import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { ArkTransaction } from '@arkade-os/sdk';
import { colors, spacing } from '../constants/theme';
import { usePreferences } from '../hooks/usePreferences';
import { shorten } from '../lib/format';

export function transactionKey(tx: ArkTransaction): string {
  return (
    tx.key.arkTxid ??
    tx.key.boardingTxid ??
    tx.key.commitmentTxid ??
    String(tx.createdAt)
  );
}

/** El identificador más representativo de la transacción, de más a menos específico. */
export function transactionTxid(tx: ArkTransaction): string {
  if (tx.tag === 'boarding') {
    return tx.key.boardingTxid ?? tx.key.arkTxid ?? tx.key.commitmentTxid ?? '';
  }
  return (
    tx.key.arkTxid ??
    tx.key.boardingTxid ??
    tx.key.commitmentTxid ??
    ''
  );
}

export function tagLabel(tag?: string): string {
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

/** `settled` es definitivo; el resto sigue pendiente de un batch o confirmación. */
export function transactionStatus(tx: {
  settled: boolean;
  tag?: string;
}): {
  label: string;
  tone: 'success' | 'warning';
} {
  if (tx.settled) return { label: 'Liquidada', tone: 'success' };
  if (tx.tag === 'boarding') {
    return { label: 'Pendiente de confirmación', tone: 'warning' };
  }
  return { label: 'Preconfirmada', tone: 'warning' };
}

export function formatDate(timestamp: number): string {
  if (!timestamp) return 'Sin fecha';
  const date = new Date(timestamp);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${day}/${month} · ${hours}:${minutes}`;
}

export function formatFullDate(timestamp: number): string {
  if (!timestamp) return 'Sin fecha';
  const date = new Date(timestamp);
  return date.toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function TransactionRow({ tx }: { tx: ArkTransaction }) {
  const { formatBitcoin, bitcoinParts } = usePreferences();
  const incoming = tx.type === 'RECEIVED';
  const sign = incoming ? '+' : '−';
  const color = incoming ? colors.success : colors.text;
  const status = transactionStatus(tx);
  const txid = transactionTxid(tx);

  const openDetail = () => {
    router.push({
      pathname: '/transaction',
      params: {
        type: tx.type,
        amount: String(tx.amount),
        settled: tx.settled ? '1' : '0',
        createdAt: String(tx.createdAt),
        tag: tx.tag ?? '',
        arkTxid: tx.key.arkTxid ?? '',
        boardingTxid: tx.key.boardingTxid ?? '',
        commitmentTxid: tx.key.commitmentTxid ?? '',
      },
    });
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${incoming ? 'Recibido' : 'Enviado'} ${formatBitcoin(
        Math.abs(tx.amount)
      )}, ${status.label}`}
      onPress={openDetail}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={[styles.icon, incoming ? styles.iconIn : styles.iconOut]}>
        <Text style={styles.iconText}>{incoming ? '↓' : '↑'}</Text>
      </View>
      <View style={styles.middle}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {incoming ? 'Recibido' : 'Enviado'} · {tagLabel(tx.tag)}
          </Text>
        </View>
        <Text style={styles.date} numberOfLines={1}>
          {formatDate(tx.createdAt)}
          {txid ? ` · ${shorten(txid, 8, 6)}` : ''}
        </Text>
        <Text
          style={[
            styles.status,
            { color: status.tone === 'success' ? colors.success : colors.warning },
          ]}
          numberOfLines={1}
        >
          {status.label}
        </Text>
      </View>
      <View style={styles.right}>
        <Text style={[styles.amount, { color }]} numberOfLines={1}>
          {sign}
          {bitcoinParts(Math.abs(tx.amount)).value}
        </Text>
        {bitcoinParts(Math.abs(tx.amount)).unit ? (
          <Text style={styles.unit}>
            {bitcoinParts(Math.abs(tx.amount)).unit}
          </Text>
        ) : null}
      </View>
    </Pressable>
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
  pressed: {
    opacity: 0.75,
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
    flexShrink: 1,
  },
  date: {
    color: colors.textMuted,
    fontSize: 12,
    fontFamily: 'monospace',
  },
  status: {
    fontSize: 11,
    fontWeight: '700',
  },
  right: {
    alignItems: 'flex-end',
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
