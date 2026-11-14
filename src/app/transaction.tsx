import { StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  Badge,
  Button,
  Card,
  CopyField,
  Notice,
  Row,
  Screen,
  Title,
} from '../components/ui';
import { colors, spacing } from '../constants/theme';
import { usePreferences } from '../hooks/usePreferences';
import {
  formatFullDate,
  tagLabel,
  transactionStatus,
} from '../components/TransactionRow';

type ParamValue = string | string[] | undefined;

const asString = (value: ParamValue): string => {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
};

export default function TransactionDetailScreen() {
  const { bitcoinParts } = usePreferences();
  const params = useLocalSearchParams<{
    type?: string;
    amount?: string;
    settled?: string;
    createdAt?: string;
    tag?: string;
    arkTxid?: string;
    boardingTxid?: string;
    commitmentTxid?: string;
  }>();

  const type = asString(params.type);
  const incoming = type === 'RECEIVED';
  const amount = Number(asString(params.amount)) || 0;
  const settled = asString(params.settled) === '1';
  const createdAt = Number(asString(params.createdAt)) || 0;
  const tag = asString(params.tag);
  const txids = [
    { label: 'Arkade TXID', value: asString(params.arkTxid) },
    { label: 'Boarding TXID', value: asString(params.boardingTxid) },
    { label: 'Commitment TXID', value: asString(params.commitmentTxid) },
  ].filter(entry => entry.value);

  const status = transactionStatus({ settled, tag });

  return (
    <Screen>
      <View style={styles.header}>
        <Title>Transacción</Title>
        <Badge label={status.label} tone={status.tone} />
      </View>

      <Card>
        <View style={styles.amountBlock}>
          <View style={[styles.icon, incoming ? styles.iconIn : styles.iconOut]}>
            <Text style={styles.iconText}>{incoming ? '↓' : '↑'}</Text>
          </View>
          <Text style={styles.kind}>{incoming ? 'Recibido' : 'Enviado'}</Text>
          <Text style={[styles.amount, { color: incoming ? colors.success : colors.text }]}>
            {incoming ? '+' : '−'}
            {bitcoinParts(Math.abs(amount)).value}
            {bitcoinParts(Math.abs(amount)).unit ? (
              <Text style={styles.unit}>
                {' '}
                {bitcoinParts(Math.abs(amount)).unit}
              </Text>
            ) : null}
          </Text>
        </View>

        <Row label="Estado" value={status.label} />
        <Row label="Tipo" value={tagLabel(tag)} />
        <Row label="Fecha" value={formatFullDate(createdAt)} />
        <Row label="Sentido" value={incoming ? 'Entrante' : 'Saliente'} />
      </Card>

      <Card title="Identificadores">
        {txids.length === 0 ? (
          <Notice tone="info">
            El SDK todavía no ha asignado un TXID a este movimiento. Actualiza
            el historial cuando la transacción avance.
          </Notice>
        ) : (
          txids.map(entry => (
            <CopyField
              key={entry.label}
              label={entry.label}
              value={entry.value}
            />
          ))
        )}
      </Card>

      <Button
        title="Volver al historial"
        variant="ghost"
        onPress={() => router.back()}
      />
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
  amountBlock: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 22,
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
    fontSize: 20,
    fontWeight: '800',
  },
  kind: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  amount: {
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  unit: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
});
