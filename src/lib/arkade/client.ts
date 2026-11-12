import { Wallet } from '@arkade-os/sdk';
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
      storage: storage.walletStorage,
      // Renueva virtual outputs que expiran dentro de 3 días.
      settlementConfig: {
        vtxoThreshold: ACTIVE_NETWORK.vtxoThresholdSeconds,
      },
    });

    const swaps = createSwapClient({
      wallet,
      repository: storage.swapRepository,
    });
    await swaps.ready;

    session = { wallet, swaps, storage };
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
