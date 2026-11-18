import { useEffect, useMemo, useState } from 'react';
import { primeAssetMetadata } from '../lib/arkade/assets';
import {
  bareAssetId,
  resolveAssetInfo,
  type AssetInfo,
} from '../lib/arkade/assetInfo';

/**
 * Resuelve ticker y decimales de una lista de activos. Devuelve un mapa por id
 * en hex. La primera llamada intenta dejar cacheados los mercados publicados,
 * de donde salen los datos del stablecoin sin depender del indexer.
 */
export function useAssetInfo(
  assetIds: string[]
): Record<string, AssetInfo> {
  const [infos, setInfos] = useState<Record<string, AssetInfo>>({});
  const key = useMemo(
    () => Array.from(new Set(assetIds.map(bareAssetId))).join('|'),
    [assetIds]
  );

  useEffect(() => {
    const ids = key ? key.split('|') : [];
    if (ids.length === 0) {
      setInfos({});
      return;
    }

    let cancelled = false;
    void (async () => {
      await primeAssetMetadata();
      const resolved = await Promise.all(ids.map(id => resolveAssetInfo(id)));
      if (cancelled) return;
      const next: Record<string, AssetInfo> = {};
      for (const info of resolved) next[info.assetId] = info;
      setInfos(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [key]);

  return infos;
}
