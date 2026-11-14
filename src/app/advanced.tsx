import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
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
} from '../components/ui';
import { colors, spacing } from '../constants/theme';
import { useWallet } from '../hooks/useWallet';
import type { LnurlSession } from '@arkade-os/lnurl-client';
import {
  getLnurlConfig,
  loadLightningAddress,
  openLightningAddressSession,
  registerLightningAddress,
} from '../lib/arkade/lightning';
import { errorMessage, formatBtc, formatSats } from '../lib/format';

function AdvancedItem({
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

export default function AdvancedSettingsScreen() {
  const {
    network,
    status,
    address,
    boardingAddress,
    balance,
    history,
    refresh,
  } = useWallet();

  const lnurl = getLnurlConfig();

  const [open, setOpen] = useState<string | null>('vtxos');
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
    <Screen>
      <View style={styles.header}>
        <Title>Avanzado</Title>
        <Badge label={network.isMainnet ? 'Mainnet' : 'Mutinynet'} />
      </View>

      <SectionLabel>Avanzado</SectionLabel>
      <View style={styles.group}>
        <AdvancedItem
          icon="🏦"
          label="Arkade Mint"
          value="No disponible"
          open={open === 'mint'}
          onToggle={() => toggle('mint')}
        >
          <Notice tone="info">
            Arkade Mint permite emitir y gestionar activos. CanoArk todavía no
            implementa esta función.
          </Notice>
        </AdvancedItem>

        <AdvancedItem
          icon="🔐"
          label="Passphrase"
          value="Gestionada en el desbloqueo"
          open={open === 'password'}
          onToggle={() => toggle('password')}
        >
          <Paragraph muted>
            La passphrase cifra la semilla en este dispositivo con
            expo-secure-store. No se puede cambiar desde aquí sin volver a
            respaldar la billetera.
          </Paragraph>
        </AdvancedItem>

        <AdvancedItem
          icon="◫"
          label="Coin control (VTXOs)"
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
                label="Boarding confirmado"
                value={`${formatSats(balance.boardingConfirmed)} sats`}
              />
              <Row
                label="Boarding sin confirmar"
                value={`${formatSats(balance.boardingUnconfirmed)} sats`}
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
        </AdvancedItem>

        <AdvancedItem
          icon="🧩"
          label="Contratos"
          value="Gated"
          open={open === 'contracts'}
          onToggle={() => toggle('contracts')}
        >
          <Paragraph muted>
            Los fondos en contratos (swaps y lockups) se muestran como saldo
            bloqueado o recuperable en Coin control.
          </Paragraph>
        </AdvancedItem>

        <AdvancedItem
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
        </AdvancedItem>

        <AdvancedItem
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
        </AdvancedItem>

        <AdvancedItem
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
        </AdvancedItem>

        <AdvancedItem
          icon="🔀"
          label="Solvers"
          value="Arkade swap"
          open={open === 'solvers'}
          onToggle={() => toggle('solvers')}
        >
          <Paragraph muted>
            Los pagos fuera de Arkade (Lightning u onchain) los ejecuta un
            solver mediante swaps. La comisión máxima se define al enviar.
          </Paragraph>
        </AdvancedItem>

        <AdvancedItem
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
                Deténla cuando no la necesites para ahorrar batería.
              </Paragraph>
            </>
          )}
        </AdvancedItem>
      </View>

      <Card title="Red y operador">
        <Row label="Dirección Arkade" value={address ?? '—'} mono />
        <Row label="Boarding" value={boardingAddress ?? '—'} mono />
      </Card>

      <Button
        title="Volver a configuración"
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
});
