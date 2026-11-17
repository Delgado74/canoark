import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import {
  Badge,
  Card,
  ErrorBanner,
  Screen,
} from '../../components/ui';
import { colors, spacing } from '../../constants/theme';
import { useWallet } from '../../hooks/useWallet';
import { usePreferences } from '../../hooks/usePreferences';
import { formatSats } from '../../lib/format';
import {
  TransactionRow,
  transactionKey,
} from '../../components/TransactionRow';

function QuickAction({
  icon,
  label,
  onPress,
}: {
  icon: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}
    >
      <View style={styles.actionIcon}>
        <Text style={styles.actionIconText}>{icon}</Text>
      </View>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

export default function WalletScreen() {
  const {
    balance,
    history,
    network,
    refresh,
    refreshing,
    error,
    walletMode,
  } = useWallet();
  const { bitcoinParts, formatFiatValue, preferences } = usePreferences();

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>CanoArk</Text>
          <Text style={styles.brandSub}>
            {walletMode === 'hd' ? 'Direcciones rotativas' : 'Dirección estática'}
          </Text>
        </View>
        <Badge label={network.label} tone="primary" />
      </View>

      {error ? <ErrorBanner message={error} /> : null}

      <Card>
        <View style={styles.balanceHead}>
          <Text style={styles.eyebrow}>Saldo disponible</Text>
          {refreshing ? (
            <View style={styles.syncing}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.syncingText}>Sincronizando</Text>
            </View>
          ) : null}
        </View>
        {balance ? (
          <>
            <View style={styles.balanceRow}>
              <Text
                style={styles.balanceValue}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
              >
                {bitcoinParts(balance.available).value}
              </Text>
              {bitcoinParts(balance.available).unit ? (
                <Text style={styles.balanceUnit}>
                  {bitcoinParts(balance.available).unit}
                </Text>
              ) : null}
            </View>
            {preferences.currency !== 'BTC' ? (
              <Text style={styles.fiat}>
                ≈ {formatFiatValue(balance.available)}
              </Text>
            ) : null}

            <View style={styles.breakdown}>
              <View style={styles.breakdownItem}>
                <Text style={styles.breakdownLabel}>Liquidado</Text>
                <Text style={styles.breakdownValue}>
                  {formatSats(balance.settled)} sats
                </Text>
              </View>
              <View style={styles.breakdownItem}>
                <Text style={styles.breakdownLabel}>Preconfirmado</Text>
                <Text style={styles.breakdownValue}>
                  {formatSats(balance.preconfirmed)} sats
                </Text>
              </View>
              {balance.boarding > 0 ? (
                <View style={styles.breakdownItem}>
                  <Text style={styles.breakdownLabel}>Boarding</Text>
                  <Text style={styles.breakdownValue}>
                    {formatSats(balance.boarding)} sats
                  </Text>
                </View>
              ) : null}
            </View>

            {balance.boarding > 0 ? (
              <View style={styles.boarding}>
                <Text style={styles.boardingTitle}>
                  ⏳ Boarding pendiente: {bitcoinParts(balance.boarding).value}{' '}
                  {bitcoinParts(balance.boarding).unit}
                </Text>
                <Text style={styles.boardingText}>
                  {balance.boardingUnconfirmed > 0
                    ? `${formatSats(balance.boardingUnconfirmed)} sats sin confirmar.`
                    : `${formatSats(balance.boardingConfirmed)} sats confirmados, en cola de liquidación.`}{' '}
                  Al confirmarse se convierten en saldo Arkade automáticamente.
                </Text>
              </View>
            ) : null}
          </>
        ) : (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.muted}>Sincronizando…</Text>
          </View>
        )}
      </Card>

      <View style={styles.actions}>
        <QuickAction
          icon="↓"
          label="Recibir"
          onPress={() => router.push({ pathname: '/receive', params: { tab: 'arkade' } })}
        />
        <QuickAction
          icon="⇄"
          label="Swap"
          onPress={() => {
            if (network.name === 'mutinynet') {
              router.push('/swap');
              return;
            }
            Alert.alert(
              'Swap BTC / USD',
              'Estamos trabajando para llevarlo a mainnet. Pronto estará disponible; por ahora sólo funciona en Mutinynet.'
            );
          }}
        />
        <QuickAction
          icon="↑"
          label="Enviar"
          onPress={() => router.push('/send')}
        />
      </View>

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
            Aún no hay movimientos. Recibe tus primeros sats para empezar. Puedes
            depositar onchain desde Recibir → Onchain.
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
  brandSub: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    paddingTop: 2,
  },
  balanceHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  eyebrow: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  syncing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  syncingText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
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
  breakdown: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  breakdownItem: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 10,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    gap: 1,
  },
  breakdownLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  breakdownValue: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  boarding: {
    backgroundColor: 'rgba(244, 201, 93, 0.12)',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.warning,
    padding: spacing.sm,
    gap: 2,
  },
  boardingTitle: {
    color: colors.warning,
    fontSize: 13,
    fontWeight: '700',
  },
  boardingText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  action: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: spacing.md,
  },
  actionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
  },
  actionIconText: {
    color: colors.primary,
    fontSize: 18,
    fontWeight: '800',
  },
  actionLabel: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  muted: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  sectionLink: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  list: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  pressed: {
    opacity: 0.75,
  },
});
