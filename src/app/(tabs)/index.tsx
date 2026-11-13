import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  Screen,
} from '../../components/ui';
import { colors, spacing } from '../../constants/theme';
import { useWallet } from '../../hooks/useWallet';
import { formatBtc, formatSats } from '../../lib/format';
import {
  TransactionRow,
  transactionKey,
} from '../../components/TransactionRow';

export default function WalletScreen() {
  const {
    balance,
    history,
    network,
    refresh,
    refreshing,
    error,
  } = useWallet();

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <View style={styles.header}>
        <Text style={styles.brand}>CanoArk</Text>
        <Badge label={network.label} tone="primary" />
      </View>

      {error ? <ErrorBanner message={error} /> : null}

      <Card>
        <Text style={styles.eyebrow}>Saldo disponible</Text>
        {balance ? (
          <>
            <View style={styles.balanceRow}>
              <Text
                style={styles.balanceValue}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
              >
                {formatSats(balance.available)}
              </Text>
              <Text style={styles.balanceUnit}>sats</Text>
            </View>
            <Text style={styles.fiat}>≈ {formatBtc(balance.available)} BTC</Text>
          </>
        ) : (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.muted}>Sincronizando…</Text>
          </View>
        )}

        <View style={styles.actions}>
          <View style={styles.action}>
            <Button
              title="Recibir"
              onPress={() => router.push('/receive')}
            />
          </View>
          <View style={styles.action}>
            <Button
              title="Enviar"
              variant="secondary"
              onPress={() => router.push('/send')}
            />
          </View>
        </View>
      </Card>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Últimos movimientos</Text>
        <Text
          style={styles.sectionLink}
          onPress={() => router.push('/(tabs)/history')}
        >
          Ver todo
        </Text>
      </View>

      {history.length === 0 ? (
        <Card>
          <Text style={styles.muted}>
            Aún no hay movimientos. Recibe tus primeros sats para empezar.
          </Text>
        </Card>
      ) : (
        <View style={styles.list}>
          {history.slice(0, 4).map((tx, index) => (
            <TransactionRow key={`${transactionKey(tx)}-${index}`} tx={tx} />
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
  brand: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  eyebrow: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  balanceValue: {
    color: colors.text,
    fontSize: 44,
    fontWeight: '800',
    letterSpacing: -1,
    flexShrink: 1,
  },
  balanceUnit: {
    color: colors.textMuted,
    fontSize: 16,
    fontWeight: '700',
    paddingBottom: 9,
  },
  fiat: {
    color: colors.textMuted,
    fontSize: 14,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  action: {
    flex: 1,
  },
  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  sectionLink: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '700',
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
