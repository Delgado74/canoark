import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  closeArkadeSession,
  openArkadeSession,
  type ArkadeSession,
} from '../../src/lib/arkade/client';
import { sendCollaborativeExit } from '../../src/lib/arkade/offboard';

/**
 * Capa 2: mismos paquetes @arkade-os que la capa hermética, pero contra un
 * arkd real. Solo se ejecuta en CI con el stack de arkade-regtest levantado.
 */
const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const regtestDir =
  process.env.ARKADE_REGTEST_DIR ?? resolve(__dirname, '../../../arkade-regtest');

const cli = (...args: string[]): string =>
  execFileSync(process.execPath, [resolve(regtestDir, 'regtest.mjs'), ...args], {
    encoding: 'utf8',
    stdio: 'pipe',
  });

const waitFor = async (
  label: string,
  predicate: () => Promise<boolean>,
  attempts = 30
): Promise<void> => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await predicate()) return;
    await new Promise(done => setTimeout(done, 2_000));
  }
  throw new Error(`Timeout esperando ${label} en regtest`);
};

let session: ArkadeSession;

beforeAll(async () => {
  session = await openArkadeSession(MNEMONIC, 'static', {
    operatorUrl: process.env.ARKADE_REGTEST_OPERATOR ?? 'http://localhost:7070',
    indexerUrl: process.env.ARKADE_REGTEST_INDEXER ?? 'http://localhost:7070',
    esploraUrl: process.env.ARKADE_REGTEST_ESPLORA ?? 'http://localhost:3000/api',
    delegateUrl: null,
    swapNetwork: 'regtest',
    solverRegistryUrl:
      process.env.ARKADE_REGTEST_SOLVER_REGISTRY ??
      'http://localhost:3002/solver-registry/regtest.json',
  });
}, 180_000);

afterAll(async () => {
  await closeArkadeSession();
});

describe('integración real contra arkd de regtest', () => {
  it('abre la wallet y habla con el operador de regtest', async () => {
    const address = await session.wallet.getAddress();
    expect(address).toMatch(/^tark1/);

    const info = await session.wallet.getOperatorInfo();
    expect(info.network).toMatch(/regtest/i);
    expect(session.onchainWallet.address).toMatch(/^bcrt1p/);
  });

  it('hace boarding, liquida, envía offchain y hace offboarding', async () => {
    const boardingAddress = await session.wallet.getBoardingAddress();
    cli('faucet', boardingAddress, '0.001');
    cli('mine', '1');

    // El SDK detecta el depósito con polling HTTP (15 s) cuando el websocket
    // de Esplora no está disponible en Node. El `mine` puede adelantarse a la
    // difusión de la tx del faucet, así que se mina un par de bloques más
    // mientras se espera en vez de fiarlo todo a un único bloque.
    let extraBlocks = 0;
    await waitFor(
      'boarding confirmado',
      async () => {
        const balance = await session.wallet.getBalance();
        if (balance.boarding.confirmed > 0) return true;
        if (extraBlocks < 3) {
          extraBlocks += 1;
          cli('mine', '1');
        }
        return false;
      },
      60
    );

    await session.wallet.settle();
    await waitFor(
      'VTXOs liquidados',
      async () => {
        const balance = await session.wallet.getBalance();
        return balance.available >= 10_000;
      },
      60
    );

    const ownAddress = await session.wallet.getAddress();
    const txid = await session.wallet.send({
      recipients: [{ address: ownAddress, amount: 1_000 }],
    });
    expect(txid).toMatch(/^[0-9a-f]{64}$/);

    const exit = await sendCollaborativeExit(
      session.wallet,
      session.onchainWallet.address,
      5_000,
      50_000
    );
    expect(exit.txid).toMatch(/^[0-9a-f]{64}$/);
    await waitFor(
      'salida onchain confirmada',
      async () => {
        cli('mine', '1');
        return (await session.onchainWallet.getBalance()) > 0;
      },
      60
    );
  });
});
