import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { PayResult } from '@arkade-os/swap';
import type { WalletBalance } from '@arkade-os/sdk';
import { ACTIVE_NETWORK, type NetworkConfig } from '../constants/network';
import type { BalanceView } from '../types/wallet';
import { closeArkadeSession, getArkadeSession, openArkadeSession } from '../lib/arkade/client';
import {
  canUseBiometrics,
  deleteWalletSecrets,
  getMnemonicAuthMode,
  hasStoredWallet,
  isValidMnemonic,
  loadWalletMnemonic,
  normalizeMnemonic,
  saveWalletMnemonic,
  type SaveMode,
  type SaveResult,
} from '../lib/arkade/identity';
import {
  forgetLnurlSecrets,
  isArkadeAddress,
  payThroughSolver,
  receiveLightning,
  watchSwap,
} from '../lib/arkade/lightning';
import { wipeStorageDatabases } from '../lib/storage/sqlite';
import { errorMessage } from '../lib/format';

export type WalletStatus = 'loading' | 'empty' | 'locked' | 'unlocked';

export type SendOutcome =
  | { kind: 'arkade'; txid: string }
  | PayResult;

export interface CreateWalletOptions {
  mnemonic: string;
  mode: SaveMode;
  passphrase?: string;
}

export interface UnlockOptions {
  passphrase?: string;
}

type WalletContextValue = {
  status: WalletStatus;
  busy: boolean;
  refreshing: boolean;
  error: string | null;
  balance: BalanceView | null;
  address: string | null;
  boardingAddress: string | null;
  network: NetworkConfig;
  /** true si la wallet guardada se desbloquea con passphrase (no biometría). */
  requiresPassphrase: boolean;
  clearError: () => void;
  /** Devuelve el resultado del guardado (degradación incluida). */
  createWallet: (options: CreateWalletOptions) => Promise<SaveResult>;
  /** Acepta passphrase para wallets guardadas en modo passphrase. */
  unlock: (options?: UnlockOptions) => Promise<void>;
  lock: () => Promise<void>;
  wipe: () => Promise<void>;
  refresh: () => Promise<void>;
  sendPayment: (
    destination: string,
    amountSats: number,
    maxFeeSats: number
  ) => Promise<SendOutcome>;
  createInvoice: (amountSats: number) => Promise<{
    id: string;
    invoice: string;
  }>;
  watchOutcome: (
    swapId: string,
    onOutcome: (outcome: string) => void
  ) => () => void;
};

const WalletContext = createContext<WalletContextValue | null>(null);

/** Tras este tiempo en segundo plano la wallet se bloquea. */
const RELOCK_AFTER_MS = 2 * 60 * 1000;

const toBalanceView = (raw: WalletBalance): BalanceView => ({
  available: raw.available,
  settled: raw.settled,
  preconfirmed: raw.preconfirmed,
  recoverable: raw.recoverable,
  boarding: raw.boarding.total,
});

