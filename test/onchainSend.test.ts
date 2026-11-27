import type { Quote } from '@arkade-os/swap';
import {
  assertOnchainSwapFee,
  claimFeeRateSatVb,
  clearClaimFeeCache,
  isNoRouteError,
  isQuoteExpired,
  quoteOnchainSwap,
  sendOnchainSwap,
} from '../src/lib/arkade/onchainSend';

const ADDRESS = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const ESPLORA = 'https://mempool.example/api';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** Cotización del corredor onchain con el gross-up ya verificado por el cliente. */
const fakeQuote = (opts: {
  take: number;
  solverFee: number;
  id?: string;
}): Quote =>
  ({
    id: opts.id ?? 'rfq-1',
    route: { from: 'arkade', to: 'onchain' },
    give: { amount: BigInt(opts.take + opts.solverFee) },
    take: { amount: BigInt(opts.take) },
    fee: { amount: BigInt(opts.solverFee) },
    market: { key: 'btc-onchain', source: 'feed' },
    expiresAt: Math.floor(Date.now() / 1000) + 60,
  }) as unknown as Quote;

class FakeSwapError extends Error {
  constructor(name: string) {
    super(name);
    this.name = name;
  }
}

describe('tarifa del claim L1', () => {
  beforeEach(() => clearClaimFeeCache());

  it('lee mempool.space (/v1/fees/recommended) y cachea', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse({ fastestFee: 12, halfHourFee: 8 })
    );

    await expect(
      claimFeeRateSatVb(ESPLORA, fetchImpl as unknown as typeof fetch)
    ).resolves.toBe(12);
    // La segunda lectura sale de caché: una sola petición.
    await claimFeeRateSatVb(ESPLORA, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('cae a /fee-estimates cuando la primera forma no existe', async () => {
    const fetchImpl = jest.fn(async (url: string) =>
      url.endsWith('/v1/fees/recommended')
        ? jsonResponse({}, 404)
        : jsonResponse({ '2': 7, '1': 5, '3': 9 })
    );

    await expect(
      claimFeeRateSatVb(ESPLORA, fetchImpl as unknown as typeof fetch)
    ).resolves.toBe(7);
  });

  it('devuelve undefined cuando ninguna fuente responde', async () => {
    const fetchImpl = jest.fn(async () =>
      new Response('nope', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      })
    );

    await expect(
      claimFeeRateSatVb(ESPLORA, fetchImpl as unknown as typeof fetch)
    ).resolves.toBeUndefined();
  });

  it('nunca baja de 1 sat/vB', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse({ fastestFee: 0, halfHourFee: 0 })
    );

    await expect(
      claimFeeRateSatVb(ESPLORA, fetchImpl as unknown as typeof fetch)
    ).resolves.toBe(1);
  });
});

describe('cotización del swap onchain', () => {
  it('pide destinatario + claim y deja el importe exacto', async () => {
    const rate = 10; // 10 sat/vB × 152 vB = 1.520 sats de claim
    const recipient = 50_000;
    const solverFee = 3_200;
    const swaps = {
      quote: jest.fn(async () =>
        fakeQuote({ take: recipient + 1_520, solverFee })
      ),
    };

    const quote = await quoteOnchainSwap({
      swaps,
      address: ADDRESS,
      amountSats: recipient,
      claimFeeRateSatVb: rate,
    });

    expect(swaps.quote).toHaveBeenCalledWith({
      to: ADDRESS,
      amount: BigInt(recipient + 1_520),
      amountOn: 'take',
    });
    expect(quote).toMatchObject({
      amountSats: recipient,
      claimFeeSats: 1_520,
      solverFeeSats: solverFee,
      feeSats: 1_520 + solverFee,
      totalSats: recipient + 1_520 + solverFee,
    });
  });

  it('aplica el techo de comisión antes de aceptar', async () => {
    const quote = await quoteOnchainSwap({
      swaps: { quote: jest.fn(async () => fakeQuote({ take: 51_520, solverFee: 3_200 })) },
      address: ADDRESS,
      amountSats: 50_000,
      claimFeeRateSatVb: 10,
    });

    expect(quote).toBeDefined();
    expect(() => assertOnchainSwapFee(quote!, 4_000)).toThrow(/máximo es 4000/);
    expect(() => assertOnchainSwapFee(quote!, 4_720)).not.toThrow();
  });

  it('sin mercado devuelve undefined para caer a la salida del operador', async () => {
    const swaps = {
      quote: jest.fn(async () => {
        throw new FakeSwapError('UnsupportedRoute');
      }),
    };

    await expect(
      quoteOnchainSwap({
        swaps,
        address: ADDRESS,
        amountSats: 50_000,
        claimFeeRateSatVb: 10,
      })
    ).resolves.toBeUndefined();
    expect(isNoRouteError(new FakeSwapError('UnsupportedRoute'))).toBe(true);
    expect(isNoRouteError(new FakeSwapError('AmountMismatch'))).toBe(false);
  });

  it('una RFQ que no contesta a tiempo no bloquea el envío', async () => {
    const swaps = { quote: jest.fn(() => new Promise<Quote>(() => {})) };

    await expect(
      quoteOnchainSwap({
        swaps,
        address: ADDRESS,
        amountSats: 50_000,
        claimFeeRateSatVb: 10,
        timeoutMs: 20,
      })
    ).resolves.toBeUndefined();
  });

  it('rechaza una cotización que no cuadra', async () => {
    const broken = fakeQuote({ take: 51_520, solverFee: 3_200 });
    (broken as { give: { amount: bigint } }).give = { amount: 1n };
    const swaps = { quote: jest.fn(async () => broken) };

    await expect(
      quoteOnchainSwap({
        swaps,
        address: ADDRESS,
        amountSats: 50_000,
        claimFeeRateSatVb: 10,
      })
    ).rejects.toThrow(/no cuadra/);
  });

  it('acepta y devuelve el id del swap', async () => {
    const swaps = {
      accept: jest.fn(async (quote: Quote) => ({
        id: 'swap-9',
        outcome: 'accepted',
        quote,
      })),
    };

    await expect(
      sendOnchainSwap(swaps as never, {
        address: ADDRESS,
        amountSats: 50_000,
        claimFeeSats: 1_520,
        solverFeeSats: 3_200,
        feeSats: 4_720,
        totalSats: 54_720,
        quote: fakeQuote({ take: 51_520, solverFee: 3_200 }),
      })
    ).resolves.toEqual({ id: 'swap-9', outcome: 'accepted' });
  });
});

describe('taxonomía de errores del corredor', () => {
  it('distingue cotización caducada', () => {
    expect(isQuoteExpired(new FakeSwapError('QuoteExpired'))).toBe(true);
    expect(isQuoteExpired(new FakeSwapError('UnsupportedRoute'))).toBe(false);
  });
});
