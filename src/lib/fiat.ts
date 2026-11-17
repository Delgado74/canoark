import type { FiatCurrency } from './preferences';
import { fetchBtcRates } from './rates';

export type FiatPrices = {
  eur: number;
  usd: number;
  chf: number;
  jpy: number;
  gbp: number;
  cny: number;
  brl: number;
};

export const EMPTY_FIAT_PRICES: FiatPrices = {
  eur: 0,
  usd: 0,
  chf: 0,
  jpy: 0,
  gbp: 0,
  cny: 0,
  brl: 0,
};

/** Mismos símbolos y decimales que Arkade Wallet. */
const FIAT_SYMBOLS: Partial<Record<FiatCurrency, string>> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
};

let cachedPrices: FiatPrices | null = null;

/**
 * Precios fiat a partir de la referencia de mercado (YADIO, con
 * blockchain.info/ticker como respaldo). No es crítico: si ambas fuentes fallan
 * se mantiene el último valor conocido.
 */
export async function fetchFiatPrices(): Promise<FiatPrices> {
  const rates = await fetchBtcRates();
  const next: FiatPrices = {
    eur: rates.eur,
    usd: rates.usd,
    chf: rates.chf,
    jpy: rates.jpy,
    gbp: rates.gbp,
    cny: rates.cny,
    brl: rates.brl,
  };

  if (rates.usd > 0 || rates.eur > 0) {
    cachedPrices = next;
  }
  return cachedPrices ?? EMPTY_FIAT_PRICES;
}

export function priceFor(prices: FiatPrices, currency: FiatCurrency): number {
  switch (currency) {
    case 'EUR':
      return prices.eur;
    case 'CHF':
      return prices.chf;
    case 'JPY':
      return prices.jpy;
    case 'GBP':
      return prices.gbp;
    case 'CNY':
      return prices.cny;
    case 'BRL':
      return prices.brl;
    case 'USD':
      return prices.usd;
    default:
      return 0;
  }
}

export function fiatDecimals(currency: FiatCurrency): number {
  return currency === 'JPY' ? 0 : 2;
}

export function toFiatAmount(
  sats: number,
  currency: FiatCurrency,
  prices: FiatPrices
): number {
  if (currency === 'BTC') return sats / 100_000_000;
  const price = priceFor(prices, currency);
  if (!price) return 0;
  return (sats / 100_000_000) * price;
}

const groupThousands = (value: string, separator: string): string => {
  const [whole, fraction] = value.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
  return fraction ? `${grouped},${fraction}` : grouped;
};

/** Formatea un importe fiat con separador de miles es-ES. */
export function formatFiat(
  amount: number,
  currency: FiatCurrency,
  decimals = fiatDecimals(currency)
): string {
  if (!Number.isFinite(amount)) return '—';
  const fixed = Math.abs(amount).toFixed(decimals);
  const formatted = groupThousands(fixed, '.');
  const sign = amount < 0 ? '-' : '';
  const symbol = FIAT_SYMBOLS[currency] ?? '';
  if (symbol) return `${sign}${symbol}${formatted}`;
  return `${sign}${formatted} ${currency}`;
}
