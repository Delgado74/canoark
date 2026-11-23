import {
  isBtcAsset,
  sameAsset,
  type Market,
  type MarketLeg,
  type Quote,
  type Swap,
} from '@arkade-os/swap';
import { discoverMarkets } from '@arkade-os/swap/protocol';
import { ACTIVE_NETWORK } from '../../constants/network';
import { bareAssetId, cacheAssetInfo } from './assetInfo';
import { getArkadeSession } from './client';
import { solverDiscoveryOptions } from './solverDiscovery';

/**
 * Swaps BTC ↔ stablecoin USD sobre Arkade.
 *
 * Sólo Mutinynet publica hoy un mercado para esto. La cotización vinculante
 * viene siempre del solver (`SwapClient.quote`); cualquier tasa externa que se
 * muestre en pantalla es una referencia, nunca el precio de ejecución.
 */

export type SwapDirection = 'btc-to-usd' | 'usd-to-btc';

/** Tickers que tratamos como un dólar dentro de un mercado de activos. */
const USD_TICKERS = new Set([
  'USD',
  'USDT',
  'USDC',
  'USDP',
  'DAI',
  'TUSD',
  'BUSD',
  'FDUSD',
  'USDE',
]);

export type BtcUsdMarket = {
  market: Market;
  btcIndex: 0 | 1;
  usdIndex: 0 | 1;
  usdTicker: string;
  btcDecimals: number;
  usdDecimals: number;
};

export type BtcUsdLegs = {
  give: MarketLeg;
  take: MarketLeg;
  giveTicker: string;
  takeTicker: string;
};

export type BtcUsdQuoteInfo = {
  giveUnits: number;
  takeUnits: number;
  /** Unidades de `takeTicker` por cada unidad de `giveTicker`. */
  rate: number;
  feeUnits: number;
  feeDecimals: number;
  feeTicker: string;
};

export const swapsAvailable = (): boolean =>
  ACTIVE_NETWORK.name === 'mutinynet';

/** ¿El ticker de un activo representa un dólar? (USDT, USDC, USDX…) */
export function isUsdAssetTicker(ticker: string): boolean {
  const value = ticker.trim().toUpperCase();
  return value === 'USD' || value.startsWith('USD') || USD_TICKERS.has(value);
}

let primePromise: Promise<void> | null = null;

/**
 * Carga una vez los mercados para dejar cacheados ticker y decimales de los
 * activos que aparecen en el saldo o el historial. Es best-effort: si falla se
 * reintenta en la siguiente llamada.
 */
export function primeAssetMetadata(): Promise<void> {
  if (!swapsAvailable()) return Promise.resolve();
  if (primePromise) return primePromise;

  primePromise = findBtcUsdMarkets()
    .then(() => undefined)
    .catch(() => {
      primePromise = null;
    });
  return primePromise;
}

const tickerOf = (label: string): string =>
  label
    .replace(/[^a-zA-Z]/g, '')
    .toUpperCase();

const usdTickerFromPair = (market: Market, index: 0 | 1): string | null => {
  const side = market.pair.split('/')[index] ?? '';
  const ticker = tickerOf(side);
  if (USD_TICKERS.has(ticker)) return ticker;
  // Algunos registros publican la pata como `arkade:USDT` o similar.
  const bare = tickerOf(side.split(':').pop() ?? '');
  if (USD_TICKERS.has(bare)) return bare;
  if (bare.startsWith('USD')) return bare;
  return null;
};

async function usdTickerOf(
  market: Market,
  index: 0 | 1,
  discoveredTicker?: string
): Promise<string | null> {
  const ticker = discoveredTicker?.trim().toUpperCase();
  if (ticker && isUsdAssetTicker(ticker)) return ticker;

  const pairTicker = usdTickerFromPair(market, index);
  if (pairTicker) return pairTicker;

  const asset = market.legs[index].asset;
  if (!asset) return null;

  try {
    const { wallet } = getArkadeSession();
    const details = await wallet.assetManager.getAssetDetails(
      bareAssetId(asset)
    );
    const ticker =
      typeof details.metadata?.ticker === 'string'
        ? details.metadata.ticker.trim().toUpperCase()
        : '';
    return isUsdAssetTicker(ticker) ? ticker : null;
  } catch {
    // The pair label remains the fallback when the indexer has no asset metadata.
    return null;
  }
}

