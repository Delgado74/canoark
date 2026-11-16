import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import {
  Badge,
  Button,
  Card,
  CopyField,
  ErrorBanner,
  Field,
  Notice,
  Paragraph,
  Row,
  Screen,
  Title,
} from '../components/ui';
import { colors, spacing } from '../constants/theme';
import { useWallet } from '../hooks/useWallet';
import { usePreferences } from '../hooks/usePreferences';
import { arkadeAddressHrp, swapErrorMessage } from '../lib/arkade/lightning';
import {
  destinationKindLabel,
  parseDestination,
  type ParsedDestinationKind,
} from '../lib/bip21';
import { errorMessage, formatSats, satsFromInput, shorten } from '../lib/format';

type Stage = 'form' | 'confirm' | 'success';

type SendResult =
  | { kind: 'arkade'; txid: string }
  | { kind: 'swap'; id: string; outcome: string; amountSats: number };

function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case 'accepted':
      return 'Swap aceptado. Preparando el lockup…';
    case 'funding':
      return 'Fondeando el lockup…';
    case 'funded':
    case 'open':
      return 'Esperando que el solver complete el pago…';
    case 'paid':
      return 'Pago completado. El solver pagó el destino.';
    case 'claimed':
      return 'Pago completado y reclamado.';
    case 'refunded':
      return 'El solver no completó el pago. Tus sats fueron reembolsados.';
    case 'lapsed':
      return 'La ventana del swap expiró.';
    case 'needs_recovery':
      return 'El swap necesita recuperación manual desde Configuración → Avanzado → Solvers.';
    case 'failed':
      return 'El swap falló.';
    default:
      return `Estado: ${outcome}`;
  }
}

const isTerminal = (outcome: string) =>
  ['paid', 'claimed', 'refunded', 'lapsed', 'failed', 'needs_recovery'].includes(
    outcome
  );

const isSuccess = (outcome: string) => outcome === 'paid' || outcome === 'claimed';

