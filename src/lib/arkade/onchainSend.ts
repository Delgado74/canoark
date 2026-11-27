import {
  claimFeeSats,
  type Quote,
  type SwapClient,
} from '@arkade-os/swap';
import { ONCHAIN_DUST_SATS } from '@arkade-os/swap/protocol';
import { ACTIVE_NETWORK } from '../../constants/network';

/**
 * Envío onchain a través del solver (Arkade Intent, corredor
 * `arkade:BTC -> onchain:BTC`).
 *
 * No es la salida colaborativa: el solver bloquea BTC en un HTLC de L1 y esta
 * wallet lo reclama con la preimagen, pagando la dirección de destino. El
 * cliente del swap (`createSwapClient` en `client.ts`) ya trae el corredor
 * cableado con su `chain` y su `claim`; aquí sólo se cotiza y se acepta.
 *
 * El importe que se le pide al solver es `destinatario + comisión del claim`:
 * el claim L1 lo paga el destinatario si no se compensa, así que se suma antes
 * de cotizar y se resta al leer la pata onchain. Es el mismo criterio que usa
 * Arkade Wallet. Por eso NO se configura `corridors.onchain.claimFeeRateSatVb`
 * en el cliente: el cliente volvería a sumarlo (`solverFacingAmount`) y el
 * destinatario recibiría de menos.
 */

export type OnchainSwapQuote = {
  address: string;
  /** Sats que recibe el destinatario, exactos. */
  amountSats: number;
  /** Comisión minera del claim L1, ya incluida en `totalSats`. */
  claimFeeSats: number;
  /** Spread del solver. */
  solverFeeSats: number;
  /** `solverFeeSats + claimFeeSats`. */
  feeSats: number;
  /** Sats que salen del saldo Arkade (`quote.give`). */
  totalSats: number;
  /** La cotización que hay que aceptar; caduca. */
  quote: Quote;
};

const MIN_CLAIM_FEE_RATE = 1;
const FEE_ESTIMATE_TIMEOUT_MS = 8_000;
const FEE_CACHE_MS = 60_000;

/**
 * Formas de la API de fees que sirven los Esplora de la red compilada:
 * los hosts de Arkade son mempool.space (`/v1/fees/recommended`) y el de
 * mutinynet es Esplora puro (`/fee-estimates`). Se prueban en ese orden.
 */
const FEE_SOURCES = [
  { path: '/v1/fees/recommended', keys: ['fastestFee', 'halfHourFee'] },
  { path: '/fee-estimates', keys: ['2', '1', '3'] },
] as const;

type FeeCacheEntry = { rate: number | undefined; at: number };
const feeCache = new Map<string, FeeCacheEntry>();

const usableRate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > MIN_CLAIM_FEE_RATE;

/** `undefined` = la ruta no contestó con la forma esperada (404, HTML…). */
async function readFeeSource(
  url: string,
  keys: readonly string[],
  fetchImpl: typeof fetch,
  signal: AbortSignal
): Promise<{ rate?: number } | undefined> {
  try {
    const response = await fetchImpl(url, { signal });
    if (!response.ok) return undefined;
    if (!response.headers.get('content-type')?.includes('json')) {
      return undefined;
    }
    const body = (await response.json()) as Record<string, unknown>;
    const hasKnownKey = keys.some(key => usableRate(body[key]) || body[key] === 0);
    if (!hasKnownKey) return undefined;
    // Primera tarifa usable, no la primera presente: un 0 no debe arrastrar el
    // claim al mínimo cuando hay otra buena.
    return { rate: keys.map(key => body[key]).find(usableRate) };
  } catch {
    return undefined;
  }
}

/**
 * sat/vB del claim L1, leído de Esplora. Se usa tanto para construir el claim
 * como para inflar la pata onchain, así que un solo número evita que el
 * destinatario reciba de menos.
 *
 * `undefined` cuando ninguna fuente responde: sin estimación no se ofrece el
 * swap (el claim tiene fecha límite y revelar la preimagen a ciegas no es una
 * opción), y el envío cae a la salida colaborativa.
 */
