import { useCallback, useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import type { Market } from '@arkade-os/swap';
import {
  Badge,
  Button,
  ErrorBanner,
  Notice,
  Paragraph,
  Row,
  SectionLabel,
} from '../../components/ui';
import { SettingsScreen } from '../../components/SettingsScreen';
import { colors, spacing } from '../../constants/theme';
import { useWallet } from '../../hooks/useWallet';
import { getArkadeSession } from '../../lib/arkade/client';
import { errorMessage } from '../../lib/format';

const assetLabel = (asset: unknown): string => {
  if (!asset) return '—';
  const value = String(asset);
  const parts = value.split(/[/:]/);
  return parts[parts.length - 1] || value;
};

const limitLabel = (limit: { min: bigint; max: bigint } | null): string => {
  if (!limit) return 'No paga esta pata';
  return `${Number(limit.min)} – ${Number(limit.max)} sats`;
};

export default function SolversScreen() {
  const { status, network } = useWallet();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (status !== 'unlocked') return;
    setLoading(true);
    setError(null);
    try {
      const { swaps } = getArkadeSession();
      const next = await swaps.markets();
      setMarkets(next);
    } catch (err) {
      setError(errorMessage(err));
      setMarkets([]);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SettingsScreen
      title="Solvers"
      onRefresh={() => void load()}
      refreshing={loading}
    >
      <Row label="Red" value={network.swapNetwork} />
      <Row label="Registro" value={network.solverRegistryUrl} mono />
      <Button
        title="Abrir registro de solvers"
        variant="secondary"
        onPress={() => {
          void Linking.openURL(network.solverRegistryUrl);
        }}
      />
      <Button title="Actualizar mercados" onPress={load} loading={loading} />

      {error ? <ErrorBanner message={error} /> : null}

      <SectionLabel>Mercados disponibles</SectionLabel>
      {markets.length === 0 && !loading ? (
        <Paragraph muted>
          No hay mercados publicados para esta red. Revisa el registro o
          inténtalo de nuevo.
        </Paragraph>
      ) : (
        <View style={styles.list}>
          {markets.map(market => (
            <View key={`${market.key}:${market.solver}`} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.pair}>{market.pair}</Text>
                <Badge
                  label={market.sourceType === 'local' ? 'Local' : 'Registro'}
                  tone="neutral"
                />
              </View>
              <Text style={styles.solver}>{market.solver}</Text>
              <Text style={styles.meta}>
                {assetLabel(market.legs[0].asset)} →{' '}
                {assetLabel(market.legs[1].asset)}
              </Text>
              <Text style={styles.meta}>
                {limitLabel(market.legs[0].limits)} ·{' '}
                {limitLabel(market.legs[1].limits)}
              </Text>
              <Text style={styles.source} numberOfLines={1}>
                {market.source}
              </Text>
            </View>
          ))}
        </View>
      )}

      <Notice tone="info">
        Los mercados vienen del mismo registro que usa Arkade Wallet. La comisión
        real se muestra al cotizar cada pago.
      </Notice>
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 4,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  pair: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  solver: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  meta: {
    color: colors.textMuted,
    fontSize: 12,
  },
  source: {
    color: colors.textMuted,
    fontSize: 10,
    fontFamily: 'monospace',
    marginTop: 2,
  },
});
