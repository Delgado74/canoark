import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

const DATABASE_NAME = 'canoark-cash.db';
const ENCRYPTION_KEY = 'canoark.cashStoreKey.v1';
const NONCE_BYTES = 24;
const KEY_BYTES = 32;

const secureOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

let database: SQLite.SQLiteDatabase | null = null;
let keyPromise: Promise<Uint8Array> | null = null;

export type CashRecord = {
  id: string;
  cash: string;
  amountSats: number;
  createdAt: number;
  pending: boolean;
};

type EncryptedCashRecord = Omit<CashRecord, 'cash' | 'pending'> & {
  nonce: string;
  ciphertext: string;
  pending: number;
};

export class CashPersistenceError extends Error {
  readonly cash: string;

  constructor(cash: string, cause: unknown) {
    super(
      `El ArkadeCash se creó, pero no se pudo guardar en este dispositivo: ${
        cause instanceof Error ? cause.message : String(cause)
      }`
    );
    this.name = 'CashPersistenceError';
    this.cash = cash;
  }
}

function getDatabase(): SQLite.SQLiteDatabase {
  if (!database) {
    database = SQLite.openDatabaseSync(DATABASE_NAME);
    database.execSync(`
      CREATE TABLE IF NOT EXISTS cash_tokens (
        id TEXT PRIMARY KEY NOT NULL,
        nonce TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        amount_sats INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        pending INTEGER NOT NULL
      );
    `);
  }
  return database;
}

function getEncryptionKey(): Promise<Uint8Array> {
  if (keyPromise) return keyPromise;

  keyPromise = (async () => {
    const stored = await SecureStore.getItemAsync(ENCRYPTION_KEY, secureOptions);
    if (stored) {
      const key = hexToBytes(stored);
      if (key.length !== KEY_BYTES) {
        throw new Error('La clave local de ArkadeCash no es válida.');
      }
      return key;
    }

    const key = Crypto.getRandomBytes(KEY_BYTES);
    await SecureStore.setItemAsync(
      ENCRYPTION_KEY,
      bytesToHex(key),
      secureOptions
    );
    return key;
  })().catch(error => {
    keyPromise = null;
    throw error;
  });

  return keyPromise;
}

const randomId = (): string => bytesToHex(Crypto.getRandomBytes(16));
const decodeCash = (bytes: Uint8Array): string =>
  Array.from(bytes, byte => String.fromCharCode(byte)).join('');

export async function saveCashToken(
  cash: string,
  amountSats: number,
  pending = false
): Promise<void> {
  const key = await getEncryptionKey();
  const nonce = Crypto.getRandomBytes(NONCE_BYTES);
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(
    utf8ToBytes(cash)
  );
  const db = getDatabase();

  await db.runAsync(
    `INSERT INTO cash_tokens (id, nonce, ciphertext, amount_sats, created_at, pending)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      randomId(),
      bytesToHex(nonce),
      bytesToHex(ciphertext),
      Math.floor(amountSats),
      Date.now(),
      pending ? 1 : 0,
    ]
  );
}

export async function listCashTokens(): Promise<CashRecord[]> {
  const db = getDatabase();
  const rows = await db.getAllAsync<EncryptedCashRecord>(
    `SELECT id, nonce, ciphertext, amount_sats AS amountSats,
            created_at AS createdAt, pending
     FROM cash_tokens
     ORDER BY created_at DESC`
  );
  if (rows.length === 0) return [];

  const key = await getEncryptionKey();
  return rows.map(row => {
    const cash = xchacha20poly1305(
      key,
      hexToBytes(row.nonce)
    ).decrypt(hexToBytes(row.ciphertext));
    return {
      id: row.id,
      cash: decodeCash(cash),
      amountSats: row.amountSats,
      createdAt: row.createdAt,
      pending: row.pending === 1,
    };
  });
}

export async function deleteCashToken(id: string): Promise<void> {
  await getDatabase().runAsync('DELETE FROM cash_tokens WHERE id = ?', [id]);
}
