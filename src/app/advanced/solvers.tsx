import { useCallback, useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import type { Market, Swap } from '@arkade-os/swap';
import type { CorridorSwapRecord } from '@arkade-os/swap/advanced';
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
import { isPendingSwapOutcome } from '../../lib/arkade/lightning';
import { errorMessage, shorten } from '../../lib/format';

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

const outcomeTone = (
  outcome: string
): 'neutral' | 'success' | 'danger' | 'warning' => {
  if (outcome === 'paid' || outcome === 'claimed' || outcome === 'filled') {
    return 'success';
  }
  if (
    outcome === 'failed' ||
    outcome === 'lapsed' ||
    outcome === 'needs_recovery'
  ) {
    return 'danger';
  }
  if (
    outcome === 'refunded' ||
    outcome === 'cancelling' ||
    outcome === 'cancelled' ||
    outcome === 'refunding'
  ) {
    return 'warning';
  }
  return 'neutral';
};

const outcomeLabel = (outcome: string): string => {
  switch (outcome) {
    case 'accepted':
      return 'Aceptado';
    case 'funding':
      return 'Fondeando';
    case 'funded':
      return 'Financiado';
    case 'open':
      return 'Abierto';
    case 'filled':
      return 'Rellenado';
    case 'claimed':
      return 'Reclamado';
    case 'paid':
      return 'Pagado';
    case 'cancelling':
      return 'Cancelando';
    case 'cancelled':
      return 'Cancelado';
    case 'refunding':
      return 'Reembolsando';
    case 'refunded':
      return 'Reembolsado';
    case 'lapsed':
      return 'Expirado';
    case 'needs_recovery':
      return 'Recuperación';
    case 'failed':
      return 'Fallido';
    default:
      return outcome;
  }
};

const sats = (amount: bigint | number | undefined): string =>
  amount === undefined ? '—' : `${Number(amount)} sats`;

/** Campos que el corredor onchain escribe en `profile` al avanzar el drive. */
type OnchainProfile = {
  htlcAddress?: string;
  expectedAmount?: number;
  minConfirmations?: number;
  payoutPkScript?: string;
  funding?: { txid: string; vout: number; amount?: number };
  claimTxid?: string;
  claimFeeRateSatVb?: number;
  claimBroadcastAt?: number;
};

const onchainProfile = (record: CorridorSwapRecord): OnchainProfile => {
  const profile = record.profile as Record<string, unknown>;
  const funding = profile.funding as OnchainProfile['funding'];
  return {
    htlcAddress:
      typeof profile.htlcAddress === 'string' ? profile.htlcAddress : undefined,
    expectedAmount:
      typeof profile.expectedAmount === 'number'
        ? profile.expectedAmount
        : undefined,
    minConfirmations:
      typeof profile.minConfirmations === 'number'
        ? profile.minConfirmations
        : undefined,
    payoutPkScript:
      typeof profile.payoutPkScript === 'string'
        ? profile.payoutPkScript
        : undefined,
    funding: funding && typeof funding.txid === 'string' ? funding : undefined,
    claimTxid:
      typeof profile.claimTxid === 'string' ? profile.claimTxid : undefined,
    claimFeeRateSatVb:
      typeof profile.claimFeeRateSatVb === 'number'
        ? profile.claimFeeRateSatVb
        : undefined,
    claimBroadcastAt:
      typeof profile.claimBroadcastAt === 'number'
        ? profile.claimBroadcastAt
        : undefined,
  };
};

const broadcastLabel = (seconds: number | undefined): string => {
  if (seconds === undefined) return '—';
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? String(seconds) : date.toLocaleString();
};

export default function SolversScreen() {
  const { status, network } = useWallet();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [swaps, setSwaps] = useState<Swap[]>([]);
  const [records, setRecords] = useState<CorridorSwapRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (status !== 'unlocked') return;
    setLoading(true);
    setError(null);
    try {
      const { swaps: client, storage } = getArkadeSession();
      const [nextMarkets, nextSwaps, page] = await Promise.all([
        client.markets(),
        client.swaps(),
        storage.swapRepository.getSwapRecordsPage({ limit: 50 }),
      ]);
      setMarkets(nextMarkets);
      setSwaps(
        [...nextSwaps].sort((a, b) => Number(b.createdAt) - Number(a.createdAt))
      );
      setRecords(
        page.items
          .filter(
            (record): record is CorridorSwapRecord =>
              record.family === 'rfq'
          )
          .sort((a, b) => b.updatedAt - a.updatedAt)
      );
    } catch (err) {
      setError(errorMessage(err));
      setMarkets([]);
      setSwaps([]);
      setRecords([]);
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
      <Button title="Actualizar" onPress={load} loading={loading} />

      {error ? <ErrorBanner message={error} /> : null}

      <SectionLabel>Swaps</SectionLabel>
      {swaps.length === 0 && !loading ? (
        <Paragraph muted>No hay swaps guardados en este dispositivo.</Paragraph>
      ) : (
        <View style={styles.list}>
          {swaps.map(swap => {
            const pending = isPendingSwapOutcome(swap.outcome);
            return (
              <View key={swap.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.pair}>
                    {swap.route?.give?.corridor ?? '?'} →{' '}
                    {swap.route?.take?.corridor ?? '?'}
                  </Text>
                  <Badge
                    label={outcomeLabel(swap.outcome)}
                    tone={outcomeTone(swap.outcome)}
                  />
                </View>
                <Text style={styles.meta}>
                  Envía {sats(swap.give?.amount)} · Recibe{' '}
                  {sats(swap.take?.amount)}
                </Text>
                <Text style={styles.meta}>
                  Comisión {sats(swap.fee?.amount)}
                </Text>
                <Text style={styles.source} numberOfLines={1}>
                  ID {swap.id}
                </Text>
                {swap.fundingTxid ? (
                  <Text style={styles.source} numberOfLines={1}>
                    Fondeo {shorten(swap.fundingTxid, 10, 10)}
                  </Text>
                ) : null}
                {swap.failure ? (
                  <Text style={styles.failure}>Fallo: {swap.failure}</Text>
                ) : null}
                {swap.blockedReason ? (
                  <Text style={styles.failure}>
                    Bloqueado: {swap.blockedReason}
                  </Text>
                ) : null}
                {pending ? (
                  <Text style={styles.pending}>
                    Pendiente: el cliente sigue reclamando o reembolsando.
                    Mantén la app abierta.
                  </Text>
                ) : null}
              </View>
            );
          })}
        </View>
      )}

      <SectionLabel>Registros onchain (detalle del reclamo)</SectionLabel>
      {records.length === 0 && !loading ? (
        <Paragraph muted>
          No hay registros de swap guardados en este dispositivo.
        </Paragraph>
      ) : (
        <View style={styles.list}>
          {records.map(record => {
            const detail =
              record.kind === 'onchain_send' ? onchainProfile(record) : null;
            const funding = detail?.funding;
            return (
              <View key={record.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.pair}>{record.kind}</Text>
                  <Badge
                    label={record.state}
                    tone={outcomeTone(record.state)}
                  />
                </View>
                <Text style={styles.source} numberOfLines={1}>
                  RFQ {record.rfqId}
                </Text>
                {detail ? (
                  <>
                    <Text style={styles.meta}>
                      Esperado {sats(detail.expectedAmount)} · Conf.{' '}
                      {detail.minConfirmations ?? '—'}
                    </Text>
                    <Text style={styles.source} numberOfLines={1}>
                      HTLC {detail.htlcAddress ?? '—'}
                    </Text>
                    <Text style={styles.meta}>
                      Fondeo{' '}
                      {funding
                        ? `${shorten(funding.txid, 8, 8)}:${funding.vout}`
                        : 'no visto'}{' '}
                      {funding?.amount ? `(${funding.amount} sats)` : ''}
                    </Text>
                    <Text style={styles.meta}>
                      Claim{' '}
                      {detail.claimTxid
                        ? shorten(detail.claimTxid, 8, 8)
                        : 'no emitido'}{' '}
                      {detail.claimFeeRateSatVb
                        ? `· ${detail.claimFeeRateSatVb} sat/vB`
                        : ''}
                    </Text>
                    <Text style={styles.meta}>
                      Claim difundido {broadcastLabel(detail.claimBroadcastAt)}
                    </Text>
                  </>
                ) : null}
                {record.fundingTxid ? (
                  <Text style={styles.source} numberOfLines={1}>
                    Lockup {shorten(record.fundingTxid, 10, 10)}
                  </Text>
                ) : null}
                {record.failure ? (
                  <Text style={styles.failure}>Fallo: {record.failure}</Text>
                ) : null}
                {record.claimFailure ? (
                  <Text style={styles.failure}>
                    Claim: {record.claimFailure}
                  </Text>
                ) : null}
                {record.blockedReason ? (
                  <Text style={styles.failure}>
                    Bloqueado: {record.blockedReason}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </View>
      )}

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
        real se muestra al cotizar cada pago. El estado de cada swap se lee del
        repositorio local; en un envío onchain, «Reclamado» ya pagó la dirección
        de destino.
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
  failure: {
    color: colors.danger,
    fontSize: 11,
    marginTop: 2,
  },
  pending: {
    color: colors.warning,
    fontSize: 11,
    marginTop: 2,
  },
});
