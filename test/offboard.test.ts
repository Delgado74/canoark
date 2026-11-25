import { ArkAddress, type IWallet } from '@arkade-os/sdk';
import {
  planCollaborativeExit,
  quoteCollaborativeExit,
  sendCollaborativeExit,
} from '../src/lib/arkade/offboard';

const DESTINATION = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const OWN_ADDRESS = new ArkAddress(
  new Uint8Array(32).fill(1),
  new Uint8Array(32).fill(2),
  'tark'
).encode();

const fakeWallet = () => {
  const settle = jest.fn(async (_params: unknown) => 'settlement-txid');
  const wallet = {
    getSpendableVtxos: jest.fn(async () => [
      {
        txid: 'a'.repeat(64),
        vout: 0,
        value: 100_000,
        status: { confirmed: true },
        script: '5120' + '00'.repeat(32),
        createdAt: new Date('2026-01-01T00:00:00Z'),
        expiresAt: new Date('2026-01-10T00:00:00Z'),
        isUnrolled: false,
        isSwept: false,
      },
    ]),
    getOperatorInfo: jest.fn(async () => ({
      dust: 100n,
      utxoMinAmount: 0n,
      utxoMaxAmount: -1n,
      fees: {
        txFeeRate: '1',
        intentFee: {
          offchainInput: 'amount * 0.01',
          offchainOutput: 'amount * 0.001',
          onchainOutput: '250.0',
        },
      },
    })),
    getAddress: jest.fn(async () => OWN_ADDRESS),
    settle,
  };
  return { wallet: wallet as unknown as IWallet, settle };
};

describe('salida colaborativa a L1 (offboarding nativo)', () => {
  it('cotiza sin solver: la salida paga la dirección destino', async () => {
    const { wallet } = fakeWallet();
    const plan = await quoteCollaborativeExit(wallet, DESTINATION, 10_000);

    expect(plan.inputs).toHaveLength(1);
    expect(plan.outputs[0]).toEqual({
      address: DESTINATION,
      amount: 10_000n,
    });
    expect(plan.feeSats).toBeGreaterThan(0);
  });

  it('rechaza la operación si la comisión supera el máximo', async () => {
    const { wallet, settle } = fakeWallet();
    const plan = await quoteCollaborativeExit(wallet, DESTINATION, 10_000);

    await expect(
      planCollaborativeExit(wallet, DESTINATION, 10_000, plan.feeSats - 1)
    ).rejects.toThrow('La salida onchain cuesta');
    expect(settle).not.toHaveBeenCalled();
  });

  it('envía con wallet.settle({ inputs, outputs }), no con un swap', async () => {
    const { wallet, settle } = fakeWallet();
    const result = await sendCollaborativeExit(wallet, DESTINATION, 10_000, 10_000);

    expect(settle).toHaveBeenCalledTimes(1);
    const params = settle.mock.calls[0][0] as {
      inputs: unknown[];
      outputs: { address: string; amount: bigint }[];
    };
    expect(params.inputs).toHaveLength(1);
    expect(params.outputs[0].address).toBe(DESTINATION);
    expect(result).toEqual({
      txid: 'settlement-txid',
      feeSats: expect.any(Number),
      changeSats: expect.any(Number),
    });
  });
});
