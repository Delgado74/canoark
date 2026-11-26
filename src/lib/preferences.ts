import * as SQLite from 'expo-sqlite';

export type BitcoinUnit = 'BTC' | 'sats' | 'BIP177';

export type AutoLockMinutes = 2 | 5 | 10;

export const AUTO_LOCK_OPTIONS: { value: AutoLockMinutes; label: string }[] = [
  { value: 2, label: '2 min' },
  { value: 5, label: '5 min' },
  { value: 10, label: '10 min' },
];

export const DEFAULT_AUTO_LOCK_MINUTES: AutoLockMinutes = 5;

export type FiatCurrency =
  | 'BRL'
  | 'BTC'
  | 'CHF'
  | 'CNY'
  | 'CUP'
  | 'EUR'
  | 'GBP'
  | 'JPY'
  | 'USD';

export type Preferences = {
  unit: BitcoinUnit;
  currency: FiatCurrency;
  haptics: boolean;
  autoLockMinutes: AutoLockMinutes;
};

export const BITCOIN_UNITS: { value: BitcoinUnit; label: string }[] = [
  { value: 'BTC', label: 'BTC' },
  { value: 'sats', label: 'Sats' },
  { value: 'BIP177', label: '₿' },
];

export const FIAT_CURRENCIES: FiatCurrency[] = [
  'BRL',
  'BTC',
  'CHF',
  'CNY',
  'CUP',
  'EUR',
  'GBP',
  'JPY',
  'USD',
];

export const DEFAULT_PREFERENCES: Preferences = {
  // Arkade Wallet muestra BTC por defecto.
  unit: 'BTC',
  currency: 'USD',
  haptics: true,
  autoLockMinutes: DEFAULT_AUTO_LOCK_MINUTES,
};

const PREFERENCES_DB = 'canoark-preferences.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const database = SQLite.openDatabaseSync(PREFERENCES_DB);
      await database.runAsync(
        'CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);'
      );
      return database;
    })().catch(error => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

const isUnit = (value: unknown): value is BitcoinUnit =>
  value === 'BTC' || value === 'sats' || value === 'BIP177';

const isCurrency = (value: unknown): value is FiatCurrency =>
  typeof value === 'string' &&
  (FIAT_CURRENCIES as string[]).includes(value);

const isAutoLockMinutes = (value: unknown): value is AutoLockMinutes =>
  value === '2' || value === '5' || value === '10';

export async function loadPreferences(): Promise<Preferences> {
  try {
    const database = await getDb();
    const rows = await database.getAllAsync<{ key: string; value: string }>(
      'SELECT key, value FROM preferences'
    );
    const stored = new Map(rows.map(row => [row.key, row.value]));
    const unit = stored.get('unit');
    const currency = stored.get('currency');
    const haptics = stored.get('haptics');
    const autoLockMinutes = stored.get('autoLockMinutes');
    return {
      unit: isUnit(unit) ? unit : DEFAULT_PREFERENCES.unit,
      currency: isCurrency(currency)
        ? currency
        : DEFAULT_PREFERENCES.currency,
      haptics:
        haptics === undefined
          ? DEFAULT_PREFERENCES.haptics
          : haptics === 'true',
      autoLockMinutes: isAutoLockMinutes(autoLockMinutes)
        ? (Number(autoLockMinutes) as AutoLockMinutes)
        : DEFAULT_PREFERENCES.autoLockMinutes,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export async function savePreferences(preferences: Preferences): Promise<void> {
  const entries: [string, string][] = [
    ['unit', preferences.unit],
    ['currency', preferences.currency],
    ['haptics', String(preferences.haptics)],
    ['autoLockMinutes', String(preferences.autoLockMinutes)],
  ];
  try {
    const database = await getDb();
    for (const [key, value] of entries) {
      await database.runAsync(
        'INSERT INTO preferences (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [key, value]
      );
    }
  } catch {
    // Las preferencias son cosméticas: no deben romper la app.
  }
}
