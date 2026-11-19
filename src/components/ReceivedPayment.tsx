import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button } from './ui';
import { colors, radius, spacing } from '../constants/theme';
import { useAssetInfo } from '../hooks/useAssetInfo';
import { usePreferences } from '../hooks/usePreferences';
import { useWallet } from '../hooks/useWallet';
import { formatUnits } from '../lib/arkade/assets';
import { shortAssetId } from '../lib/arkade/assetInfo';
import { formatSats } from '../lib/format';

/**
 * Aviso de pago recibido. Se muestra sobre cualquier pantalla en cuanto el
 * saldo sube, con el mismo lenguaje visual que la pantalla de éxito del envío.
 *
 * Los activos no tienen dirección propia, así que un envío de activo también
 * suma unos sats de portador: cuando llegan los dos, se listan ambos.
 */
export function ReceivedPayment() {
  const { receivedPayment, dismissReceivedPayment, balance, network } =
    useWallet();
  const { formatBitcoin } = usePreferences();
  const assetIds = receivedPayment?.assets.map(line => line.assetId) ?? [];
  const infos = useAssetInfo(assetIds);

  if (!receivedPayment) return null;

  const { sats, assets } = receivedPayment;
  const hasAssets = assets.length > 0;
  const title = hasAssets ? 'Pago con activo recibido' : 'Pago recibido';

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={dismissReceivedPayment}
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="Cerrar el aviso de pago recibido"
          onPress={dismissReceivedPayment}
        />

        <View style={styles.card}>
          <View style={styles.icon}>
            <Text style={styles.mark}>✓</Text>
          </View>

          <Text style={styles.title}>{title}</Text>

          {!hasAssets && sats > 0 ? (
            <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit>
              {formatBitcoin(sats)}
            </Text>
          ) : null}

          {hasAssets ? (
            <View style={styles.assets}>
              {assets.map(line => {
                const info = infos[line.assetId];
                const ticker =
                  info?.ticker ?? shortAssetId(line.assetId);
                const decimals = info?.decimals ?? 0;
                return (
                  <View key={line.assetId} style={styles.assetRow}>
                    <Text style={styles.assetTicker}>{ticker}</Text>
                    <Text style={styles.assetAmount} numberOfLines={1}>
                      {formatUnits(line.amount, decimals)} {ticker}
                    </Text>
                  </View>
                );
              })}
              {sats > 0 ? (
                <Text style={styles.carrier}>
                  + {formatSats(sats)} sats de portador
                </Text>
              ) : null}
            </View>
          ) : null}

          <Text style={styles.text}>
            {hasAssets
              ? `El activo ya está en tu dirección Arkade de ${network.label}, junto a los sats de portador.`
              : 'Los sats ya están en tu saldo. No hace falta hacer nada más.'}
          </Text>

          {balance ? (
            <View style={styles.balanceRow}>
              <Text style={styles.balanceLabel}>Saldo disponible</Text>
              <Text style={styles.balanceValue}>
                {formatSats(balance.available)} sats
              </Text>
            </View>
          ) : null}

          <View style={styles.actions}>
            <Button
              title="Ver historial"
              variant="secondary"
              onPress={() => {
                dismissReceivedPayment();
                router.push('/(tabs)/history');
              }}
            />
            <Button title="Entendido" onPress={dismissReceivedPayment} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(11, 14, 17, 0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  icon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(60, 203, 127, 0.14)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.success,
  },
  mark: {
    color: colors.success,
    fontSize: 30,
    fontWeight: '800',
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  amount: {
    color: colors.text,
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  assets: {
    alignSelf: 'stretch',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 6,
    marginTop: spacing.xs,
  },
  assetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  assetTicker: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  assetAmount: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    flexShrink: 1,
  },
  carrier: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'right',
  },
  text: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  balanceRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    marginTop: spacing.xs,
  },
  balanceLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  balanceValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  actions: {
    alignSelf: 'stretch',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});
