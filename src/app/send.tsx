import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  Field,
  Notice,
  Paragraph,
  Screen,
  Title,
} from '../components/ui';
import { colors, spacing } from '../constants/theme';
import { useWallet } from '../hooks/useWallet';
import {
  isArkadeAddress,
  isLightningInvoice,
  isOnchainAddress,
  swapErrorMessage,
} from '../lib/arkade/lightning';
import { errorMessage, formatSats, satsFromInput, shorten } from '../lib/format';

type DestinationKind = 'lightning' | 'onchain' | 'arkade' | 'unknown';

type SendResult =
  | { kind: 'arkade'; txid: string }
  | { kind: 'swap'; id: string; outcome: string };

function classify(destination: string): DestinationKind {
  const value = destination.trim();
  if (!value) return 'unknown';
  if (isLightningInvoice(value)) return 'lightning';
  if (isOnchainAddress(value)) return 'onchain';
  if (isArkadeAddress(value)) return 'arkade';
  return 'unknown';
}

const kindLabel: Record<DestinationKind, string> = {
  lightning: 'Factura Lightning',
  onchain: 'Dirección onchain',
  arkade: 'Dirección Arkade',
  unknown: 'Destino',
};

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
      return 'El swap necesita recuperación manual desde Ajustes.';
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

export default function SendScreen() {
  const { sendPayment, watchOutcome, balance } = useWallet();
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

  const kind = classify(destination);
  const sats = satsFromInput(amount);
  const feeSats = satsFromInput(maxFee);
  const needsAmount = kind === 'onchain' || kind === 'arkade';

  const submit = () => {
    setLocalError(null);

    if (kind === 'unknown') {
      setLocalError(
        'Destino no reconocido. Usa una factura Lightning (lnbc…), una dirección onchain (bc1…) o una dirección Arkade (tark1… / ark1…).'
      );
      return;
    }
    if (needsAmount && sats <= 0) {
      setLocalError('Indica cuántos sats quieres enviar.');
      return;
    }
    if (kind !== 'arkade' && feeSats <= 0) {
      setLocalError('Indica una comisión máxima en sats.');
      return;
    }

    const amountText =
      kind === 'lightning'
        ? 'el importe de la factura'
        : `${formatSats(sats)} sats`;

    Alert.alert(
      'Confirmar envío',
      `Vas a enviar ${amountText} a ${kindLabel[kind]}:\n${shorten(
        destination.trim(),
        16,
        12
      )}\n\nComisión máxima: ${formatSats(feeSats)} sats.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Enviar',
          onPress: () => {
            void (async () => {
              setBusy(true);
              setResult(null);
              unsubscribeRef.current?.();
              unsubscribeRef.current = null;
              try {
                const outcome = await sendPayment(
                  destination.trim(),
                  sats,
                  feeSats
                );

                if (outcome.kind === 'arkade') {
                  setResult({ kind: 'arkade', txid: outcome.txid });
                } else if (outcome.kind === 'payment') {
                  setResult({ kind: 'arkade', txid: outcome.txid });
                } else {
                  const swapId = outcome.swap.id;
                  setResult({
                    kind: 'swap',
                    id: swapId,
                    outcome: outcome.swap.outcome,
                  });
                  unsubscribeRef.current = watchOutcome(swapId, next => {
                    setResult(previous =>
                      previous && previous.kind === 'swap'
                        ? { ...previous, outcome: next }
                        : previous
                    );
                    if (isTerminal(next)) {
                      unsubscribeRef.current?.();
                      unsubscribeRef.current = null;
                    }
                  });
                }

                setDestination('');
                setAmount('');
              } catch (error) {
                setLocalError(swapErrorMessage(error));
              } finally {
                setBusy(false);
              }
            })();
          },
        },
      ]
    );
  };

  return (
    <Screen>
      <Pressable onPress={() => router.back()} style={styles.back}>
        <Text style={styles.backText}>‹ Volver</Text>
      </Pressable>
      <View style={styles.header}>
        <Title>Enviar</Title>
        <Badge
          label={
            balance ? `${formatSats(balance.available)} sats` : 'sin datos'
          }
          tone="neutral"
        />
      </View>

      {localError ? <ErrorBanner message={localError} /> : null}

      <Card>
        <Field
          label="Destino"
          value={destination}
          onChangeText={value => {
            setDestination(value);
            setResult(null);
          }}
          placeholder="lnbc… / bc1… / tark1…"
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          numberOfLines={3}
        />
        {destination.trim() ? (
          <Badge
            label={kindLabel[kind]}
            tone={kind === 'unknown' ? 'danger' : 'success'}
          />
        ) : null}

        <Field
          label="Importe (sats)"
          value={amount}
          onChangeText={setAmount}
          placeholder="0"
          keyboardType="number-pad"
          hint={
            kind === 'lightning'
              ? 'La factura ya incluye el importe; este campo se ignora.'
              : 'Obligatorio para direcciones onchain y Arkade.'
          }
        />

        {kind === 'lightning' || kind === 'onchain' ? (
          <Field
            label="Comisión máxima del solver (sats)"
            value={maxFee}
            onChangeText={setMaxFee}
            placeholder="500"
            keyboardType="number-pad"
            hint="Se rechaza el pago antes de mover fondos si el solver pide más."
          />
        ) : null}

        <Button title="Enviar" onPress={submit} loading={busy} />
      </Card>

      {result ? (
        <Card
          title={
            result.kind === 'arkade'
              ? 'Pago Arkade enviado'
              : outcomeLabel(result.outcome)
          }
          tone="alt"
        >
          {result.kind === 'arkade' ? (
            <>
              <Text style={styles.mono}>{result.txid}</Text>
              <Paragraph muted>
                La transacción se envió al operador. Actualiza el balance para
                ver el cambio.
              </Paragraph>
            </>
          ) : (
            <>
              <Text style={styles.mono}>{result.id}</Text>
              {!isTerminal(result.outcome) ? (
                <Notice tone="info">
                  Mantén la app abierta hasta que el swap llegue a un estado
                  final. El cliente reclama o reembolsa solo.
                </Notice>
              ) : null}
            </>
          )}
        </Card>
      ) : null}

      <Notice tone="warning">
        Verifica la red antes de enviar. Una dirección de otra red será
        rechazada.
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
  mono: {
    color: colors.text,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },
  strong: {
    fontWeight: '800',
  },
});
