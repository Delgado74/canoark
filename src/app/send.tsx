import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
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
import { colors, spacing } from '../constants/theme';
import { useAssetInfo } from '../hooks/useAssetInfo';
import { useWallet } from '../hooks/useWallet';
import { usePreferences } from '../hooks/usePreferences';
import { bareAssetId } from '../lib/arkade/assetInfo';
import { formatUnits, parseUnits } from '../lib/arkade/assets';
import type { CollaborativeExitPlan } from '../lib/arkade/offboard';
import type { OnchainSwapQuote } from '../lib/arkade/onchainSend';
import { onchainSwapClaimTxid } from '../lib/arkade/client';
import type { OnchainSendRoutes } from '../hooks/useWallet';
import {
  arkadeExplorerTxUrl,
  onchainExplorerTxUrl,
} from '../lib/arkade/explorer';
import { arkadeAddressHrp, swapErrorMessage } from '../lib/arkade/lightning';
import {
  destinationKindLabel,
  parseDestination,
  type ParsedDestinationKind,
} from '../lib/bip21';
import { errorMessage, formatSats, satsFromInput, shorten } from '../lib/format';
import { saveTransactionNote } from '../lib/storage/appData';

type Stage = 'form' | 'confirm' | 'success';

type SendResult =
  | { kind: 'arkade'; txid: string; assetText?: string }
  | {
      kind: 'onchain';
      txid: string;
      feeSats: number;
      changeSats: number;
    }
  | {
      kind: 'swap';
      id: string;
      outcome: string;
      amountSats: number;
      /** Swap onchain: el TXID es el claim L1 y puede tardar en existir. */
      onchain?: boolean;
      claimTxid?: string;
      feeSats?: number;
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

/** Detalle técnico del error, para poder copiarlo y reportarlo. */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    const stack = error.stack ? `\n\n${error.stack}` : '';
    return `${error.name}: ${error.message}${stack}`;
  }
  return String(error);
}

