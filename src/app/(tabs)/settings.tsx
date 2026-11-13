import { useState, type ReactNode } from 'react';
import { Alert, Linking, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
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
import { errorMessage } from '../../lib/format';

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

  const [open, setOpen] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);

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
          <Row label="Tema" value="Oscuro" />
          <Row label="Unidad de bitcoin" value="Sats" />
          <Row label="Vibración" value="Sistema" />
          <Paragraph muted>
            Tema oscuro fijo, optimizado para pantallas móviles y bajo consumo.
          </Paragraph>
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
          icon="🌐"
          label="Idioma"
          value="Español"
          open={open === 'language'}
          onToggle={() => toggle('language')}
        >
          <Paragraph muted>Idioma de la interfaz: español.</Paragraph>
        </SettingsItem>

        <SettingsItem
          icon="📝"
          label="Notas"
          value="No disponible"
          open={open === 'notes'}
          onToggle={() => toggle('notes')}
        >
          <Notice tone="info">
            Arkade Wallet permite canjear notas (notes). CanoArk todavía no
            implementa esta función; se añadirá en una próxima versión.
          </Notice>
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

        <MenuRow
          icon="🧩"
          label="Avanzado"
          value="Servidor, VTXOs, LNURL"
          onPress={() => router.push('/advanced')}
        />
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
            disabled={busy || status !== 'unlocked'}
          />
        </SettingsItem>
      </View>

      <Card title="Red y operador">
        <Row label="Dirección Arkade" value={address ?? '—'} mono />
        <Row label="Boarding" value={boardingAddress ?? '—'} mono />
        <Row
          label="Boarding pendiente"
          value={balance ? `${balance.boarding} sats` : '—'}
        />
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
