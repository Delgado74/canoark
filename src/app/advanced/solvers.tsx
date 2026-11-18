import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, StyleSheet, Text, View } from 'react-native';
import type { Market, Swap } from '@arkade-os/swap';
import { EsploraProvider } from '@arkade-os/sdk';
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
import {
  getArkadeSession,
  getOnchainClaimError,
  retryOnchainClaim,
} from '../../lib/arkade/client';
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
  htlcLocktime?: number;
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
    htlcLocktime:
      typeof profile.htlcLocktime === 'number'
        ? profile.htlcLocktime
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

/** Minutos que quedan hasta que abra la hoja de reembolso del solver. */
const windowLabel = (locktime: number | undefined): string => {
  if (locktime === undefined) return '—';
  const remaining = Math.round(locktime - Date.now() / 1000);
  if (remaining <= 0) return 'ventana cerrada';
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.round((remaining % 3600) / 60);
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
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
  const [htlcStatus, setHtlcStatus] = useState<Record<string, string>>({});
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
      const corridor = page.items
        .filter(
          (record): record is CorridorSwapRecord => record.family === 'rfq'
        )
        .sort((a, b) => b.updatedAt - a.updatedAt);
      setRecords(corridor);

      // Confirmaciones reales del HTLC en L1: si el drive sigue en `pending` es
      // la diferencia entre «aún no confirma» y «ya se puede reclamar».
      const provider = new EsploraProvider(network.esploraUrl);
      const entries = await Promise.all(
        corridor
          .filter(record => record.kind === 'onchain_send')
          .slice(0, 5)
          .map(async record => {
            const detail = onchainProfile(record);
            if (!detail.htlcAddress) return [record.rfqId, 'sin HTLC'] as const;
            try {
              const [coins, tip] = await Promise.all([
                provider.getCoins(detail.htlcAddress),
                provider.getChainTip(),
              ]);
              if (coins.length === 0) {
                return [record.rfqId, 'sin UTXO en el HTLC'] as const;
              }
              const best = coins.reduce((a, b) => (b.value > a.value ? b : a));
              const confirmations =
                best.status.confirmed &&
                typeof best.status.block_height === 'number'
                  ? Math.max(0, tip.height - best.status.block_height + 1)
                  : 0;
              return [
                record.rfqId,
                `${coins.length} UTXO · ${confirmations} conf · ${best.value} sats`,
              ] as const;
            } catch (err) {
              return [
                record.rfqId,
                `no se pudo leer Esplora: ${errorMessage(err)}`,
              ] as const;
            }
          })
      );
      setHtlcStatus(Object.fromEntries(entries));
    } catch (err) {
      setError(errorMessage(err));
      setMarkets([]);
      setSwaps([]);
      setRecords([]);
      setHtlcStatus({});
    } finally {
      setLoading(false);
    }
  }, [status, network.esploraUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  const retryClaim = (rfqId: string) => {
    void (async () => {
      try {
        const { txid } = await retryOnchainClaim(rfqId);
        Alert.alert('Claim emitido', txid);
      } catch (err) {
        Alert.alert('El claim falló', errorMessage(err));
      } finally {
        await load();
      }
    })();
  };

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
            const claimError = getOnchainClaimError(record.rfqId);
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
                    <Text style={styles.meta}>
                      Ventana HTLC {windowLabel(detail.htlcLocktime)}
                    </Text>
                    {htlcStatus[record.rfqId] ? (
                      <Text style={styles.meta}>
                        HTLC en L1: {htlcStatus[record.rfqId]}
                      </Text>
                    ) : null}
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
                {claimError ? (
                  <Text style={styles.failure}>
                    Error del claim: {claimError}
                  </Text>
                ) : null}
                {record.blockedReason ? (
                  <Text style={styles.failure}>
                    Bloqueado: {record.blockedReason}
                  </Text>
                ) : null}
                {record.kind === 'onchain_send' && !detail?.claimTxid ? (
                  <Button
                    title="Reintentar reclamo"
                    variant="secondary"
                    onPress={() => retryClaim(record.rfqId)}
                  />
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
          {markets.map(market => {
            const [legA, legB] = market.legs;
            return (
              <View key={`${market.key}:${market.solver}`} style={styles.marketCard}>
                <View style={styles.marketHeader}>
                  <View style={styles.marketTitleBlock}>
                    <Text style={styles.marketPair}>{market.pair}</Text>
                    <Text style={styles.marketSolver} numberOfLines={1}>
                      {market.solver}
                    </Text>
                  </View>
                  <Badge
                    label={market.sourceType === 'local' ? 'Local' : 'Registro'}
                    tone="neutral"
                  />
                </View>

                <View style={styles.marketSection}>
                  <Text style={styles.marketSectionTitle}>Patas del mercado</Text>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>{assetLabel(legA.asset)}</Text>
                    <Text style={styles.detailValue}>{limitLabel(legA.limits)}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>{assetLabel(legB.asset)}</Text>
                    <Text style={styles.detailValue}>{limitLabel(legB.limits)}</Text>
                  </View>
                </View>

                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Origen</Text>
                  <Text
                    style={[styles.detailValue, styles.detailMono]}
                    numberOfLines={1}
                  >
                    {market.source}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}
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
  marketCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  marketHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  marketTitleBlock: {
    flex: 1,
    gap: 2,
  },
  marketPair: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  marketSolver: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  marketSection: {
    gap: 6,
    paddingTop: 2,
  },
  marketSectionTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  detailLabel: {
    color: colors.textMuted,
    fontSize: 12,
    flexShrink: 0,
  },
  detailValue: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
    textAlign: 'right',
  },
  detailMono: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '500',
  },
});
