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
import {
  ArkAddress,
  ArkNote,
  Estimator,
  VtxoScript,
  hasBoardingTxExpired,
  type ArkTransaction,
  type ExtendedCoin,
  type NormalizedExtendedVirtualCoin,
  type RelativeTimelock,
  type WalletBalance,
} from '@arkade-os/sdk';
import { ACTIVE_NETWORK, type NetworkConfig } from '../constants/network';
import type { BalanceView, CoinView } from '../types/wallet';
import { closeArkadeSession, getArkadeSession, openArkadeSession } from '../lib/arkade/client';
import {
  canUseBiometrics,
  changeWalletPassphrase,
  createWalletSecrets,
  deleteWalletSecrets,
  hasBiometricUnlock,
  hasStoredWallet,
  isValidMnemonic,
  loadWalletMnemonicWithBiometrics,
  loadWalletMnemonicWithPassphrase,
  normalizeMnemonic,
  type ChangePassphraseResult,
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
  /** Virtual outputs y UTXOs de boarding, con vencimiento y estado. */
  coins: CoinView[];
  coinsLoaded: boolean;
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
  /** Recarga los coins (VTXOs + UTXOs de boarding) bajo demanda. */
  loadCoins: () => Promise<CoinView[]>;
  /** Canjea una o varias notas Ark separadas por espacios. */
  redeemNotes: (note: string) => Promise<void>;
  /**
   * Convierte los depósitos onchain confirmados en saldo Arkade sin esperar
   * al ciclo automático del SDK. Devuelve los sats liquidados.
   */
  settleBoarding: () => Promise<number>;
  /** Cambia la passphrase que cifra la semilla en este dispositivo. */
  changePassphrase: (
    currentPassphrase: string,
    nextPassphrase: string,
    useBiometrics: boolean
  ) => Promise<ChangePassphraseResult>;
};

const WalletContext = createContext<WalletContextValue | null>(null);

/** Tras este tiempo en segundo plano la wallet se bloquea. */
const RELOCK_AFTER_MS = 2 * 60 * 1000;

/** Hex de un script, sin depender de utilidades externas al SDK. */
const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

/**
 * El timelock de salida más corto del boarding UTXO, que es el que decide si
 * ya venció y por tanto si se puede liquidar o hay que barrerlo. Réplica de
 * `isExpiredUtxo` de Arkade Wallet.
 */
function earliestBoardingTimelock(
  utxo: ExtendedCoin
): RelativeTimelock | undefined {
  let earliest: RelativeTimelock | undefined;
  for (const path of VtxoScript.decode(utxo.tapTree).exitPaths()) {
    earliest = !earliest || path.params.timelock.value < earliest.value
      ? path.params.timelock
      : earliest;
  }
  return earliest;
}

function isBoardingUtxoExpired(utxo: ExtendedCoin): boolean {
  const timelock = earliestBoardingTimelock(utxo);
  return timelock ? hasBoardingTxExpired(utxo, timelock) : false;
}

const OUTPUT_FEE_ROUNDS = 8;

/**
 * Importe de salida que cumple `out + fee(out) = amount`. El operador cobra
 * sobre el importe que recibe, así que restar la comisión del total una sola
 * vez se queda corto. Misma lógica que `outputAfterItsFee` de Arkade Wallet.
 */
function outputAfterItsFee(
  estimator: Estimator,
  address: string,
  amount: number
): number {
  const script = toHex(ArkAddress.decode(address).pkScript);
  let out = amount;
  for (let round = 0; round < OUTPUT_FEE_ROUNDS; round++) {
    const next =
      amount -
      estimator.evalOffchainOutput({
        amount: BigInt(Math.max(out, 0)),
        script,
      }).satoshis;
    if (next === out) return Math.max(out, 0);
    out = next;
  }
  throw new Error(`La comisión de salida no cuadra para ${amount} sats.`);
}

const toBalanceView = (raw: WalletBalance): BalanceView => ({
  available: raw.available,
  settled: raw.settled,
  preconfirmed: raw.preconfirmed,
  recoverable: raw.recoverable,
  boarding: raw.boarding.total,
  boardingConfirmed: raw.boarding.confirmed,
  boardingUnconfirmed: raw.boarding.unconfirmed,
});

const vtxoStatus = (vtxo: NormalizedExtendedVirtualCoin): CoinView['status'] => {
  if (vtxo.isSpent) return 'spent';
  if (vtxo.isSwept) return 'swept';
  if (vtxo.isPreconfirmed) return 'preconfirmed';
  return 'settled';
};

