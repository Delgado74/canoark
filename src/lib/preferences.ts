import * as SQLite from 'expo-sqlite';

export type BitcoinUnit = 'BTC' | 'sats' | 'BIP177';

export type FiatCurrency =
  | 'BRL'
  | 'BTC'
  | 'CHF'
  | 'CNY'
  | 'EUR'
  | 'GBP'
  | 'JPY'
  | 'USD';

export type Preferences = {
  unit: BitcoinUnit;
  currency: FiatCurrency;
  haptics: boolean;
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
};

const PREFERENCES_DB = 'canoark-preferences.db';

let db: SQLite.SQLiteDatabase | null = null;

function getDb(): SQLite.SQLiteDatabase {
  if (!db) {
    db = SQLite.openDatabaseSync(PREFERENCES_DB);
    db.execSync(
      'CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);'
    );
  }
  return db;
}

const isUnit = (value: unknown): value is BitcoinUnit =>
  value === 'BTC' || value === 'sats' || value === 'BIP177';

const isCurrency = (value: unknown): value is FiatCurrency =>
  typeof value === 'string' &&
  (FIAT_CURRENCIES as string[]).includes(value);

export async function loadPreferences(): Promise<Preferences> {
  try {
    const rows = await getDb().getAllAsync<{ key: string; value: string }>(
      'SELECT key, value FROM preferences'
    );
    const stored = new Map(rows.map(row => [row.key, row.value]));
    const unit = stored.get('unit');
    const currency = stored.get('currency');
    const haptics = stored.get('haptics');
    return {
      unit: isUnit(unit) ? unit : DEFAULT_PREFERENCES.unit,
      currency: isCurrency(currency)
        ? currency
        : DEFAULT_PREFERENCES.currency,
      haptics:
        haptics === undefined
          ? DEFAULT_PREFERENCES.haptics
          : haptics === 'true',
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
  ];
  try {
    const database = getDb();
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
