import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
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
  getLnurlConfig,
  loadLightningAddress,
  openLightningAddressSession,
  registerLightningAddress,
} from '../../lib/arkade/lightning';
import { errorMessage, formatSats } from '../../lib/format';

export default function LightningAddressScreen() {
  const { address, boardingAddress, status, refresh } = useWallet();
  const lnurl = getLnurlConfig();

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
      <Notice tone="info">
        Mismo servidor y dominio que Arkade Wallet. La dirección queda como
        usuario@{lnurl?.domain ?? 'dominio'}.
      </Notice>
      <Paragraph muted>
        Con la sesión activa la app responde facturas al instante. Deténla
        cuando no la necesites para ahorrar batería.
      </Paragraph>
      <Button
        title="Volver a avanzado"
        variant="ghost"
        onPress={() => router.back()}
      />
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
