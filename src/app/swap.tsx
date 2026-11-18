import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import type { Quote, Swap } from '@arkade-os/swap';
import { ASSET_CARRIER_SATS } from '@arkade-os/swap/protocol';
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
  SectionLabel,
  Segmented,
  Title,
} from '../components/ui';
import { colors, spacing } from '../constants/theme';
import { usePreferences } from '../hooks/usePreferences';
import { useWallet } from '../hooks/useWallet';
import {
  acceptBtcUsd,
  btcPriceInUsd,
  findBtcUsdMarkets,
  formatUnits,
  isSuccessfulSwapOutcome,
  isTerminalSwapOutcome,
  parseUnits,
  quoteBtcUsd,
  quoteInfo,
  swapsAvailable,
  unitsToInput,
  type BtcUsdMarket,
  type SwapDirection,
} from '../lib/arkade/assets';
import { getArkadeSession } from '../lib/arkade/client';
import { swapErrorMessage } from '../lib/arkade/lightning';
import { formatSats } from '../lib/format';
import { fetchBtcRates, type BtcRates } from '../lib/rates';

type Stage = 'form' | 'confirm' | 'sending' | 'result';

function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case 'accepted':
      return 'Aceptado';
    case 'funding':
      return 'Fondeando';
    case 'funded':
      return 'Financiado';
    case 'open':
      return 'Esperando al solver';
    case 'filled':
      return 'Completado';
    case 'claimed':
      return 'Reclamado';
    case 'paid':
      return 'Pagado';
    case 'cancelling':
      return 'Cancelando';
    case 'cancelled':
      return 'Cancelado';
    case 'refunding':
      return 'Reembolsando';
    case 'refunded':
      return 'Reembolsado';
    case 'lapsed':
      return 'Expirado';
    case 'needs_recovery':
      return 'Necesita recuperación';
    case 'failed':
      return 'Fallido';
    default:
      return outcome;
  }
}

const fixed = (value: number, decimals = 2): string =>
  value.toFixed(decimals).replace('.', ',');

const signedPercent = (value: number): string =>
  `${value >= 0 ? '+' : ''}${fixed(value)} %`;

const clockOf = (timestamp: number): string => {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
};