export function WalletProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<WalletStatus>('loading');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<BalanceView | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [boardingAddress, setBoardingAddress] = useState<string | null>(null);
  const [requiresPassphrase, setRequiresPassphrase] = useState<boolean>(false);

  const mnemonicRef = useRef<string | null>(null);
  const statusRef = useRef<WalletStatus>('loading');
  const backgroundAtRef = useRef<number | null>(null);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const exists = await hasStoredWallet();
      if (cancelled) return;
      setStatus(exists ? 'locked' : 'empty');
      if (exists) {
        const authMode = await getMnemonicAuthMode();
        if (!cancelled) setRequiresPassphrase(authMode === 'passphrase');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const resetState = useCallback(() => {
    setBalance(null);
    setAddress(null);
    setBoardingAddress(null);
    setError(null);
  }, []);

  const ensureSession = useCallback(async () => {
    try {
      return getArkadeSession();
    } catch {
      const mnemonic = mnemonicRef.current;
      if (!mnemonic) {
        throw new Error('La billetera está bloqueada.');
      }
      return openArkadeSession(mnemonic);
    }
  }, []);

  const connect = useCallback(async () => {
    const session = await ensureSession();
    const [nextAddress, nextBoardingAddress, rawBalance] = await Promise.all([
      session.wallet.getAddress(),
      session.wallet.getBoardingAddress(),
      session.wallet.getBalance(),
    ]);
    setAddress(nextAddress);
    setBoardingAddress(nextBoardingAddress);
    setBalance(toBalanceView(rawBalance));
  }, [ensureSession]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await connect();
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRefreshing(false);
    }
  }, [connect]);

  const createWallet = useCallback(
    async (options: CreateWalletOptions): Promise<SaveResult> => {
      const phrase = normalizeMnemonic(options.mnemonic);
      if (!isValidMnemonic(phrase)) {
        throw new Error('La frase de recuperación no es válida.');
      }

      setBusy(true);
      setError(null);
      try {
        const result = await saveWalletMnemonic(phrase, {
          mode: options.mode,
          passphrase: options.passphrase,
        });
        mnemonicRef.current = phrase;
        setStatus('unlocked');
        statusRef.current = 'unlocked';
        setRequiresPassphrase(result.mode === 'passphrase');

        try {
          await connect();
        } catch (err) {
          // La wallet existe y está desbloqueada; el error es de red.
          setError(errorMessage(err));
        }
        return result;
      } finally {
        setBusy(false);
      }
    },
    [connect]
  );

  const unlock = useCallback(
    async (options?: UnlockOptions) => {
      setBusy(true);
      setError(null);
      try {
        const mnemonic = await loadWalletMnemonic({
          passphrase: options?.passphrase,
        });
        mnemonicRef.current = mnemonic;
        setStatus('unlocked');
        statusRef.current = 'unlocked';

        try {
          await connect();
        } catch (err) {
          setError(errorMessage(err));
        }
      } catch (err) {
        setError(errorMessage(err));
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [connect]
  );

  const lock = useCallback(async () => {
    mnemonicRef.current = null;
    await closeArkadeSession();
    resetState();
    setStatus('locked');
    statusRef.current = 'locked';
  }, [resetState]);

  const wipe = useCallback(async () => {
    setBusy(true);
    try {
      mnemonicRef.current = null;
      await closeArkadeSession();
      await deleteWalletSecrets();
      await forgetLnurlSecrets();
      await wipeStorageDatabases();
      resetState();
      setStatus('empty');
      statusRef.current = 'empty';
      setRequiresPassphrase(false);
    } finally {
      setBusy(false);
    }
  }, [resetState]);

  const sendPayment = useCallback(
    async (destination: string, amountSats: number, maxFeeSats: number) => {
      const session = await ensureSession();
      const target = destination.trim();
      if (!target) throw new Error('Indica un destino.');

      if (isArkadeAddress(target)) {
        if (amountSats <= 0) {
          throw new Error('Indica cuántos sats quieres enviar.');
        }
        const txid = await session.wallet.send({
          recipients: [
            { address: target, amount: Math.floor(amountSats) },
          ],
        });
        await refresh();
        return { kind: 'arkade' as const, txid };
      }

      const result = await payThroughSolver(target, amountSats, maxFeeSats);
      await refresh();
      return result;
    },
    [ensureSession, refresh]
  );

  const createInvoice = useCallback(
    async (amountSats: number) => {
      await ensureSession();
      if (amountSats <= 0) {
        throw new Error('Indica cuántos sats quieres recibir.');
      }
      return receiveLightning(amountSats);
    },
    [ensureSession]
  );

  const watchOutcome = useCallback(
    (swapId: string, onOutcome: (outcome: string) => void) =>
      watchSwap(swapId, onOutcome),
    []
  );

  useEffect(() => {
    const subscription = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        if (nextState === 'background' || nextState === 'inactive') {
          if (backgroundAtRef.current === null) {
            backgroundAtRef.current = Date.now();
          }
          return;
        }

        if (nextState === 'active') {
          const since = backgroundAtRef.current;
          backgroundAtRef.current = null;
          if (
            since !== null &&
            Date.now() - since > RELOCK_AFTER_MS &&
            statusRef.current === 'unlocked'
          ) {
            void lock();
          }
        }
      }
    );

    return () => subscription.remove();
  }, [lock]);

  const value: WalletContextValue = {
    status,
    busy,
    refreshing,
    error,
    balance,
    address,
    boardingAddress,
    network: ACTIVE_NETWORK,
    requiresPassphrase,
    clearError: () => setError(null),
    createWallet,
    unlock,
    lock,
    wipe,
    refresh,
    sendPayment,
    createInvoice,
    watchOutcome,
  };

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet debe usarse dentro de WalletProvider.');
  }
  return context;
}
