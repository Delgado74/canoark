import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  bytesToHex,
  hexToBytes,
  utf8ToBytes,
} from '@noble/hashes/utils.js';
import { ACTIVE_NETWORK } from '../../constants/network';

/**
 * Datos propios de la app que no pertenecen al SDK: notas de movimientos y
 * Arkade Cash creados por el usuario.
 *
 * Vive en su propia base de datos y con un único executor durante todo el
 * proceso, igual que las demás bases: dos conexiones al mismo archivo pueden
 * intercalar escrituras.
 */
export const APP_DB = 'canoark-app.db';

/**
 * Clave local que cifra los Arkade Cash guardados. Vive en SecureStore, no en
 * la base de datos: los tokens son dinero al portador y no deben quedar
 * legibles aunque alguien copie el archivo SQLite.
 */
const CASH_KEY = 'canoark.cashStoreKey.v1';
const NONCE_BYTES = 24;
const KEY_BYTES = 32;

const secureOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export type NoteDirection = 'sent' | 'received';

export type TransactionNote = {
  key: string;
  note: string;
  direction: NoteDirection;
  amount: number;
  createdAt: number;
  updatedAt: number;
};

const CASH_SCHEMA = `
  CREATE TABLE IF NOT EXISTS cash_tokens (
    token_hash TEXT PRIMARY KEY NOT NULL,
    network TEXT NOT NULL,
    amount INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    claimed_at INTEGER,
    nonce TEXT NOT NULL,
    ciphertext TEXT NOT NULL
  );
`;

const EXIT_SCHEMA = `
  CREATE TABLE IF NOT EXISTS exit_packages (
    id TEXT PRIMARY KEY NOT NULL,
    network TEXT NOT NULL,
    package_json TEXT NOT NULL,
    sweep_address TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    valid_until INTEGER,
    tx_count INTEGER NOT NULL,
    total_fee_sats INTEGER NOT NULL,
    funding_required_sats INTEGER NOT NULL,
    recovered_sats INTEGER NOT NULL
  );
`;

const INIT_SQL = `
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS tx_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    network TEXT NOT NULL,
    ref_key TEXT NOT NULL,
    note TEXT NOT NULL,
    direction TEXT NOT NULL,
    amount INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(network, ref_key)
  );
  ${CASH_SCHEMA}
  ${EXIT_SCHEMA}
`;

let database: SQLite.SQLiteDatabase | null = null;
/** Las bases creadas antes del cifrado guardan el token legible y hay que migrarlas. */
let needsCashMigration = false;

function db(): SQLite.SQLiteDatabase {
  if (!database) {
    const opened = SQLite.openDatabaseSync(APP_DB);
    opened.execSync(INIT_SQL);
    const columns = opened.getAllSync<{ name: string }>(
      'PRAGMA table_info(cash_tokens)'
    );
    needsCashMigration =
      columns.length > 0 &&
      !columns.some(column => column.name === 'token_hash');
    database = opened;
  }
  return database;
}

type NoteRow = {
  ref_key: string;
  note: string;
  direction: string;
  amount: number;
  created_at: number;
  updated_at: number;
};

