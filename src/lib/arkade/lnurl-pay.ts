import { formatSats } from '../format';

/**
 * Pago a una Lightning Address (LUD-16) resolviendo la factura BOLT11 con
 * LNURL-pay (LUD-06).
 *
 * El solver de `@arkade-os/swap` solo acepta facturas BOLT11, así que el
 * camino es: `usuario@dominio` -> `/.well-known/lnurlp/usuario` -> callback
 * con el importe -> factura -> pagar la factura por el solver.
 *
 * Solo se usa `fetch` + JSON; no se guarda nada en disco.
 */

/** Tiempo máximo por petición HTTP al servidor LNURL. */
const LNURL_TIMEOUT_MS = 20_000;

type PayRequest = {
  tag?: string;
  callback?: string;
  /** Milisatoshis. */
  minSendable?: number;
  /** Milisatoshis. */
  maxSendable?: number;
  status?: string;
  reason?: string;
};

type InvoiceResponse = {
  pr?: string;
  status?: string;
  reason?: string;
};

const splitAddress = (
  value: string
): { name: string; domain: string } | null => {
  const trimmed = value
    .trim()
    .replace(/^lightning:/i, '')
    .trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return null;
  const name = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1).toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return null;
  return { name, domain };
};

export function isLightningAddress(value: string): boolean {
  return splitAddress(value) !== null;
}

const knownReasons: Record<string, string> = {
  'unknown ln address': 'Esa dirección Lightning no existe en ese dominio.',
  'unknown lnurl': 'Esa dirección Lightning no existe en ese dominio.',
  'this ln address is not available':
    'Esa dirección Lightning no está disponible ahora mismo.',
};

const serverError = (reason: unknown, fallback: string): Error => {
  const raw = typeof reason === 'string' ? reason.trim() : '';
  if (!raw) return new Error(fallback);
  return new Error(knownReasons[raw.toLowerCase()] ?? raw);
};

async function getJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LNURL_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`El servidor LNURL respondió ${response.status}.`);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error('El servidor LNURL devolvió una respuesta no válida.');
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('La dirección Lightning tardó demasiado en responder.');
    }
    if (
      error instanceof Error &&
      /network request failed|failed to fetch/i.test(error.message)
    ) {
      throw new Error('No se pudo contactar con el servidor de la dirección Lightning.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Devuelve una factura BOLT11 por el importe indicado, lista para pagar con
 * `payThroughSolver`.
 */
export async function resolveLightningAddress(
  address: string,
  amountSats: number
): Promise<string> {
  const parts = splitAddress(address);
  if (!parts) {
    throw new Error(
      'La dirección Lightning no es válida. Debe tener el formato usuario@dominio.'
    );
  }

  const sats = Math.floor(amountSats);
  if (!Number.isFinite(sats) || sats <= 0) {
    throw new Error(
      'Indica cuántos sats quieres enviar a la dirección Lightning.'
    );
  }

  const wellKnown = `https://${parts.domain}/.well-known/lnurlp/${encodeURIComponent(
    parts.name
  )}`;
  const payRequest = await getJson<PayRequest>(wellKnown);

  if (payRequest.status === 'ERROR') {
    throw serverError(
      payRequest.reason,
      'El servidor LNURL rechazó la solicitud.'
    );
  }
  if (payRequest.tag !== 'payRequest' || !payRequest.callback) {
    throw new Error(
      'Ese dominio no parece un servidor LNURL-pay válido para esa dirección.'
    );
  }

  const msat = sats * 1000;
  const minMsat =
    typeof payRequest.minSendable === 'number' ? payRequest.minSendable : 0;
  const maxMsat =
    typeof payRequest.maxSendable === 'number'
      ? payRequest.maxSendable
      : Number.MAX_SAFE_INTEGER;

  if (msat < minMsat) {
    throw new Error(
      `Esa dirección pide al menos ${formatSats(
        Math.ceil(minMsat / 1000)
      )} sats.`
    );
  }
  if (msat > maxMsat) {
    throw new Error(
      `Esa dirección acepta como máximo ${formatSats(
        Math.floor(maxMsat / 1000)
      )} sats.`
    );
  }

  // Se construye la URL a mano: el polyfill de `URL` de React Native no
  // siempre refleja `searchParams` en `toString()`.
  if (!/^https?:\/\//i.test(payRequest.callback)) {
    throw new Error('El servidor LNURL devolvió un callback no válido.');
  }
  const separator = payRequest.callback.includes('?') ? '&' : '?';
  const callbackUrl = `${payRequest.callback}${separator}amount=${msat}`;

  const invoiceResponse = await getJson<InvoiceResponse>(callbackUrl);

  if (invoiceResponse.status === 'ERROR') {
    throw serverError(
      invoiceResponse.reason,
      'El servidor LNURL no pudo emitir la factura.'
    );
  }
  const pr = typeof invoiceResponse.pr === 'string' ? invoiceResponse.pr.trim() : '';
  if (!pr) {
    throw new Error('El servidor LNURL no devolvió una factura BOLT11.');
  }
  return pr;
}