/**
 * Mercados publicados con una pata BTC y otra stablecoin USD. La pata no-BTC y
 * su ticker sale de la tarjeta descubierta, el `pair` o los metadatos del
 * activo cuando el registro usa un identificador opaco como `BTC/f121ac9b`.
 */
export async function findBtcUsdMarkets(): Promise<BtcUsdMarket[]> {
  const { swaps, storage } = getArkadeSession();
  const discovered = await discoverMarkets({
    ...solverDiscoveryOptions(ACTIVE_NETWORK),
    repository: storage.swapRepository,
    useCache: false,
  });
  const markets = await swaps.markets();

  const found: BtcUsdMarket[] = [];
  for (const market of markets) {
    const btcIndex = market.legs.findIndex(
      leg => leg.asset !== undefined && isBtcAsset(leg.asset)
    );
    if (btcIndex !== 0 && btcIndex !== 1) continue;

    const usdIndex: 0 | 1 = btcIndex === 0 ? 1 : 0;
    const btcLeg = market.legs[btcIndex];
    const usdLeg = market.legs[usdIndex];
    if (!usdLeg.asset || isBtcAsset(usdLeg.asset)) continue;

    const solverCard = discovered.find(
      card =>
        card.pair === market.pair &&
        card.solver === market.solver
    );
    const discoveredTicker =
      usdIndex === 0
        ? solverCard?.base_asset.ticker
        : solverCard?.quote_asset.ticker;
    const usdTicker = await usdTickerOf(market, usdIndex, discoveredTicker);
    if (!usdTicker) continue;

    // Deja el activo descrito para el saldo y el historial: el registro publica
    // ticker y decimales, así no dependemos de los metadatos del indexer.
    cacheAssetInfo({
      assetId: usdLeg.asset,
      ticker: usdTicker,
      decimals: usdLeg.decimals,
    });

    found.push({
      market,
      btcIndex,
      usdIndex,
      usdTicker,
      btcDecimals: btcLeg.decimals,
      usdDecimals: usdLeg.decimals,
    });
  }

  // Los mercados de precio (sin rendezvous RFQ) cotizan sin abrir un canal con
  // el solver; se prefieren sobre los RFQ para un swap puntual.
  return found.sort((a, b) => {
    const feed =
      Number(a.market.backend === 'feed') -
      Number(b.market.backend === 'feed');
    if (feed !== 0) return -feed;
    return a.market.pair.localeCompare(b.market.pair);
  });
}

export function legsFor(
  market: BtcUsdMarket,
  direction: SwapDirection
): BtcUsdLegs {
  const btc = market.market.legs[market.btcIndex];
  const usd = market.market.legs[market.usdIndex];

  return direction === 'btc-to-usd'
    ? {
        give: btc,
        take: usd,
        giveTicker: 'BTC',
        takeTicker: market.usdTicker,
      }
    : {
        give: usd,
        take: btc,
        giveTicker: market.usdTicker,
        takeTicker: 'BTC',
      };
}

/** Convierte unidades decimales (texto de usuario) a unidades atómicas. */
export function parseUnits(text: string, decimals: number): bigint | null {
  const normalized = text.trim().replace(',', '.');
  if (!/^\d*(\.\d*)?$/.test(normalized)) return null;
  if (normalized === '' || normalized === '.') return null;

  const [whole = '0', fraction = ''] = normalized.split('.');
  if (fraction.length > decimals) return null;

  const atomic = `${whole || '0'}${fraction.padEnd(decimals, '0')}`;
  try {
    return BigInt(atomic);
  } catch {
    return null;
  }
}

