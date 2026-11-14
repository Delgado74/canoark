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
import { ACTIVE_NETWORK } from '../../constants/network';
import { openStorage, type AppStorage } from '../storage/sqlite';
import { identityFromMnemonic } from './identity';

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
 * Abre la wallet de Arkade y el swap client. Una sola instancia por proceso:
 * el swap client reclama y reembolsa swaps solo mientras sigue vivo.
 */
export async function openArkadeSession(
  mnemonic: string
): Promise<ArkadeSession> {
  await closeArkadeSession();

  const storage = openStorage();
  let wallet: Wallet | null = null;

  try {
    wallet = await Wallet.create({
      identity: identityFromMnemonic(mnemonic),
      // En Expo no hay EventSource: estos providers usan expo/fetch para SSE.
      operatorProvider: new ExpoOperatorProvider(ACTIVE_NETWORK.operatorUrl),
      indexerProvider: new ExpoIndexerProvider(ACTIVE_NETWORK.indexerUrl),
      // Sin un onchain provider explícito, los depósitos al boarding dependen
      // del Esplora por defecto del SDK. Lo fijamos al de la red activa para
      // que getBoardingUtxos() consulte siempre el explorador correcto.
      onchainProvider: new EsploraProvider(ACTIVE_NETWORK.esploraUrl),
      storage: storage.walletStorage,
      // Igual que Arkade Wallet: dirección de recepción estática y delegación
      // de renovaciones al servicio configurado para la red.
      walletMode: 'static',
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

    const swaps = createSwapClient({
      wallet,
      repository: storage.swapRepository,
      // Mismo registro de solvers que usa Arkade Wallet.
      discovery: {
        network: ACTIVE_NETWORK.swapNetwork,
        registryUrl: ACTIVE_NETWORK.solverRegistryUrl,
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
