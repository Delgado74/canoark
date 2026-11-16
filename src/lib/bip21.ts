import { BIP21 } from '@arkade-os/sdk';
import { isArkadeAddress, isLightningInvoice, isOnchainAddress } from './arkade/lightning';

export type ParsedDestinationKind = 'arkade' | 'lightning' | 'onchain' | 'unknown';

export type ParsedDestination = {
  /** Texto normalizado que se pasa al SDK. */
  raw: string;
  kind: ParsedDestinationKind;
  /** Importe incluido en el BIP21 o factura, si se puede leer. */
  amountSats?: number;
  lnurl?: string;
};

const stripScheme = (value: string, scheme: string): string =>
  value.toLowerCase().startsWith(scheme) ? value.slice(scheme.length) : value;

/**
 * Interpreta lo que el usuario pega o escanea:
 * - `bitcoin:` BIP21 (con `ark=`, `lightning=` y `amount=`)
 * - `lightning:` facturas BOLT11
 * - direcciones Arkade y onchain sueltas
 */
export function parseDestination(input: string): ParsedDestination {
  const value = input.trim();
  if (!value) return { raw: '', kind: 'unknown' };

  if (value.toLowerCase().startsWith('bitcoin:')) {
    try {
      const parsed = BIP21.parse(value);
      const params = parsed.params;
      const amountSats =
        typeof params.amount === 'number' && Number.isFinite(params.amount)
          ? Math.round(params.amount * 100_000_000)
          : undefined;
      const ark = typeof params.ark === 'string' ? params.ark : undefined;
      const lightning =
        typeof params.lightning === 'string' ? params.lightning : undefined;
      const address =
        typeof params.address === 'string' ? params.address : undefined;

      if (ark && isArkadeAddress(ark)) {
        return { raw: ark, kind: 'arkade', amountSats };
      }
      if (lightning) {
        return {
          raw: lightning,
          kind: isLightningInvoice(lightning) ? 'lightning' : 'unknown',
          amountSats,
          lnurl: lightning.includes('@') ? lightning : undefined,
        };
      }
      if (address && isOnchainAddress(address)) {
        return { raw: address, kind: 'onchain', amountSats };
      }
      return { raw: value, kind: 'unknown', amountSats };
    } catch {
      return { raw: value, kind: 'unknown' };
    }
  }

  const withoutLightning = stripScheme(value, 'lightning:');
  if (isLightningInvoice(withoutLightning)) {
    return { raw: withoutLightning, kind: 'lightning' };
  }
  if (isArkadeAddress(value)) return { raw: value, kind: 'arkade' };
  if (isOnchainAddress(value)) return { raw: value, kind: 'onchain' };

  // Lightning Address (usuario@dominio). El solver actual de @arkade-os/swap
  // no acepta LNURL-pay como destino directo, pero lo identificamos para dar
  // un mensaje útil en vez de "destino desconocido".
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return { raw: value, kind: 'unknown', lnurl: value };
  }

  return { raw: value, kind: 'unknown' };
}

export function destinationKindLabel(kind: ParsedDestinationKind): string {
  switch (kind) {
    case 'arkade':
      return 'Dirección Arkade';
    case 'lightning':
      return 'Factura Lightning';
    case 'onchain':
      return 'Dirección onchain';
    default:
      return 'Destino';
  }
}

/** URI BIP21 unificado para la pestaña onchain de Recibir. */
export function buildOnchainUri(address: string, sats: number): string {
  if (!address) return '';
  if (!sats || sats <= 0) return address;
  return BIP21.create({
    address,
    amount: sats / 100_000_000,
  });
}
