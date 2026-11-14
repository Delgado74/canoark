import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Linking,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Redirect, router } from 'expo-router';
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  Field,
  Notice,
  Row,
  Screen,
  Segmented,
  Title,
} from '../components/ui';
import { QrCode } from '../components/QrCode';
import { colors, spacing } from '../constants/theme';
import { useWallet } from '../hooks/useWallet';
import {
  getLnurlConfig,
  loadLightningAddress,
  swapErrorMessage,
} from '../lib/arkade/lightning';
import { errorMessage, formatSats, satsFromInput, shorten } from '../lib/format';

type ReceiveTab = 'arkade' | 'lightning' | 'onchain';

type InvoiceState = {
  id: string;
  invoice: string;
  sats: number;
  outcome: string;
};

const isTerminal = (outcome: string) =>
  ['claimed', 'paid', 'refunded', 'lapsed', 'failed', 'needs_recovery'].includes(
    outcome
  );

function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case 'accepted':
      return 'Esperando el pago…';
    case 'funding':
    case 'funded':
    case 'open':
      return 'Procesando el pago…';
    case 'claimed':
    case 'paid':
      return 'Pago recibido';
    case 'refunded':
      return 'Reembolsado al pagador';
    case 'lapsed':
      return 'Factura expirada';
    case 'failed':
      return 'La recepción falló';
    case 'needs_recovery':
      return 'Requiere recuperación manual';
    default:
      return outcome;
  }
}

