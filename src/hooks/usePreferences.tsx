import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  savePreferences,
  type BitcoinUnit,
  type FiatCurrency,
  type Preferences,
} from '../lib/preferences';
import {
  EMPTY_FIAT_PRICES,
  fetchFiatPrices,
  formatFiat,
  toFiatAmount,
  type FiatPrices,
} from '../lib/fiat';
import { formatBitcoinAmount, formatBitcoinParts } from '../lib/format';

type PreferencesContextValue = {
  preferences: Preferences;
  loaded: boolean;
  prices: FiatPrices;
  setUnit: (unit: BitcoinUnit) => void;
  setCurrency: (currency: FiatCurrency) => void;
  toggleHaptics: () => void;
  /** Importe en la unidad de bitcoin elegida (BTC / sats / ₿). */
  formatBitcoin: (sats: number | null | undefined) => string;
  /** Importe y unidad por separado, para la pantalla principal. */
  bitcoinParts: (sats: number | null | undefined) => {
    value: string;
    unit: string;
  };
  /** Importe en la moneda fiat elegida (o BTC si así se seleccionó). */
  formatFiatValue: (sats: number | null | undefined) => string;
};

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

const PRICE_REFRESH_MS = 5 * 60 * 1000;

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<Preferences>(
    DEFAULT_PREFERENCES
  );
  const [loaded, setLoaded] = useState(false);
  const [prices, setPrices] = useState<FiatPrices>(EMPTY_FIAT_PRICES);
  const preferencesRef = useRef(preferences);

  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await loadPreferences();
      if (cancelled) return;
      setPreferences(stored);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const next = await fetchFiatPrices();
      if (!cancelled) setPrices(next);
    };
    void refresh();
    const timer = setInterval(() => void refresh(), PRICE_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const update = useCallback((next: Preferences) => {
    setPreferences(next);
    void savePreferences(next);
  }, []);

  const setUnit = useCallback(
    (unit: BitcoinUnit) => update({ ...preferencesRef.current, unit }),
    [update]
  );

  const setCurrency = useCallback(
    (currency: FiatCurrency) =>
      update({ ...preferencesRef.current, currency }),
    [update]
  );

  const toggleHaptics = useCallback(
    () =>
      update({
        ...preferencesRef.current,
        haptics: !preferencesRef.current.haptics,
      }),
    [update]
  );

  const formatBitcoin = useCallback(
    (sats: number | null | undefined) =>
      formatBitcoinAmount(sats, preferences.unit),
    [preferences.unit]
  );

  const bitcoinParts = useCallback(
    (sats: number | null | undefined) =>
      formatBitcoinParts(sats, preferences.unit),
    [preferences.unit]
  );

  const formatFiatValue = useCallback(
    (sats: number | null | undefined) => {
      const amount = toFiatAmount(sats ?? 0, preferences.currency, prices);
      if (preferences.currency === 'BTC') {
        return formatBitcoinAmount(sats ?? 0, 'BTC');
      }
      return formatFiat(amount, preferences.currency);
    },
    [preferences.currency, prices]
  );

  const value = useMemo<PreferencesContextValue>(
    () => ({
      preferences,
      loaded,
      prices,
      setUnit,
      setCurrency,
      toggleHaptics,
      formatBitcoin,
      bitcoinParts,
      formatFiatValue,
    }),
    [
      preferences,
      loaded,
      prices,
      setUnit,
      setCurrency,
      toggleHaptics,
      formatBitcoin,
      bitcoinParts,
      formatFiatValue,
    ]
  );

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): PreferencesContextValue {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error(
      'usePreferences debe usarse dentro de PreferencesProvider.'
    );
  }
  return context;
}
