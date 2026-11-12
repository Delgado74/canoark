import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import type { LnurlSession } from '@arkade-os/lnurl-client';
import {
  Badge,
  Button,
  Card,
  CopyField,
  ErrorBanner,
  Field,
  Notice,
  Paragraph,
  Screen,
  Title,
} from '../../components/ui';
import { colors, spacing } from '../../constants/theme';
import { useWallet } from '../../hooks/useWallet';
import {
  getLnurlConfig,
  loadLightningAddress,
  openLightningAddressSession,
  registerLightningAddress,
  swapErrorMessage,
} from '../../lib/arkade/lightning';
import { errorMessage, formatSats, satsFromInput } from '../../lib/format';

type InvoiceState = {
  id: string;
  invoice: string;
  sats: number;
  outcome: string;
};

function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case 'accepted':
      return 'Swap aceptado. Esperando el pago…';
    case 'funding':
    case 'funded':
    case 'open':
      return 'Esperando que el pagador complete la factura…';
    case 'claimed':
      return 'Pago recibido y reclamado.';
    case 'paid':
      return 'Pago recibido.';
    case 'refunded':
      return 'La recepción fue reembolsada al pagador.';
    case 'lapsed':
      return 'La factura expiró sin pagarse.';
    case 'failed':
      return 'La recepción falló.';
    case 'needs_recovery':
      return 'La recepción necesita recuperación manual.';
    default:
      return `Estado: ${outcome}`;
  }
}

const isTerminal = (outcome: string) =>
  ['claimed', 'paid', 'refunded', 'lapsed', 'failed', 'needs_recovery'].includes(
    outcome
  );