export default function ReceiveScreen() {
  const {
    status,
    address,
    boardingAddress,
    createInvoice,
    watchOutcome,
    refresh,
    network,
  } = useWallet();
  const { width } = useWindowDimensions();
  const lnurlConfig = getLnurlConfig();

  const [tab, setTab] = useState<ReceiveTab>('arkade');
  const [amount, setAmount] = useState('');
  const [invoiceBusy, setInvoiceBusy] = useState(false);
  const [invoice, setInvoice] = useState<InvoiceState | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [lnurlAddress, setLnurlAddress] = useState<string | null>(null);

  const invoiceUnsubscribeRef = useRef<null | (() => void)>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await loadLightningAddress();
      if (!cancelled) setLnurlAddress(stored);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      invoiceUnsubscribeRef.current?.();
      invoiceUnsubscribeRef.current = null;
    },
    []
  );

  useEffect(() => {
    if (status === 'unlocked') return;
    invoiceUnsubscribeRef.current?.();
    invoiceUnsubscribeRef.current = null;
  }, [status]);

  if (status === 'empty') return <Redirect href="/welcome" />;

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

  const lightningValue = invoice?.invoice ?? lnurlAddress ?? '';

  const activeValue =
    tab === 'arkade'
      ? address ?? ''
      : tab === 'onchain'
        ? boardingAddress ?? ''
        : lightningValue;

  const qrSize = Math.min(280, Math.max(200, width - 96));

  const copy = async () => {
    if (!activeValue) return;
    await Clipboard.setStringAsync(activeValue);
    Alert.alert('Copiado', 'La dirección se copió al portapapeles.');
  };

  const share = async () => {
    if (!activeValue) return;
    try {
      await Share.share({ message: activeValue });
    } catch (error) {
      Alert.alert('No se pudo compartir', errorMessage(error));
    }
  };

  const addFunds = () => {
    if (tab === 'onchain') {
      Alert.alert(
        'Añadir fondos onchain',
        `Envía bitcoin desde otra billetera a esta dirección. Los fondos aparecerán como boarding y se convertirán en saldo Arkade al liquidarse.`
      );
      return;
    }
    setTab('onchain');
    Alert.alert(
      'Añadir fondos',
      'Usa la pestaña ONCHAIN para depositar bitcoin desde otra billetera.'
    );
  };

  const emptyLabel =
    tab === 'arkade'
      ? 'Generando dirección Arkade…'
      : tab === 'onchain'
        ? 'Generando dirección onchain…'
        : 'Genera una factura para recibir por Lightning.';

  return (
    <Screen>
      <View style={styles.header}>
        <Title>Recibir</Title>
        <Badge label={network.label} tone="primary" />
      </View>

      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'arkade', label: 'Arkade' },
          { value: 'lightning', label: 'Lightning' },
          { value: 'onchain', label: 'Onchain' },
        ]}
      />

      {localError ? <ErrorBanner message={localError} /> : null}

      {tab === 'lightning' ? (
        <Card>
          {lnurlAddress ? (
            <View style={styles.labelRow}>
              <Text style={styles.label}>Lightning Address</Text>
              <Text style={styles.value} numberOfLines={1}>
                {lnurlAddress}
              </Text>
            </View>
          ) : null}
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
            title={invoice ? 'Generar otra factura' : 'Generar factura'}
            variant={invoice ? 'secondary' : 'primary'}
            onPress={requestInvoice}
            loading={invoiceBusy}
          />
          {invoice ? (
            <Text style={styles.status}>
              {outcomeLabel(invoice.outcome)} · {formatSats(invoice.sats)} sats
            </Text>
          ) : null}
          {!invoice && !lnurlAddress ? (
            <Notice tone="info">
              {lnurlConfig
                ? 'También puedes configurar una Lightning Address en Configuración → Dirección Lightning.'
                : 'Sin servidor LNURL configurado. Las facturas funcionan mientras la app esté abierta.'}
            </Notice>
          ) : null}
        </Card>
      ) : null}

      <Card>
        {activeValue ? (
          <>
            <QrCode value={activeValue} size={qrSize} />
            <Text style={styles.address} selectable numberOfLines={3}>
              {activeValue}
            </Text>
            {tab === 'onchain' ? (
              <Notice tone="warning">
                Envía solo bitcoin onchain. Los depósitos tardan en confirmar y
                luego se liquidan como saldo Arkade.
              </Notice>
            ) : null}
            {tab === 'lightning' && invoice && !isTerminal(invoice.outcome) ? (
              <Notice tone="warning">
                Mantén la app abierta hasta que el pago se complete.
              </Notice>
            ) : null}
          </>
        ) : (
          <Text style={styles.empty}>{emptyLabel}</Text>
        )}

        <View style={styles.buttons}>
          <View style={styles.button}>
            <Button
              title="Copiar"
              variant="secondary"
              onPress={copy}
              disabled={!activeValue}
            />
          </View>
          <View style={styles.button}>
            <Button
              title="Compartir"
              variant="secondary"
              onPress={share}
              disabled={!activeValue}
            />
          </View>
        </View>
        <Button title="Añadir fondos" onPress={addFunds} />
      </Card>

      {tab === 'onchain' && boardingAddress ? (
        <Card>
          <Text style={styles.diagTitle}>Diagnóstico del depósito</Text>
          <Row label="Red activa" value={network.label} />
          <Row label="Dirección" value={boardingAddress} mono />
          <Row label="Esplora" value={network.esploraUrl} mono />
          <Button
            title="Ver en el explorador"
            variant="secondary"
            onPress={() => {
              void Linking.openURL(
                `${network.onchainExplorerUrl}/address/${boardingAddress}`
              );
            }}
          />
          <Notice tone="warning">
            Esta dirección solo recibe bitcoin de {network.label}. Un envío
            desde otra red (signet, testnet o mainnet) no aparecerá aquí ni se
            podrá recuperar. Comprueba la transacción en el explorador antes de
            darla por perdida.
          </Notice>
        </Card>
      ) : null}

      {tab === 'arkade' && address ? (
        <Text style={styles.hint}>
          Tu dirección Arkade: {shorten(address, 14, 10)}
        </Text>
      ) : null}

      <Button
        title="Volver al inicio"
        variant="ghost"
        onPress={() => router.back()}
      />
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
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  label: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  value: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  status: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
  address: {
    color: colors.text,
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    paddingHorizontal: spacing.sm,
  },
  empty: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  buttons: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  button: {
    flex: 1,
  },
  hint: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
  },
  diagTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
});
