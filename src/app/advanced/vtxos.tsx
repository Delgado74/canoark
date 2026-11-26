import { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  Notice,
  Paragraph,
  Row,
  SectionLabel,
} from '../../components/ui';
import { SettingsScreen } from '../../components/SettingsScreen';
import { colors, spacing } from '../../constants/theme';
import { useWallet } from '../../hooks/useWallet';
import { usePreferences } from '../../hooks/usePreferences';
import type { CoinView } from '../../types/wallet';
import type { ConsolidationPlan } from '../../lib/arkade/offboard';
import { errorMessage, formatSats } from '../../lib/format';

const STATUS_LABEL: Record<CoinView['status'], string> = {
  settled: 'Liquidado',
  preconfirmed: 'Preconfirmado',
  unconfirmed: 'Sin confirmar',
  recoverable: 'Recuperable',
  spent: 'Gastado',
  swept: 'Barrido',
};

const statusTone = (status: CoinView['status']) => {
  if (status === 'settled') return 'success' as const;
  if (status === 'spent' || status === 'swept') return 'neutral' as const;
  if (status === 'unconfirmed') return 'warning' as const;
  return 'primary' as const;
};

function expiryLabel(expiresAt: number | null): string {
  if (!expiresAt) return 'Sin vencimiento';
  const delta = expiresAt - Date.now();
  if (delta <= 0) return 'Expirado';
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `Vence en ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `Vence en ${hours} h`;
  const days = Math.floor(hours / 24);
  return `Vence en ${days} días`;
}

export default function VtxosScreen() {
  const {
    coins,
    coinsLoaded,
    loadCoins,
    settleBoarding,
    quoteVtxoConsolidation,
    consolidateVtxos,
    recoverVtxos,
    status,
    balance,
    boardingAddress,
    network,
  } = useWallet();
  const { formatBitcoin } = usePreferences();
  const [busy, setBusy] = useState(false);
  const [settling, setSettling] = useState(false);
  const [quotingConsolidation, setQuotingConsolidation] = useState(false);
  const [consolidating, setConsolidating] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [consolidation, setConsolidation] =
    useState<ConsolidationPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== 'unlocked' || coinsLoaded) return;
    let cancelled = false;
    void (async () => {
      try {
        await loadCoins();
      } catch (err) {
        if (!cancelled) setError(errorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, coinsLoaded, loadCoins]);

  const refresh = async () => {
    setBusy(true);
    setError(null);
    try {
      await loadCoins();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const { virtual, boarding } = useMemo(() => {
    const active = coins.filter(
      coin => coin.status !== 'spent' && coin.status !== 'swept'
    );
    return {
      virtual: active.filter(coin => coin.kind === 'vtxo'),
      boarding: active.filter(coin => coin.kind === 'boarding'),
    };
  }, [coins]);

  const totalVirtual = virtual.reduce((sum, coin) => sum + coin.value, 0);
  const totalBoarding = boarding.reduce((sum, coin) => sum + coin.value, 0);
  const confirmedBoarding = boarding.filter(
    coin => coin.status === 'settled'
  );

  const settle = async () => {
    setSettling(true);
    setError(null);
    try {
      const sats = await settleBoarding();
      Alert.alert(
        'Boarding liquidado',
        `${formatBitcoin(sats)} ya forma parte de tu saldo Arkade.`
      );
      await loadCoins();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSettling(false);
    }
  };

  const quoteConsolidation = async () => {
    setQuotingConsolidation(true);
    setError(null);
    try {
      setConsolidation(await quoteVtxoConsolidation());
    } catch (err) {
      setConsolidation(null);
      setError(errorMessage(err));
    } finally {
      setQuotingConsolidation(false);
    }
  };

  const consolidate = async () => {
    if (!consolidation) return;
    setConsolidating(true);
    setError(null);
    try {
      const result = await consolidateVtxos();
      setConsolidation(null);
      await loadCoins();
      Alert.alert(
        'Salidas virtuales consolidadas',
        `${result.inputCount} salidas virtuales se unieron en una de ${formatBitcoin(
          result.outputSats
        )}. La comisión fue de ${formatSats(result.feeSats)} sats.`
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setConsolidating(false);
    }
  };

  const recover = async () => {
    setRecovering(true);
    setError(null);
    try {
      const result = await recoverVtxos();
      await loadCoins();
      Alert.alert(
        'Saldo recuperado',
        `Se liquidaron ${result.vtxoCount} salidas virtuales recuperables${
          result.subdustSats > 0n
            ? `, incluidos ${formatSats(Number(result.subdustSats))} sats de polvo`
            : ''
        }.`
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRecovering(false);
    }
  };

  return (
    <SettingsScreen
      title="Salidas virtuales"
      onRefresh={() => void refresh()}
      refreshing={busy}
    >
      <Notice tone="info">
        Una salida virtual es una salida de Bitcoin que puedes gastar al
        instante dentro de Arkade. Se liquida en Bitcoin mediante un intercambio
        por lotes que cofirma el operador.
      </Notice>
      <SectionLabel>Resumen</SectionLabel>
      <Row
        label="Saldo Arkade"
        value={balance ? formatBitcoin(balance.available) : '—'}
      />
      <Row label="Salidas virtuales activas" value={`${virtual.length}`} />
      <Row
        label="Total salidas virtuales"
        value={formatBitcoin(totalVirtual)}
      />
      <Row
        label="Outputs onchain de boarding"
        value={formatBitcoin(totalBoarding)}
      />
      <Row
        label="Recuperable / polvo"
        value={balance ? formatBitcoin(balance.recoverable) : '—'}
      />
      <Row label="Dirección onchain" value={boardingAddress ?? '—'} mono />
      <Row label="Esplora" value={network.esploraUrl} mono />

      {error ? <ErrorBanner message={error} /> : null}

      <SectionLabel>Optimizar</SectionLabel>
      {consolidation ? (
        <Card title="Consolidar salidas virtuales">
          <Row
            label="Salidas virtuales"
            value={String(consolidation.inputCount)}
          />
          <Row
            label="Quedaría"
            value={`${formatSats(consolidation.outputSats)} sats`}
          />
          <Row
            label="Comisión"
            value={`${formatSats(consolidation.feeSats)} sats`}
          />
          <Paragraph muted>
            Reinicia la profundidad de la cadena, pero no abarata un envío
            onchain inmediato: añade un intercambio por lotes.
          </Paragraph>
          <Button
            title="Consolidar ahora"
            onPress={() => void consolidate()}
            loading={consolidating}
          />
          <Button
            title="Cancelar"
            variant="ghost"
            onPress={() => setConsolidation(null)}
            disabled={consolidating}
          />
        </Card>
      ) : (
        <Button
          title="Calcular consolidación"
          variant="secondary"
          onPress={() => void quoteConsolidation()}
          loading={quotingConsolidation}
          disabled={quotingConsolidation || busy}
        />
      )}
      <Button
        title="Recuperar salidas virtuales vencidas o polvo"
        variant="secondary"
        onPress={() => void recover()}
        loading={recovering}
        disabled={recovering}
      />
      <Notice tone="info">
        Consolidar reduce el número de inputs y acorta la rama de salida
        unilateral, pero cuesta un intercambio por lotes. Hazlo mientras el
        operador esté disponible; si ya cayó, solo queda el plan de salida.
      </Notice>

      <SectionLabel>Salidas virtuales</SectionLabel>
      {virtual.length === 0 ? (
        <Paragraph muted>No hay salidas virtuales activas.</Paragraph>
      ) : (
        <View style={styles.list}>
          {virtual.map(coin => (
            <CoinCard key={coin.id} coin={coin} amount={formatBitcoin(coin.value)} />
          ))}
        </View>
      )}

      <SectionLabel>Boarding (onchain)</SectionLabel>
      {boarding.length === 0 ? (
        <Paragraph muted>No hay depósitos onchain pendientes.</Paragraph>
      ) : (
        <View style={styles.list}>
          {boarding.map(coin => (
            <CoinCard key={coin.id} coin={coin} amount={formatBitcoin(coin.value)} />
          ))}
        </View>
      )}

      <Button
        title="Actualizar salidas virtuales"
        onPress={refresh}
        loading={busy}
      />
      <Button
        title="Convertir boarding a saldo Arkade"
        variant="secondary"
        onPress={settle}
        loading={settling}
        disabled={confirmedBoarding.length === 0 || busy}
      />
      <Notice tone="info">
        El SDK barre los depósitos onchain confirmados automáticamente cada
        minuto. Este botón fuerza la liquidación sin esperar al siguiente ciclo.
      </Notice>
      <Notice tone="info">
        Las salidas virtuales se renuevan automáticamente antes de vencer. Si el
        vencimiento ya pasó, el SDK las recupera en el siguiente ciclo.
      </Notice>
      <Notice tone="info">
        «Preconfirmado» significa que el operador ya aceptó la salida virtual,
        pero todavía no tiene finalidad en Bitcoin. «Liquidado» significa que ya
        está incluida en la transacción de compromiso.
      </Notice>
    </SettingsScreen>
  );
}

function CoinCard({ coin, amount }: { coin: CoinView; amount: string }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.amount}>{amount}</Text>
        <Badge
          label={STATUS_LABEL[coin.status]}
          tone={statusTone(coin.status)}
        />
      </View>
      <Text style={styles.meta}>
        {coin.kind === 'vtxo' ? 'Salida virtual' : 'Output onchain'} ·{' '}
        {expiryLabel(coin.expiresAt)}
      </Text>
      <Text style={styles.txid} numberOfLines={1}>
        {coin.txid}:{coin.vout}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 4,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  amount: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  meta: {
    color: colors.textMuted,
    fontSize: 13,
  },
  txid: {
    color: colors.textMuted,
    fontSize: 11,
    fontFamily: 'monospace',
  },
});