export default function SwapScreen() {
  const { status, balance, refresh, cashDustSats, watchOutcome } = useWallet();
  const { formatBitcoin } = usePreferences();
  const params = useLocalSearchParams<{ direction?: string }>();

  const [markets, setMarkets] = useState<BtcUsdMarket[]>([]);
  const [marketIndex, setMarketIndex] = useState(0);
  const [loadingMarkets, setLoadingMarkets] = useState(() => swapsAvailable());
  const [marketsError, setMarketsError] = useState<string | null>(null);

  const [direction, setDirection] = useState<SwapDirection>(
    params.direction === 'usd-to-btc' ? 'usd-to-btc' : 'btc-to-usd'
  );
  const [amountText, setAmountText] = useState('');
  const [usdBalance, setUsdBalance] = useState<bigint>(0n);

  const [rates, setRates] = useState<BtcRates | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteNonce, setQuoteNonce] = useState(0);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const [stage, setStage] = useState<Stage>('form');
  const [actionError, setActionError] = useState<string | null>(null);
  const [swap, setSwap] = useState<Swap | null>(null);
  const [outcome, setOutcome] = useState('accepted');
  const [result, setResult] = useState<{
    pair: string;
    give: string;
    take: string;
  } | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const available = swapsAvailable();
  const market = markets[marketIndex] ?? null;

  const loadMarkets = useCallback(async () => {
    if (!swapsAvailable()) {
      setLoadingMarkets(false);
      return;
    }
    setLoadingMarkets(true);
    setMarketsError(null);
    try {
      const found = await findBtcUsdMarkets();
      setMarkets(found);
      setMarketIndex(0);
      if (found.length === 0) {
        setMarketsError(
          'El registro de solvers no publica ningún mercado BTC/USD en esta red.'
        );
      }
    } catch (error) {
      setMarketsError(swapErrorMessage(error));
    } finally {
      setLoadingMarkets(false);
    }
  }, []);

  const loadUsdBalance = useCallback(async () => {
    if (!market) {
      setUsdBalance(0n);
      return;
    }
    const usdLeg = market.market.legs[market.usdIndex];
    if (!usdLeg.asset) {
      setUsdBalance(0n);
      return;
    }
    try {
      const { wallet } = getArkadeSession();
      const raw = await wallet.getBalance();
      const entry = raw.availableAssets.find(asset =>
        usdLeg.asset?.endsWith(asset.assetId)
      );
      setUsdBalance(entry?.amount ?? 0n);
    } catch {
      setUsdBalance(0n);
    }
  }, [market]);

  useEffect(() => {
    if (status !== 'unlocked') return;
    void loadMarkets();
  }, [status, loadMarkets]);

  useEffect(() => {
    void loadUsdBalance();
  }, [loadUsdBalance]);

  useEffect(() => {
    let cancelled = false;
    void fetchBtcRates().then(next => {
      if (!cancelled) setRates(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      1000
    );
    return () => clearInterval(timer);
  }, []);

  useEffect(
    () => () => {
      unsubscribeRef.current?.();
    },
    []
  );

  /*
   * En la dirección BTC→USD el usuario escribe sats (unidades atómicas de BTC),
   * no BTC: se parsea como entero y se envía tal cual al solver. En la otra
   * dirección el importe va en unidades atómicas del token, con sus decimales.
   */
  const amountAtomic = useMemo(() => {
    if (direction === 'btc-to-usd') {
      const digits = amountText.trim();
      if (!/^\d+$/.test(digits)) return null;
      try {
        return BigInt(digits);
      } catch {
        return null;
      }
    }
    return parseUnits(amountText, market?.usdDecimals ?? 2);
  }, [amountText, direction, market]);

  const giveBalance =
    direction === 'btc-to-usd'
      ? BigInt(Math.max(0, Math.floor(balance?.available ?? 0)))
      : usdBalance;

  const exceedsBalance =
    amountAtomic !== null && amountAtomic > giveBalance;
  const amountUnparsable =
    amountText.trim() !== '' && amountAtomic === null;

  /*
   * El cambio parcial de un token deja un VTXO de cambio y necesita otro VTXO
   * que pague el dust. Sin él, `accept` falla con un "Insufficient funds" seco.
   */
  const lacksAssetChangeCarrier =
    direction === 'usd-to-btc' &&
    amountAtomic !== null &&
    amountAtomic > 0n &&
    amountAtomic < usdBalance &&
    (balance?.available ?? 0) < cashDustSats * 2;

  useEffect(() => {
    if (!market || amountAtomic === null || amountAtomic <= 0n || exceedsBalance) {
      setQuote(null);
      setQuoteLoading(false);
      setQuoteError(null);
      return;
    }

    let cancelled = false;
    setQuote(null);
    setQuoteLoading(true);
    setQuoteError(null);

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const next = await quoteBtcUsd(market, direction, amountAtomic);
          if (cancelled) return;
          setQuote(next);
          setQuoteError(null);
        } catch (error) {
          if (cancelled) return;
          setQuote(null);
          setQuoteError(swapErrorMessage(error));
        } finally {
          if (!cancelled) setQuoteLoading(false);
        }
      })();
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [market, direction, amountAtomic, exceedsBalance, quoteNonce]);

  const info = quote && market ? quoteInfo(quote, market, direction) : null;
  const expiresIn = quote ? Math.max(0, quote.expiresAt - now) : 0;
  const quoteExpired = quote !== null && expiresIn <= 0;

  const solverBtcPrice = info ? btcPriceInUsd(info, direction) : 0;
  const referenceRate = rates?.usd ?? 0;
  const spreadPct =
    solverBtcPrice > 0 && referenceRate > 0
      ? ((solverBtcPrice - referenceRate) / referenceRate) * 100
      : null;

  const giveBalanceText =
    market && direction === 'usd-to-btc'
      ? `${formatUnits(giveBalance, market.usdDecimals)} ${market.usdTicker}`
      : `${formatSats(Number(giveBalance))} sats`;

  const quotedCard = quote?.market.kind === 'card' ? quote.market : null;
  const quoteTexts =
    quote && market && info
      ? {
          pair: quotedCard?.pair ?? market.market.pair,
          give:
            direction === 'btc-to-usd'
              ? formatBitcoin(Number(quote.give.amount))
              : `${formatUnits(quote.give.amount, market.usdDecimals)} ${
                  market.usdTicker
                }`,
          take:
            direction === 'btc-to-usd'
              ? `${formatUnits(quote.take.amount, market.usdDecimals)} ${
                  market.usdTicker
                }`
              : formatBitcoin(Number(quote.take.amount)),
          rate: `${formatUnits(
            BigInt(Math.max(0, Math.round(solverBtcPrice * 100))),
            2
          )} ${market.usdTicker}/BTC`,
          fee: `${formatUnits(quote.fee.amount, info.feeDecimals)} ${
            info.feeTicker
          }`,
        }
      : null;

  const changeDirection = (next: SwapDirection) => {
    if (next === direction) return;
    setDirection(next);
    setAmountText('');
    setQuote(null);
    setQuoteError(null);
    setActionError(null);
    setQuoteNonce(value => value + 1);
  };

  const changeMarket = (indexText: string) => {
    const next = Number(indexText);
    if (!Number.isInteger(next) || next === marketIndex) return;
    setMarketIndex(next);
    setAmountText('');
    setQuote(null);
    setQuoteError(null);
    setActionError(null);
    setQuoteNonce(value => value + 1);
  };

  const useMax = () => {
    setActionError(null);
    setQuote(null);
    setQuoteError(null);
    if (direction === 'btc-to-usd') {
      const sats = Math.max(0, Math.floor(balance?.available ?? 0));
      setAmountText(sats > 0 ? String(sats) : '');
      return;
    }
    if (!market) return;
    setAmountText(
      usdBalance > 0n ? unitsToInput(usdBalance, market.usdDecimals) : ''
    );
  };

  const confirm = async () => {
    if (!quote || !market || !quoteTexts || quoteExpired) return;
    setStage('sending');
    setActionError(null);
    setResult({
      pair: quoteTexts.pair,
      give: quoteTexts.give,
      take: quoteTexts.take,
    });

    let accepted: Swap;
    try {
      accepted = await acceptBtcUsd(quote);
    } catch (error) {
      setActionError(swapErrorMessage(error));
      setStage('confirm');
      return;
    }

    setSwap(accepted);
    setOutcome(accepted.outcome);
    setStage('result');

    /*
     * El swap ya está aceptado y persistido: un fallo al suscribirse a las
     * actualizaciones no puede presentarse como un fallo del swap.
     */
    try {
      unsubscribeRef.current?.();
      unsubscribeRef.current = watchOutcome(accepted.id, next => {
        setOutcome(next);
        if (isTerminalSwapOutcome(next)) {
          void refresh();
          void loadUsdBalance();
        }
      });
    } catch {
      // El drive sigue trabajando aunque la UI no reciba el stream.
    }

    void refresh();
    void loadUsdBalance();
  };

  const reset = () => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    setSwap(null);
    setOutcome('accepted');
    setQuote(null);
    setQuoteError(null);
    setActionError(null);
    setResult(null);
    setAmountText('');
    setStage('form');
    setQuoteNonce(value => value + 1);
    void refresh();
    void loadUsdBalance();
  };

  /* ---------------------------------------------------------------- */
  /* Estados de la operación                                           */
  /* ---------------------------------------------------------------- */

  if (stage === 'sending') {
    return (
      <Screen>
        <Title>Fondeando el swap</Title>
        <Card>
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.muted}>
              El solver está aceptando la cotización. No cierres la app.
            </Text>
          </View>
        </Card>
      </Screen>
    );
  }

  if (stage === 'result' && swap) {
    const success = isSuccessfulSwapOutcome(outcome);
    const failed =
      outcome === 'failed' ||
      outcome === 'refunded' ||
      outcome === 'cancelled' ||
      outcome === 'lapsed';
    const needsRecovery = outcome === 'needs_recovery';
    const done = isTerminalSwapOutcome(outcome);

    return (
      <Screen>
        <BackButton onPress={() => router.replace('/(tabs)')} />
        <Title>
          {success
            ? 'Swap completado'
            : needsRecovery
              ? 'Swap necesita recuperación'
              : failed
                ? 'El swap no se completó'
                : 'Swap en curso'}
        </Title>

        <Card>
          <View style={styles.resultHead}>
            <View
              style={[
                styles.resultIcon,
                success && styles.resultIconSuccess,
                (failed || needsRecovery) && styles.resultIconFailed,
              ]}
            >
              <Text style={styles.resultMark}>
                {success ? '✓' : needsRecovery ? '!' : failed ? '!' : '…'}
              </Text>
            </View>
            <Badge
              label={outcomeLabel(outcome)}
              tone={
                success
                  ? 'success'
                  : failed || needsRecovery
                    ? 'danger'
                    : 'warning'
              }
            />
          </View>

          {result ? (
            <>
              <Row label="Mercado" value={result.pair} />
              <Row label="Entregado" value={result.give} />
              <Row label="Recibido" value={result.take} />
              {success && direction === 'btc-to-usd' ? (
                <Row
                  label="Portador BTC"
                  value={`${formatSats(Number(ASSET_CARRIER_SATS))} sats`}
                />
              ) : null}
            </>
          ) : null}
        </Card>

        <CopyField label="ID del swap" value={swap.id} />

        {success && direction === 'btc-to-usd' ? (
          <Notice tone="info">
            El {market?.usdTicker ?? 'activo'} recibido viaja en un VTXO con{' '}
            {formatSats(Number(ASSET_CARRIER_SATS))} sats de portador. Por eso el
            historial muestra también un movimiento de esos sats: no es un cobro
            aparte, siguen en tu saldo BTC.
          </Notice>
        ) : null}

        {!done ? (
          <Notice tone="info">
            El swap sigue en curso. Mantén la app abierta hasta que llegue a un
            estado final; el cliente reclama o reembolsa solo.
          </Notice>
        ) : null}
        {needsRecovery ? (
          <Notice tone="danger">
            El swap necesita recuperación manual. Revísalo en Ajustes →
            Avanzado → Solvers.
          </Notice>
        ) : null}
        {failed ? (
          <Notice tone="warning">
            El swap terminó en «{outcomeLabel(outcome)}». El reembolso, si
            corresponde, lo gestiona el cliente de swaps con tus VTXOs.
          </Notice>
        ) : null}

        <Button title="Hacer otro swap" variant="secondary" onPress={reset} />
      </Screen>
    );
  }

  if (stage === 'confirm') {
    return (
      <Screen>
        <BackButton
          onPress={() => {
            setStage('form');
            setActionError(null);
          }}
        />

        <View style={styles.header}>
          <Title>Confirmar swap</Title>
          {market ? (
            <Badge label={market.usdTicker} tone="primary" />
          ) : null}
        </View>

        {actionError ? <ErrorBanner message={actionError} /> : null}

        {quoteTexts ? (
          <Card title="Resumen">
            <Row label="Mercado" value={quoteTexts.pair} />
            <Row
              label={direction === 'btc-to-usd' ? 'Entregas BTC' : 'Entregas'}
              value={quoteTexts.give}
            />
            <Row
              label={direction === 'btc-to-usd' ? 'Recibes' : 'Recibes BTC'}
              value={quoteTexts.take}
            />
            <Row label="Tasa del solver" value={quoteTexts.rate} />
            <Row label="Comisión del solver" value={quoteTexts.fee} />
            <Row label="Expira en" value={`${expiresIn} s`} />
            {quotedCard || market ? (
              <Row
                label="Solver"
                value={
                  quotedCard?.solver ?? market?.market.solver ?? '—'
                }
              />
            ) : null}
          </Card>
        ) : null}

        <Notice tone="warning">
          El swap se fondea con tus VTXOs en Arkade. Mantén la app abierta hasta
          que termine: el cliente reclama el activo recibido o reembolsa el
          entregado.
        </Notice>

        <Button
          title="Confirmar swap"
          onPress={() => void confirm()}
          disabled={quoteExpired}
        />
        {quoteExpired ? (
          <Notice tone="danger">
            La cotización expiró. Vuelve atrás y actualízala antes de confirmar.
          </Notice>
        ) : null}
        <Button
          title="Cancelar"
          variant="secondary"
          onPress={() => setStage('form')}
        />
      </Screen>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Formulario                                                        */
  /* ---------------------------------------------------------------- */

  const shownError =
    actionError ??
    quoteError ??
    (amountUnparsable
      ? direction === 'btc-to-usd'
        ? 'Escribe un número entero de sats.'
        : `Escribe un importe válido en ${market?.usdTicker ?? 'USD'} (máximo ${market?.usdDecimals ?? 2} decimales).`
      : exceedsBalance
        ? 'Saldo insuficiente para esa cantidad.'
        : null);

  return (
    <Screen>
      <BackButton />

      <View style={styles.header}>
        <Title>Cambiar BTC / USD</Title>
        <Badge label="Mutinynet" tone="primary" />
      </View>

      {!available ? (
        <Notice tone="danger">
          Los swaps BTC/USD sólo están disponibles en Mutinynet. En mainnet
          todavía no hay un mercado publicado.
        </Notice>
      ) : null}

      {available && status !== 'unlocked' ? (
        <Notice tone="warning">
          {status === 'empty'
            ? 'Crea o restaura una billetera para cotizar y ejecutar swaps.'
            : 'Desbloquea la billetera para cotizar y ejecutar swaps.'}
        </Notice>
      ) : null}

      {available && status === 'unlocked' ? (
        <>
          {loadingMarkets ? (
            <Card>
              <View style={styles.center}>
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.muted}>
                  Buscando mercados BTC/USD en el registro de solvers…
                </Text>
              </View>
            </Card>
          ) : null}

          {marketsError ? (
            <>
              <ErrorBanner message={marketsError} />
              <Button
                title="Reintentar"
                variant="secondary"
                onPress={() => void loadMarkets()}
              />
            </>
          ) : null}

          {market ? (
            <>
              {markets.length > 1 ? (
                <>
                  <SectionLabel>Mercado</SectionLabel>
                  <Segmented
                    options={markets.map((item, index) => ({
                      value: String(index),
                      label: item.usdTicker,
                    }))}
                    value={String(marketIndex)}
                    onChange={changeMarket}
                  />
                </>
              ) : (
                <Card title="Mercado">
                  <Row label="Par" value={market.market.pair} />
                  <Row label="Solver" value={market.market.solver} />
                  <Row
                    label="Tipo"
                    value={
                      market.market.backend === 'feed'
                        ? 'Precio de mercado'
                        : 'RFQ con el solver'
                    }
                  />
                </Card>
              )}

              <SectionLabel>Dirección</SectionLabel>
              <Segmented
                options={[
                  { value: 'btc-to-usd', label: `BTC → ${market.usdTicker}` },
                  { value: 'usd-to-btc', label: `${market.usdTicker} → BTC` },
                ]}
                value={direction}
                onChange={changeDirection}
              />

              <Field
                label={
                  direction === 'btc-to-usd'
                    ? 'Cantidad a entregar (sats)'
                    : `Cantidad a entregar (${market.usdTicker})`
                }
                value={amountText}
                onChangeText={value => {
                  setAmountText(value);
                  setQuote(null);
                  setQuoteError(null);
                  setActionError(null);
                }}
                placeholder="0"
                keyboardType={
                  direction === 'btc-to-usd' ? 'number-pad' : 'decimal-pad'
                }
                hint={`Disponible: ${giveBalanceText}`}
              />

              <View style={styles.maxRow}>
                <Pressable
                  accessibilityRole="button"
                  onPress={useMax}
                  style={({ pressed }) => [
                    styles.maxButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.maxText}>Usar todo</Text>
                </Pressable>
              </View>

              {shownError ? <ErrorBanner message={shownError} /> : null}
              {lacksAssetChangeCarrier ? (
                <Notice tone="warning">
                  Un cambio parcial de {market.usdTicker} necesita un VTXO de BTC
                  adicional para llevar el cambio del token. Deja al menos{' '}
                  {formatSats(cashDustSats * 2)} sats libres o entrega el saldo
                  completo de {market.usdTicker}.
                </Notice>
              ) : null}

              {quoteLoading ? (
                <Card>
                  <View style={styles.quoteLoading}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={styles.muted}>
                      Cotizando con el solver…
                    </Text>
                  </View>
                </Card>
              ) : null}

              {quoteTexts && quote ? (
                <>
                  <Card title="Cotización del solver">
                    <Row
                      label={
                        direction === 'btc-to-usd'
                          ? 'Entregas BTC'
                          : `Entregas ${market.usdTicker}`
                      }
                      value={quoteTexts.give}
                    />
                    <Row
                      label={
                        direction === 'btc-to-usd'
                          ? `Recibes ${market.usdTicker}`
                          : 'Recibes BTC'
                      }
                      value={quoteTexts.take}
                    />
                    <Row label="Tasa del solver" value={quoteTexts.rate} />
                    <Row label="Comisión del solver" value={quoteTexts.fee} />
                    <Row
                      label="Expira en"
                      value={quoteExpired ? 'Expirada' : `${expiresIn} s`}
                    />
                  </Card>

                  <Card title="Referencia de mercado">
                    <Row
                      label="BTC en USD (referencia)"
                      value={
                        referenceRate > 0
                          ? `${formatUnits(
                              BigInt(Math.round(referenceRate * 100)),
                              2
                            )} USD/BTC`
                          : 'Sin datos'
                      }
                    />
                    <Row
                      label="Diferencia del solver"
                      value={
                        spreadPct === null ? '—' : signedPercent(spreadPct)
                      }
                    />
                    {rates ? (
                      <Text style={styles.source}>
                        Referencia de{' '}
                        {rates.source === 'yadio'
                          ? 'YADIO'
                          : rates.source === 'blockchain.info'
                            ? 'blockchain.info'
                            : 'caché local'}{' '}
                        · {clockOf(rates.fetchedAt)}
                      </Text>
                    ) : null}
                  </Card>

                  <Notice tone="info">
                    La tasa que se ejecuta es la que fija el solver en esta
                    cotización. La referencia de mercado es sólo informativa: no
                    se usa para fondear ni para calcular el swap.
                  </Notice>

                  {quoteExpired ? (
                    <Button
                      title="Actualizar cotización"
                      variant="secondary"
                      onPress={() => setQuoteNonce(value => value + 1)}
                    />
                  ) : (
                    <Button
                      title="Continuar"
                      onPress={() => {
                        setActionError(null);
                        setStage('confirm');
                      }}
                    />
                  )}
                </>
              ) : null}

              {!quote && !quoteLoading && !shownError && amountText === '' ? (
                <Paragraph muted>
                  Indica cuánto quieres cambiar. La cotización se pide al solver
                  y caduca en segundos; confírmala sólo si el importe y la tasa
                  te cuadran.
                </Paragraph>
              ) : null}
            </>
          ) : null}

          {!loadingMarkets && !marketsError && !market ? (
            <Notice tone="warning">
              No hay un mercado BTC/USD disponible ahora mismo.
            </Notice>
          ) : null}
        </>
      ) : null}
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
    gap: spacing.sm,
  },
  center: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  muted: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  maxRow: {
    alignItems: 'flex-end',
  },
  maxButton: {
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  maxText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.7,
  },
  quoteLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  source: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
  },
  resultHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  resultIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  resultIconSuccess: {
    borderColor: colors.success,
  },
  resultIconFailed: {
    borderColor: colors.danger,
  },
  resultMark: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
  },
});
