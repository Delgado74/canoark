import { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { ExecutorEvent, ExitQuote } from '@arkade-os/sdk';
import {
  Button,
  Card,
  CopyField,
  ErrorBanner,
  Field,
  Notice,
  Paragraph,
  Row,
  SectionLabel,
} from '../../components/ui';
import { SettingsScreen } from '../../components/SettingsScreen';
import { colors, spacing } from '../../constants/theme';
import { useWallet } from '../../hooks/useWallet';
import { errorMessage, formatSats } from '../../lib/format';
import type { StoredExitPackage } from '../../lib/storage/appData';

function dateLabel(seconds: number | null): string {
  if (!seconds) return 'Sin vencimiento conocido';
  return new Date(seconds * 1000).toLocaleString();
}

function isExpired(seconds: number | null): boolean {
  return Boolean(seconds && Date.now() > seconds * 1000);
}

function eventLabel(event: ExecutorEvent): string {
  const tx = event.txid ? ` · ${event.txid.slice(0, 12)}…` : '';
  const reason = event.reason ? ` · ${event.reason}` : '';
  return `[${event.stepIndex + 1}] ${event.kind} · ${event.status}${tx}${reason}`;
}

export default function ExitScreen() {
  const {
    getExitWallet,
    estimateUnilateralExit,
    prepareUnilateralExit,
    listExitPackages,
    deleteExitPackage,
    executeExitPackage,
    refresh,
  } = useWallet();

  const [walletInfo, setWalletInfo] = useState<{
    address: string;
    balanceSats: number;
  } | null>(null);
  const [packages, setPackages] = useState<StoredExitPackage[]>([]);
  const [sweepAddress, setSweepAddress] = useState('');
  const [quote, setQuote] = useState<ExitQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const [quoting, setQuoting] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [info, stored] = await Promise.all([
        getExitWallet(),
        listExitPackages(),
      ]);
      setWalletInfo(info);
      setPackages(stored);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const estimate = async () => {
    setQuoting(true);
    setError(null);
    try {
      const next = await estimateUnilateralExit(sweepAddress.trim() || undefined);
      setQuote(next);
    } catch (err) {
      setQuote(null);
      setError(errorMessage(err));
    } finally {
      setQuoting(false);
    }
  };

  const prepare = async () => {
    if (quote) {
      Alert.alert(
        'Preparar plan de salida',
        `Se firmarán ${quote.totals.txCount} transacciones y se guardará el paquete en este dispositivo. No se difunde nada ni se gasta BTC todavía. ¿Continuar?`,
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Preparar', onPress: () => void doPrepare() },
        ]
      );
      return;
    }
    await doPrepare();
  };

  const doPrepare = async () => {
    setPreparing(true);
    setError(null);
    try {
      const saved = await prepareUnilateralExit(
        sweepAddress.trim() || undefined
      );
      setPackages(current => [saved, ...current]);
      Alert.alert(
        'Plan guardado',
        'El paquete quedó guardado. Compártelo o expórtalo si quieres poder ejecutarlo desde otro dispositivo.'
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPreparing(false);
    }
  };

  const run = async (stored: StoredExitPackage) => {
    setExecutingId(stored.id);
    setLog([]);
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await executeExitPackage(
        stored,
        event => setLog(current => [...current.slice(-59), eventLabel(event)]),
        controller.signal
      );
      setLog(current => [...current, 'Ejecución completada.']);
      await refresh();
      await load();
    } catch (err) {
      if (controller.signal.aborted) {
        setLog(current => [
          ...current,
          'Ejecución detenida. Puedes reanudarla más tarde; es idempotente.',
        ]);
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setExecutingId(null);
      abortRef.current = null;
    }
  };

  const execute = (stored: StoredExitPackage) => {
    if (isExpired(stored.validUntil)) {
      Alert.alert(
        'Plan vencido',
        'El batch de estos VTXOs ya venció. Genera un plan nuevo con el saldo actual.'
      );
      return;
    }
    Alert.alert(
      'Ejecutar salida unilateral',
      `Se difundirán las transacciones prefirmadas y se pagarán las comisiones desde el fondo de salida. Los fondos irán a:\n\n${stored.sweepAddress}`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Ejecutar',
          style: 'destructive',
          onPress: () => void run(stored),
        },
      ]
    );
  };

  const share = async (stored: StoredExitPackage) => {
    try {
      const file = new File(Paths.cache, `canoark-exit-${stored.id}.json`);
      file.create({ overwrite: true });
      await file.write(stored.envelope);
      if (!(await Sharing.isAvailableAsync())) {
        throw new Error('Compartir no está disponible en este dispositivo.');
      }
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/json',
        dialogTitle: 'Paquete de salida CanoArk',
      });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const remove = (stored: StoredExitPackage) => {
    Alert.alert('Borrar plan', 'Solo se borra de este dispositivo.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteExitPackage(stored.id);
              setPackages(current =>
                current.filter(item => item.id !== stored.id)
              );
            } catch (err) {
              setError(errorMessage(err));
            }
          })();
        },
      },
    ]);
  };

  return (
    <SettingsScreen
      title="Salida unilateral"
      onRefresh={() => void load()}
      refreshing={loading}
    >
      <Notice tone="warning">
        Es el último recurso si el operador deja de cofirmar. No sustituye al
        envío onchain normal: es más lento, más caro y no debe usarse como
        rutina.
      </Notice>

      {error ? <ErrorBanner message={error} /> : null}

      <SectionLabel>Fondo de salida</SectionLabel>
      <Card
        title={
          walletInfo
            ? `${formatSats(walletInfo.balanceSats)} sats onchain`
            : 'Cargando…'
        }
        subtitle="Las transacciones del unroll necesitan BTC onchain para pagar comisiones."
      >
        <CopyField
          label="Dirección para comisiones"
          value={walletInfo?.address ?? '—'}
        />
        <Paragraph muted>
          Es una P2TR derivada de tu semilla, distinta de la dirección de
          boarding y de la dirección Arkade. Envía aquí BTC si quieres que la
          salida pueda ejecutarse sin depender de nadie más.
        </Paragraph>
      </Card>

      <SectionLabel>Destino del rescate</SectionLabel>
      <Field
        label="Dirección onchain (opcional)"
        value={sweepAddress}
        onChangeText={setSweepAddress}
        placeholder={walletInfo?.address ?? 'bc1… / tb1…'}
        autoCapitalize="none"
        autoCorrect={false}
        hint="Si lo dejas vacío, los fondos vuelven al fondo de salida. Usa una dirección externa si quieres que el plan sirva aunque pierdas la semilla."
      />

      <Button
        title="Calcular coste de salida"
        onPress={() => void estimate()}
        loading={quoting}
        disabled={quoting || preparing || Boolean(executingId)}
      />

      {quote ? (
        <Card title="Coste real" subtitle={`Fee rate ${quote.feeRate} sat/vB`}>
          <Row label="Transacciones" value={String(quote.totals.txCount)} />
          <Row
            label="Comisión total"
            value={`${formatSats(quote.totals.totalFeeSats)} sats`}
          />
          <Row
            label="Necesitas onchain"
            value={`${formatSats(quote.totals.fundingRequiredSats)} sats`}
          />
          <Row
            label="Saldo del fondo"
            value={`${formatSats(quote.currentBalanceSats)} sats`}
          />
          <Row
            label="Falta depositar"
            value={
              quote.shortfallSats > 0
                ? `${formatSats(quote.shortfallSats)} sats`
                : 'Nada'
            }
          />
          <Row
            label="Recibirás"
            value={`${formatSats(quote.totals.recoveredSats)} sats`}
          />
          {quote.vtxos.some(vtxo => vtxo.skipped) ? (
            <Paragraph muted>
              Algunos VTXOs se omiten por no compensar su salida:{' '}
              {quote.vtxos
                .filter(vtxo => vtxo.skipped)
                .slice(0, 3)
                .map(vtxo => vtxo.skipped)
                .join(' · ')}
            </Paragraph>
          ) : null}
        </Card>
      ) : null}

      <Button
        title="Preparar y guardar plan"
        variant="secondary"
        onPress={() => void prepare()}
        loading={preparing}
        disabled={preparing || quoting || Boolean(executingId)}
      />

      <Notice tone="info">
        El plan se firma ahora pero no se difunde hasta que pulses Ejecutar. No
        gasta BTC al prepararlo. Queda obsoleto si mueves o renuevas los VTXOs
        incluidos.
      </Notice>

      <SectionLabel>Planes guardados</SectionLabel>
      {packages.length === 0 ? (
        <Paragraph muted>No hay planes guardados en este dispositivo.</Paragraph>
      ) : (
        <View style={styles.list}>
          {packages.map(stored => {
            const expired = isExpired(stored.validUntil);
            const running = executingId === stored.id;
            return (
              <View key={stored.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.amount}>
                    {formatSats(stored.recoveredSats)} sats
                  </Text>
                  <Text style={[styles.state, expired && styles.expired]}>
                    {expired ? 'Vencido' : 'Listo'}
                  </Text>
                </View>
                <Text style={styles.meta}>
                  {stored.txCount} txs · fee {formatSats(stored.totalFeeSats)}{' '}
                  sats · {new Date(stored.createdAt).toLocaleString()}
                </Text>
                <Text style={styles.meta}>
                  Vence: {dateLabel(stored.validUntil)}
                </Text>
                <Text style={styles.address} numberOfLines={2}>
                  → {stored.sweepAddress}
                </Text>
                <View style={styles.actions}>
                  <Button
                    title={running ? 'Ejecutando…' : 'Ejecutar'}
                    onPress={() => execute(stored)}
                    loading={running}
                    disabled={expired || Boolean(executingId)}
                  />
                  <Button
                    title="Compartir"
                    variant="secondary"
                    onPress={() => void share(stored)}
                    disabled={Boolean(executingId)}
                  />
                  <Button
                    title="Borrar"
                    variant="danger"
                    onPress={() => remove(stored)}
                    disabled={Boolean(executingId)}
                  />
                </View>
              </View>
            );
          })}
        </View>
      )}

      {executingId ? (
        <Card title="Progreso de la salida">
          {log.length === 0 ? (
            <Paragraph muted>Esperando el primer paso…</Paragraph>
          ) : (
            log.map((line, index) => (
              <Text key={`${index}-${line}`} style={styles.log}>
                {line}
              </Text>
            ))
          )}
          <Button
            title="Detener"
            variant="danger"
            onPress={() => abortRef.current?.abort()}
          />
          <Paragraph muted>
            Detener no revierte lo ya difundido. Puedes reanudar más tarde: el
            ejecutor comprueba el estado de la cadena antes de repetir un paso.
          </Paragraph>
        </Card>
      ) : null}

      <Notice tone="danger">
        El paquete no contiene tu semilla, pero cualquiera que lo tenga puede
        difundirlo. Los fondos solo pueden ir a la dirección de rescate elegida.
        Guárdalo en un lugar seguro y no lo compartas con desconocidos.
      </Notice>
    </SettingsScreen>
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
    gap: 6,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  amount: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  state: {
    color: colors.success,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  expired: {
    color: colors.danger,
  },
  meta: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  address: {
    color: colors.text,
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 16,
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  log: {
    color: colors.text,
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 16,
  },
});
