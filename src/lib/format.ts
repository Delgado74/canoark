import type { BitcoinUnit } from './preferences';

const groupThousands = (value: number): string =>
  String(Math.trunc(Math.abs(value))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** Formatea satoshis con separador de miles (es-ES). */
export function formatSats(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  const sign = value < 0 ? '-' : '';
  return `${sign}${groupThousands(value)}`;
}

/** Convierte sats a una cadena BTC con 8 decimales, sin redondear a cero. */
export function formatBtc(value: number | null | undefined): string {
  if (!value || !Number.isFinite(value)) return '0,00000000';
  const sats = Math.trunc(value);
  const whole = Math.trunc(sats / 100_000_000);
  const fraction = String(Math.abs(sats % 100_000_000)).padStart(8, '0');
  return `${whole},${fraction}`;
}

export function shorten(value: string, head = 12, tail = 10): string {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return 'Error desconocido';
  }
}

export function satsFromInput(value: string): number {
  const normalized = value.replace(/[.\s]/g, '').replace(',', '.');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}

/**
 * Separa el importe de su unidad para poder pintarlos con estilos distintos,
 * igual que la pantalla principal de Arkade Wallet.
 */
export function formatBitcoinParts(
  sats: number | null | undefined,
  unit: BitcoinUnit
): { value: string; unit: string } {
  const amount = sats ?? 0;
  if (unit === 'BIP177') {
    return { value: `₿${groupThousands(amount)}`, unit: '' };
  }
  if (unit === 'sats') {
    return { value: formatSats(amount), unit: 'sats' };
  }
  return { value: formatBtc(amount), unit: 'BTC' };
}

/** Importe en la unidad de bitcoin elegida, con su etiqueta. */
export function formatBitcoinAmount(
  sats: number | null | undefined,
  unit: BitcoinUnit
): string {
  const parts = formatBitcoinParts(sats, unit);
  return parts.unit ? `${parts.value} ${parts.unit}` : parts.value;
}
