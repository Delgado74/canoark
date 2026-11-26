import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {
  ArkadeCash,
  ArkadeCashCreateError,
  ArkadeCashOperatorMismatchError,
  type ArkadeCashClaimResult,
  type ArkadeCashUnclaimedReason,
} from '@arkade-os/sdk';
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
  SectionLabel,
} from '../../components/ui';
import { SettingsScreen } from '../../components/SettingsScreen';
import { colors, spacing } from '../../constants/theme';
import { useWallet } from '../../hooks/useWallet';
import { errorMessage, formatSats, satsFromInput, shorten } from '../../lib/format';
import {
  deleteCashToken,
  listCashTokens,
  markCashClaimed,
  saveCashToken,
  type SavedCashToken,
} from '../../lib/storage/appData';

type Mode = 'create' | 'claim' | 'saved';

const unclaimedLabel: Record<ArkadeCashUnclaimedReason, string> = {
  subdust: 'por debajo del dust (no gastable)',
  'already-spent': 'ya reclamado por otra persona',
  exited: 'salió onchain (requiere unroll)',
  'has-assets': 'contiene assets; el barrido solo movería BTC',
  'sweep-failed': 'el operador rechazó el barrido',
  'recovery-failed': 'falló la importación para recuperación',
};

const formatCashDate = (timestamp: number): string =>
  new Date(timestamp).toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

function ModeButton({
  icon,
  label,
  hint,
  active,
  onPress,
}: {
  icon: string;
  label: string;
  hint: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.modeButton,
        active && styles.modeButtonActive,
        pressed && styles.pressed,
      ]}
    >
      <Text style={styles.modeIcon}>{icon}</Text>
      <Text style={[styles.modeLabel, active && styles.modeLabelActive]}>
        {label}
      </Text>
      <Text style={styles.modeHint}>{hint}</Text>
    </Pressable>
  );
}

