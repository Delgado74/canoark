import { StyleSheet, Text, View } from 'react-native';
import type { ArkTransaction } from '@arkade-os/sdk';
import { colors, spacing } from '../constants/theme';
import { formatSats } from '../lib/format';

export function transactionKey(tx: ArkTransaction): string {
  return (
    tx.key.arkTxid ??
    tx.key.boardingTxid ??
    tx.key.commitmentTxid ??
    String(tx.createdAt)
  );
}

function tagLabel(tag?: string): string {
  switch (tag) {
    case 'offchain':
      return 'Arkade';
    case 'boarding':
      return 'Onchain';
    case 'exit':
      return 'Salida';
    case 'batch':
      return 'Batch';
    case 'gated':
      return 'Contrato';
    default:
      return 'Movimiento';
  }
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${day}/${month} · ${hours}:${minutes}`;
}

export function TransactionRow({ tx }: { tx: ArkTransaction }) {
  const incoming = tx.type === 'RECEIVED';
  const sign = incoming ? '+' : '−';
  const color = incoming ? colors.success : colors.text;

  return (
    <View style={styles.row}>
      <View style={[styles.icon, incoming ? styles.iconIn : styles.iconOut]}>
        <Text style={styles.iconText}>{incoming ? '↓' : '↑'}</Text>
      </View>
      <View style={styles.middle}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>
            {incoming ? 'Recibido' : 'Enviado'} · {tagLabel(tx.tag)}
          </Text>
          {!tx.settled ? <Text style={styles.pending}>Pendiente</Text> : null}
        </View>
        <Text style={styles.date}>{formatDate(tx.createdAt)}</Text>
      </View>
      <Text style={[styles.amount, { color }]} numberOfLines={1}>
        {sign}
        {formatSats(Math.abs(tx.amount))}
        <Text style={styles.unit}> sats</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconIn: {
    backgroundColor: 'rgba(60, 203, 127, 0.14)',
  },
  iconOut: {
    backgroundColor: colors.surfaceAlt,
  },
  iconText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  middle: {
    flex: 1,
    gap: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  pending: {
    color: colors.warning,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  date: {
    color: colors.textMuted,
    fontSize: 12,
  },
  amount: {
    fontSize: 14,
    fontWeight: '800',
  },
  unit: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
});
