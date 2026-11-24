import * as SQLite from 'expo-sqlite';
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

export type NoteDirection = 'sent' | 'received';

export type TransactionNote = {
  key: string;
  note: string;
  direction: NoteDirection;
  amount: number;
  createdAt: number;
  updatedAt: number;
};

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
  CREATE TABLE IF NOT EXISTS cash_tokens (
    token TEXT PRIMARY KEY NOT NULL,
    network TEXT NOT NULL,
    amount INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    claimed_at INTEGER
  );
`;

let database: SQLite.SQLiteDatabase | null = null;

function db(): SQLite.SQLiteDatabase {
  if (!database) {
    const opened = SQLite.openDatabaseSync(APP_DB);
    opened.execSync(INIT_SQL);
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
  token: string;
  amount: number;
  note: string;
  status: string;
  created_at: number;
  claimed_at: number | null;
};

const toCash = (row: CashRow): SavedCashToken => ({
  token: row.token,
  amount: row.amount,
  note: row.note,
  status: row.status === 'claimed' ? 'claimed' : 'active',
  createdAt: row.created_at,
  claimedAt: row.claimed_at,
});

/** Guarda un token recién creado para poder compartirlo más tarde, incluso sin conexión. */
export async function saveCashToken(params: {
  token: string;
  amount: number;
  note?: string;
}): Promise<void> {
  const token = params.token.trim();
  if (!token) return;
  await db().runAsync(
    `INSERT INTO cash_tokens (token, network, amount, note, status, created_at)
     VALUES (?, ?, ?, ?, 'active', ?)
     ON CONFLICT(token) DO UPDATE SET
       amount = excluded.amount,
       note = CASE WHEN excluded.note <> '' THEN excluded.note ELSE cash_tokens.note END`,
    [
      token,
      ACTIVE_NETWORK.name,
      Math.round(params.amount),
      params.note?.trim() ?? '',
      Date.now(),
    ]
  );
}

export async function listCashTokens(): Promise<SavedCashToken[]> {
  const rows = await db().getAllAsync<CashRow>(
    `SELECT token, amount, note, status, created_at, claimed_at
       FROM cash_tokens
      WHERE network = ?
      ORDER BY created_at DESC`,
    [ACTIVE_NETWORK.name]
  );
  return rows.map(toCash);
}

export async function markCashClaimed(token: string): Promise<void> {
  await db().runAsync(
    `UPDATE cash_tokens
        SET status = 'claimed', claimed_at = ?
      WHERE network = ? AND token = ?`,
    [Date.now(), ACTIVE_NETWORK.name, token.trim()]
  );
}

export async function deleteCashToken(token: string): Promise<void> {
  await db().runAsync('DELETE FROM cash_tokens WHERE network = ? AND token = ?', [
    ACTIVE_NETWORK.name,
    token.trim(),
  ]);
}

export function closeAppDatabase(): void {
  const current = database;
  database = null;
  current?.closeSync();
}

/** Borra notas y Arkade Cash guardados. Tras crear/restaurar o eliminar la wallet. */
export async function wipeAppDatabase(): Promise<void> {
  closeAppDatabase();
  await SQLite.deleteDatabaseAsync(APP_DB).catch(() => undefined);
}
