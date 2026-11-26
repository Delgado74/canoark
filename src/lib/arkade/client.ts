import {
  contractSigner,
  EsploraProvider,
  OnchainWallet,
  RestDelegateProvider,
  Wallet,
  type IVtxoManager,
  type NetworkName,
} from '@arkade-os/sdk';
import {
  ExpoIndexerProvider,
  ExpoOperatorProvider,
} from '@arkade-os/sdk/adapters/expo';
import { createSwapClient, type SwapClient } from '@arkade-os/swap';
import { corridorRecordStore, type OnchainClaim } from '@arkade-os/swap/advanced';
import {
  chainSourceFrom,
  claimOnchainFill,
  onchainHtlcScript,
  ONCHAIN_DUST_SATS,
  preimageForSwapRecord,
  rfqClaimSecretOf,
  type OnchainNetwork,
  type OnchainSendSwap,
} from '@arkade-os/swap/protocol';
import { ACTIVE_NETWORK, type NetworkConfig } from '../../constants/network';
import { openStorage, type AppStorage } from '../storage/sqlite';
import { identityFromMnemonic } from './identity';
import { selectSwapMarket } from './marketSelection';
import { solverDiscoveryOptions } from './solverDiscovery';
import type { WalletMode } from './walletMode';

export type ArkadeSession = {
  wallet: Wallet;
  swaps: SwapClient;
  storage: AppStorage;
  /**
   * Wallet onchain derivada de la misma semilla. No es la dirección de
   * boarding: su P2TR es la que paga las comisiones de una salida unilateral.
   */
  onchainWallet: OnchainWallet;
  /**
   * Manager de liquidación. Su construcción arranca el poll que convierte los
   * depósitos onchain (boarding) en saldo Arkade y renueva las salidas virtuales.
   */
  vtxoManager: IVtxoManager;
};

let session: ArkadeSession | null = null;

/**
 * Último error del reclamo L1 por `rfqId`. El drive sólo emite el fallo por el
 * listener (`emitFailed`) y no lo escribe en el registro, así que sin esto un
 * claim que falla cada 5 s deja el swap en «pending» sin explicación visible.
 */
const onchainClaimErrors = new Map<string, string>();

export function getOnchainClaimError(rfqId: string): string | undefined {
  return onchainClaimErrors.get(rfqId);
}

/**
 * Última pareja `(swap, utxo)` con la que el drive pidió reclamar. Permite
 * reintentar el claim desde la pantalla de diagnóstico cuando el drive lo dejó
 * en `pending`, y muestra el error real en vez de sólo el listener.
 */
type ClaimArgs = {
  swap: Parameters<OnchainClaim>[0];
  utxo: Parameters<OnchainClaim>[1];
};

const liveOnchainClaims = new Map<string, ClaimArgs>();

/**
 * Todo lo necesario para reintentar un claim sin depender de que el drive haya
 * llegado a `claimable`: la wallet firma, Esplora da el UTXO y el registro
 * guarda las claves del HTLC.
 */
type OnchainClaimContext = {
  claim: OnchainClaim;
  wallet: Wallet;
  provider: EsploraProvider;
  storage: AppStorage;
};

let activeOnchainContext: OnchainClaimContext | null = null;

const decodeHex = (value: string): Uint8Array => {
  const clean = value.startsWith('0x') ? value.slice(2) : value;
  if (clean.length % 2 !== 0) {
    throw new Error(`Hex de longitud impar: ${value}`);
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error(`Hex inválido: ${value}`);
    }
    bytes[index] = byte;
  }
  return bytes;
};

/**
 * Reclamo manual desde el registro guardado.
 *
 * No usa los argumentos vivos del drive: reconstruye el HTLC con las claves y
 * el locktime persistidos, busca el UTXO en Esplora y firma con el descriptor
 * del registro. Así funciona incluso si el drive nunca emitió el claim (por
 * ejemplo porque quedó en `awaiting_confirmations` o la ventana ya cerró).
 */
