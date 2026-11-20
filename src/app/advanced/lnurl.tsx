import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import {
  Button,
  ErrorBanner,
  Field,
  Notice,
  Paragraph,
  Row,
  SectionLabel,
} from '../../components/ui';
import { SettingsScreen } from '../../components/SettingsScreen';
import { colors } from '../../constants/theme';
import { useWallet } from '../../hooks/useWallet';
import type { LnurlSession } from '@arkade-os/lnurl-client';
import {
  getLnurlCapabilities,
  getLnurlConfig,
  lnurlErrorMessage,
  loadLightningAddress,
  openLightningAddressSession,
  registerLightningAddress,
  type LnurlCapabilities,
} from '../../lib/arkade/lightning';
import { errorMessage, formatSats } from '../../lib/format';

export default function LightningAddressScreen() {
  const { address, boardingAddress, status, refresh } = useWallet();
  const lnurl = getLnurlConfig();

  const [lnurlAddress, setLnurlAddress] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [claimCode, setClaimCode] = useState('');
  const [claimOpen, setClaimOpen] = useState(false);
  const [capabilities, setCapabilities] = useState<LnurlCapabilities | null>(
    null
  );
  const [capabilitiesLoaded, setCapabilitiesLoaded] = useState(false);
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
      const caps = await getLnurlCapabilities();
      if (!cancelled) {
        setCapabilities(caps);
        setCapabilitiesLoaded(true);
      }
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

  const register = async (options: {
    username?: string;
    claimCode?: string;
    random?: boolean;
  }) => {
    setLnurlError(null);
    if (!address) {
      setLnurlError('La dirección Arkade todavía no está lista.');
      return;
    }
    const chosenUsername = options.username?.trim() ?? '';
    const chosenClaimCode = options.claimCode?.trim() ?? '';
    if (!options.random && !chosenUsername && !chosenClaimCode) {
      setLnurlError('Elige un nombre de usuario o pega un código de reclamo.');
      return;
    }
    setRegisterBusy(true);
    try {
      const { registered } = await registerLightningAddress({
        arkadeAddress: address,
        boardingAddress: boardingAddress ?? undefined,
        ...(chosenUsername ? { username: chosenUsername } : {}),
        ...(chosenClaimCode ? { claimCode: chosenClaimCode } : {}),
      });
      setLnurlAddress(registered.lightningAddress ?? registered.sessionLnurl);
      setUsername('');
      setClaimCode('');
      setClaimOpen(false);
    } catch (err) {
      setLnurlError(lnurlErrorMessage(err));
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

  const modes = capabilities?.allocationModes ?? [];
  const selfAllowed =
    capabilitiesLoaded && (!capabilities || modes.includes('self'));
  const randomAllowed = modes.includes('random');
  const claimAllowed = capabilitiesLoaded && !selfAllowed;
  const domainLabel = lnurl?.domain ?? 'dominio';

  return (
    <SettingsScreen title="Dirección Lightning">
      <SectionLabel>Servidor LNURL</SectionLabel>
      <Row label="Servidor" value={lnurl?.baseUrl ?? 'No configurado'} mono />
      <Row label="Dominio" value={lnurl?.domain ?? '—'} />
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
      ) : !capabilitiesLoaded ? (
        <Paragraph muted>Cargando opciones del servidor…</Paragraph>
      ) : (
        <>
          {selfAllowed ? (
            <>
              <Field
                label="Nombre de usuario"
                value={username}
                onChangeText={setUsername}
                placeholder="tu-nombre"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Button
                title="Registrar dirección"
                onPress={() => register({ username })}
                loading={registerBusy}
              />
            </>
          ) : (
            <>
              <Notice tone="info">
                Este servidor no permite elegir el nombre. Puedes generar una
                dirección automática en {domainLabel} o reclamar un nombre con
                un código del operador.
              </Notice>
              {randomAllowed ? (
                <Button
                  title="Generar dirección automática"
                  onPress={() => register({ random: true })}
                  loading={registerBusy}
                />
              ) : null}
            </>
          )}
          {claimAllowed ? (
            <>
              <Button
                title={
                  claimOpen
                    ? 'Ocultar código de reclamo'
                    : 'Tengo un código de reclamo'
                }
                variant="secondary"
                onPress={() => setClaimOpen(open => !open)}
              />
              {claimOpen ? (
                <>
                  <Field
                    label="Código de reclamo"
                    value={claimCode}
                    onChangeText={setClaimCode}
                    placeholder="Código del operador"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <Field
                    label="Nombre de usuario (si el código lo pide)"
                    value={username}
                    onChangeText={setUsername}
                    placeholder="tu-nombre"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <Button
                    title="Reclamar dirección"
                    onPress={() => register({ username, claimCode })}
                    loading={registerBusy}
                  />
                </>
              ) : null}
            </>
          ) : null}
        </>
      )}
      {lnurlError ? <ErrorBanner message={lnurlError} /> : null}
      <Paragraph muted>
        Con la sesión activa la app responde facturas al instante. Deténla
        cuando no la necesites para ahorrar batería.
      </Paragraph>
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  sessionEvent: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
});