/** Formatea unidades atómicas con separadores es-ES, sin ceros sobrantes. */
export function formatUnits(
  amount: bigint,
  decimals: number,
  maxFractionDigits = decimals
): string {
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const scale = 10n ** BigInt(decimals);
  const whole = absolute / scale;
  const fractionDigits = Math.max(0, Math.min(decimals, maxFractionDigits));
  let fraction = (absolute % scale).toString().padStart(decimals, '0');
  if (fractionDigits < decimals) fraction = fraction.slice(0, fractionDigits);
  fraction = fraction.replace(/0+$/, '');

  const grouped = whole
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}${grouped}${
    fraction ? `,${fraction}` : ''
  }`;
}

/** Número decimal de una cantidad atómica, sólo para calcular tasas. */
export function unitsOf(amount: bigint, decimals: number): number {
  return Number(amount) / 10 ** decimals;
}

/** Unidades atómicas al formato que entiende `parseUnits` (sin separadores). */
export function unitsToInput(amount: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = (amount % scale)
    .toString()
    .padStart(decimals, '0')
    .replace(/0+$/, '');
  return `${whole}${fraction ? `.${fraction}` : ''}`;
}

/**
 * Cotiza un intercambio con el solver. `amount` va en unidades atómicas de la
 * pata que se entrega y se fija con `amountOn: 'give'`, igual que Arkade Wallet.
 */
export async function quoteBtcUsd(
  market: BtcUsdMarket,
  direction: SwapDirection,
  amount: bigint
): Promise<Quote> {
  const { swaps } = getArkadeSession();
  const { give, take, giveTicker } = legsFor(market, direction);

  if (!give.asset || !take.asset) {
    throw new Error(
      'El mercado no publica los identificadores de sus dos activos.'
    );
  }
  if (amount <= 0n) {
    throw new Error('Indica un importe mayor que cero.');
  }

  if (give.limits) {
    if (amount < give.limits.min) {
      throw new Error(
        `El mínimo del mercado es ${formatUnits(
          give.limits.min,
          give.decimals
        )} ${giveTicker} por operación.`
      );
    }
    // -1 significa «sin límite» en los parámetros del operador.
    if (give.limits.max >= 0n && amount > give.limits.max) {
      throw new Error(
        `El máximo del mercado es ${formatUnits(
          give.limits.max,
          give.decimals
        )} ${giveTicker} por operación.`
      );
    }
  }

  return swaps.quote({
    give: give.asset,
    take: take.asset,
    amount,
    amountOn: 'give',
  });
}

/** Hace durable la cotización y financia el swap. */
export async function acceptBtcUsd(quote: Quote): Promise<Swap> {
  const { swaps } = getArkadeSession();
  return swaps.accept(quote);
}

export function quoteInfo(
  quote: Quote,
  market: BtcUsdMarket,
  direction: SwapDirection
): BtcUsdQuoteInfo {
  const { give, take, giveTicker, takeTicker } = legsFor(market, direction);
  const giveUnits = unitsOf(quote.give.amount, give.decimals);
  const takeUnits = unitsOf(quote.take.amount, take.decimals);
  const feeOnGive = sameAsset(quote.fee.asset, quote.give.asset);

  return {
    giveUnits,
    takeUnits,
    rate: giveUnits > 0 ? takeUnits / giveUnits : 0,
    feeUnits: unitsOf(
      quote.fee.amount,
      feeOnGive ? give.decimals : take.decimals
    ),
    feeDecimals: feeOnGive ? give.decimals : take.decimals,
    feeTicker: feeOnGive ? giveTicker : takeTicker,
  };
}

/** Precio implícito de 1 BTC en la stablecoin, sea cual sea la dirección. */
export function btcPriceInUsd(
  info: BtcUsdQuoteInfo,
  direction: SwapDirection
): number {
  if (direction === 'btc-to-usd') return info.rate;
  return info.rate > 0 ? 1 / info.rate : 0;
}

/**
 * Estados en los que la UI ya puede dejar de esperar. `filled` es el estado
 * final de un swap de activos por oferta (el covenant se rellenó); `claimed`
 * lo es cuando además hay un reclamo propio.
 */
export function isTerminalSwapOutcome(outcome: string): boolean {
  return [
    'filled',
    'claimed',
    'paid',
    'refunded',
    'cancelled',
    'lapsed',
    'failed',
    'needs_recovery',
  ].includes(outcome);
}

export function isSuccessfulSwapOutcome(outcome: string): boolean {
  return outcome === 'filled' || outcome === 'claimed' || outcome === 'paid';
}
