/**
 * Precio de BTC en monedas fiat.
 *
 * La tasa que ejecuta un swap **no** sale de aquí: la fija el solver en su
 * cotización (`SwapClient.quote`). Este módulo sólo alimenta la referencia de
 * mercado que se muestra junto a la cotización y la conversión fiat del saldo.
 *
 * Fuente principal: YADIO (`api.yadio.io`). Devuelve BTC contra todas las
 * monedas en una sola llamada, incluida CUP. Si falla, se conserva el último
 * valor conocido y, si nunca hubo uno, se recurre a blockchain.info/ticker
 * (la fuente histórica de la app).
 */

export type BtcRates = {
  usd: number;
  eur: number;
  chf: number;
  jpy: number;
  gbp: number;
  cny: number;
  brl: number;
  cup: number;
  fetchedAt: number;
  source: 'yadio' | 'blockchain.info' | 'cache';
};

export const EMPTY_BTC_RATES: BtcRates = {
  usd: 0,
  eur: 0,
  chf: 0,
  jpy: 0,
  gbp: 0,
  cny: 0,
  brl: 0,
  cup: 0,
  fetchedAt: 0,
  source: 'cache',
};

const YADIO_URL = 'https://api.yadio.io/exrates/BTC';
const BLOCKCHAIN_URL = 'https://blockchain.info/ticker';
const TTL_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 10_000;

let cached: BtcRates | null = null;
let cachedAt = 0;
let inflight: Promise<BtcRates> | null = null;

const positive = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

async function getJson(url: string): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json: unknown = await response.json();
    if (!json || typeof json !== 'object') {
      throw new Error('Respuesta de precios inválida.');
    }
    return json as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

async function fromYadio(): Promise<BtcRates | null> {
  const json = await getJson(YADIO_URL);
  const btc = json.BTC;
  if (!btc || typeof btc !== 'object') return null;

  const prices = btc as Record<string, unknown>;
  const rates: BtcRates = {
    usd: positive(prices.USD),
    eur: positive(prices.EUR),
    chf: positive(prices.CHF),
    jpy: positive(prices.JPY),
    gbp: positive(prices.GBP),
    cny: positive(prices.CNY),
    brl: positive(prices.BRL),
    cup: positive(prices.CUP),
    fetchedAt: Date.now(),
    source: 'yadio',
  };

  return rates.usd > 0 ? rates : null;
}

async function fromBlockchainInfo(): Promise<BtcRates | null> {
  const json = await getJson(BLOCKCHAIN_URL);
  const last = (code: string): number => {
    const entry = json[code];
    if (!entry || typeof entry !== 'object') return 0;
    return positive((entry as { last?: unknown }).last);
  };

  const rates: BtcRates = {
    usd: last('USD'),
    eur: last('EUR'),
    chf: last('CHF'),
    jpy: last('JPY'),
    gbp: last('GBP'),
    cny: last('CNY'),
    brl: last('BRL'),
    cup: 0,
    fetchedAt: Date.now(),
    source: 'blockchain.info',
  };

  return rates.usd > 0 ? rates : null;
}

/**
 * Precio de BTC en fiat. Nunca lanza: ante un fallo devuelve la última copia
 * válida (marcada como `cache`) o ceros, que la UI interpreta como «sin datos».
 */
export async function fetchBtcRates(): Promise<BtcRates> {
  if (cached && Date.now() - cachedAt < TTL_MS) return cached;
  if (inflight) return inflight;

  const pending = (async (): Promise<BtcRates> => {
    for (const load of [fromYadio, fromBlockchainInfo]) {
      try {
        const next = await load();
        if (next) {
          cached = next;
          cachedAt = Date.now();
          return next;
        }
      } catch {
        // Se prueba la siguiente fuente.
      }
    }

    if (cached) {
      const known: BtcRates = { ...cached, source: 'cache' };
      return known;
    }
    return EMPTY_BTC_RATES;
  })();

  inflight = pending;
  try {
    return await pending;
  } finally {
    if (inflight === pending) inflight = null;
  }
}