export async function retryOnchainClaim(
  rfqId: string
): Promise<{ txid: string }> {
  const context = activeOnchainContext;
  if (!context) {
    throw new Error(
      'La wallet de Arkade no está abierta; desbloquea de nuevo para reintentar el reclamo.'
    );
  }

  const records = corridorRecordStore(context.storage.swapRepository);
  const record = await records.getRfqSwap(rfqId);
  if (!record) {
    throw new Error(`No hay registro guardado para el swap ${rfqId}.`);
  }
  if (record.kind !== 'onchain_send') {
    throw new Error(
      `El swap ${rfqId} es ${record.kind}, no un envío Arkade → onchain.`
    );
  }

  const profile = record.profile as Record<string, unknown>;
  const secret = rfqClaimSecretOf(record);
  if (!secret) {
    throw new Error(
      `El swap ${rfqId} no guardó su secreto (hashlock); no se puede reclamar.`
    );
  }

  const claimKey = profile.claimKey;
  const refundKey = profile.refundKey;
  const htlcLocktime = profile.htlcLocktime;
  const network = profile.network;
  if (
    typeof claimKey !== 'string' ||
    typeof refundKey !== 'string' ||
    typeof htlcLocktime !== 'number'
  ) {
    throw new Error(
      `El registro ${rfqId} no tiene las claves o el locktime del HTLC; no se puede reconstruir.`
    );
  }
  const htlc = onchainHtlcScript(
    {
      paymentHash: secret.paymentHash,
      claimKey: decodeHex(claimKey),
      refundKey: decodeHex(refundKey),
      refundLocktime: htlcLocktime,
    },
    (typeof network === 'string' ? network : onchainNetwork()) as OnchainNetwork
  );
  if (
    typeof profile.htlcAddress === 'string' &&
    profile.htlcAddress !== htlc.address
  ) {
    throw new Error(
      `El HTLC reconstruido (${htlc.address}) no coincide con el guardado (${profile.htlcAddress}).`
    );
  }

  const [coins, tip] = await Promise.all([
    context.provider.getCoins(htlc.address),
    context.provider.getChainTip(),
  ]);
  if (coins.length === 0) {
    throw new Error(
      `El HTLC ${htlc.address} no tiene UTXOs en L1 todavía; revisa el explorador antes de reintentar.`
    );
  }
  const best = coins.reduce((a, b) => (b.value > a.value ? b : a));
  const confirmations =
    best.status.confirmed && typeof best.status.block_height === 'number'
      ? Math.max(0, tip.height - best.status.block_height + 1)
      : 0;
  const utxo = {
    txid: best.txid,
    vout: best.vout,
    amount: BigInt(best.value),
    confirmations,
  };

  const payoutPkScript =
    typeof profile.payoutPkScript === 'string'
      ? decodeHex(profile.payoutPkScript)
      : undefined;

  const swap = {
    kind: 'onchain_send',
    rfqId,
    htlc,
    minConfirmations:
      typeof profile.minConfirmations === 'number'
        ? profile.minConfirmations
        : 1,
    expectedAmount:
      typeof profile.expectedAmount === 'number' ? profile.expectedAmount : 0,
    ...(payoutPkScript ? { payoutPkScript } : {}),
    ...(typeof profile.claimTxid === 'string'
      ? { claimTxid: profile.claimTxid }
      : {}),
    ...(typeof profile.claimFeeRateSatVb === 'number'
      ? { claimFeeRateSatVb: profile.claimFeeRateSatVb }
      : {}),
  } as unknown as OnchainSendSwap;

  try {
    return await context.claim(swap, utxo);
  } catch (error) {
    onchainClaimErrors.set(
      rfqId,
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  }
}

/** Los 152 vB que ocupa el claim; sólo se usa para no gastar por debajo del dust. */
const CLAIM_VSIZE = 152;

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

/**
 * L1 que usa el corredor onchain. En Arkade, signet y mutinynet comparten los
 * parámetros de testnet; el SDK sólo nombra bitcoin/testnet/regtest.
 */
const onchainNetwork = (): OnchainNetwork =>
  ACTIVE_NETWORK.isMainnet ? 'bitcoin' : 'testnet';

/**
 * Reclamo de nuestro lado del HTLC en un envío Arkade → onchain.
 *
 * En este corredor el solver financia un HTLC en L1 y **nosotros** debemos
 * reclamarlo con la preimagen; es esa transacción la que paga `receiverPkScript`
 * (la dirección de destino). Si el claim no se cablea, el drive marca la pata L1
 * como bloqueada y el destino nunca recibe.
 *
 * Se cablea explícitamente (como hace Arkade Wallet) en vez de depender del
 * claim por defecto: así el script de pago se lee siempre del swap, la tarifa se
 * estima contra la red activa y la firma va por la identidad, no por un
 * descriptor derivado.
 */
function createOnchainClaim(
  wallet: Wallet,
  provider: EsploraProvider,
  storage: AppStorage
): OnchainClaim {
  const chain = chainSourceFrom(provider, onchainNetwork());
  const records = corridorRecordStore(storage.swapRepository);

  return async (swap, utxo, options) => {
    liveOnchainClaims.set(swap.rfqId, { swap, utxo });
    try {
      const record = await records.getRfqSwap(swap.rfqId);
      if (!record) {
        throw new Error(
          `No hay registro guardado para el swap ${swap.rfqId}; no se puede reclamar.`
        );
      }
      const secret = rfqClaimSecretOf(record);
      if (!secret) {
        throw new Error(
          `El swap ${swap.rfqId} no guardó su secreto (hashlock); no se puede reclamar.`
        );
      }
      if (!swap.payoutPkScript) {
        throw new Error(
          `El swap ${swap.rfqId} no trae el script de pago del destinatario; se rechaza reclamar a otra dirección.`
        );
      }

      // El firmante sale del descriptor guardado, no de `wallet.identity`: es el
      // mismo criterio con el que se provisionó la preimagen y con el que se
      // declaró `claimKey` en la cotización.
      const signer = await contractSigner(wallet, secret.signingDescriptor);
      const expectedClaimKey = record.profile.claimKey;
      if (typeof expectedClaimKey === 'string') {
        const held = toHex(await signer.xOnlyPublicKey());
        if (held !== expectedClaimKey.toLowerCase()) {
          throw new Error(
            `La clave de esta wallet (${held}) no es la clave de reclamo ${expectedClaimKey} con la que se cotizó el swap ${swap.rfqId}; semilla o derivación incorrectas.`
          );
        }
      }

      // Si no hay estimación, se usa 1 sat/vB (el mínimo de Mutinynet) en vez de
      // dejar la pata sin reclamar. La preimagen sólo se publica en el claim.
      let feeRateSatVb = 1;
      try {
        const estimate = await chain.getFeeRate?.();
        if (estimate !== undefined && Number.isFinite(estimate) && estimate > 0) {
          feeRateSatVb = Math.ceil(estimate);
        }
      } catch {
        // Se mantiene el mínimo: el claim debe salir igualmente.
      }
      if (options?.bump && swap.claimFeeRateSatVb) {
        feeRateSatVb = Math.max(
          feeRateSatVb,
          Math.ceil(swap.claimFeeRateSatVb * 1.5)
        );
      }
      // Nunca por encima de lo que deja el pago por encima del dust.
      const affordable = Number(
        (utxo.amount - BigInt(ONCHAIN_DUST_SATS)) / BigInt(CLAIM_VSIZE)
      );
      if (Number.isFinite(affordable) && affordable > 0) {
        feeRateSatVb = Math.min(feeRateSatVb, Math.floor(affordable));
      }

      const preimage = await preimageForSwapRecord(wallet, secret);
      const { txid } = await claimOnchainFill(chain, {
        htlc: swap.htlc,
        utxo,
        preimage,
        payoutPkScript: swap.payoutPkScript,
        feeRateSatVb,
        sign: sighash => signer.signMessage(sighash, 'schnorr'),
        ...(swap.claimTxid ? { republish: true } : {}),
      });
      onchainClaimErrors.delete(swap.rfqId);
      return { txid, feeRateSatVb };
    } catch (error) {
      onchainClaimErrors.set(
        swap.rfqId,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  };
}

/**
 * Fronteras de red sustituibles solo por los tests de integración. La app
 * siempre usa `ACTIVE_NETWORK` (inlineado al compilar); el regtest de CI necesita
 * apuntar los mismos providers a localhost sin reconstruir el bundle.
 */
export type ArkadeSessionOverrides = Partial<
  Pick<
    NetworkConfig,
    'operatorUrl' | 'indexerUrl' | 'esploraUrl' | 'delegateUrl' | 'solverRegistryUrl'
  >
> & { swapNetwork?: NetworkName };

/**
 * Abre la wallet de Arkade y el swap client. Una sola instancia por proceso:
 * el swap client reclama y reembolsa swaps solo mientras sigue vivo.
 */
export async function openArkadeSession(
  mnemonic: string,
  walletMode: WalletMode = 'static',
  overrides: ArkadeSessionOverrides = {}
): Promise<ArkadeSession> {
  await closeArkadeSession();
  onchainClaimErrors.clear();

  const network = { ...ACTIVE_NETWORK, ...overrides };
  const storage = openStorage();
  let wallet: Wallet | null = null;

  try {
    const onchainProvider = new EsploraProvider(network.esploraUrl);

    wallet = await Wallet.create({
      identity: identityFromMnemonic(mnemonic),
      // En Expo no hay EventSource: estos providers usan expo/fetch para SSE.
      operatorProvider: new ExpoOperatorProvider(network.operatorUrl),
      indexerProvider: new ExpoIndexerProvider(network.indexerUrl),
      // Sin un onchain provider explícito, los depósitos al boarding dependen
      // del Esplora por defecto del SDK. Lo fijamos al de la red activa para
      // que getBoardingUtxos() consulte siempre el explorador correcto.
      onchainProvider,
      storage: storage.walletStorage,
      // El modo se elige al crear/restaurar. `hd` rota la dirección de
      // recepción (BIP86) y vigila la ventana anterior; `static` mantiene una
      // única dirección, como las instalaciones antiguas.
      walletMode,
      ...(network.delegateUrl
        ? { delegateProvider: new RestDelegateProvider(network.delegateUrl) }
        : {}),
      // Renueva virtual outputs que expiran dentro de 3 días y barre los
      // depósitos onchain confirmados para convertirlos en saldo Arkade.
      settlementConfig: {
        vtxoThreshold: ACTIVE_NETWORK.vtxoThresholdSeconds,
        boardingUtxoSweep: true,
        pollIntervalMs: 60_000,
      },
    });

    const createdWallet = wallet;
    // Misma identidad, red Bitcoin real. Esta P2TR es independiente de la
    // dirección de boarding y solo se usa para financiar salidas unilaterales.
    const onchainWallet = await OnchainWallet.create(
      createdWallet.identity,
      network.swapNetwork as NetworkName,
      onchainProvider
    );
    const onchainClaim = createOnchainClaim(
      createdWallet,
      onchainProvider,
      storage
    );
    activeOnchainContext = {
      claim: onchainClaim,
      wallet: createdWallet,
      provider: onchainProvider,
      storage,
    };
    const swaps = createSwapClient({
      wallet: createdWallet,
      repository: storage.swapRepository,
      // Registro de solvers, tarjetas publicadas por Nostr y tarjetas locales.
      // En mainnet el registro está vacío y Lightning lo aporta la tarjeta del build.
      discovery: solverDiscoveryOptions(
        network as Pick<NetworkConfig, 'swapNetwork' | 'solverRegistryUrl'>
      ),
      // El registro puede publicar varias tarjetas para el mismo par; sin esta
      // política el cliente se queda con la primera y una tarjeta RFQ obsoleta
      // responde `unsupported_pair` aunque el mercado de precio sí cotice.
      policy: { selectMarket: selectSwapMarket },
      corridors: {
        onchain: {
          // Sin esta fuente de cadena el drive no puede ver el HTLC ni
          // reclamarlo; con ella, el claim paga la dirección de destino.
          chain: { provider: onchainProvider },
          claim: onchainClaim,
        },
      },
    });
    await swaps.ready;

    // Igual que Arkade Wallet: obtener el VtxoManager es lo que arranca el
    // ciclo de liquidación. Sin esta llamada `settlementConfig` solo queda
    // guardado y los depósitos onchain nunca se barajan a saldo Arkade.
    const vtxoManager = await wallet.getVtxoManager();

    session = { wallet, swaps, storage, onchainWallet, vtxoManager };
    return session;
  } catch (err) {
    await wallet?.dispose().catch(() => undefined);
    await storage.close().catch(() => undefined);
    throw err;
  }
}

export function getArkadeSession(): ArkadeSession {
  if (!session) {
    throw new Error('La billetera está bloqueada.');
  }
  return session;
}

export async function closeArkadeSession(): Promise<void> {
  const current = session;
  session = null;
  activeOnchainContext = null;
  liveOnchainClaims.clear();
  if (!current) return;

  await current.swaps[Symbol.asyncDispose]().catch(() => undefined);
  await current.wallet.dispose().catch(() => undefined);
  await current.storage.close().catch(() => undefined);
}
