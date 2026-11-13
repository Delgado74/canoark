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
import type { ArkTransaction, WalletBalance } from '@arkade-os/sdk';
import { ACTIVE_NETWORK, type NetworkConfig } from '../constants/network';
import type { BalanceView } from '../types/wallet';
import { closeArkadeSession, getArkadeSession, openArkadeSession } from '../lib/arkade/client';
import {
  canUseBiometrics,
  createWalletSecrets,
  deleteWalletSecrets,
  hasBiometricUnlock,
  hasStoredWallet,
  isValidMnemonic,
  loadWalletMnemonicWithBiometrics,
  loadWalletMnemonicWithPassphrase,
  normalizeMnemonic,
  type CreateWalletResult,
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

type WalletContextValue = {
  status: WalletStatus;
  busy: boolean;
  refreshing: boolean;
  error: string | null;
  balance: BalanceView | null;
  address: string | null;
  boardingAddress: string | null;
  history: ArkTransaction[];
  network: NetworkConfig;
  /** true si este dispositivo puede usar biometría con SecureStore (Class 3). */
  biometricAvailable: boolean;
  /** true si la wallet guardada tiene desbloqueo biométrico configurado. */
  biometricEnabled: boolean;
  clearError: () => void;
  createWallet: (input: {
    mnemonic: string;
    passphrase: string;
    useBiometrics?: boolean;
  }) => Promise<CreateWalletResult>;
  unlock: (options?: {
    passphrase?: string;
    useBiometrics?: boolean;
  }) => Promise<void>;
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
  /** Solo disponible con la billetera desbloqueada. */
  revealMnemonic: () => string | null;
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
  const [history, setHistory] = useState<ArkTransaction[]>([]);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricAvailable] = useState(() => canUseBiometrics());

  const mnemonicRef = useRef<string | null>(null);
  const statusRef = useRef<WalletStatus>('loading');
  const backgroundAtRef = useRef<number | null>(null);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [exists, biometric] = await Promise.all([
        hasStoredWallet(),
        hasBiometricUnlock(),
      ]);
      if (cancelled) return;
      setStatus(exists ? 'locked' : 'empty');
      setBiometricEnabled(biometric);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const resetState = useCallback(() => {
    setBalance(null);
    setAddress(null);
    setBoardingAddress(null);
    setHistory([]);
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

    try {
      const transactions = await session.wallet.getTransactionHistory();
      setHistory(
        [...transactions].sort((a, b) => b.createdAt - a.createdAt)
      );
    } catch {
      // El historial es secundario: no debe tumbar la sincronización.
    }
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
    async ({
      mnemonic,
      passphrase,
      useBiometrics = false,
    }: {
      mnemonic: string;
      passphrase: string;
      useBiometrics?: boolean;
    }) => {
      const phrase = normalizeMnemonic(mnemonic);
      if (!isValidMnemonic(phrase)) {
        throw new Error('La frase de recuperación no es válida.');
      }

      setBusy(true);
      setError(null);
      try {
        const result = await createWalletSecrets({
          mnemonic: phrase,
          passphrase,
          useBiometrics: useBiometrics && biometricAvailable,
        });
        setBiometricEnabled(result.biometricEnabled);
        mnemonicRef.current = phrase;
        setStatus('unlocked');
        statusRef.current = 'unlocked';

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
    [biometricAvailable, connect]
  );

  const unlock = useCallback(
    async ({
      passphrase,
      useBiometrics = false,
    }: { passphrase?: string; useBiometrics?: boolean } = {}) => {
      setBusy(true);
      setError(null);
      try {
        const mnemonic = useBiometrics
          ? await loadWalletMnemonicWithBiometrics()
          : await loadWalletMnemonicWithPassphrase(passphrase ?? '');
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
      setBiometricEnabled(false);
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

  const revealMnemonic = useCallback(() => mnemonicRef.current, []);

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
    history,
    network: ACTIVE_NETWORK,
    biometricAvailable,
    biometricEnabled,
    clearError: () => setError(null),
    createWallet,
    unlock,
    lock,
    wipe,
    refresh,
    sendPayment,
    createInvoice,
    watchOutcome,
    revealMnemonic,
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
