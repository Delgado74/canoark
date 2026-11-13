import { StyleSheet, Text, View } from 'react-native';
import { Card, Screen, Title } from '../../components/ui';
import { colors, spacing } from '../../constants/theme';
import { useWallet } from '../../hooks/useWallet';
import {
  TransactionRow,
  transactionKey,
} from '../../components/TransactionRow';

export default function HistoryScreen() {
  const { history, refresh, refreshing } = useWallet();

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <View style={styles.header}>
        <Title>Historial</Title>
        <Text style={styles.count}>
          {history.length} {history.length === 1 ? 'movimiento' : 'movimientos'}
        </Text>
      </View>

      {history.length === 0 ? (
        <Card>
          <Text style={styles.muted}>
            Todavía no hay movimientos en esta billetera. Cuando envíes o
            recibas sats aparecerán aquí.
          </Text>
        </Card>
      ) : (
        <View style={styles.list}>
          {history.map(tx => (
            <TransactionRow key={transactionKey(tx)} tx={tx} />
          ))}
        </View>
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