function toCoinViews(
  vtxos: NormalizedExtendedVirtualCoin[],
  boarding: ExtendedCoin[],
  boardingExitDelay: number
): CoinView[] {
  const virtual = vtxos.map<CoinView>(vtxo => ({
    id: `vtxo:${vtxo.txid}:${vtxo.vout}`,
    kind: 'vtxo',
    value: vtxo.value,
    txid: vtxo.txid,
    vout: vtxo.vout,
    expiresAt: vtxo.expiresAt ? vtxo.expiresAt.getTime() : null,
    createdAt: vtxo.createdAt ? vtxo.createdAt.getTime() : null,
    status: vtxoStatus(vtxo),
    isSpent: Boolean(vtxo.isSpent),
    isSwept: Boolean(vtxo.isSwept),
  }));

  const onchain = boarding.map<CoinView>(utxo => ({
    id: `boarding:${utxo.txid}:${utxo.vout}`,
    kind: 'boarding',
    value: utxo.value,
    txid: utxo.txid,
    vout: utxo.vout,
    expiresAt: utxo.status.block_time
      ? (utxo.status.block_time + boardingExitDelay) * 1000
      : null,
    createdAt: utxo.status.block_time
      ? utxo.status.block_time * 1000
      : null,
    status: utxo.status.confirmed ? 'settled' : 'unconfirmed',
    isSpent: false,
    isSwept: false,
  }));

  return [...virtual, ...onchain].sort((a, b) => b.value - a.value);
}

/** Cada cuánto se refresca el saldo mientras la app está en primer plano. */
const BALANCE_POLL_MS = 30 * 1000;

/** Espera tras un aviso de fondos para dejar que el indexer actualice su caché. */
const INCOMING_DEBOUNCE_MS = 1200;

