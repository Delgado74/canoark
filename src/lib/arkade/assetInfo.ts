import { shorten } from '../format';
import { getArkadeSession } from './client';

/**
 * Metadatos de un activo Arkade (ticker, nombre y decimales).
 *
 * El saldo del SDK llega con ids en hex sin ticker ni decimales. Para pintar un
 * importe hay que resolverlos: primero con lo que publica el registro de
 * solvers (los swaps ya lo cachean al descubrir el mercado) y, si no, con los
 * metadatos del indexer. Nunca es crítico: si todo falla se muestra un id
 * corto con cero decimales.
 */
export type AssetInfo = {
  assetId: string;
  ticker: string;
  name?: string;
  decimals: number;
};

const cache = new Map<string, AssetInfo>();

/** Los ids del saldo son hex; los del mercado, CAIP (`arkade:red/asset:<hex>`). */
export function bareAssetId(value: string): string {
  const afterSlash = value.includes('/')
    ? value.slice(value.lastIndexOf('/') + 1)
    : value;
  return afterSlash.startsWith('asset:')
    ? afterSlash.slice('asset:'.length)
    : afterSlash;
}

export function shortAssetId(assetId: string): string {
  return shorten(bareAssetId(assetId), 6, 4);
}

export function cacheAssetInfo(info: AssetInfo): AssetInfo {
  const normalized: AssetInfo = { ...info, assetId: bareAssetId(info.assetId) };
  cache.set(normalized.assetId, normalized);
  return normalized;
}

export function knownAssetInfo(assetId: string): AssetInfo | undefined {
  return cache.get(bareAssetId(assetId));
}

/** Resuelve ticker y decimales. Nunca lanza. */
export async function resolveAssetInfo(assetId: string): Promise<AssetInfo> {
  const bare = bareAssetId(assetId);
  const known = cache.get(bare);
  if (known) return known;

  const fallback: AssetInfo = {
    assetId: bare,
    ticker: shortAssetId(bare),
    decimals: 0,
  };

  try {
    const { wallet } = getArkadeSession();
    const details = await wallet.assetManager.getAssetDetails(bare);
    const metadata = details.metadata ?? {};
    const decimals = Number(metadata.decimals);
    const ticker =
      typeof metadata.ticker === 'string' ? metadata.ticker.trim() : '';
    const name = typeof metadata.name === 'string' ? metadata.name : undefined;

    return cacheAssetInfo({
      assetId: bare,
      ticker: ticker ? ticker.toUpperCase() : shortAssetId(bare),
      name,
      decimals: Number.isInteger(decimals) && decimals >= 0 ? decimals : 0,
    });
  } catch {
    // Sin metadatos el activo sigue siendo visible, sólo que sin decimales.
    return fallback;
  }
}
