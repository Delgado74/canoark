import {
  EsploraProvider,
  RestDelegateProvider,
  Wallet,
  type IVtxoManager,
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
  preimageForSwapRecord,
  rfqClaimSecretOf,
  type OnchainNetwork,
} from '@arkade-os/swap/protocol';
import { ACTIVE_NETWORK } from '../../constants/network';
import { openStorage, type AppStorage } from '../storage/sqlite';
import { identityFromMnemonic } from './identity';
import type { WalletMode } from './walletMode';

export type ArkadeSession = {
  wallet: Wallet;
  swaps: SwapClient;
  storage: AppStorage;
  /**
   * Manager de liquidación. Su construcción arranca el poll que convierte los
   * depósitos onchain (boarding) en saldo Arkade y renueva los VTXOs.
   */
  vtxoManager: IVtxoManager;
};

let session: ArkadeSession | null = null;

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

    const preimage = await preimageForSwapRecord(wallet, secret);
    const { txid } = await claimOnchainFill(chain, {
      htlc: swap.htlc,
      utxo,
      preimage,
      payoutPkScript: swap.payoutPkScript,
      feeRateSatVb,
      // La firma del claim es de la identidad, el mismo criterio con el que se
      // provisionó la preimagen.
      sign: sighash => wallet.identity.signMessage(sighash, 'schnorr'),
      ...(swap.claimTxid ? { republish: true } : {}),
    });
    return { txid, feeRateSatVb };
  };
}

/**
 * Abre la wallet de Arkade y el swap client. Una sola instancia por proceso:
 * el swap client reclama y reembolsa swaps solo mientras sigue vivo.
 */
export async function openArkadeSession(
  mnemonic: string,
  walletMode: WalletMode = 'static'
): Promise<ArkadeSession> {
  await closeArkadeSession();

  const storage = openStorage();
  let wallet: Wallet | null = null;

  try {
    const onchainProvider = new EsploraProvider(ACTIVE_NETWORK.esploraUrl);

    wallet = await Wallet.create({
      identity: identityFromMnemonic(mnemonic),
      // En Expo no hay EventSource: estos providers usan expo/fetch para SSE.
      operatorProvider: new ExpoOperatorProvider(ACTIVE_NETWORK.operatorUrl),
      indexerProvider: new ExpoIndexerProvider(ACTIVE_NETWORK.indexerUrl),
      // Sin un onchain provider explícito, los depósitos al boarding dependen
      // del Esplora por defecto del SDK. Lo fijamos al de la red activa para
      // que getBoardingUtxos() consulte siempre el explorador correcto.
      onchainProvider,
      storage: storage.walletStorage,
      // El modo se elige al crear/restaurar. `hd` rota la dirección de
      // recepción (BIP86) y vigila la ventana anterior; `static` mantiene una
      // única dirección, como las instalaciones antiguas.
      walletMode,
      ...(ACTIVE_NETWORK.delegateUrl
        ? { delegateProvider: new RestDelegateProvider(ACTIVE_NETWORK.delegateUrl) }
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
    const swaps = createSwapClient({
      wallet: createdWallet,
      repository: storage.swapRepository,
      // Mismo registro de solvers que usa Arkade Wallet.
      discovery: {
        network: ACTIVE_NETWORK.swapNetwork,
        registryUrl: ACTIVE_NETWORK.solverRegistryUrl,
      },
      corridors: {
        onchain: {
          // Sin esta fuente de cadena el drive no puede ver el HTLC ni
          // reclamarlo; con ella, el claim paga la dirección de destino.
          chain: { provider: onchainProvider },
          claim: createOnchainClaim(createdWallet, onchainProvider, storage),
        },
      },
    });
    await swaps.ready;

    // Igual que Arkade Wallet: obtener el VtxoManager es lo que arranca el
    // ciclo de liquidación. Sin esta llamada `settlementConfig` solo queda
    // guardado y los depósitos onchain nunca se barajan a saldo Arkade.
    const vtxoManager = await wallet.getVtxoManager();

    session = { wallet, swaps, storage, vtxoManager };
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
  if (!current) return;

  await current.swaps[Symbol.asyncDispose]().catch(() => undefined);
  await current.wallet.dispose().catch(() => undefined);
  await current.storage.close().catch(() => undefined);
}