export default function SendScreen() {
  const {
    sendPayment,
    sendAsset,
    quoteOnchainRoutes,
    watchOutcome,
    balance,
    refresh,
    network,
  } = useWallet();
  const { formatBitcoin } = usePreferences();
  const params = useLocalSearchParams<{ assetId?: string }>();
  const assetId =
    typeof params.assetId === 'string' && params.assetId
      ? bareAssetId(params.assetId)
      : '';
  const assetMode = Boolean(assetId);
  const assetInfoMap = useAssetInfo(assetId ? [assetId] : []);
  const assetInfo = assetId ? assetInfoMap[assetId] : undefined;
  const assetTicker = assetInfo?.ticker ?? 'activo';
  const assetDecimals = assetInfo?.decimals ?? 0;
  const assetBalance = assetId
    ? balance?.assets.find(entry => bareAssetId(entry.assetId) === assetId)
    : undefined;

  const [stage, setStage] = useState<Stage>('form');
  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('');
  const [maxFee, setMaxFee] = useState('500');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [onchainRoutes, setOnchainRoutes] =
    useState<OnchainSendRoutes | null>(null);
  const [onchainRoute, setOnchainRoute] = useState<'swap' | 'exit'>('exit');
  const [localError, setLocalError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);
  const unsubscribeRef = useRef<null | (() => void)>(null);

  const assetAmountAtomic =
    assetMode && amount.trim() ? parseUnits(amount, assetDecimals) : null;

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
  const invoiceHasAmount =
    kind === 'lightning' &&
    Boolean(parsed.amountSats && parsed.amountSats > 0);
  const needsAmount =
    kind === 'onchain' ||
    kind === 'arkade' ||
    kind === 'lnurl' ||
    (kind === 'lightning' && !invoiceHasAmount);
  const isArkade = kind === 'arkade';
  const swapQuote: OnchainSwapQuote | undefined = onchainRoutes?.swap;
  const exitQuote: CollaborativeExitPlan | undefined = onchainRoutes?.exit;
  const chosenFeeSats =
    onchainRoute === 'swap' ? swapQuote?.feeSats : exitQuote?.feeSats;
  const feeTooHigh =
    kind === 'onchain' &&
    chosenFeeSats !== undefined &&
    chosenFeeSats > feeSats;
  const cheapestRoute = (routes: OnchainSendRoutes): 'swap' | 'exit' => {
    if (!routes.swap) return 'exit';
    if (!routes.exit) return 'swap';
    return routes.swap.feeSats < routes.exit.feeSats ? 'swap' : 'exit';
  };
  const assetAmountText =
    assetAmountAtomic !== null
      ? `${formatUnits(assetAmountAtomic, assetDecimals)} ${assetTicker}`
      : '';

  const fillFromParsed = (value: string) => {
    setDestination(value);
    setResult(null);
    setLocalError(null);
    setErrorDetails(null);
    setOnchainRoutes(null);
    const next = parseDestination(value);
    if (!assetMode && next.amountSats && next.amountSats > 0) {
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
    if (assetMode) {
      if (kind === 'unknown') {
        const hrp = arkadeAddressHrp(parsed.raw || destination);
        if (hrp) {
          return `Esa dirección Arkade es de ${
            hrp === 'ark' ? 'Bitcoin mainnet' : 'otra red de pruebas'
          }. CanoArk está conectado a ${network.label}: usa una dirección ${network.addressPrefix}….`;
        }
        return 'Para enviar un activo necesitas una dirección Arkade (ark1… / tark1…).';
      }
      if (kind !== 'arkade') {
        return `Los activos sólo se pueden enviar a una dirección Arkade. Una ${destinationKindLabel(
          kind
        ).toLowerCase()} no puede llevarlos.`;
      }
      if (assetAmountAtomic === null) {
        return `Indica una cantidad válida de ${assetTicker} (hasta ${assetDecimals} decimales).`;
      }
      if (assetAmountAtomic <= 0n) {
        return 'Indica una cantidad mayor que cero.';
      }
      const held = assetBalance?.amount ?? 0n;
      if (assetAmountAtomic > held) {
        return `Saldo insuficiente: tienes ${formatUnits(
          held,
          assetDecimals
        )} ${assetTicker}.`;
      }
      return null;
    }

    if (kind === 'unknown') {
      const hrp = arkadeAddressHrp(parsed.raw || destination);
      if (hrp) {
        return `Esa dirección Arkade es de ${
          hrp === 'ark' ? 'Bitcoin mainnet' : 'otra red de pruebas'
        }. CanoArk está conectado a ${network.label}: usa una dirección ${network.addressPrefix}….`;
      }
      return 'Destino no reconocido. Usa una factura Lightning (lnbc…), una dirección onchain (bc1… / tb1…), una dirección Arkade (ark1… / tark1…) o una Lightning Address (usuario@dominio). También puedes pegar un BIP21.';
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

  const review = async () => {
    const problem = validate();
    if (problem) {
      setLocalError(problem);
      return;
    }

    if (kind === 'onchain') {
      setQuoting(true);
      setErrorDetails(null);
      try {
        const routes = await quoteOnchainRoutes(
          parsed.raw || destination.trim(),
          amountSats
        );
        setOnchainRoutes(routes);
        const choice = cheapestRoute(routes);
        setOnchainRoute(choice);
        const fee =
          choice === 'swap'
            ? routes.swap?.feeSats ?? 0
            : routes.exit?.feeSats ?? 0;
        if (fee > feeSats) {
          setLocalError(
            `La comisión estimada es ${formatSats(
              fee
            )} sats y el máximo es ${formatSats(
              feeSats
            )}. Sube el máximo para continuar.`
          );
          return;
        }
      } catch (err) {
        setOnchainRoutes(null);
        setLocalError(errorMessage(err));
        return;
      } finally {
        setQuoting(false);
      }
    } else {
      setOnchainRoutes(null);
    }

    setLocalError(null);
    setStage('confirm');
  };

  const persistNote = (key: string, sats: number) => {
    const text = note.trim();
    if (!text) return;
    void saveTransactionNote({
      key,
      note: text,
      direction: 'sent',
      amount: sats,
      createdAt: Date.now(),
    }).catch(() => undefined);
  };

  const send = async () => {
    setLocalError(null);
    setBusy(true);
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;

    try {
      if (assetMode) {
        const sent = await sendAsset({
          assetId,
          amount: assetAmountAtomic ?? 0n,
          address: parsed.raw || destination.trim(),
        });
        persistNote(sent.txid, amountSats);
        setResult({ kind: 'arkade', txid: sent.txid, assetText: assetAmountText });
        setStage('success');
        return;
      }

      const outcome = await sendPayment(
        parsed.raw || destination.trim(),
        amountSats,
        feeSats,
        kind === 'onchain' ? onchainRoute : undefined
      );
      if (outcome.kind === 'payment') {
        persistNote(outcome.txid, amountSats);
        setResult({ kind: 'arkade', txid: outcome.txid });
        setStage('success');
      } else if (outcome.kind === 'arkade') {
        persistNote(outcome.txid, amountSats);
        setResult({ kind: 'arkade', txid: outcome.txid });
        setStage('success');
      } else if (outcome.kind === 'onchain') {
        persistNote(outcome.txid, amountSats);
        setResult({
          kind: 'onchain',
          txid: outcome.txid,
          feeSats: outcome.feeSats,
          changeSats: outcome.changeSats,
        });
        setStage('success');
      } else if (outcome.kind === 'onchain-swap') {
        const swapId = outcome.id;
        persistNote(`swap:${swapId}`, amountSats);
        setResult({
          kind: 'swap',
          id: swapId,
          outcome: 'accepted',
          amountSats,
          onchain: true,
          feeSats: outcome.feeSats,
        });
        setStage('success');
        unsubscribeRef.current = watchOutcome(swapId, next => {
          setResult(previous =>
            previous && previous.kind === 'swap'
              ? { ...previous, outcome: next }
              : previous
          );
          if (!isTerminal(next)) return;
          unsubscribeRef.current?.();
          unsubscribeRef.current = null;
          if (!isSuccess(next)) return;
          void refresh();
          // El TXID del swap es el del claim L1: sólo existe cuando el drive
          // ya difundió la transacción que paga al destinatario.
          void onchainSwapClaimTxid(swapId).then(txid => {
            if (!txid) return;
            persistNote(txid, amountSats);
            setResult(previous =>
              previous && previous.kind === 'swap'
                ? { ...previous, claimTxid: txid }
                : previous
            );
          });
        });
      } else {
        const swapId = outcome.swap.id;
        persistNote(`swap:${swapId}`, amountSats);
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
      console.error('[send] fallo al enviar', error);
      setLocalError(swapErrorMessage(error));
      setErrorDetails(describeError(error));
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
    setNote('');
    setResult(null);
    setLocalError(null);
    setOnchainRoutes(null);
  };

  /* ---------------------------------------------------------------- */
  /* Éxito                                                             */
  /* ---------------------------------------------------------------- */

  if (stage === 'success' && result) {
    const pending = result.kind === 'swap' && !isTerminal(result.outcome);
    const claimTxid = result.kind === 'swap' ? result.claimTxid : undefined;
    const failed =
      result.kind === 'swap' &&
      ['refunded', 'lapsed', 'failed', 'needs_recovery'].includes(
        result.outcome
      );

    return (
      <Screen>
        <BackButton onPress={() => router.replace('/(tabs)')} />
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
              : result.kind === 'onchain'
                ? 'Salida onchain enviada'
                : result.assetText
                  ? 'Activo enviado'
                  : 'Pago Arkade enviado'}
          </Title>
          <Text style={styles.successAmount}>
            {result.kind === 'swap'
              ? result.amountSats
                ? formatBitcoin(result.amountSats)
                : 'Según factura'
              : result.kind === 'arkade' && result.assetText
                ? result.assetText
                : formatBitcoin(amountSats)}
          </Text>
          <Text style={styles.successText}>
            {result.kind === 'swap'
              ? outcomeLabel(result.outcome)
              : result.kind === 'onchain'
                ? 'El operador incluyó la salida en un intercambio por lotes. El destinatario recibe el pago en la transacción de compromiso.'
                : result.kind === 'arkade' && result.assetText
                  ? 'El activo viaja en una salida virtual del destinatario, junto a los sats de portador que exige el operador.'
                  : 'La transacción se envió al operador. El saldo se actualizará en unos segundos.'}
          </Text>
        </View>

        {result.kind === 'swap' ? (
          <>
            <CopyField
              label={result.onchain && result.claimTxid ? 'TXID del claim' : 'ID del swap'}
              value={result.claimTxid ?? result.id}
            />
            {result.onchain && !result.claimTxid && !pending ? (
              <Notice tone="info">
                El swap terminó pero el claim L1 aún no tiene TXID local. El
                destinatario recibe el pago en la transacción que difunde el
                solver; revísalo en Configuración → Avanzado → Solvers.
              </Notice>
            ) : null}
          </>
        ) : (
          <CopyField label="TXID" value={result.txid} />
        )}

        {note.trim() ? (
          <Card title="Nota">
            <Paragraph>{note.trim()}</Paragraph>
          </Card>
        ) : null}

        {result.kind === 'onchain' ? (
          <Row
            label="Comisión de la salida"
            value={`${formatSats(result.feeSats)} sats`}
          />
        ) : null}

        {result.kind === 'swap' && result.onchain && result.feeSats !== undefined ? (
          <Row
            label="Comisión (solver y claim)"
            value={`${formatSats(result.feeSats)} sats`}
          />
        ) : null}

        {result.kind === 'arkade' ? (
          <Button
            title="Ver en el explorador Arkade"
            variant="secondary"
            onPress={() => {
              void Linking.openURL(arkadeExplorerTxUrl(result.txid, network));
            }}
          />
        ) : null}

        {result.kind === 'onchain' ? (
          <Button
            title="Ver en el explorador onchain"
            variant="secondary"
            onPress={() => {
              void Linking.openURL(onchainExplorerTxUrl(result.txid, network));
            }}
          />
        ) : null}

        {result.kind === 'swap' && claimTxid ? (
          <Button
            title="Ver el claim en el explorador onchain"
            variant="secondary"
            onPress={() => {
              void Linking.openURL(onchainExplorerTxUrl(claimTxid, network));
            }}
          />
        ) : null}

        {pending ? (
          <Notice tone="warning">
            {result.kind === 'swap' && result.onchain
              ? 'Mantén la app abierta hasta que el HTLC se reclame. La transacción del claim paga la dirección de destino; si cierras, se reanuda al desbloquear.'
              : 'Mantén la app abierta hasta que el swap llegue a un estado final. El cliente de swaps reclama o reembolsa solo.'}
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
      </Screen>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Confirmación                                                      */
  /* ---------------------------------------------------------------- */

  if (stage === 'confirm') {
    return (
      <Screen>
        <BackButton
          onPress={() => {
            setStage('form');
            setLocalError(null);
          }}
        />

        <Title>Confirmar envío</Title>

        {localError ? <ErrorBanner message={localError} /> : null}
        {errorDetails ? (
          <CopyField
            label="Copiar detalles del error"
            value={errorDetails}
            displayValue={errorDetails.split('\n').slice(0, 3).join('\n')}
          />
        ) : null}

        <Card
          title={assetMode ? `Enviar ${assetTicker}` : destinationKindLabel(kind)}
          subtitle="Revisa estos datos antes de firmar."
        >
          <Row label="Destino" value={shorten(parsed.raw || destination, 14, 10)} mono />
          <Row
            label="Importe"
            value={
              assetMode
                ? assetAmountText || `— ${assetTicker}`
                : kind === 'lightning'
                  ? invoiceHasAmount
                    ? `${formatSats(parsed.amountSats ?? 0)} sats`
                    : amountSats > 0
                      ? `${formatSats(amountSats)} sats`
                      : 'Sin importe en la factura'
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
          {kind === 'onchain' && onchainRoutes ? (
            <>
              <Row
                label="Ruta"
                value={
                  onchainRoute === 'swap'
                    ? 'Swap del solver'
                    : 'Salida del operador'
                }
              />
              <Row
                label="Comisión estimada"
                value={`${formatSats(chosenFeeSats ?? 0)} sats`}
              />
              {onchainRoute === 'swap' && swapQuote ? (
                <>
                  <Row
                    label="Comisión del solver"
                    value={`${formatSats(swapQuote.solverFeeSats)} sats`}
                  />
                  <Row
                    label="Comisión del claim L1"
                    value={`${formatSats(swapQuote.claimFeeSats)} sats`}
                  />
                  <Row
                    label="Total que sale del saldo"
                    value={`${formatSats(swapQuote.totalSats)} sats`}
                  />
                </>
              ) : null}
              {onchainRoute === 'exit' && exitQuote ? (
                <>
                  <Row
                    label="Salidas virtuales usadas"
                    value={String(exitQuote.inputs.length)}
                  />
                  {exitQuote.changeSats > 0 ? (
                    <Row
                      label="Cambio"
                      value={`${formatSats(exitQuote.changeSats)} sats`}
                    />
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}
          <Row label="Red" value={network.label} />
          <Row
            label="Saldo disponible"
            value={
              assetMode
                ? `${formatUnits(
                    assetBalance?.amount ?? 0n,
                    assetDecimals
                  )} ${assetTicker}`
                : balance
                  ? `${formatSats(balance.available)} sats`
                  : '—'
            }
          />
          {note.trim() ? <Row label="Nota" value={note.trim()} /> : null}
        </Card>

        {assetMode ? (
          <Notice tone="info">
            El activo se transfiere dentro de Arkade, sin solver. El destinatario
            lo recibe en su dirección Arkade junto a los sats de portador.
          </Notice>
        ) : null}
        {kind === 'lightning' ? (
          <Notice tone="info">
            Una factura Lightning se paga mediante un swap. El solver recibe el
            importe de la factura y paga al destino. Es un Arkade Intent
            (developer preview).
          </Notice>
        ) : null}
        {kind === 'onchain' && onchainRoutes ? (
          <Card
            title="Ruta del envío"
            subtitle="La más barata viene elegida; puedes cambiarla."
          >
            {swapQuote && exitQuote ? (
              <Segmented
                options={[
                  { value: 'swap', label: 'Swap del solver' },
                  { value: 'exit', label: 'Salida del operador' },
                ]}
                value={onchainRoute}
                onChange={setOnchainRoute}
              />
            ) : (
              <Paragraph muted>
                {swapQuote
                  ? 'Sólo está disponible el swap del solver.'
                  : 'Sólo está disponible la salida del operador.'}
              </Paragraph>
            )}
            {onchainRoute === 'swap' && swapQuote ? (
              <>
                <Row
                  label="Comisión del solver"
                  value={`${formatSats(swapQuote.solverFeeSats)} sats`}
                />
                <Row
                  label="Claim L1"
                  value={`${formatSats(swapQuote.claimFeeSats)} sats`}
                />
              </>
            ) : null}
            {onchainRoute === 'exit' && exitQuote ? (
              <Row
                label="Salidas virtuales usadas"
                value={String(exitQuote.inputs.length)}
              />
            ) : null}
            <Row
              label="Comisión total"
              value={`${formatSats(chosenFeeSats ?? 0)} sats`}
            />
          </Card>
        ) : null}
        {kind === 'onchain' && onchainRoute === 'swap' && swapQuote ? (
          <Notice tone="warning">
            El solver financia un HTLC onchain y la app lo reclama para pagar la
            dirección de destino. Mantén la app abierta hasta que el pago se
            reclame; si se cierra, la reclamación se reanuda al desbloquear.
          </Notice>
        ) : null}
        {kind === 'onchain' && onchainRoute === 'exit' ? (
          <Notice tone="warning">
            El pago se hace con una salida colaborativa: el operador incluye tus
            salidas virtuales en un intercambio por lotes y la transacción de
            compromiso paga la dirección de destino. No hay solver ni swap;
            mantén la app abierta hasta que el lote cierre.
          </Notice>
        ) : null}
        {feeTooHigh ? (
          <ErrorBanner
            message={`La comisión estimada es ${formatSats(
              chosenFeeSats ?? 0
            )} sats y el máximo es ${formatSats(
              feeSats
            )}. Sube el máximo o elige otra ruta.`}
          />
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
          disabled={busy || feeTooHigh}
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
      <BackButton />
      <View style={styles.header}>
        <Title>{assetMode ? `Enviar ${assetTicker}` : 'Enviar'}</Title>
        <Badge
          label={
            assetMode
              ? `${formatUnits(assetBalance?.amount ?? 0n, assetDecimals)} ${assetTicker}`
              : balance
                ? formatBitcoin(balance.available)
                : 'sin datos'
          }
          tone="neutral"
        />
      </View>

      {localError ? <ErrorBanner message={localError} /> : null}
      {errorDetails ? (
        <CopyField
          label="Copiar detalles del error"
          value={errorDetails}
          displayValue={errorDetails.split('\n').slice(0, 3).join('\n')}
        />
      ) : null}

      {assetMode ? (
        <Notice tone="info">
          Envía {assetTicker} a otra billetera Arkade. El destinatario recibirá
          el activo en su dirección; los sats de portador los pone tu saldo.
        </Notice>
      ) : null}

      <Card>
        <Field
          label="Destino"
          value={destination}
          onChangeText={fillFromParsed}
          placeholder={
            assetMode
              ? `${network.addressPrefix}… (dirección Arkade)`
              : 'lnbc… / bc1… / tb1… / tark1… / usuario@dominio'
          }
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          numberOfLines={3}
        />
        <View style={styles.metaRow}>
          {destination.trim() ? (
            <Badge
              label={destinationKindLabel(kind)}
              tone={
                kind === 'unknown' || (assetMode && kind !== 'arkade')
                  ? 'danger'
                  : 'success'
              }
            />
          ) : (
            <Text style={styles.metaMuted}>Pega o escribe un destino</Text>
          )}
          <Pressable onPress={paste} style={styles.linkRow}>
            <Text style={styles.link}>Pegar</Text>
          </Pressable>
        </View>

        <Field
          label={assetMode ? `Cantidad (${assetTicker})` : 'Importe (sats)'}
          value={amount}
          onChangeText={value => {
            setAmount(value);
            setOnchainRoutes(null);
          }}
          placeholder="0"
          keyboardType={assetMode ? 'decimal-pad' : 'number-pad'}
          editable={kind !== 'lightning' || !invoiceHasAmount}
          hint={
            assetMode
              ? assetDecimals > 0
                ? `Hasta ${assetDecimals} decimales. Tienes ${formatUnits(
                    assetBalance?.amount ?? 0n,
                    assetDecimals
                  )} ${assetTicker}.`
                : `Unidades enteras de ${assetTicker}. Tienes ${formatUnits(
                    assetBalance?.amount ?? 0n,
                    assetDecimals
                  )} ${assetTicker}.`
              : kind === 'lightning'
                ? invoiceHasAmount
                  ? `La factura ya incluye ${formatSats(
                      parsed.amountSats ?? 0
                    )} sats; este campo se rellena solo.`
                  : 'La factura no lleva importe: indica cuántos sats pagar.'
                : kind === 'lnurl'
                  ? 'Obligatorio: se pedirá una factura a la dirección por este importe.'
                  : parsed.amountSats
                    ? `Importe detectado en el BIP21: ${formatSats(
                        parsed.amountSats
                      )} sats.`
                    : 'Obligatorio para direcciones onchain y Arkade.'
          }
        />

        {!isArkade && !assetMode ? (
          <Field
            label={
              kind === 'onchain'
                ? 'Comisión máxima del envío (sats)'
                : 'Comisión máxima del solver (sats)'
            }
            value={maxFee}
            onChangeText={value => {
              setMaxFee(value);
              setLocalError(null);
            }}
            placeholder="500"
            keyboardType="number-pad"
            hint={
              kind === 'onchain'
                ? 'Se compara con el swap del solver y la salida del operador; se rechaza si la ruta elegida cuesta más.'
                : 'Se rechaza el pago antes de mover fondos si el solver pide más.'
            }
          />
        ) : null}

        {kind === 'onchain' && onchainRoutes ? (
          <Card
            title="Rutas disponibles"
            subtitle="Se elige la más barata al revisar el envío"
          >
            {swapQuote ? (
              <Row
                label="Swap del solver"
                value={`${formatSats(swapQuote.feeSats)} sats`}
              />
            ) : null}
            {exitQuote ? (
              <Row
                label="Salida del operador"
                value={`${formatSats(exitQuote.feeSats)} sats`}
              />
            ) : null}
            {!swapQuote ? (
              <Paragraph muted>
                El solver no ofrece el corredor onchain ahora mismo.
              </Paragraph>
            ) : null}
            {chosenFeeSats !== undefined && chosenFeeSats > feeSats ? (
              <Button
                title={`Usar ${formatSats(chosenFeeSats)} sats como máximo`}
                variant="secondary"
                onPress={() => {
                  setMaxFee(String(chosenFeeSats));
                  setLocalError(null);
                }}
              />
            ) : null}
          </Card>
        ) : null}

        <Field
          label="Nota (opcional)"
          value={note}
          onChangeText={setNote}
          placeholder="Ej.: cena, alquiler, pago a Ana…"
          multiline
          numberOfLines={2}
          hint="Se guarda en este dispositivo y aparece en el detalle del pago."
        />

        <Button title="Revisar envío" onPress={review} />
      </Card>

      <Paragraph muted>
        Dirección Arkade: {network.addressPrefix}… · onchain:{' '}
        {network.isMainnet ? 'bc1…' : 'tb1…'} · Lightning: lnbc… o
        usuario@dominio
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
