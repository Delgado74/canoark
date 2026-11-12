import * as SQLite from 'expo-sqlite';
import type { SQLExecutor } from '@arkade-os/sdk/repositories/sqlite';
import {
  SQLiteContractRepository,
  SQLiteIntentRepository,
  SQLiteVirtualTxRepository,
  SQLiteWalletRepository,
} from '@arkade-os/sdk/repositories/sqlite';
import { SQLiteAssetSwapRepository } from '@arkade-os/swap/repositories/sqlite';

export const WALLET_DB = 'canoark-wallet.db';
export const SWAP_DB = 'canoark-swaps.db';

const bind = (params?: unknown[]) =>
  (params ?? []) as SQLite.SQLiteBindValue[];

/**
 * expo-sqlite no implementa la interfaz SQLExecutor del SDK directamente.
 * Este adaptador traduce las tres operaciones que el SDK necesita.
 */
export function createExecutor(db: SQLite.SQLiteDatabase): SQLExecutor {
  return {
    run: async (sql, params) => {
      await db.runAsync(sql, bind(params));
    },
    get: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
      const row = await db.getFirstAsync<T>(sql, bind(params));
      return row ?? undefined;
    },
    all: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
      return db.getAllAsync<T>(sql, bind(params));
    },
  };
}

export type AppStorage = ReturnType<typeof openStorage>;

/**
 * Abre una conexión por base de datos, para toda la vida del proceso.
 * El SDK exige el MISMO executor para todos los repositorios de un archivo:
 * dos executors sobre el mismo archivo pueden intercalar escrituras.
 */
export function openStorage() {
  const walletDb = SQLite.openDatabaseSync(WALLET_DB);
  const swapDb = SQLite.openDatabaseSync(SWAP_DB);

  const walletExecutor = createExecutor(walletDb);
  const swapExecutor = createExecutor(swapDb);

  const walletStorage = {
    walletRepository: new SQLiteWalletRepository(walletExecutor),
    contractRepository: new SQLiteContractRepository(walletExecutor),
    intentRepository: new SQLiteIntentRepository(walletExecutor),
    // Guarda las ramas de salida de cada output virtual. Sin esto, una salida
    // unilateral depende por completo del indexer.
    virtualTxRepository: new SQLiteVirtualTxRepository(walletExecutor),
  };

  const swapRepository = new SQLiteAssetSwapRepository(swapExecutor);

  return {
    walletDb,
    swapDb,
    walletStorage,
    swapRepository,
    close: async () => {
      await walletDb.closeAsync();
      await swapDb.closeAsync();
    },
  };
}

/**
 * Borra las dos bases de datos. Debe llamarse DESPUÉS de cerrar la sesión,
 * porque SQLite no permite eliminar un archivo abierto.
 */
export async function wipeStorageDatabases(): Promise<void> {
  await SQLite.deleteDatabaseAsync(WALLET_DB).catch(() => undefined);
  await SQLite.deleteDatabaseAsync(SWAP_DB).catch(() => undefined);
}