export async function claimFeeRateSatVb(
  baseUrl: string = ACTIVE_NETWORK.esploraUrl,
  fetchImpl: typeof fetch = fetch
): Promise<number | undefined> {
  const base = baseUrl.replace(/\/+$/, '');
  const cached = feeCache.get(base);
  if (cached && Date.now() - cached.at < FEE_CACHE_MS) return cached.rate;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEE_ESTIMATE_TIMEOUT_MS);
  try {
    for (const { path, keys } of FEE_SOURCES) {
      const reading = await readFeeSource(
        `${base}${path}`,
        keys,
        fetchImpl,
        controller.signal
      );
      if (reading) {
        const rate = reading.rate === undefined ? MIN_CLAIM_FEE_RATE : Math.ceil(reading.rate);
        feeCache.set(base, { rate, at: Date.now() });
        return rate;
      }
    }
    feeCache.set(base, { rate: undefined, at: Date.now() });
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** Sólo para tests: vacía la caché de tarifas. */
export function clearClaimFeeCache(): void {
  feeCache.clear();
}

/** Errores de enrutado: no hay solver que sirva el corredor, no es un fallo del envío. */
const NO_ROUTE_ERRORS = new Set([
  'UnsupportedRoute',
  'AmbiguousDestination',
  'SolverRoutesUnavailable',
  'SolverUnavailable',
  'DiscoverySnapshotUnavailable',
]);

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : '';

export const isNoRouteError = (error: unknown): boolean =>
  NO_ROUTE_ERRORS.has(errorName(error));

export const isQuoteExpired = (error: unknown): boolean =>
  errorName(error) === 'QuoteExpired';

const withTimeout = async <T>(
  work: Promise<T>,
  timeoutMs: number
): Promise<T | undefined> => {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<undefined>(resolve => {
    timer = setTimeout(() => resolve(undefined), timeoutMs);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
};

type QuoteClient = Pick<SwapClient, 'quote'>;
type AcceptClient = Pick<SwapClient, 'accept'>;

export type QuoteOnchainSwapParams = {
  swaps: QuoteClient;
  address: string;
  amountSats: number;
  claimFeeRateSatVb: number;
  /** Presupuesto para la ronda RFQ; por defecto 8 s, como la pantalla de envío. */
  timeoutMs?: number;
};

/**
 * Cotiza un envío onchain por solver. Devuelve `undefined` cuando no hay
 * mercado para el corredor (o la RFQ no contestó a tiempo): el llamador debe
 * caer a la salida colaborativa.
 */
export async function quoteOnchainSwap({
  swaps,
  address,
  amountSats,
  claimFeeRateSatVb: rate,
  timeoutMs = 8_000,
}: QuoteOnchainSwapParams): Promise<OnchainSwapQuote | undefined> {
  const target = address.trim();
  if (!target) throw new Error('Indica una dirección onchain.');
  if (!Number.isSafeInteger(amountSats) || amountSats <= 0) {
    throw new Error('Indica cuántos sats quieres enviar.');
  }
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('No hay una tarifa válida para el claim onchain.');
  }

  const claimFee = Number(claimFeeSats({ claimFeeRateSatVb: rate }));
  const take = amountSats + claimFee;

  let quote: Quote;
  try {
    const pending = swaps.quote({
      to: target,
      amount: BigInt(take),
      amountOn: 'take',
    });
    const result = await withTimeout(pending, timeoutMs);
    if (!result) return undefined;
    quote = result;
  } catch (error) {
    if (isNoRouteError(error)) return undefined;
    throw error;
  }

  const payout = Number(quote.take.amount) - claimFee;
  if (payout <= 0 || payout < ONCHAIN_DUST_SATS) {
    throw new Error(
      `El importe deja ${payout} sats para el destinatario tras la comisión del claim y el mínimo es ${ONCHAIN_DUST_SATS}.`
    );
  }
  const solverFee = Number(quote.fee.amount);
  const total = Number(quote.give.amount);
  if (total !== payout + claimFee + solverFee) {
    throw new Error(
      'La cotización del solver no cuadra: el importe que sale del saldo no es el destinatario más las comisiones.'
    );
  }

  return {
    address: target,
    amountSats: payout,
    claimFeeSats: claimFee,
    solverFeeSats: solverFee,
    feeSats: solverFee + claimFee,
    totalSats: total,
    quote,
  };
}

/** Acepta la cotización: a partir de aquí el swap es durable y lo mueve el drive. */
export async function sendOnchainSwap(
  swaps: AcceptClient,
  quote: OnchainSwapQuote
): Promise<{ id: string; outcome: string }> {
  const swap = await swaps.accept(quote.quote);
  return { id: swap.id, outcome: swap.outcome };
}

/** Valida el techo de comisión antes de aceptar nada. */
export function assertOnchainSwapFee(
  quote: OnchainSwapQuote,
  maxFeeSats: number
): void {
  if (quote.feeSats > maxFeeSats) {
    throw new Error(
      `El swap onchain cuesta ${quote.feeSats} sats de comisión (solver y claim) y el máximo es ${maxFeeSats}.`
    );
  }
}