export function WalletProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<WalletStatus>('loading');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<BalanceView | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [boardingAddress, setBoardingAddress] = useState<string | null>(null);
  const [history, setHistory] = useState<ArkTransaction[]>([]);
  const [coins, setCoins] = useState<CoinView[]>([]);
  const [coinsLoaded, setCoinsLoaded] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricAvailable] = useState(() => canUseBiometrics());

  const mnemonicRef = useRef<string | null>(null);
  const statusRef = useRef<WalletStatus>('loading');
  const backgroundAtRef = useRef<number | null>(null);
  const appStateRef = useRef<AppStateStatus>(
    (AppState.currentState ?? 'active') as AppStateStatus
  );
  const stopIncomingRef = useRef<(() => void) | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    setCoins([]);
    setCoinsLoaded(false);
    setSessionReady(false);
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

  const loadCoins = useCallback(async () => {
    const session = await ensureSession();
    const [vtxos, boarding, info] = await Promise.all([
      session.wallet.getVtxos({ withRecoverable: true }),
      session.wallet.getBoardingUtxos(),
      session.wallet.getOperatorInfo().catch(() => null),
    ]);
    const exitDelay = info ? Number(info.boardingExitDelay) : 0;
    const next = toCoinViews(vtxos, boarding, exitDelay);
    setCoins(next);
    setCoinsLoaded(true);
    return next;
  }, [ensureSession]);

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

    try {
      await loadCoins();
    } catch {
      // El listado de coins es secundario; el saldo ya está actualizado.
    }

    setSessionReady(true);
  }, [ensureSession, loadCoins]);

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

  /**
   * Sincroniza saldo e historial sin mostrar el spinner de pull-to-refresh.
   * La usan el polling y los avisos del SDK.
   */
  const syncBalance = useCallback(async () => {
    try {
      await connect();
    } catch {
      // Un fallo de red transitorio no debe borrar el saldo ya mostrado.
    }
  }, [connect]);

  /** Agrupa ráfagas de eventos (p. ej. utxo + vtxo del mismo depósito). */
  const scheduleSync = useCallback(() => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      syncTimerRef.current = null;
      void syncBalance();
    }, INCOMING_DEBOUNCE_MS);
  }, [syncBalance]);

  const stopIncomingWatcher = useCallback(() => {
    const stop = stopIncomingRef.current;
    stopIncomingRef.current = null;
    stop?.();
  }, []);

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
    stopIncomingWatcher();
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    await closeArkadeSession();
    resetState();
    setStatus('locked');
    statusRef.current = 'locked';
  }, [resetState, stopIncomingWatcher]);

  const wipe = useCallback(async () => {
    setBusy(true);
    try {
      mnemonicRef.current = null;
      stopIncomingWatcher();
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }
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
  }, [resetState, stopIncomingWatcher]);

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

  const redeemNotes = useCallback(
    async (note: string) => {
      const session = await ensureSession();
      const raw = note.trim();
      if (!raw) throw new Error('Introduce una nota Ark.');
      const inputs = raw
        .split(/\s+/)
        .filter(Boolean)
        .map(value => ArkNote.fromString(value));
      if (inputs.length === 0) throw new Error('La nota no es válida.');
      const amount = inputs.reduce(
        (total, input) => total + BigInt(input.value),
        0n
      );
      const address = await session.wallet.getAddress();
      await session.wallet.settle({
        inputs,
        outputs: [{ address, amount }],
      });
      await refresh();
    },
    [ensureSession, refresh]
  );

  const settleBoarding = useCallback(async () => {
    const session = await ensureSession();
    const [utxos, info] = await Promise.all([
      session.wallet.getBoardingUtxos(),
      session.wallet.getOperatorInfo(),
    ]);

    // Mismo criterio que Arkade Wallet: solo UTXOs confirmados, no expirados
    // y cuyo fee de entrada no se coma el importe.
    const estimator = new Estimator(info.fees.intentFee ?? {});
    const priced = utxos
      .filter(utxo => utxo.status.confirmed && !isBoardingUtxoExpired(utxo))
      .map(input => {
        const fee = estimator.evalOnchainInput({
          amount: BigInt(input.value),
        }).satoshis;
        return { input, fee };
      })
      .filter(({ input, fee }) => fee < input.value);

    if (priced.length === 0) {
      throw new Error(
        'No hay depósitos onchain confirmados y liquidables (o están por debajo de la comisión).'
      );
    }

    const address = await session.wallet.getAddress();
    const net = priced.reduce(
      (sum, { input, fee }) => sum + input.value - fee,
      0
    );
    const amount = outputAfterItsFee(estimator, address, net);
    const dust = Number(info.dust);
    if (amount < dust) {
      throw new Error(
        `El importe liquidable (${amount} sats) está por debajo del mínimo (${dust} sats).`
      );
    }

    await session.wallet.settle({
      inputs: priced.map(({ input }) => input),
      outputs: [{ address, amount: BigInt(amount) }],
    });
    await refresh();
    return amount;
  }, [ensureSession, refresh]);

  const changePassphrase = useCallback(
    async (
      currentPassphrase: string,
      nextPassphrase: string,
      useBiometrics: boolean
    ) => {
      const result = await changeWalletPassphrase(
        currentPassphrase,
        nextPassphrase,
        useBiometrics
      );
      setBiometricEnabled(result.biometricEnabled);
      return result;
    },
    []
  );

  const revealMnemonic = useCallback(() => mnemonicRef.current, []);

  /**
   * El SDK emite avisos de fondos nuevos (boarding y virtual outputs) mientras
   * la wallet está viva. Refrescamos para que el saldo no dependa de que el
   * usuario haga pull-to-refresh.
   */
  useEffect(() => {
    if (status !== 'unlocked' || !sessionReady) {
      stopIncomingWatcher();
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const session = await ensureSession();
        const stop = await session.wallet.notifyIncomingFunds(() => {
          scheduleSync();
        });
        if (cancelled) {
          stop();
          return;
        }
        stopIncomingRef.current = stop;
      } catch {
        // Si el SSE no está disponible, el polling sigue cubriendo el saldo.
      }
    })();

    return () => {
      cancelled = true;
      stopIncomingWatcher();
    };
  }, [status, sessionReady, ensureSession, scheduleSync, stopIncomingWatcher]);

  /** Red de seguridad: el SSE puede caerse al cambiar de red o de pantalla. */
  useEffect(() => {
    if (status !== 'unlocked' || !sessionReady) return;
    const timer = setInterval(() => {
      if (appStateRef.current === 'active') void syncBalance();
    }, BALANCE_POLL_MS);
    return () => clearInterval(timer);
  }, [status, sessionReady, syncBalance]);

  useEffect(() => {
    const subscription = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        appStateRef.current = nextState;
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
            return;
          }
          if (statusRef.current === 'unlocked') void syncBalance();
        }
      }
    );

    return () => subscription.remove();
  }, [lock, syncBalance]);

  const value: WalletContextValue = {
    status,
    busy,
    refreshing,
    error,
    balance,
    address,
    boardingAddress,
    history,
    coins,
    coinsLoaded,
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
    loadCoins,
    redeemNotes,
    settleBoarding,
    changePassphrase,
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