const toNote = (row: NoteRow): TransactionNote => ({
  key: row.ref_key,
  note: row.note,
  direction: row.direction === 'received' ? 'received' : 'sent',
  amount: row.amount,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/**
 * Busca la nota de un movimiento. Primero por sus identificadores (arkTxid,
 * boardingTxid, commitmentTxid). Si no hay, acepta una nota creada al generar
 * una factura o un swap con el mismo sentido e importe, para que la nota
 * aparezca también en el historial cuando el SDK todavía no conoce el txid.
 */
export async function findTransactionNote(params: {
  keys: string[];
  direction: NoteDirection;
  amount: number;
  /** Momento del movimiento, en ms. */
  createdAt: number;
}): Promise<TransactionNote | null> {
  const network = ACTIVE_NETWORK.name;
  const keys = Array.from(new Set(params.keys.filter(Boolean)));

  if (keys.length > 0) {
    const placeholders = keys.map(() => '?').join(', ');
    const row = await db().getFirstAsync<NoteRow>(
      `SELECT ref_key, note, direction, amount, created_at, updated_at
         FROM tx_notes
        WHERE network = ? AND ref_key IN (${placeholders})
        ORDER BY updated_at DESC
        LIMIT 1`,
      [network, ...keys]
    );
    if (row) return toNote(row);
  }

  const amount = Math.abs(Math.round(params.amount));
  const distance = 24 * 60 * 60 * 1000;
  const row = await db().getFirstAsync<NoteRow>(
    `SELECT ref_key, note, direction, amount, created_at, updated_at
       FROM tx_notes
      WHERE network = ?
        AND direction = ?
        AND amount = ?
        AND (ref_key LIKE 'invoice:%' OR ref_key LIKE 'swap:%')
        AND ABS(created_at - ?) <= ?
      ORDER BY ABS(created_at - ?) ASC
      LIMIT 1`,
    [network, params.direction, amount, params.createdAt, distance, params.createdAt]
  );
  return row ? toNote(row) : null;
}

/** Crea o actualiza la nota de un movimiento. Una nota vacía la borra. */
export async function saveTransactionNote(params: {
  key: string;
  note: string;
  direction: NoteDirection;
  amount: number;
  /** Fecha del movimiento (no la de la nota). */
  createdAt: number;
}): Promise<void> {
  const key = params.key.trim();
  const note = params.note.trim();
  if (!key) throw new Error('La transacción no tiene identificador.');
  if (!note) {
    await deleteTransactionNote(key);
    return;
  }

  const now = Date.now();
  await db().runAsync(
    `INSERT INTO tx_notes
       (network, ref_key, note, direction, amount, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(network, ref_key) DO UPDATE SET
       note = excluded.note,
       direction = excluded.direction,
       amount = excluded.amount,
       updated_at = excluded.updated_at`,
    [
      ACTIVE_NETWORK.name,
      key,
      note,
      params.direction,
      Math.abs(Math.round(params.amount)),
      params.createdAt || now,
      now,
    ]
  );
}

export async function deleteTransactionNote(key: string): Promise<void> {
  await db().runAsync(
    'DELETE FROM tx_notes WHERE network = ? AND ref_key = ?',
    [ACTIVE_NETWORK.name, key.trim()]
  );
}

/* ------------------------------------------------------------------ */
/* Arkade Cash                                                         */
/* ------------------------------------------------------------------ */

export type CashTokenStatus = 'active' | 'claimed';

export type SavedCashToken = {
  token: string;
  amount: number;
  note: string;
  status: CashTokenStatus;
  createdAt: number;
  claimedAt: number | null;
};

type CashRow = {
  amount: number;
  note: string;
  status: string;
  created_at: number;
  claimed_at: number | null;
  nonce: string;
  ciphertext: string;
};

type LegacyCashRow = {
  token: string;
  network: string;
  amount: number;
  note: string;
  status: string;
  created_at: number;
  claimed_at: number | null;
};

let cashKeyPromise: Promise<Uint8Array> | null = null;
let cashReadyPromise: Promise<Uint8Array> | null = null;

/** Clave XChaCha20 del dispositivo. Se crea una sola vez y queda en SecureStore. */
function getCashKey(): Promise<Uint8Array> {
  if (cashKeyPromise) return cashKeyPromise;

  cashKeyPromise = (async () => {
    const stored = await SecureStore.getItemAsync(CASH_KEY, secureOptions);
    if (stored) {
      const key = hexToBytes(stored);
      if (key.length !== KEY_BYTES) {
        throw new Error('La clave local de Arkade Cash no es válida.');
      }
      return key;
    }

    const key = Crypto.getRandomBytes(KEY_BYTES);
    await SecureStore.setItemAsync(CASH_KEY, bytesToHex(key), secureOptions);
    return key;
  })().catch(error => {
    cashKeyPromise = null;
    throw error;
  });

  return cashKeyPromise;
}

const tokenHash = (token: string): string =>
  bytesToHex(sha256(utf8ToBytes(token)));

function encryptToken(
  token: string,
  key: Uint8Array
): { nonce: string; ciphertext: string } {
  const nonce = Crypto.getRandomBytes(NONCE_BYTES);
  return {
    nonce: bytesToHex(nonce),
    ciphertext: bytesToHex(
      xchacha20poly1305(key, nonce).encrypt(utf8ToBytes(token))
    ),
  };
}

function decryptToken(row: CashRow, key: Uint8Array): string {
  const plaintext = xchacha20poly1305(key, hexToBytes(row.nonce)).decrypt(
    hexToBytes(row.ciphertext)
  );
  return Array.from(plaintext, byte => String.fromCharCode(byte)).join('');
}

const toCash = (row: CashRow, key: Uint8Array): SavedCashToken => ({
  token: decryptToken(row, key),
  amount: row.amount,
  note: row.note,
  status: row.status === 'claimed' ? 'claimed' : 'active',
  createdAt: row.created_at,
  claimedAt: row.claimed_at,
});

/**
 * Reescribe la tabla antigua (token legible) con el esquema cifrado. Se hace en
 * una transacción: si la app se cierra a medias, la tabla original sigue ahí y
 * la migración se reintenta en el siguiente arranque.
 */
async function migrateCashTokens(key: Uint8Array): Promise<void> {
  const database = db();
  const legacy = await database.getAllAsync<LegacyCashRow>(
    `SELECT token, network, amount, note, status, created_at, claimed_at
       FROM cash_tokens`
  );

  const encrypted = legacy.map(row => ({
    hash: tokenHash(row.token),
    network: row.network,
    amount: row.amount,
    note: row.note,
    status: row.status,
    createdAt: row.created_at,
    claimedAt: row.claimed_at,
    ...encryptToken(row.token, key),
  }));

  await database.withTransactionAsync(async () => {
    await database.execAsync(
      'ALTER TABLE cash_tokens RENAME TO cash_tokens_legacy'
    );
    await database.execAsync(CASH_SCHEMA);
    for (const row of encrypted) {
      await database.runAsync(
        `INSERT OR REPLACE INTO cash_tokens
           (token_hash, network, amount, note, status, created_at, claimed_at,
            nonce, ciphertext)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.hash,
          row.network,
          row.amount,
          row.note,
          row.status,
          row.createdAt,
          row.claimedAt,
          row.nonce,
          row.ciphertext,
        ]
      );
    }
    await database.execAsync('DROP TABLE cash_tokens_legacy');
  });

  needsCashMigration = false;
}

/** Clave lista y, si hacía falta, migración antigua completada. */
function ensureCashReady(): Promise<Uint8Array> {
  if (!cashReadyPromise) {
    cashReadyPromise = (async () => {
      // Abre la base aquí para detectar si aún tiene el esquema antiguo.
      db();
      const key = await getCashKey();
      if (needsCashMigration) await migrateCashTokens(key);
      return key;
    })().catch(error => {
      cashReadyPromise = null;
      throw error;
    });
  }
  return cashReadyPromise;
}

/** Guarda un token recién creado para poder compartirlo más tarde, incluso sin conexión. */
export async function saveCashToken(params: {
  token: string;
  amount: number;
  note?: string;
}): Promise<void> {
  const token = params.token.trim();
  if (!token) return;

  const key = await ensureCashReady();
  const { nonce, ciphertext } = encryptToken(token, key);
  await db().runAsync(
    `INSERT INTO cash_tokens
       (token_hash, network, amount, note, status, created_at, claimed_at,
        nonce, ciphertext)
     VALUES (?, ?, ?, ?, 'active', ?, NULL, ?, ?)
     ON CONFLICT(token_hash) DO UPDATE SET
       amount = excluded.amount,
       note = CASE WHEN excluded.note <> '' THEN excluded.note ELSE cash_tokens.note END`,
    [
      tokenHash(token),
      ACTIVE_NETWORK.name,
      Math.round(params.amount),
      params.note?.trim() ?? '',
      Date.now(),
      nonce,
      ciphertext,
    ]
  );
}

export async function listCashTokens(): Promise<SavedCashToken[]> {
  const key = await ensureCashReady();
  const rows = await db().getAllAsync<CashRow>(
    `SELECT amount, note, status, created_at, claimed_at, nonce, ciphertext
       FROM cash_tokens
      WHERE network = ?
      ORDER BY created_at DESC`,
    [ACTIVE_NETWORK.name]
  );
  return rows.map(row => toCash(row, key));
}

export async function markCashClaimed(token: string): Promise<void> {
  await ensureCashReady();
  await db().runAsync(
    `UPDATE cash_tokens
        SET status = 'claimed', claimed_at = ?
      WHERE network = ? AND token_hash = ?`,
    [Date.now(), ACTIVE_NETWORK.name, tokenHash(token.trim())]
  );
}

export async function deleteCashToken(token: string): Promise<void> {
  await ensureCashReady();
  await db().runAsync(
    'DELETE FROM cash_tokens WHERE network = ? AND token_hash = ?',
    [ACTIVE_NETWORK.name, tokenHash(token.trim())]
  );
}

/* ------------------------------------------------------------------ */
/* Planes de salida unilateral                                         */
/* ------------------------------------------------------------------ */

/**
 * Paquete prefirmado para salir de Arkade sin el operador. No contiene la
 * semilla: solo transacciones que pagan a `sweepAddress`. Aun así es sensible,
 * porque cualquiera que lo tenga puede difundirlo (no redirigir los fondos).
 */
export type StoredExitPackage = {
  id: string;
  envelope: string;
  sweepAddress: string;
  createdAt: number;
  /** Vencimiento del batch, en segundos unix. `null` si el SDK no lo conoce. */
  validUntil: number | null;
  txCount: number;
  totalFeeSats: number;
  fundingRequiredSats: number;
  recoveredSats: number;
};

type ExitRow = {
  id: string;
  package_json: string;
  sweep_address: string;
  created_at: number;
  valid_until: number | null;
  tx_count: number;
  total_fee_sats: number;
  funding_required_sats: number;
  recovered_sats: number;
};

const toExitPackage = (row: ExitRow): StoredExitPackage => ({
  id: row.id,
  envelope: row.package_json,
  sweepAddress: row.sweep_address,
  createdAt: row.created_at,
  validUntil: row.valid_until,
  txCount: row.tx_count,
  totalFeeSats: row.total_fee_sats,
  fundingRequiredSats: row.funding_required_sats,
  recoveredSats: row.recovered_sats,
});

export async function saveExitPackage(params: {
  envelope: string;
  sweepAddress: string;
  validUntil: number | null;
  txCount: number;
  totalFeeSats: number;
  fundingRequiredSats: number;
  recoveredSats: number;
}): Promise<StoredExitPackage> {
  const envelope = params.envelope.trim();
  if (!envelope) throw new Error('El paquete de salida está vacío.');

  const row: StoredExitPackage = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    envelope,
    sweepAddress: params.sweepAddress,
    createdAt: Date.now(),
    validUntil: params.validUntil,
    txCount: params.txCount,
    totalFeeSats: params.totalFeeSats,
    fundingRequiredSats: params.fundingRequiredSats,
    recoveredSats: params.recoveredSats,
  };

  await db().runAsync(
    `INSERT INTO exit_packages
       (id, network, package_json, sweep_address, created_at, valid_until,
        tx_count, total_fee_sats, funding_required_sats, recovered_sats)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      ACTIVE_NETWORK.name,
      row.envelope,
      row.sweepAddress,
      row.createdAt,
      row.validUntil,
      row.txCount,
      row.totalFeeSats,
      row.fundingRequiredSats,
      row.recoveredSats,
    ]
  );

  return row;
}

export async function listExitPackages(): Promise<StoredExitPackage[]> {
  const rows = await db().getAllAsync<ExitRow>(
    `SELECT id, package_json, sweep_address, created_at, valid_until,
            tx_count, total_fee_sats, funding_required_sats, recovered_sats
       FROM exit_packages
      WHERE network = ?
      ORDER BY created_at DESC`,
    [ACTIVE_NETWORK.name]
  );
  return rows.map(toExitPackage);
}

export async function deleteExitPackage(id: string): Promise<void> {
  await db().runAsync(
    'DELETE FROM exit_packages WHERE network = ? AND id = ?',
    [ACTIVE_NETWORK.name, id]
  );
}

export function closeAppDatabase(): void {
  const current = database;
  database = null;
  needsCashMigration = false;
  current?.closeSync();
}

/** Borra notas y Arkade Cash guardados. Tras crear/restaurar o eliminar la wallet. */
export async function wipeAppDatabase(): Promise<void> {
  closeAppDatabase();
  await SQLite.deleteDatabaseAsync(APP_DB).catch(() => undefined);
}
