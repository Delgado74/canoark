import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ArkTransaction } from '@arkade-os/sdk';
import {
  Card,
  Screen,
  SectionLabel,
  Segmented,
  Title,
} from '../../components/ui';
import { colors, spacing } from '../../constants/theme';
import { useWallet } from '../../hooks/useWallet';
import {
  TransactionRow,
  transactionKey,
} from '../../components/TransactionRow';
import { formatSats } from '../../lib/format';

type Filter = 'all' | 'received' | 'sent';

const dayKey = (timestamp: number): string => {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
};

const dayLabel = (timestamp: number): string => {
  if (!timestamp) return 'Sin fecha';
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (dayKey(timestamp) === dayKey(today.getTime())) return 'Hoy';
  if (dayKey(timestamp) === dayKey(yesterday.getTime())) return 'Ayer';

  return date.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'long',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
};

export default function HistoryScreen() {
  const { history, refresh, refreshing } = useWallet();
  const [filter, setFilter] = useState<Filter>('all');

  const filtered = useMemo(
    () =>
      history.filter(tx => {
        if (filter === 'received') return tx.type === 'RECEIVED';
        if (filter === 'sent') return tx.type === 'SENT';
        return true;
      }),
    [history, filter]
  );

  const groups = useMemo(() => {
    const map = new Map<string, { label: string; items: ArkTransaction[] }>();
    for (const tx of filtered) {
      const key = dayKey(tx.createdAt);
      const group = map.get(key);
      if (group) group.items.push(tx);
      else map.set(key, { label: dayLabel(tx.createdAt), items: [tx] });
    }
    return Array.from(map.values());
  }, [filtered]);

  const totals = useMemo(() => {
    let received = 0;
    let sent = 0;
    for (const tx of filtered) {
      if (tx.type === 'RECEIVED') received += Math.abs(tx.amount);
      else sent += Math.abs(tx.amount);
    }
    return { received, sent };
  }, [filtered]);

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <View style={styles.header}>
        <Title>Historial</Title>
        <Text style={styles.count}>
          {history.length} {history.length === 1 ? 'movimiento' : 'movimientos'}
        </Text>
      </View>

      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'Todos' },
          { value: 'received', label: 'Recibidos' },
          { value: 'sent', label: 'Enviados' },
        ]}
      />

      {filtered.length > 0 ? (
        <Card tone="alt">
          <View style={styles.summary}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Recibido</Text>
              <Text style={[styles.summaryValue, { color: colors.success }]}>
                +{formatSats(totals.received)} sats
              </Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Enviado</Text>
              <Text style={styles.summaryValue}>
                −{formatSats(totals.sent)} sats
              </Text>
            </View>
          </View>
        </Card>
      ) : null}

      {filtered.length === 0 ? (
        <Card>
          <Text style={styles.muted}>
            {history.length === 0
              ? 'Todavía no hay movimientos en esta billetera. Cuando envíes o recibas sats aparecerán aquí.'
              : 'No hay movimientos con este filtro. Cambia a «Todos» para verlos.'}
          </Text>
        </Card>
      ) : (
        groups.map(group => (
          <View key={group.label} style={styles.group}>
            <SectionLabel>{group.label}</SectionLabel>
            <View style={styles.list}>
              {group.items.map((tx, index) => (
                <TransactionRow
                  key={`${transactionKey(tx)}-${index}`}
                  tx={tx}
                />
              ))}
            </View>
          </View>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  count: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  summary: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  summaryItem: {
    flex: 1,
    gap: 2,
  },
  summaryLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summaryValue: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  group: {
    gap: spacing.xs,
  },
  list: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  muted: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
  },
});
