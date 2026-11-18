import { StyleSheet, Text, View } from 'react-native';
import { Card } from './ui';
import { colors, spacing } from '../constants/theme';
import { useAssetInfo } from '../hooks/useAssetInfo';
import { formatUnits, isUsdAssetTicker } from '../lib/arkade/assets';
import { bareAssetId, shortAssetId } from '../lib/arkade/assetInfo';
import { formatFiat } from '../lib/fiat';
import type { BalanceAsset } from '../types/wallet';

/**
 * Saldo de activos Arkade (stablecoins USD, etc.) junto al saldo BTC.
 * Sin esto, un swap a USDT desaparece de la pantalla principal aunque el
 * activo esté en la billetera.
 */
export function AssetBalances({ assets }: { assets: BalanceAsset[] }) {
  const infos = useAssetInfo(assets.map(asset => asset.assetId));

  if (assets.length === 0) return null;

  return (
    <Card title="Activos">
      {assets.map(asset => {
        const id = bareAssetId(asset.assetId);
        const info = infos[id];
        const ticker = info?.ticker ?? shortAssetId(id);
        const decimals = info?.decimals ?? 0;
        const usd = isUsdAssetTicker(ticker)
          ? Number(asset.amount) / 10 ** decimals
          : null;

        return (
          <View key={id} style={styles.row}>
            <View style={styles.labels}>
              <Text style={styles.ticker}>{ticker}</Text>
              {info?.name ? (
                <Text style={styles.name} numberOfLines={1}>
                  {info.name}
                </Text>
              ) : null}
            </View>
            <View style={styles.values}>
              <Text style={styles.amount} numberOfLines={1}>
                {formatUnits(asset.amount, decimals)} {ticker}
              </Text>
              {usd !== null ? (
                <Text style={styles.usd}>≈ {formatFiat(usd, 'USD')}</Text>
              ) : null}
            </View>
          </View>
        );
      })}
      <Text style={styles.note}>
        Los activos viajan dentro de un VTXO con unos sats de portador en BTC.
        Esos sats también son tuyos y forman parte del saldo disponible.
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  labels: {
    flexShrink: 1,
    gap: 2,
  },
  ticker: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  name: {
    color: colors.textMuted,
    fontSize: 11,
  },
  values: {
    alignItems: 'flex-end',
    gap: 2,
  },
  amount: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  usd: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  note: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: spacing.sm,
  },
});
