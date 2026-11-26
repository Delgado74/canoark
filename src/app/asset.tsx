import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import {
  BackButton,
  Badge,
  Button,
  Card,
  CopyField,
  Notice,
  Paragraph,
  Row,
  Screen,
  SectionLabel,
  Title,
} from '../components/ui';
import { colors, spacing } from '../constants/theme';
import { useAssetInfo } from '../hooks/useAssetInfo';
import { useWallet } from '../hooks/useWallet';
import { shortAssetId, bareAssetId } from '../lib/arkade/assetInfo';
import {
  formatUnits,
  isUsdAssetTicker,
  swapsAvailable,
} from '../lib/arkade/assets';

/**
 * Detalle de un activo Arkade: saldo y las tres acciones que tienen sentido
 * sobre él — enviarlo a otra dirección Arkade, recibirlo en la propia y
 * cambiarlo por BTC en un solver.
 *
 * Los activos no tienen dirección propia: viajan en una salida virtual que
 * lleva también los sats de portador, así que "recibir" es compartir la
 * dirección Arkade.
 */
export default function AssetScreen() {
  const params = useLocalSearchParams<{ assetId?: string }>();
  const rawId = typeof params.assetId === 'string' ? params.assetId : '';
  const assetId = rawId ? bareAssetId(rawId) : '';
  const infos = useAssetInfo(assetId ? [assetId] : []);
  const { balance, network } = useWallet();

  const asset = assetId
    ? balance?.assets.find(entry => bareAssetId(entry.assetId) === assetId)
    : undefined;
  const info = infos[assetId];
  const ticker = info?.ticker ?? (assetId ? shortAssetId(assetId) : '—');
  const decimals = info?.decimals ?? 0;
  const amount = asset ? formatUnits(asset.amount, decimals) : '0';
  const usd = info && isUsdAssetTicker(info.ticker) && asset
    ? Number(asset.amount) / 10 ** decimals
    : null;

  const canSwap = swapsAvailable() && Boolean(info && isUsdAssetTicker(info.ticker));

  if (!assetId) {
    return (
      <Screen>
        <BackButton />
        <Title>Activo</Title>
        <Notice tone="warning">
          No se indicó ningún activo. Abre uno desde el saldo de la billetera.
        </Notice>
      </Screen>
    );
  }

  return (
    <Screen>
      <BackButton />
      <View style={styles.header}>
        <Title>{ticker}</Title>
        <Badge label={network.label} tone="neutral" />
      </View>

      <Card>
        <View style={styles.hero}>
          <Text style={styles.heroAmount} numberOfLines={1}>
            {amount} {ticker}
          </Text>
          {info?.name ? <Text style={styles.heroName}>{info.name}</Text> : null}
          {usd !== null ? (
            <Text style={styles.heroUsd}>≈ {usd.toFixed(2)} USD</Text>
          ) : null}
        </View>
        <Row label="Decimales" value={String(decimals)} />
        <Row label="Red" value={network.swapNetwork} />
      </Card>

      <SectionLabel>Acciones</SectionLabel>
      <Button
        title="Enviar activo"
        onPress={() =>
          router.push({ pathname: '/send', params: { assetId } })
        }
      />
      <Button
        title="Recibir activo"
        variant="secondary"
        onPress={() =>
          router.push({
            pathname: '/receive',
            params: { tab: 'arkade', assetId },
          })
        }
      />
      {canSwap ? (
        <Button
          title={`Cambiar ${ticker} por BTC`}
          variant="secondary"
          onPress={() =>
            router.push({ pathname: '/swap', params: { direction: 'usd-to-btc' } })
          }
        />
      ) : null}

      <SectionLabel>Identificador</SectionLabel>
      <CopyField label="ID del activo" value={assetId} />

      <Notice tone="info">
        Los activos se envían y se reciben en una dirección Arkade. Para
        recibirlos, comparte tu dirección y este ID con quien te los envía.
      </Notice>
      <Paragraph muted>
        Cada activo viaja dentro de una salida virtual con unos sats de
        portador en BTC. Esos sats también son tuyos y se gastan junto al
        activo.
      </Paragraph>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  hero: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.md,
  },
  heroAmount: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '800',
  },
  heroName: {
    color: colors.textMuted,
    fontSize: 13,
  },
  heroUsd: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
});
