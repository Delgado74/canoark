import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  Linking,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  Field,
  MenuRow,
  Notice,
  Paragraph,
  Row,
  Screen,
  SectionLabel,
  Title,
} from '../../components/ui';
import { colors, spacing } from '../../constants/theme';
import { useWallet } from '../../hooks/useWallet';
import {
  getLnurlConfig,
  loadLightningAddress,
  openLightningAddressSession,
  registerLightningAddress,
} from '../../lib/arkade/lightning';
import type { LnurlSession } from '@arkade-os/lnurl-client';
import { errorMessage, formatBtc, formatSats } from '../../lib/format';

const REPO_URL = 'https://github.com/Delgado74/canoark';

function SettingsItem({
  icon,
  label,
  value,
  open,
  onToggle,
  children,
}: {
  icon: string;
  label: string;
  value?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <View>
      <MenuRow
        icon={icon}
        label={label}
        value={value}
        expanded={open}
        onPress={onToggle}
      />
      {open ? <View style={styles.itemBody}>{children}</View> : null}
    </View>
  );
}

export default function SettingsScreen() {
  const {
    network,
    status,
    address,
    boardingAddress,
    balance,
    history,
    refresh,
    refreshing,
    lock,
    wipe,
    busy,
    error,
    biometricAvailable,
    biometricEnabled,
    revealMnemonic,
  } = useWallet();

  const version = Constants.expoConfig?.version ?? '0.1.0';
  const lnurl = getLnurlConfig();

  const [open, setOpen] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [lnurlAddress, setLnurlAddress] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [registerBusy, setRegisterBusy] = useState(false);
  const [lnurlError, setLnurlError] = useState<string | null>(null);
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [lastEvent, setLastEvent] = useState<string | null>(null);
  const sessionRef = useRef<LnurlSession | null>(null);

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
      sessionRef.current?.close();
      sessionRef.current = null;
    },
    []
  );

  useEffect(() => {
    if (status === 'unlocked') return;
    sessionRef.current?.close();
    sessionRef.current = null;
    setSessionActive(false);
    setLastEvent(null);
  }, [status]);

  const toggle = (id: string) =>
    setOpen(current => (current === id ? null : id));

  const confirmLock = () => {
    void lock();
  };

  const confirmWipe = () => {
    Alert.alert(
      'Borrar billetera',
      'Se eliminan la frase cifrada, la sesión y las bases de datos locales. Si no guardaste la frase, los fondos se pierden para siempre.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Borrar todo',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await wipe();
              } catch (err) {
                Alert.alert('Error', errorMessage(err));
              }
            })();
          },
        },
      ]
    );
  };

  const reveal = () => {
    Alert.alert(
      'Mostrar frase de recuperación',
      'Asegúrate de que nadie más pueda ver la pantalla. No la compartas.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Mostrar',
          onPress: () => {
            const phrase = revealMnemonic();
            if (!phrase) {
              Alert.alert('Error', 'La billetera está bloqueada.');
              return;
            }
            setRevealed(phrase);
          },
        },
      ]
    );
  };

  const register = async () => {
    setLnurlError(null);
    if (!address) {
      setLnurlError('La dirección Arkade todavía no está lista.');
      return;
    }
    if (!username.trim()) {
      setLnurlError('Elige un nombre de usuario.');
      return;
    }
    setRegisterBusy(true);
    try {
      const { registered } = await registerLightningAddress({
        username: username.trim(),
        arkadeAddress: address,
        boardingAddress: boardingAddress ?? undefined,
      });
      setLnurlAddress(registered.lightningAddress);
      setUsername('');
    } catch (err) {
      setLnurlError(errorMessage(err));
    } finally {
      setRegisterBusy(false);
    }
  };

  const toggleSession = async () => {
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
          setLastEvent(`Factura de ${formatSats(sats)} sats enviada.`);
        },
        onOutcome: (_swapId, outcome) => {
          setLastEvent(`Recepción: ${outcome}`);
          if (outcome === 'claimed' || outcome === 'paid') {
            void refresh();
          }
        },
        onError: err => {
          setLnurlError(err.message);
        },
      });
      sessionRef.current = session;
      setSessionActive(true);
      setLastEvent('Escuchando pagos…');
    } catch (err) {
      setLnurlError(errorMessage(err));
    } finally {
      setSessionBusy(false);
    }
  };

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <View style={styles.header}>
        <Title>Configuración</Title>
        <Badge label={`v${version}`} tone="neutral" />
      </View>

      {error ? <ErrorBanner message={error} /> : null}

      <SectionLabel>General</SectionLabel>
      <View style={styles.group}>
        <SettingsItem
          icon="💶"
          label="Moneda"
          value="Sats / BTC"
          open={open === 'currency'}
          onToggle={() => toggle('currency')}
        >
          <Paragraph muted>
            CanoArk muestra sats y su equivalente en BTC. El selector de moneda
            fiat llegará en una próxima versión.
          </Paragraph>
        </SettingsItem>

        <SettingsItem
          icon="🖥"
          label="Pantalla"
          value="Oscuro"
          open={open === 'display'}
          onToggle={() => toggle('display')}
        >
          <Paragraph muted>
            Tema oscuro fijo, optimizado para pantallas móviles y bajo consumo.
          </Paragraph>
        </SettingsItem>

        <SettingsItem
          icon="₿"
          label="Unidad de bitcoin"
          value="Sats"
          open={open === 'unit'}
          onToggle={() => toggle('unit')}
        >
          <Paragraph muted>
            La unidad principal es el satoshi. El equivalente en BTC se muestra
            debajo del saldo disponible.
          </Paragraph>
        </SettingsItem>

        <SettingsItem
          icon="🌐"
          label="Idioma"
          value="Español"
          open={open === 'language'}
          onToggle={() => toggle('language')}
        >
          <Paragraph muted>Idioma de la interfaz: español.</Paragraph>
        </SettingsItem>

        <SettingsItem
          icon="🔔"
          label="Notificaciones"
          value="Desactivadas"
          open={open === 'notifications'}
          onToggle={() => toggle('notifications')}
        >
          <Paragraph muted>
            Las recepciones Lightning requieren la app abierta hasta completar
            el swap. Las notificaciones push todavía no están disponibles.
          </Paragraph>
        </SettingsItem>

        <SettingsItem
          icon="📳"
          label="Vibración"
          value="Sistema"
          open={open === 'haptics'}
          onToggle={() => toggle('haptics')}
        >
          <Paragraph muted>
            CanoArk usa la vibración del sistema en las acciones principales.
          </Paragraph>
        </SettingsItem>

        <SettingsItem
          icon="ℹ"
          label="Acerca de"
          value={`v${version}`}
          open={open === 'about'}
          onToggle={() => toggle('about')}
        >
          <Row label="Versión" value={version} />
          <Row label="Red" value={network.label} />
          <Row label="Dinero real" value={network.isMainnet ? 'Sí' : 'No'} />
          <Row label="Operador" value={network.operatorUrl} mono />
          <Row label="Indexer" value={network.indexerUrl} mono />
          <Button
            title="Abrir explorador"
            variant="secondary"
            onPress={() => {
              void Linking.openURL(network.explorerUrl);
            }}
          />
        </SettingsItem>

        <SettingsItem
          icon="🛟"
          label="Soporte"
          open={open === 'support'}
          onToggle={() => toggle('support')}
        >
          <Paragraph muted>
            Reporta problemas o consulta el código fuente en GitHub.
          </Paragraph>
          <Button
            title="Abrir GitHub"
            variant="secondary"
            onPress={() => {
              void Linking.openURL(REPO_URL);
            }}
          />
        </SettingsItem>
      </View>

      <SectionLabel>Seguridad</SectionLabel>
      <View style={styles.group}>
        <SettingsItem
          icon="🔑"
          label="Respaldo"
          value={revealed ? 'Visible' : 'Frase de recuperación'}
          open={open === 'backup'}
          onToggle={() => toggle('backup')}
        >
          {revealed ? (
            <>
              <View style={styles.words}>
                {revealed.split(' ').map((word, index) => (
                  <View key={`${word}-${index}`} style={styles.word}>
                    <Text style={styles.wordIndex}>{index + 1}</Text>
                    <Text style={styles.wordText}>{word}</Text>
                  </View>
                ))}
              </View>
              <Notice tone="danger">
                Quien tenga esta frase puede gastar tus fondos. Guárdala
                offline.
              </Notice>
              <Button
                title="Ocultar frase"
                variant="secondary"
                onPress={() => setRevealed(null)}
              />
            </>
          ) : (
            <>
              <Paragraph muted>
                Muestra las 12 palabras para respaldarlas. Se requiere
                confirmación y la billetera debe estar desbloqueada.
              </Paragraph>
              <Button title="Mostrar frase" onPress={reveal} />
            </>
          )}
        </SettingsItem>

        <SettingsItem
          icon="⚡"
          label="Dirección Lightning"
          value={lnurlAddress ?? (lnurl ? 'Sin registrar' : 'No configurada')}
          open={open === 'lnurl'}
          onToggle={() => toggle('lnurl')}
        >
          {!lnurl ? (
            <Notice tone="info">
              Sin servidor LNURL configurado. Define
              {'\n'}EXPO_PUBLIC_LNURL_BASE_URL y EXPO_PUBLIC_LNURL_DOMAIN y
              recompila.
            </Notice>
          ) : (
            <>
              <Row label="Servidor" value={lnurl.domain} />
              {lnurlAddress ? (
                <>
                  <Row label="Tu dirección" value={lnurlAddress} mono />
                  <Button
                    title={
                      sessionActive
                        ? 'Detener recepción'
                        : 'Escuchar pagos (primer plano)'
                    }
                    variant={sessionActive ? 'secondary' : 'primary'}
                    onPress={toggleSession}
                    loading={sessionBusy}
                  />
                  {lastEvent ? (
                    <Text style={styles.sessionEvent}>{lastEvent}</Text>
                  ) : null}
                </>
              ) : (
                <>
                  <Field
                    label="Nombre de usuario"
                    value={username}
                    onChangeText={setUsername}
                    placeholder="tu-nombre"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  {lnurlError ? <ErrorBanner message={lnurlError} /> : null}
                  <Button
                    title="Registrar dirección"
                    onPress={register}
                    loading={registerBusy}
                  />
                </>
              )}
              <Paragraph muted>
                Con la sesión activa la app responde facturas al instante.
                Detenla cuando no la necesites para ahorrar batería.
              </Paragraph>
            </>
          )}
        </SettingsItem>

        <SettingsItem
          icon="🔒"
          label="Bloqueo"
          value={biometricEnabled ? 'Biometría' : 'Passphrase'}
          open={open === 'lock'}
          onToggle={() => toggle('lock')}
        >
          <Paragraph muted>
            La billetera se bloquea sola tras 2 minutos en segundo plano.
            Desbloqueo con{' '}
            {biometricAvailable
              ? biometricEnabled
                ? 'passphrase o biometría.'
                : 'passphrase.'
              : 'passphrase (sin biometría compatible).'}
          </Paragraph>
          <Button
            title="Bloquear ahora"
            variant="secondary"
            onPress={confirmLock}
          />
        </SettingsItem>

        <SettingsItem
          icon="🗑"
          label="Reset"
          value="Borrar billetera"
          open={open === 'reset'}
          onToggle={() => toggle('reset')}
        >
          <Paragraph muted>
            Borra todos los datos locales de CanoArk en este dispositivo. No
            afecta a los fondos si conservas la frase de recuperación.
          </Paragraph>
          <Button
            title="Borrar billetera de este dispositivo"
            variant="danger"
            onPress={confirmWipe}
            disabled={busy}
          />
        </SettingsItem>
      </View>

      <SectionLabel>Avanzado</SectionLabel>
      <View style={styles.group}>
        <SettingsItem
          icon="🛰"
          label="Servidor"
          value={network.isMainnet ? 'Mainnet' : 'Mutinynet'}
          open={open === 'server'}
          onToggle={() => toggle('server')}
        >
          <Row label="Operator" value={network.operatorUrl} mono />
          <Row label="Indexer" value={network.indexerUrl} mono />
          <Row label="Asset swap" value={network.swapNetwork} />
          <Paragraph muted>
            Los endpoints se fijan al compilar. Cambiar de red requiere una
            nueva compilación con EXPO_PUBLIC_ARKADE_NETWORK.
          </Paragraph>
        </SettingsItem>

        <SettingsItem
          icon="🧩"
          label="Solvers"
          value="Arkade swap"
          open={open === 'solvers'}
          onToggle={() => toggle('solvers')}
        >
          <Paragraph muted>
            Los pagos fuera de Arkade (Lightning u onchain) los ejecuta un
            solver mediante swaps. La comisión máxima se define al enviar.
          </Paragraph>
        </SettingsItem>

        <SettingsItem
          icon="◫"
          label="VTXOs y contratos"
          value={balance ? `${formatSats(balance.available)} sats` : '—'}
          open={open === 'vtxos'}
          onToggle={() => toggle('vtxos')}
        >
          {balance ? (
            <>
              <Row
                label="Disponible"
                value={`${formatSats(balance.available)} sats`}
              />
              <Row
                label="Liquidado"
                value={`${formatSats(balance.settled)} sats`}
              />
              <Row
                label="Preconfirmado"
                value={`${formatSats(balance.preconfirmed)} sats`}
              />
              <Row
                label="Boarding onchain"
                value={`${formatSats(balance.boarding)} sats`}
              />
              <Row
                label="Recuperable"
                value={`${formatSats(balance.recoverable)} sats`}
              />
              <Row
                label="Total ≈"
                value={`${formatBtc(balance.available)} BTC`}
              />
            </>
          ) : (
            <Paragraph muted>Sincroniza para ver el detalle.</Paragraph>
          )}
        </SettingsItem>

        <SettingsItem
          icon="🧩"
          label="Contratos"
          value="Gated"
          open={open === 'contracts'}
          onToggle={() => toggle('contracts')}
        >
          <Paragraph muted>
            Los fondos en contratos (swaps y lockups) se muestran como saldo
            bloqueado o recuperable en VTXOs y contratos.
          </Paragraph>
        </SettingsItem>

        <SettingsItem
          icon="🤝"
          label="Delegados"
          value="No configurados"
          open={open === 'delegates'}
          onToggle={() => toggle('delegates')}
        >
          <Paragraph muted>
            Esta versión no delega la firma de renovaciones a un tercero: la
            billetera renueva sus outputs mientras está abierta.
          </Paragraph>
        </SettingsItem>

        <SettingsItem
          icon="📜"
          label="Registros"
          value={`${history.length} movimientos`}
          open={open === 'logs'}
          onToggle={() => toggle('logs')}
        >
          <Paragraph muted>
            El historial local contiene {history.length} movimientos. Los logs
            técnicos no se muestran en esta versión.
          </Paragraph>
        </SettingsItem>
      </View>

      <Card title="Red y operador">
        <Row label="Dirección Arkade" value={address ?? '—'} mono />
        <Row label="Boarding" value={boardingAddress ?? '—'} mono />
      </Card>

      <Notice tone="warning">
        CanoArk es software experimental.{' '}
        {network.isMainnet
          ? 'Usa dinero real: verifica direcciones y comisiones.'
          : 'En Mutinynet usa bitcoin de prueba.'}
      </Notice>
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
  group: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  itemBody: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    paddingTop: spacing.xs,
    backgroundColor: colors.surface,
  },
  sessionEvent: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  words: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  word: {
    width: '47%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
  },
  wordIndex: {
    color: colors.textMuted,
    fontSize: 11,
    width: 16,
    textAlign: 'right',
  },
  wordText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
});