export default function CashSettingsScreen() {
  const {
    createCash,
    claimCash,
    cashDustSats,
    balance,
    network,
    refresh,
    refreshing,
  } = useWallet();

  const [mode, setMode] = useState<Mode>('create');

  const [saved, setSaved] = useState<SavedCashToken[]>([]);
  const [savedBusy, setSavedBusy] = useState(false);
  const [savedError, setSavedError] = useState<string | null>(null);

  const loadSaved = useCallback(async () => {
    setSavedBusy(true);
    setSavedError(null);
    try {
      setSaved(await listCashTokens());
    } catch (error) {
      setSavedError(errorMessage(error));
    } finally {
      setSavedBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadSaved();
  }, [loadSaved]);

  /* -------------------------------------------------------------- */
  /* Crear                                                           */
  /* -------------------------------------------------------------- */

  const [amount, setAmount] = useState('');
  const [createNote, setCreateNote] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [pendingCash, setPendingCash] = useState<string | null>(null);
  const [createWarning, setCreateWarning] = useState<string | null>(null);

  const amountSats = satsFromInput(amount);
  const expectedHrp = network.isMainnet ? 'arkadecash' : 'tarkadecash';
  // El SDK deriva el HRP de la red (`ark` o `tark`); el prefijo visible añade
  // el separador bech32m, así que aquí no se usa `addressPrefix`.
  const addressHrp = network.addressHrp;

  const amountProblem = useMemo(() => {
    if (!amount.trim()) return null;
    if (amountSats <= 0) return 'Indica un importe en sats.';
    if (amountSats < cashDustSats) {
      return `El mínimo que acepta el operador es ${formatSats(
        cashDustSats
      )} sats. Por debajo se crearía un output no gastable.`;
    }
    if (balance && amountSats > balance.available) {
      return `Saldo insuficiente: tienes ${formatSats(
        balance.available
      )} sats disponibles.`;
    }
    return null;
  }, [amount, amountSats, balance, cashDustSats]);

  const submitCreate = async () => {
    setCreateError(null);
    setCreateWarning(null);
    setCreated(null);
    setPendingCash(null);

    if (amountProblem) {
      setCreateError(amountProblem);
      return;
    }
    if (amountSats < cashDustSats) {
      setCreateError(`El mínimo es ${formatSats(cashDustSats)} sats.`);
      return;
    }

    setCreateBusy(true);
    try {
      const cash = await createCash(amountSats);
      setCreated(cash);
      await saveCashToken({
        token: cash,
        amount: amountSats,
        note: createNote,
      }).catch(() => undefined);
      await loadSaved();
    } catch (error) {
      if (error instanceof ArkadeCashCreateError) {
        setPendingCash(error.cash);
        await saveCashToken({
          token: error.cash,
          amount: amountSats,
          note: createNote,
        }).catch(() => undefined);
        await loadSaved();
        setCreateWarning(
          'El envío pudo completarse pero falló la confirmación. Conserva este token: puedes reclamarlo tú mismo o entregarlo. Ya está guardado en «Guardados».'
        );
      } else {
        setCreateError(errorMessage(error));
      }
    } finally {
      setCreateBusy(false);
    }
  };

  const shareCash = async (cash: string) => {
    try {
      await Share.share({ message: cash });
    } catch (error) {
      Alert.alert('No se pudo compartir', errorMessage(error));
    }
  };

  const removeSavedCash = (cash: SavedCashToken) => {
    Alert.alert(
      'Eliminar Arkade Cash',
      cash.status === 'active'
        ? 'Este token todavía no se ha reclamado. Si lo eliminas de la lista sin haberlo compartido, podrías perder los sats. ¿Continuar?'
        : 'Se eliminará el registro de esta lista. El token ya fue reclamado.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await deleteCashToken(cash.token).catch(() => undefined);
              await loadSaved();
            })();
          },
        },
      ]
    );
  };

  const resetCreate = () => {
    setAmount('');
    setCreateNote('');
    setCreated(null);
    setPendingCash(null);
    setCreateWarning(null);
    setCreateError(null);
  };

  /* -------------------------------------------------------------- */
  /* Reclamar                                                        */
  /* -------------------------------------------------------------- */

  const [cashInput, setCashInput] = useState('');
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimResult, setClaimResult] = useState<ArkadeCashClaimResult | null>(
    null
  );

  const parsedCash = useMemo(() => {
    const raw = cashInput.trim();
    if (!raw) return null;
    try {
      const cash = ArkadeCash.fromString(raw);
      return { cash, error: null as string | null, hrp: cash.hrp };
    } catch (error) {
      return { cash: null, error: errorMessage(error), hrp: null as string | null };
    }
  }, [cashInput]);

  const hrpWarning = useMemo(() => {
    if (!parsedCash?.hrp) return null;
    if (parsedCash.hrp !== expectedHrp) {
      return `Este ArkadeCash es «${parsedCash.hrp}», pero la app está en ${network.label} («${expectedHrp}»). El operador activo no podrá reclamarlo.`;
    }
    return null;
  }, [parsedCash, expectedHrp, network.label]);

  const submitClaim = async () => {
    setClaimError(null);
    setClaimResult(null);
    if (!cashInput.trim()) {
      setClaimError('Pega un ArkadeCash (arkadecash1… / tarkadecash1…).');
      return;
    }
    if (parsedCash?.error) {
      setClaimError(parsedCash.error);
      return;
    }

    setClaimBusy(true);
    try {
      const token = cashInput.trim();
      const result = await claimCash(token);
      setClaimResult(result);
      setCashInput('');
      await markCashClaimed(token).catch(() => undefined);
      await loadSaved();
    } catch (error) {
      if (error instanceof ArkadeCashOperatorMismatchError) {
        setClaimError(
          'Este ArkadeCash no pertenece al operador al que está conectada la billetera. CanoArk usa el operador de la red activa; vuelve a intentarlo con el token emitido por ese mismo operador.'
        );
      } else if (
        error instanceof Error &&
        error.message.includes('No VTXOs found')
      ) {
        setClaimError(
          'No hay saldo pendiente en este ArkadeCash. Puede que ya se haya reclamado o que la salida haya caducado y lo haya barrido el operador.'
        );
      } else {
        setClaimError(errorMessage(error));
      }
    } finally {
      setClaimBusy(false);
    }
  };

  const resultTotals = useMemo(() => {
    if (!claimResult) return null;
    return {
      swept: claimResult.swept,
      recovering: claimResult.recovering.amount,
      unclaimed: claimResult.unclaimed.amount,
      total:
        claimResult.swept +
        claimResult.recovering.amount +
        claimResult.unclaimed.amount,
    };
  }, [claimResult]);

  return (
    <SettingsScreen
      title="Arkade Cash"
      badge="Al portador"
      onRefresh={refresh}
      refreshing={refreshing}
    >
      <Paragraph muted>
        Arkade Cash es un pago al portador dentro de Arkade: el token lleva una
        llave privada y lo puede reclamar quien lo posea. No es una nota Ark: al
        reclamarlo se barre directamente a tu saldo, sin canjear la nota en un
        intercambio por lotes.
      </Paragraph>

      <Notice tone="warning">
        Los Arkade Cash guardados viven solo en este dispositivo. La frase de
        recuperación restaura tu saldo Arkade, pero no estos tokens: si
        restauras la billetera en otro móvil o borras la app, desaparecen de la
        lista. Comparte o copia los que quieras conservar.
      </Notice>

      <View style={styles.modeRow}>
        <ModeButton
          icon="◆"
          label="Crear"
          hint="Genera un token con saldo"
          active={mode === 'create'}
          onPress={() => setMode('create')}
        />
        <ModeButton
          icon="⇲"
          label="Reclamar"
          hint="Cobra un token recibido"
          active={mode === 'claim'}
          onPress={() => setMode('claim')}
        />
        <ModeButton
          icon="▤"
          label="Guardados"
          hint="Tus Arkade Cash creados"
          active={mode === 'saved'}
          onPress={() => {
            setMode('saved');
            void loadSaved();
          }}
        />
      </View>

      {mode === 'create' ? (
        <>
          <SectionLabel>CREAR ARKADE CASH</SectionLabel>
          <Card>
            <Row
              label="Saldo disponible"
              value={balance ? `${formatSats(balance.available)} sats` : '—'}
            />
            <Row
              label="Mínimo del operador"
              value={`${formatSats(cashDustSats)} sats`}
            />
            <Field
              label="Importe (sats)"
              value={amount}
              onChangeText={value => {
                setAmount(value);
                setCreateError(null);
                setCreated(null);
              }}
              placeholder={String(Math.max(cashDustSats, 1000))}
              keyboardType="number-pad"
              hint={`Prefijo del token en esta red: ${expectedHrp}1…`}
            />
            <Field
              label="Nota (opcional)"
              value={createNote}
              onChangeText={setCreateNote}
              placeholder="Ej.: pago a Pedro, feria…"
              multiline
              numberOfLines={2}
              hint="Te ayuda a distinguir varios Arkade Cash guardados."
            />
            {amountProblem ? (
              <Text style={styles.warnText}>{amountProblem}</Text>
            ) : null}
            <Button
              title="CREAR ARKADE CASH"
              onPress={submitCreate}
              loading={createBusy}
              disabled={
                createBusy ||
                !amount.trim() ||
                amountSats < cashDustSats ||
                Boolean(amountProblem)
              }
            />
          </Card>

          {createError ? <ErrorBanner message={createError} /> : null}
          {createWarning ? <Notice tone="warning">{createWarning}</Notice> : null}

          {created || pendingCash ? (
            <Card
              title={created ? 'ArkadeCash creado' : 'ArkadeCash pendiente'}
              subtitle="Entrega este token a quien deba cobrarlo."
            >
              <CopyField
                label="Token"
                value={created ?? pendingCash ?? ''}
                displayValue={shorten(created ?? pendingCash ?? '', 24, 18)}
              />
              {created ? (
                <Row label="Importe" value={`${formatSats(amountSats)} sats`} />
              ) : null}
              {createNote.trim() ? (
                <Row label="Nota" value={createNote.trim()} />
              ) : null}
              <View style={styles.inlineButtons}>
                <Button
                  title="Compartir"
                  variant="secondary"
                  onPress={() => void shareCash(created ?? pendingCash ?? '')}
                />
                <Button title="Crear otro" variant="ghost" onPress={resetCreate} />
              </View>
              <Notice tone="danger">
                Quien tenga este token puede gastarlo. No lo publiques. Reclámalo
                pronto: si el output caduca, el operador lo barre y solo se puede
                recuperar con el mismo token.
              </Notice>
              {created ? (
                <Button
                  title="Reclamar en esta billetera"
                  variant="secondary"
                  onPress={() => {
                    setCashInput(created);
                    setCreated(null);
                    setAmount('');
                    setMode('claim');
                  }}
                />
              ) : null}
            </Card>
          ) : null}

          <Notice tone="info">
            Al crear, el importe sale de tu saldo Arkade y queda en un output
            controlado por una llave nueva. No consume la dirección de recepción.
          </Notice>
        </>
      ) : mode === 'saved' ? (
        <>
          <SectionLabel>ARKADE CASH GUARDADOS</SectionLabel>
          <Paragraph muted>
            Estos tokens siguen en tu poder. Compártelos por mensaje de texto,
            correo o Bluetooth aunque no tengas conexión: quien los reciba los
            reclama en su billetera Arkade.
          </Paragraph>

          {savedError ? <ErrorBanner message={savedError} /> : null}

          {saved.length === 0 ? (
            <Card>
              <Text style={styles.warnText}>
                Todavía no has creado ningún Arkade Cash. Al crearlo se guarda
                aquí automáticamente para que puedas compartirlo cuando quieras.
              </Text>
            </Card>
          ) : (
            saved.map(cash => (
              <Card
                key={cash.token}
                title={`${formatSats(cash.amount)} sats`}
                subtitle={formatCashDate(cash.createdAt)}
              >
                <Badge
                  label={
                    cash.status === 'claimed' ? 'Reclamado' : 'Disponible'
                  }
                  tone={cash.status === 'claimed' ? 'neutral' : 'success'}
                />
                {cash.note ? <Row label="Nota" value={cash.note} /> : null}
                <CopyField
                  label="Token"
                  value={cash.token}
                  displayValue={shorten(cash.token, 24, 18)}
                />
                <View style={styles.inlineButtons}>
                  <Button
                    title="Compartir"
                    variant="secondary"
                    onPress={() => void shareCash(cash.token)}
                  />
                  {cash.status === 'active' ? (
                    <Button
                      title="Reclamar"
                      variant="secondary"
                      onPress={() => {
                        setCashInput(cash.token);
                        setClaimError(null);
                        setClaimResult(null);
                        setMode('claim');
                      }}
                    />
                  ) : null}
                </View>
                <Button
                  title="Eliminar de la lista"
                  variant="danger"
                  onPress={() => removeSavedCash(cash)}
                />
              </Card>
            ))
          )}

          <Button
            title="Actualizar lista"
            variant="ghost"
            onPress={() => void loadSaved()}
            loading={savedBusy}
          />
        </>
      ) : (
        <>
          <SectionLabel>RECLAMAR ARKADE CASH</SectionLabel>
          <Card>
            <Field
              label="ArkadeCash"
              value={cashInput}
              onChangeText={value => {
                setCashInput(value);
                setClaimError(null);
                setClaimResult(null);
              }}
              placeholder={`${expectedHrp}1…`}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              hint="Pega el token completo, uno por vez."
            />
            {parsedCash && !parsedCash.error ? (
              <>
                <Row label="Prefijo" value={parsedCash.hrp ?? '—'} mono />
                <Row
                  label="Dirección del token"
                  value={shorten(
                    parsedCash.cash
                      ?.address(addressHrp)
                      .encode() ?? '',
                    14,
                    10
                  )}
                  mono
                />
              </>
            ) : null}
            {parsedCash?.error && cashInput.trim() ? (
              <ErrorBanner message={parsedCash.error} />
            ) : null}
            {hrpWarning ? <Notice tone="danger">{hrpWarning}</Notice> : null}
            <Button
              title="RECLAMAR ARKADE CASH"
              onPress={submitClaim}
              loading={claimBusy}
              disabled={
                claimBusy || !cashInput.trim() || Boolean(parsedCash?.error)
              }
            />
          </Card>

          {claimError ? <ErrorBanner message={claimError} /> : null}

          {claimResult && resultTotals ? (
            <Card title="Resultado del reclamo">
              <Row
                label="Barrido al saldo"
                value={`${formatSats(resultTotals.swept)} sats`}
              />
              <Row
                label="En recuperación"
                value={`${formatSats(resultTotals.recovering)} sats`}
              />
              <Row
                label="Sin reclamar"
                value={`${formatSats(resultTotals.unclaimed)} sats`}
              />

              {claimResult.recovering.vtxos.length > 0 ? (
                <Notice tone="info">
                  El operador ya había barrido parte del token. Se importó como
                  contrato recuperable y volverá a tu saldo tras la próxima
                  liquidación. No necesitas hacer nada más.
                </Notice>
              ) : null}

              {claimResult.unclaimed.vtxos.length > 0 ? (
                <>
                  <SectionLabel>Outputs sin reclamar</SectionLabel>
                  {claimResult.unclaimed.vtxos.map(vtxo => (
                    <Row
                      key={`${vtxo.txid}:${vtxo.vout}`}
                      label={unclaimedLabel[vtxo.reason]}
                      value={`${formatSats(vtxo.value)} sats · ${shorten(
                        vtxo.txid,
                        8,
                        6
                      )}`}
                      mono
                    />
                  ))}
                </>
              ) : null}

              {resultTotals.total === 0 ? (
                <Paragraph muted>
                  El token no tenía saldo pendiente. Puede que ya se haya
                  reclamado o que el output haya caducado.
                </Paragraph>
              ) : null}

              <Button
                title="Reclamar otro"
                variant="secondary"
                onPress={() => {
                  setClaimResult(null);
                  setCashInput('');
                }}
              />
            </Card>
          ) : null}

          <Notice tone="warning">
            Reclama el token antes de que expire la salida. Pasado ese punto el
            operador puede barrerlo y el barrido directo ya no es posible: el SDK
            intenta recuperarlo, pero no está garantizado.
          </Notice>
        </>
      )}

      <Card title="Cómo funciona" tone="alt">
        <Row label="Formato" value={`${expectedHrp}1…`} mono />
        <Row label="Red" value={network.label} />
        <Row label="Firma" value="Llave única del token" />
        <Badge
          label={network.isMainnet ? 'Dinero real' : 'Bitcoin de prueba'}
          tone={network.isMainnet ? 'warning' : 'neutral'}
        />
      </Card>
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  modeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  modeButton: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  modeButtonActive: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(255, 153, 0, 0.10)',
  },
  modeIcon: {
    color: colors.primary,
    fontSize: 20,
    fontWeight: '800',
  },
  modeLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  modeLabelActive: {
    color: colors.primary,
  },
  modeHint: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
  },
  inlineButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  warnText: {
    color: colors.warning,
    fontSize: 12,
    lineHeight: 17,
  },
  pressed: {
    opacity: 0.75,
  },
});
