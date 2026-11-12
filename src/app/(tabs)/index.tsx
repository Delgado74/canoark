import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import {
  Badge,
  Balance,
  Button,
  Card,
  CopyField,
  ErrorBanner,
  Notice,
  Paragraph,
  Row,
  Screen,
  Title,
} from '../../components/ui';
import { colors, spacing } from '../../constants/theme';
import { useWallet } from '../../hooks/useWallet';
import { formatBtc, formatSats, shorten } from '../../lib/format';

export default function WalletScreen() {
  const {
    balance,
    address,
    boardingAddress,
    network,
    refresh,
    refreshing,
    error,
    lock,
  } = useWallet();

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>Billetera Arkade</Text>
          <Title>CanoArk</Title>
        </View>
        <Badge label={network.label} tone="primary" />
      </View>

      {error ? <ErrorBanner message={error} /> : null}

      <Card>
        <Text style={styles.eyebrow}>Disponible</Text>
        {balance ? (
          <Balance
            sats={formatSats(balance.available)}
            caption={`≈ ${formatBtc(balance.available)} BTC`}
          />
        ) : (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.muted}>Sincronizando con el operador…</Text>
          </View>
        )}

        <View style={styles.actions}>
          <View style={styles.action}>
            <Button
              title="Enviar"
              onPress={() => router.push('/send')}
            />
          </View>
          <View style={styles.action}>
            <Button
              title="Recibir"
              variant="secondary"
              onPress={() => router.push('/receive')}
            />
          </View>
        </View>
      </Card>

      {balance ? (
        <Card title="Detalle del balance">
          <Row label="Liquidado" value={`${formatSats(balance.settled)} sats`} />
          <Row
            label="Preconfirmado"
            value={`${formatSats(balance.preconfirmed)} sats`}
          />
          <Row
            label="Boarding onchain"
            value={`${formatSats(balance.boarding)} sats`}
          />
          <Row
            label="Recuperable"
            value={`${formatSats(balance.recoverable)} sats`}
          />
          <Text style={styles.muted}>
            «Disponible» es lo que puedes gastar ahora. Los outputs virtuales
            se renuevan solos antes de expirar mientras la app está abierta.
          </Text>
        </Card>
      ) : null}

      <Card title="Recibir en Arkade">
        {address ? (
          <CopyField label="Dirección Arkade" value={address} />
        ) : (
          <Text style={styles.muted}>Generando dirección…</Text>
        )}
        {boardingAddress ? (
          <CopyField
            label="Boarding onchain"
            value={boardingAddress}
            displayValue={shorten(boardingAddress, 18, 14)}
          />
        ) : null}
        <Paragraph muted>
          Los pagos a tu dirección Arkade llegan al instante y sin comisión de
          red. La dirección de boarding sirve para depositar desde Bitcoin
          onchain.
        </Paragraph>
      </Card>

      <Notice tone="info">
        Red {network.label}. Operador: {network.operatorUrl}. Esta compilación
        usa {network.isMainnet ? 'dinero real' : 'bitcoin de prueba'}.
      </Notice>

      <Button title="Bloquear billetera" variant="secondary" onPress={lock} />
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
  eyebrow: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
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
  muted: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
});
