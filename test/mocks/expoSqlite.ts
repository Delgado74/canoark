import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';

/**
 * Sustituto de `expo-sqlite` respaldado por SQL real (sql.js/WASM).
 * Así los repositorios del SDK ejecutan su DDL y sus consultas de verdad,
 * sin dispositivo ni archivos en disco.
 */
const snapshots = new Map<string, Uint8Array>();
let sqlPromise: Promise<SqlJsStatic> | null = null;

const sql = (): Promise<SqlJsStatic> =>
  (sqlPromise ??= initSqlJs());

const bind = (params: unknown[]): (string | number | Uint8Array | null)[] =>
  params.map(value => {
    if (value === undefined || value === null) return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'number' || typeof value === 'string') return value;
    if (value instanceof Uint8Array) return value;
    return String(value);
  });

const rowsOf = (db: Database, query: string, params: unknown[]) => {
  const statement = db.prepare(query);
  try {
    statement.bind(bind(params));
    const rows: Record<string, unknown>[] = [];
    while (statement.step()) rows.push(statement.getAsObject());
    return rows;
  } finally {
    statement.free();
  }
};

export function openDatabaseSync(name: string) {
  let connection: Promise<Database> | null = null;

  const db = async (): Promise<Database> => {
    if (!connection) {
      connection = sql().then(SQL => {
        const snapshot = snapshots.get(name);
        return snapshot
          ? new SQL.Database(snapshot)
          : new SQL.Database();
      });
    }
    return connection;
  };

  return {
    async runAsync(query: string, params: unknown[] = []) {
      (await db()).run(query, bind(params));
    },
    async getFirstAsync<T = Record<string, unknown>>(
      query: string,
      params: unknown[] = []
    ): Promise<T | null> {
      return (rowsOf(await db(), query, params)[0] as T) ?? null;
    },
    async getAllAsync<T = Record<string, unknown>>(
      query: string,
      params: unknown[] = []
    ): Promise<T[]> {
      return rowsOf(await db(), query, params) as T[];
    },
    async closeAsync() {
      const connectionDb = await db();
      snapshots.set(name, connectionDb.export());
      connectionDb.close();
      connection = null;
    },
  };
}

export async function deleteDatabaseAsync(name: string): Promise<void> {
  snapshots.delete(name);
}

export const __resetDatabases = (): void => {
  snapshots.clear();
};
