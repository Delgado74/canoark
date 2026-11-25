import {
  SQLiteContractRepository,
  SQLiteIntentRepository,
  SQLiteVirtualTxRepository,
  SQLiteWalletRepository,
} from '@arkade-os/sdk/repositories/sqlite';
import { SQLiteAssetSwapRepository } from '@arkade-os/swap/repositories/sqlite';
import {
  normalizeRfqSwapRecord,
  type RfqSwapRecord,
} from '@arkade-os/swap/protocol';
import { openStorage, createExecutor } from '../src/lib/storage/sqlite';
import { openDatabaseSync, __resetDatabases } from './mocks/expoSqlite';

const SWAP = {
  id: 'funding-txid',
  fromAsset: 'btc',
  toAsset: 'btc',
  fromAmount: '1000',
  toAmount: '900',
  swapAddress: 'tark1test',
  swapPkScript: '51',
  offerHex: '00',
  fundingTxid: 'funding-txid',
  status: 'pending' as const,
  createdAt: 1_700_000_000_000,
};

describe('SQLite con repositorios reales del SDK', () => {
  beforeEach(() => {
    __resetDatabases();
  });

  it('createExecutor traduce run/get/all y devuelve undefined sin fila', async () => {
    const db = openDatabaseSync('adapter.db');
    const executor = createExecutor(db as any);

    await executor.run('CREATE TABLE probe (id TEXT PRIMARY KEY, value INTEGER)');
    await executor.run('INSERT INTO probe (id, value) VALUES (?, ?)', ['a', 7]);

    expect(await executor.get('SELECT value FROM probe WHERE id = ?', ['a'])).toEqual({
      value: 7,
    });
    expect(await executor.get('SELECT value FROM probe WHERE id = ?', ['b'])).toBeUndefined();
    expect(await executor.all('SELECT id FROM probe ORDER BY id')).toEqual([{ id: 'a' }]);
    await db.closeAsync();
  });

  it('cierra y reabre la BD conservando wallet state y swaps', async () => {
    const first = openStorage();

    await first.walletStorage.walletRepository.saveWalletState({
      lastSyncTime: 123,
      settings: { vtxoCursorMigrated: true },
    });
    await first.swapRepository.saveSwap(SWAP);

    await first.close();
    const second = openStorage();

    expect(await second.walletStorage.walletRepository.getWalletState()).toEqual({
      lastSyncTime: 123,
      settings: { vtxoCursorMigrated: true },
    });
    const page = await second.swapRepository.getAssetSwapsPage({ limit: 10 });
    expect(page.items).toEqual([SWAP]);

    await second.close();
  });

  it('conserva un registro RFQ completo, incluido el hashlock anidado', async () => {
    const storage = openStorage();
    const record = {
      rfqId: 'rfq-1',
      kind: 'lightning_send',
      lockupAddress: 'tark1test',
      profile: {
        hashlock: 'aa'.repeat(32),
        solverPubkey: 'bb'.repeat(33),
      },
      state: 'pending',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_001_000,
    } as unknown as RfqSwapRecord;

    await storage.swapRepository.saveRfqSwap(record);
    expect(await storage.swapRepository.getRfqSwap('rfq-1')).toEqual(record);

    await storage.close();
  });

  it('normaliza los nombres legacy de un registro RFQ guardado', () => {
    const legacy = {
      rfqId: 'rfq-legacy',
      kind: 'lightning_send',
      lockupAddress: 'tark1test',
      profile: { hashlock: 'aa'.repeat(32) },
      state: 'pending',
      createdAt: 1,
      updatedAt: 2,
      fundingArkTxid: 'legacy-funding',
      lockupSpendArkTxids: ['legacy-spend'],
    } as unknown as RfqSwapRecord;

    const normalized = normalizeRfqSwapRecord(legacy);

    expect(normalized.fundingTxid).toBe('legacy-funding');
    expect(normalized.lockupSpendTxids).toEqual(['legacy-spend']);
    expect(normalized).not.toHaveProperty('fundingArkTxid');
  });

  it('los cinco repositorios comparten el mismo executor de wallet', async () => {
    const storage = openStorage();
    const {
      walletRepository,
      contractRepository,
      intentRepository,
      virtualTxRepository,
    } = storage.walletStorage;
    const { swapRepository } = storage;

    expect(walletRepository).toBeInstanceOf(SQLiteWalletRepository);
    expect(contractRepository).toBeInstanceOf(SQLiteContractRepository);
    expect(intentRepository).toBeInstanceOf(SQLiteIntentRepository);
    expect(virtualTxRepository).toBeInstanceOf(SQLiteVirtualTxRepository);
    expect(swapRepository).toBeInstanceOf(SQLiteAssetSwapRepository);

    // Cada llamada inicializa sus tablas: si los executors se hubieran
    // duplicado, la segunda DDL fallaría con "table already exists" o bloqueos.
    await expect(
      Promise.all([
        walletRepository.getWalletState(),
        contractRepository.getContractsPage(undefined, { limit: 1 }),
        intentRepository.getBatchRegistrationsPage(undefined, { limit: 1 }),
        virtualTxRepository.getVirtualTx('missing-txid'),
        swapRepository.getAssetSwapsPage({ limit: 1 }),
      ])
    ).resolves.toBeDefined();

    await storage.close();
  });
});