export default function ReceiveScreen() {
  const {
    status,
    address,
    boardingAddress,
    createInvoice,
    watchOutcome,
    refresh,
  } = useWallet();
  const lnurlConfig = getLnurlConfig();

  const [amount, setAmount] = useState('');
  const [invoiceBusy, setInvoiceBusy] = useState(false);
  const [invoice, setInvoice] = useState<InvoiceState | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const [username, setUsername] = useState('');
  const [registeredAddress, setRegisteredAddress] = useState<string | null>(
    null
  );
  const [registerBusy, setRegisterBusy] = useState(false);
  const [lnurlError, setLnurlError] = useState<string | null>(null);
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [lastEvent, setLastEvent] = useState<string | null>(null);

  const invoiceUnsubscribeRef = useRef<null | (() => void)>(null);
  const sessionRef = useRef<LnurlSession | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await loadLightningAddress();
      if (!cancelled) setRegisteredAddress(stored);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      invoiceUnsubscribeRef.current?.();
      invoiceUnsubscribeRef.current = null;
      sessionRef.current?.close();
      sessionRef.current = null;
    },
    []
  );

  // Al bloquear o borrar la billetera, la sesión SSE deja de tener una wallet
  // con la que responder facturas: ciérrala en vez de dejarla colgada.
  useEffect(() => {
    if (status === 'unlocked') return;
    sessionRef.current?.close();
    sessionRef.current = null;
    setSessionActive(false);
    setLastEvent(null);
  }, [status]);

  const requestInvoice = useCallback(async () => {
    const sats = satsFromInput(amount);
    setLocalError(null);

    if (sats <= 0) {
      setLocalError('Indica cuántos sats quieres recibir.');
      return;
    }

    setInvoiceBusy(true);
    invoiceUnsubscribeRef.current?.();
    invoiceUnsubscribeRef.current = null;
    try {
      const request = await createInvoice(sats);
      setInvoice({ ...request, sats, outcome: 'accepted' });
      invoiceUnsubscribeRef.current = watchOutcome(request.id, outcome => {
        setInvoice(previous =>
          previous && previous.id === request.id
            ? { ...previous, outcome }
            : previous
        );
        if (outcome === 'claimed' || outcome === 'paid') {
          void refresh();
        }
        if (isTerminal(outcome)) {
          invoiceUnsubscribeRef.current?.();
          invoiceUnsubscribeRef.current = null;
        }
      });
    } catch (error) {
      setLocalError(swapErrorMessage(error));
    } finally {
      setInvoiceBusy(false);
    }
  }, [amount, createInvoice, refresh, watchOutcome]);

  const register = useCallback(async () => {
    setLnurlError(null);
    if (!address) {
      setLnurlError('La dirección Arkade todavía no está lista.');
      return;
    }
    if (!username.trim()) {
      setLnurlError('Elige un nombre de usuario para tu dirección.');
      return;
    }

    setRegisterBusy(true);
    try {
      const { registered } = await registerLightningAddress({
        username: username.trim(),
        arkadeAddress: address,
        boardingAddress: boardingAddress ?? undefined,
      });
      setRegisteredAddress(registered.lightningAddress);
      setUsername('');
      Alert.alert(
        'Lightning Address registrada',
        registered.lightningAddress ??
          'El servidor registró la dirección sin nombre público.'
      );
    } catch (error) {
      setLnurlError(errorMessage(error));
    } finally {
      setRegisterBusy(false);
    }
  }, [address, boardingAddress, username]);

  const toggleSession = useCallback(async () => {
    setLnurlError(null);

    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
      setSessionActive(false);
      setLastEvent(null);
      return;
    }

    setSessionBusy(true);
    try {
      const session = await openLightningAddressSession({
        onInvoice: ({ sats }) => {
          setLastEvent(
            `Factura de ${formatSats(sats)} sats enviada al pagador.`
          );
        },
        onOutcome: (swapId, outcome) => {
          setLastEvent(
            `Swap ${swapId.slice(0, 10)}…: ${outcomeLabel(outcome)}`
          );
          if (outcome === 'claimed' || outcome === 'paid') {
            void refresh();
          }
        },
        onError: error => {
          setLnurlError(error.message);
        },
      });
      sessionRef.current = session;
      setSessionActive(true);
      setLastEvent('Escuchando pagos a tu Lightning Address…');
    } catch (error) {
      setLnurlError(errorMessage(error));
    } finally {
      setSessionBusy(false);
    }
  }, [refresh]);

  const displayInvoice = invoice?.invoice ?? '';

  return (
    <Screen>
      <View style={styles.header}>
        <Title>Recibir</Title>
        <Badge label="Arkade + Lightning" tone="primary" />
      </View>

      <Paragraph muted>
        Recibe al instante en tu dirección Arkade, o genera una factura
        Lightning que un solver convierte a sats dentro de Arkade.
      </Paragraph>

      <Card title="Dirección Arkade">
        {address ? (
          <CopyField label="Tu dirección" value={address} />
        ) : (
          <Text style={styles.muted}>Generando dirección…</Text>
        )}
        {boardingAddress ? (
          <CopyField label="Boarding onchain" value={boardingAddress} />
        ) : null}
        <Paragraph muted>
          Comparte la dirección Arkade para pagos instantáneos. La dirección de
          boarding se usa para depósitos onchain.
        </Paragraph>
      </Card>

      <Card
        title="Factura Lightning"
        subtitle="Se crea un swap de recepción. Mantén la app abierta hasta que llegue el pago."
      >
        {localError ? <ErrorBanner message={localError} /> : null}
        <Field
          label="Importe (sats)"
          value={amount}
          onChangeText={value => {
            setAmount(value);
            setInvoice(null);
          }}
          placeholder="0"
          keyboardType="number-pad"
        />
        <Button
          title="Generar factura"
          onPress={requestInvoice}
          loading={invoiceBusy}
        />

        {invoice ? (
          <View style={styles.invoiceBlock}>
            <Badge
              label={outcomeLabel(invoice.outcome)}
              tone={isTerminal(invoice.outcome) ? 'neutral' : 'warning'}
            />
            <CopyField label="Factura BOLT11" value={displayInvoice} />
            {!isTerminal(invoice.outcome) ? (
              <Notice tone="warning">
                No cierres la app: el cliente debe seguir vivo para reclamar el
                swap cuando el pagador pague la factura.
              </Notice>
            ) : null}
          </View>
        ) : null}
      </Card>

      <Card
        title="Lightning Address"
        subtitle="Un nombre tipo usuario@dominio que recibe incluso con la app cerrada."
      >
        {!lnurlConfig ? (
          <Notice tone="info">
            Sin servidor LNURL configurado. Define
            {'\n'}
            EXPO_PUBLIC_LNURL_BASE_URL y EXPO_PUBLIC_LNURL_DOMAIN y recompila.
          </Notice>
        ) : (
          <>
            <View style={styles.row}>
              <Text style={styles.muted}>Servidor</Text>
              <Text style={styles.value}>{lnurlConfig.domain}</Text>
            </View>

            {registeredAddress ? (
              <CopyField label="Tu dirección" value={registeredAddress} />
            ) : (
              <Field
                label="Nombre de usuario"
                value={username}
                onChangeText={setUsername}
                placeholder="tu-nombre"
                autoCapitalize="none"
                autoCorrect={false}
              />
            )}

            {lnurlError ? <ErrorBanner message={lnurlError} /> : null}

            {registeredAddress ? (
              <>
                <Button
                  title={
                    sessionActive
                      ? 'Detener recepción en primer plano'
                      : 'Escuchar pagos (primer plano)'
                  }
                  variant={sessionActive ? 'secondary' : 'primary'}
                  onPress={toggleSession}
                  loading={sessionBusy}
                />
                {lastEvent ? (
                  <Notice tone={sessionActive ? 'info' : 'warning'}>
                    {lastEvent}
                  </Notice>
                ) : (
                  <Paragraph muted>
                    Mientras la sesión está abierta, la app responde a las
                    solicitudes de factura del servidor LNURL. Los pagos
                    offline usan la dirección Arkade registrada.
                  </Paragraph>
                )}
              </>
            ) : (
              <Button
                title="Registrar dirección"
                onPress={register}
                loading={registerBusy}
              />
            )}

            <Paragraph muted>
              La preimagen de liquidación se envía al servidor cuando el swap
              se reclama. Sin sesión activa el servidor puede pagar por la
              dirección Arkade registrada, pero no emitir facturas al instante.
            </Paragraph>
          </>
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
  muted: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  value: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  invoiceBlock: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
});
