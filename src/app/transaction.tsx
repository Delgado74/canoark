import { StyleSheet, Text, View } from 'react-native';
import { useMemo } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Linking } from 'react-native';
import {
  BackButton,
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
import { useAssetInfo } from '../hooks/useAssetInfo';
import { usePreferences } from '../hooks/usePreferences';
import { useWallet } from '../hooks/useWallet';
import { formatUnits } from '../lib/arkade/assets';
import { bareAssetId, shortAssetId } from '../lib/arkade/assetInfo';
import { formatSats } from '../lib/format';
import {
  arkadeExplorerTxUrl,
  onchainExplorerTxUrl,
} from '../lib/arkade/onchain';
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
  const { network } = useWallet();
  const params = useLocalSearchParams<{
    type?: string;
    amount?: string;
    settled?: string;
    createdAt?: string;
    tag?: string;
    arkTxid?: string;
    boardingTxid?: string;
    commitmentTxid?: string;
    assets?: string;
  }>();

  const type = asString(params.type);
  const incoming = type === 'RECEIVED';
  const amount = Number(asString(params.amount)) || 0;
  const settled = asString(params.settled) === '1';
  const createdAt = Number(asString(params.createdAt)) || 0;
  const tag = asString(params.tag);

  const rawAssets = asString(params.assets);
  const assets = useMemo(() => {
    if (!rawAssets) return [];
    try {
      const parsed: unknown = JSON.parse(rawAssets);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map(entry => {
          if (!entry || typeof entry !== 'object') return null;
          const { assetId, amount: rawAmount } = entry as {
            assetId?: unknown;
            amount?: unknown;
          };
          if (typeof assetId !== 'string' || typeof rawAmount !== 'string') {
            return null;
          }
          try {
            return { assetId, amount: BigInt(rawAmount) };
          } catch {
            return null;
          }
        })
        .filter(
          (entry): entry is { assetId: string; amount: bigint } =>
            entry !== null
        );
    } catch {
      return [];
    }
  }, [rawAssets]);

  const assetInfos = useAssetInfo(assets.map(asset => asset.assetId));

  const txids = [
    {
      label: 'Arkade TXID',
      value: asString(params.arkTxid),
      url: arkadeExplorerTxUrl(asString(params.arkTxid), network),
    },
    {
      label: 'Boarding TXID',
      value: asString(params.boardingTxid),
      url: onchainExplorerTxUrl(asString(params.boardingTxid), network),
    },
    {
      label: 'Commitment TXID',
      value: asString(params.commitmentTxid),
      url: onchainExplorerTxUrl(
        asString(params.commitmentTxid),
        network
      ),
    },
  ].filter(entry => entry.value);

  const status = transactionStatus({ settled, tag });

  return (
    <Screen>
      <BackButton />
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

      {assets.length > 0 ? (
        <Card title={incoming ? 'Activo recibido' : 'Activo enviado'}>
          {assets.map(asset => {
            const id = bareAssetId(asset.assetId);
            const info = assetInfos[id];
            const ticker = info?.ticker ?? shortAssetId(id);
            const value = `${incoming ? '+' : '−'}${formatUnits(
              asset.amount,
              info?.decimals ?? 0
            )} ${ticker}`;
            return (
              <Row
                key={`${id}:${asset.amount.toString()}`}
                label={info?.name ?? ticker}
                value={value}
              />
            );
          })}
          <Text style={styles.note}>
            Los {formatSats(Math.abs(amount))} sats de este movimiento son el
            portador BTC del activo, no un cargo aparte: viajan en el mismo VTXO
            y siguen en tu saldo disponible.
          </Text>
        </Card>
      ) : null}

      <Card title="Identificadores">
        {txids.length === 0 ? (
          <Notice tone="info">
            El SDK todavía no ha asignado un TXID a este movimiento. Actualiza
            el historial cuando la transacción avance.
          </Notice>
        ) : (
          txids.map(entry => (
            <View key={entry.label} style={styles.txid}>
              <CopyField label={entry.label} value={entry.value} />
              <Button
                title="Ver en explorador"
                variant="secondary"
                onPress={() => void Linking.openURL(entry.url)}
              />
            </View>
          ))
        )}
      </Card>

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
  note: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: spacing.sm,
  },
  txid: {
    gap: spacing.xs,
  },
});
