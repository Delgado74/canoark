import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  Redirect,
  router,
  useLocalSearchParams,
} from 'expo-router';
import {
  BackButton,
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
  Segmented,
  Title,
} from '../components/ui';
import { QrCode } from '../components/QrCode';
import { colors, spacing } from '../constants/theme';
import { useAssetInfo } from '../hooks/useAssetInfo';
import { useWallet } from '../hooks/useWallet';
import { bareAssetId, shortAssetId } from '../lib/arkade/assetInfo';
import {
  getLnurlConfig,
  loadLightningAddress,
  swapErrorMessage,
} from '../lib/arkade/lightning';
import {
  addressNetworkWarning,
  esploraAddressUrl,
  inspectOnchainAddress,
  onchainExplorerAddressUrl,
  type OnchainAddressStatus,
} from '../lib/arkade/onchain';
import { buildOnchainUri } from '../lib/bip21';
import { errorMessage, formatSats, satsFromInput, shorten } from '../lib/format';
import { saveTransactionNote } from '../lib/storage/appData';

type ReceiveTab = 'arkade' | 'lightning' | 'onchain';

type InvoiceState = {
  id: string;
  invoice: string;
  sats: number;
  outcome: string;
  note?: string;
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
    boardingAddresses,
    createInvoice,
    watchOutcome,
    refresh,
    network,
  } = useWallet();
  const { width } = useWindowDimensions();
  const lnurlConfig = getLnurlConfig();
  const params = useLocalSearchParams<{ tab?: string; assetId?: string }>();
  const initialTab: ReceiveTab =
    params.tab === 'lightning' || params.tab === 'onchain'
      ? params.tab
      : 'arkade';
  const assetId =
    typeof params.assetId === 'string' && params.assetId
      ? bareAssetId(params.assetId)
      : '';
  const assetInfos = useAssetInfo(assetId ? [assetId] : []);
  const assetTicker = assetInfos[assetId]?.ticker ?? shortAssetId(assetId);

  const [tab, setTab] = useState<ReceiveTab>(initialTab);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [invoiceBusy, setInvoiceBusy] = useState(false);
  const [invoice, setInvoice] = useState<InvoiceState | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [lnurlAddress, setLnurlAddress] = useState<string | null>(null);
  const [onchainAmount, setOnchainAmount] = useState('');
  const [depositStatuses, setDepositStatuses] = useState<
    Record<string, OnchainAddressStatus>
  >({});
  const [depositChecking, setDepositChecking] = useState(false);
  const [depositError, setDepositError] = useState<string | null>(null);

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
      const savedNote = note.trim();
      setInvoice({ ...request, sats, outcome: 'accepted', note: savedNote });
      if (savedNote) {
        void saveTransactionNote({
          key: `invoice:${request.id}`,
          note: savedNote,
          direction: 'received',
          amount: sats,
          createdAt: Date.now(),
        }).catch(() => undefined);
      }
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
  }, [amount, createInvoice, note, refresh, watchOutcome]);

  const lightningValue = invoice?.invoice ?? lnurlAddress ?? '';

  const watchedOnchainAddresses = useMemo(
    () =>
      Array.from(
        new Set(
          [boardingAddress ?? '', ...boardingAddresses].filter(Boolean)
        )
      ),
    [boardingAddress, boardingAddresses]
  );

  const checkDeposits = useCallback(async () => {
    if (watchedOnchainAddresses.length === 0) return;
    setDepositChecking(true);
    setDepositError(null);
    try {
      const results = await Promise.all(
        watchedOnchainAddresses.map(async target => {
          try {
            return await inspectOnchainAddress(target, network);
          } catch (error) {
            return { address: target, error: errorMessage(error) };
          }
        })
      );
      const next: Record<string, OnchainAddressStatus> = {};
      const failures: string[] = [];
      for (const item of results) {
        if ('error' in item) {
          failures.push(`${shorten(item.address, 10, 8)}: ${item.error}`);
        } else {
          next[item.address] = item;
        }
      }
      setDepositStatuses(next);
      if (failures.length > 0) {
        setDepositError(
          `No se pudo consultar Esplora para ${failures.join(' · ')}`
        );
      }
    } finally {
      setDepositChecking(false);
    }
  }, [network, watchedOnchainAddresses]);

  useEffect(() => {
    if (tab !== 'onchain' || watchedOnchainAddresses.length === 0) return;
    void checkDeposits();
  }, [tab, watchedOnchainAddresses.length, checkDeposits]);

  const activeValue =
    tab === 'arkade'
      ? address ?? ''
      : tab === 'onchain'
        ? boardingAddress
          ? buildOnchainUri(
              boardingAddress,
              satsFromInput(onchainAmount)
            )
          : ''
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

  const emptyLabel =
    tab === 'arkade'
      ? 'Generando dirección Arkade…'
      : tab === 'onchain'
        ? 'Generando dirección onchain…'
        : 'Genera una factura para recibir por Lightning.';

  return (
    <Screen>
      <BackButton />
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
          <Field
            label="Nota (opcional)"
            value={note}
            onChangeText={setNote}
            placeholder="Ej.: factura de julio, regalo…"
            multiline
            numberOfLines={2}
            hint="Se guarda en este dispositivo y aparece en el detalle del cobro."
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
          {invoice?.note ? (
            <Row label="Nota" value={invoice.note} />
          ) : null}
          {invoice &&
          (invoice.outcome === 'claimed' || invoice.outcome === 'paid') ? (
            <Card title="Pago recibido" tone="alt">
              <Paragraph>
                El swap se completó y los sats ya forman parte de tu saldo
                Arkade. Puedes cerrar esta pantalla.
              </Paragraph>
            </Card>
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

      {tab === 'arkade' && assetId ? (
        <Card
          title={`Recibir ${assetTicker}`}
          subtitle="El activo llega a tu dirección Arkade."
        >
          <Paragraph>
            Comparte tu dirección Arkade con quien te envía el activo. El envío
            viaja dentro de Arkade, así que también necesita este ID para no
            confundirlo con otro activo.
          </Paragraph>
          <CopyField label="ID del activo" value={assetId} />
        </Card>
      ) : null}

      <Card>
        {tab === 'onchain' ? (
          <Field
            label="Importe opcional (sats)"
            value={onchainAmount}
            onChangeText={setOnchainAmount}
            placeholder="0"
            keyboardType="number-pad"
            hint="Si indicas un importe, el QR será un BIP21 con amount=. Puedes dejarlo vacío."
          />
        ) : null}
        {activeValue ? (
          <>
            <QrCode value={activeValue} size={qrSize} />
            <Text style={styles.address} selectable numberOfLines={3}>
              {activeValue}
            </Text>
            {tab === 'onchain' ? (
              <>
                <Notice tone="warning">
                  Envía solo bitcoin onchain de {network.label}. Los depósitos
                  tardan en confirmar y luego se liquidan como saldo Arkade.
                </Notice>
                {addressNetworkWarning(boardingAddress ?? '', network) ? (
                  <Notice tone="danger">
                    {addressNetworkWarning(boardingAddress ?? '', network)}
                  </Notice>
                ) : null}
              </>
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
      </Card>

      {tab === 'onchain' && boardingAddress ? (
        <Card
          title="Comprobar depósito"
          subtitle="Consulta Esplora directamente, sin esperar al SDK."
        >
          <Row label="Red activa" value={network.label} />
          <Row label="Dirección actual" value={boardingAddress} mono />
          <Row
            label="Esplora"
            value={network.esploraUrl}
            mono
          />

          {depositError ? <ErrorBanner message={depositError} /> : null}

          {watchedOnchainAddresses.map(target => {
            const status = depositStatuses[target];
            const current = target === boardingAddress;
            return (
              <View key={target} style={styles.depositRow}>
                <View style={styles.depositHeader}>
                  <Text style={styles.depositLabel} numberOfLines={1}>
                    {current ? 'Dirección actual' : 'Dirección anterior'}
                  </Text>
                  {status ? (
                    <Badge
                      label={
                        status.balance > 0
                          ? `${formatSats(status.balance)} sats`
                          : 'sin fondos'
                      }
                      tone={status.balance > 0 ? 'success' : 'neutral'}
                    />
                  ) : (
                    <Badge label="sin comprobar" tone="neutral" />
                  )}
                </View>
                <Text style={styles.depositAddress} selectable>
                  {target}
                </Text>
                {status ? (
                  <>
                    <Row
                      label="Recibido"
                      value={`${formatSats(status.received)} sats`}
                    />
                    <Row
                      label="Transacciones"
                      value={`${status.txCount} (${status.mempoolTxCount} en mempool)`}
                    />
                    {status.utxos.length > 0 ? (
                      status.utxos.map(utxo => (
                        <Row
                          key={`${utxo.txid}:${utxo.vout}`}
                          label={
                            utxo.confirmed
                              ? `UTXO confirmado #${utxo.vout}`
                              : `UTXO pendiente #${utxo.vout}`
                          }
                          value={`${formatSats(
                            utxo.value
                          )} sats · ${shorten(utxo.txid, 8, 6)}`}
                          mono
                        />
                      ))
                    ) : (
                      <Text style={styles.depositEmpty}>
                        No hay UTXOs en esta dirección. Si acabas de enviar, puede
                        tardar unos segundos en aparecer en el mempool.
                      </Text>
                    )}
                  </>
                ) : null}
              </View>
            );
          })}

          <Row
            label="Altura de la cadena"
            value={
              Object.values(depositStatuses)[0]?.tipHeight
                ? String(Object.values(depositStatuses)[0].tipHeight)
                : '—'
            }
          />

          <Button
            title="Comprobar de nuevo"
            variant="secondary"
            onPress={() => void checkDeposits()}
            loading={depositChecking}
          />
          <Button
            title="Ver dirección en mutinynet.com"
            variant="secondary"
            onPress={() => {
              void Linking.openURL(
                onchainExplorerAddressUrl(boardingAddress, network)
              );
            }}
          />
          <Button
            title="Ver respuesta de Esplora"
            variant="ghost"
            onPress={() => {
              void Linking.openURL(esploraAddressUrl(boardingAddress, network));
            }}
          />

          <Notice tone="info">
            La dirección de boarding es Taproot ({network.isMainnet ? 'bc1p' : 'tb1p'}…).
            Algunos monederos y exchanges no permiten enviar a Taproot en redes
            de prueba: en ese caso la transacción nunca se transmite y no
            aparecerá ni en mutinynet.com ni aquí. Si la transacción aparece en
            el explorador pero no en esta pantalla, pulsa «Comprobar de nuevo».
          </Notice>
        </Card>
      ) : null}

      {tab === 'arkade' && address ? (
        <Text style={styles.hint}>
          Tu dirección Arkade: {shorten(address, 14, 10)}
        </Text>
      ) : null}
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
  depositRow: {
    gap: 4,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  depositHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  depositLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    flexShrink: 1,
  },
  depositAddress: {
    color: colors.textMuted,
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 16,
  },
  depositEmpty: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    paddingVertical: spacing.xs,
  },
});