export default function SendScreen() {
  const { sendPayment, watchOutcome, balance, refresh, network } = useWallet();
  const { formatBitcoin } = usePreferences();

  const [stage, setStage] = useState<Stage>('form');
  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('');
  const [maxFee, setMaxFee] = useState('500');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);
  const unsubscribeRef = useRef<null | (() => void)>(null);

  useEffect(
    () => () => {
      unsubscribeRef.current?.();
    },
    []
  );

  const parsed = parseDestination(destination);
  const kind: ParsedDestinationKind = parsed.kind;
  const amountSats =
    parsed.amountSats && parsed.amountSats > 0
      ? parsed.amountSats
      : satsFromInput(amount);
  const feeSats = satsFromInput(maxFee);
  const needsAmount = kind === 'onchain' || kind === 'arkade';
  const isArkade = kind === 'arkade';

  const fillFromParsed = (value: string) => {
    setDestination(value);
    setResult(null);
    setLocalError(null);
    const next = parseDestination(value);
    if (next.amountSats && next.amountSats > 0) {
      setAmount(String(next.amountSats));
    }
  };

  const paste = async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text) fillFromParsed(text.trim());
    } catch (error) {
      setLocalError(errorMessage(error));
    }
  };

  const validate = (): string | null => {
    if (kind === 'unknown') {
      if (parsed.lnurl) {
        return 'Las Lightning Address (usuario@dominio) todavía no se pueden pagar directamente desde CanoArk. Pide una factura BOLT11 o usa una dirección Arkade.';
      }
      const hrp = arkadeAddressHrp(parsed.raw || destination);
      if (hrp) {
        return `Esa dirección Arkade es de ${
          hrp === 'ark' ? 'Bitcoin mainnet' : 'otra red de pruebas'
        }. CanoArk está conectado a ${network.label}: usa una dirección ${network.addressPrefix}….`;
      }
      return 'Destino no reconocido. Usa una factura Lightning (lnbc…), una dirección onchain (bc1… / tb1…) o una dirección Arkade (ark1… / tark1…). También puedes pegar un BIP21.';
    }
    if (needsAmount && amountSats <= 0) {
      return 'Indica cuántos sats quieres enviar.';
    }
    if (!isArkade && feeSats <= 0) {
      return 'Indica una comisión máxima en sats.';
    }
    if (balance && needsAmount && amountSats > balance.available) {
      return `Saldo insuficiente: tienes ${formatSats(
        balance.available
      )} sats disponibles.`;
    }
    return null;
  };

  const review = () => {
    const problem = validate();
    if (problem) {
      setLocalError(problem);
      return;
    }
    setLocalError(null);
    setStage('confirm');
  };

  const send = async () => {
    setLocalError(null);
    setBusy(true);
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;

    try {
      const outcome = await sendPayment(
        parsed.raw || destination.trim(),
        amountSats,
        feeSats
      );
      if (outcome.kind === 'payment') {
        setResult({ kind: 'arkade', txid: outcome.txid });
        setStage('success');
      } else if (outcome.kind === 'arkade') {
        setResult({ kind: 'arkade', txid: outcome.txid });
        setStage('success');
      } else {
        const swapId = outcome.swap.id;
        setResult({
          kind: 'swap',
          id: swapId,
          outcome: outcome.swap.outcome,
          amountSats,
        });
        setStage('success');
        unsubscribeRef.current = watchOutcome(swapId, next => {
          setResult(previous =>
            previous && previous.kind === 'swap'
              ? { ...previous, outcome: next }
              : previous
          );
          if (isTerminal(next)) {
            unsubscribeRef.current?.();
            unsubscribeRef.current = null;
            if (isSuccess(next)) void refresh();
          }
        });
      }
    } catch (error) {
      setLocalError(swapErrorMessage(error));
      setStage('form');
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setStage('form');
    setDestination('');
    setAmount('');
    setMaxFee('500');
    setResult(null);
    setLocalError(null);
  };

  /* ---------------------------------------------------------------- */
  /* Éxito                                                             */
  /* ---------------------------------------------------------------- */

  if (stage === 'success' && result) {
    const pending = result.kind === 'swap' && !isTerminal(result.outcome);
    const failed =
      result.kind === 'swap' &&
      ['refunded', 'lapsed', 'failed', 'needs_recovery'].includes(
        result.outcome
      );

    return (
      <Screen>
        <View style={styles.success}>
          <View
            style={[
              styles.successIcon,
              failed && styles.successIconFailed,
              pending && styles.successIconPending,
            ]}
          >
            <Text
              style={[
                styles.successMark,
                failed && styles.successMarkFailed,
                pending && styles.successMarkPending,
              ]}
            >
              {failed ? '!' : pending ? '…' : '✓'}
            </Text>
          </View>
          <Title>
            {result.kind === 'swap'
              ? failed
                ? 'El envío no se completó'
                : isSuccess(result.outcome)
                  ? 'Pago enviado'
                  : 'Pago en curso'
              : 'Pago Arkade enviado'}
          </Title>
          <Text style={styles.successAmount}>
            {result.kind === 'swap'
              ? result.amountSats
                ? formatBitcoin(result.amountSats)
                : 'Según factura'
              : formatBitcoin(amountSats)}
          </Text>
          <Text style={styles.successText}>
            {result.kind === 'swap'
              ? outcomeLabel(result.outcome)
              : 'La transacción se envió al operador. El saldo se actualizará en unos segundos.'}
          </Text>
        </View>

        {result.kind === 'swap' ? (
          <CopyField label="ID del swap" value={result.id} />
        ) : (
          <CopyField label="TXID" value={result.txid} />
        )}

        {pending ? (
          <Notice tone="warning">
            Mantén la app abierta hasta que el swap llegue a un estado final. El
            cliente de swaps reclama o reembolsa solo.
          </Notice>
        ) : null}

        {failed ? (
          <Notice tone="danger">
            Si el lockup se reembolsó, el saldo volverá a estar disponible. Si
            figura como recuperación pendiente, revísalo en Configuración →
            Avanzado → Solvers.
          </Notice>
        ) : null}

        <Button title="Hacer otro envío" variant="secondary" onPress={reset} />
        <Button
          title="Ver historial"
          variant="ghost"
          onPress={() => router.replace('/(tabs)/history')}
        />
        <Button
          title="Volver al inicio"
          variant="ghost"
          onPress={() => router.replace('/(tabs)')}
        />
      </Screen>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Confirmación                                                      */
  /* ---------------------------------------------------------------- */

  if (stage === 'confirm') {
    return (
      <Screen>
        <Pressable
          onPress={() => {
            setStage('form');
            setLocalError(null);
          }}
          style={styles.back}
        >
          <Text style={styles.backText}>‹ Editar</Text>
        </Pressable>

        <Title>Confirmar envío</Title>

        {localError ? <ErrorBanner message={localError} /> : null}

        <Card
          title={destinationKindLabel(kind)}
          subtitle="Revisa estos datos antes de firmar."
        >
          <Row label="Destino" value={shorten(parsed.raw || destination, 14, 10)} mono />
          <Row
            label="Importe"
            value={
              kind === 'lightning'
                ? parsed.amountSats
                  ? `${formatSats(parsed.amountSats)} sats (BIP21)`
                  : 'Según factura'
                : `${formatSats(amountSats)} sats`
            }
          />
          <Row
            label="Comisión máxima"
            value={
              isArkade
                ? 'La cobra el operador'
                : `${formatSats(feeSats)} sats`
            }
          />
          <Row label="Red" value={network.label} />
          <Row
            label="Saldo disponible"
            value={balance ? `${formatSats(balance.available)} sats` : '—'}
          />
        </Card>

        {kind === 'lightning' ? (
          <Notice tone="info">
            Una factura Lightning se paga mediante un swap. El solver recibe el
            importe de la factura y paga al destino.
          </Notice>
        ) : null}
        {kind === 'onchain' ? (
          <Notice tone="warning">
            Un envío onchain tarda en confirmar. La ventana del swap debe seguir
            abierta hasta que el solver complete el pago.
          </Notice>
        ) : null}
        {kind === 'arkade' ? (
          <Notice tone="info">
            Es una transferencia dentro de Arkade: instantánea y sin solver.
          </Notice>
        ) : null}

        <Button
          title="Confirmar y enviar"
          onPress={send}
          loading={busy}
          disabled={busy}
        />
        <Button
          title="Cancelar"
          variant="ghost"
          onPress={() => {
            setStage('form');
            setLocalError(null);
          }}
          disabled={busy}
        />
      </Screen>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Formulario                                                        */
  /* ---------------------------------------------------------------- */

  return (
    <Screen>
      <Pressable onPress={() => router.back()} style={styles.back}>
        <Text style={styles.backText}>‹ Volver</Text>
      </Pressable>
      <View style={styles.header}>
        <Title>Enviar</Title>
        <Badge
          label={balance ? formatBitcoin(balance.available) : 'sin datos'}
          tone="neutral"
        />
      </View>

      {localError ? <ErrorBanner message={localError} /> : null}

      <Card>
        <Field
          label="Destino"
          value={destination}
          onChangeText={fillFromParsed}
          placeholder="lnbc… / bc1… / tb1… / tark1… / bitcoin:…"
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          numberOfLines={3}
        />
        <View style={styles.metaRow}>
          {destination.trim() ? (
            <Badge
              label={
                parsed.lnurl && kind === 'unknown'
                  ? 'Lightning Address'
                  : destinationKindLabel(kind)
              }
              tone={kind === 'unknown' ? 'danger' : 'success'}
            />
          ) : (
            <Text style={styles.metaMuted}>Pega o escribe un destino</Text>
          )}
          <Pressable onPress={paste} style={styles.linkRow}>
            <Text style={styles.link}>Pegar</Text>
          </Pressable>
        </View>

        <Field
          label="Importe (sats)"
          value={amount}
          onChangeText={setAmount}
          placeholder="0"
          keyboardType="number-pad"
          editable={kind !== 'lightning'}
          hint={
            kind === 'lightning'
              ? parsed.amountSats
                ? `La factura/BIP21 ya incluye ${formatSats(
                    parsed.amountSats
                  )} sats.`
                : 'La factura ya incluye el importe; este campo se ignora.'
              : parsed.amountSats
                ? `Importe detectado en el BIP21: ${formatSats(
                    parsed.amountSats
                  )} sats.`
                : 'Obligatorio para direcciones onchain y Arkade.'
          }
        />

        {!isArkade ? (
          <Field
            label="Comisión máxima del solver (sats)"
            value={maxFee}
            onChangeText={setMaxFee}
            placeholder="500"
            keyboardType="number-pad"
            hint="Se rechaza el pago antes de mover fondos si el solver pide más."
          />
        ) : null}

        <Button title="Revisar envío" onPress={review} />
      </Card>

      <Paragraph muted>
        Dirección Arkade: {network.addressPrefix}… · onchain:{' '}
        {network.isMainnet ? 'bc1…' : 'tb1…'} · Lightning: lnbc…
      </Paragraph>
      <Notice tone="warning">
        Verifica la red antes de enviar. Una dirección de otra red será
        rechazada o no aparecerá en el explorador.
      </Notice>
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  backText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  metaMuted: {
    color: colors.textMuted,
    fontSize: 12,
  },
  linkRow: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  link: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  success: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  successIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(60, 203, 127, 0.14)',
    borderWidth: 1,
    borderColor: colors.success,
  },
  successIconPending: {
    backgroundColor: 'rgba(244, 201, 93, 0.12)',
    borderColor: colors.warning,
  },
  successIconFailed: {
    backgroundColor: 'rgba(240, 97, 109, 0.12)',
    borderColor: colors.danger,
  },
  successMark: {
    color: colors.success,
    fontSize: 42,
    fontWeight: '800',
  },
  successMarkPending: {
    color: colors.warning,
  },
  successMarkFailed: {
    color: colors.danger,
  },
  successAmount: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
  },
  successText: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    maxWidth: 340,
  },
});
