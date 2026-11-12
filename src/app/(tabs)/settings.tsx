import { Alert, Linking, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import {
  Badge,
  Button,
  Card,
  CopyField,
  ErrorBanner,
  Notice,
  Paragraph,
  Row,
  Screen,
  Title,
} from '../../components/ui';
import { colors, spacing } from '../../constants/theme';
import { useWallet } from '../../hooks/useWallet';
import { getLnurlConfig } from '../../lib/arkade/lightning';
import { errorMessage, formatBtc, formatSats } from '../../lib/format';

export default function SettingsScreen() {
  const {
    network,
    address,
    boardingAddress,
    balance,
    refresh,
    refreshing,
    lock,
    wipe,
    busy,
    error,
  } = useWallet();

  const version = Constants.expoConfig?.version ?? '0.1.0';
  const lnurl = getLnurlConfig();

  const confirmLock = () => {
    void lock();
  };

  const confirmWipe = () => {
    Alert.alert(
      'Borrar billetera',
      'Se eliminan la frase cifrada, la sesión y las bases de datos locales. Si no guardaste la frase de recuperación, los fondos se pierden para siempre.',
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

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <View style={styles.header}>
        <Title>Ajustes</Title>
        <Badge label={`v${version}`} tone="neutral" />
      </View>

      {error ? <ErrorBanner message={error} /> : null}

      <Card title="Red y operador">
        <Row label="Red" value={network.label} />
        <Row label="Dinero real" value={network.isMainnet ? 'Sí' : 'No'} />
        <Row label="Dirección" value={address ?? '—'} mono />
        <Row label="Boarding" value={boardingAddress ?? '—'} mono />
        <Button
          title="Abrir explorador"
          variant="secondary"
          onPress={() => {
            void Linking.openURL(network.explorerUrl);
          }}
        />
      </Card>

      <Card title="Endpoints">
        <Row label="Operator" value={network.operatorUrl} mono />
        <Row label="Indexer" value={network.indexerUrl} mono />
        <Row label="Asset swap" value={network.swapNetwork} />
        <Paragraph muted>
          Los endpoints se fijan al compilar. Cambiar de red requiere una nueva
          compilación con EXPO_PUBLIC_ARKADE_NETWORK.
        </Paragraph>
      </Card>

      <Card title="Balance">
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
              label="Boarding"
              value={`${formatSats(balance.boarding)} sats`}
            />
            <Row label="Total ≈" value={`${formatBtc(balance.available)} BTC`} />
          </>
        ) : (
          <Text style={styles.muted}>Sincroniza para ver el balance.</Text>
        )}
        <Button
          title="Sincronizar ahora"
          onPress={() => {
            void refresh();
          }}
          loading={refreshing}
        />
      </Card>

      <Card title="Lightning Address">
        <Row
          label="Servidor LNURL"
          value={lnurl ? lnurl.baseUrl : 'No configurado'}
          mono
        />
        <Row
          label="Estado"
          value={lnurl ? 'Disponible' : 'Solo Lightning vía solver'}
        />
        <Paragraph muted>
          {lnurl
            ? 'Registra un nombre en la pestaña Recibir para cobrar con la app cerrada.'
            : 'Sin servidor LNURL la app sigue pudiendo pagar y cobrar con facturas mientras está abierta.'}
        </Paragraph>
      </Card>

      <Card title="Seguridad">
        <Paragraph muted>
          La frase de recuperación se guarda en expo-secure-store, respaldado
          por Android Keystore. Si el dispositivo tiene biometría, se exige
          huella o rostro para leerla.
        </Paragraph>
        <Notice tone="info">
          La billetera se bloquea sola tras 2 minutos en segundo plano. Los
          outputs virtuales se renuevan mientras la app está abierta; al
          reabrirla conviene sincronizar.
        </Notice>
        <Button title="Bloquear ahora" variant="secondary" onPress={confirmLock} />
      </Card>

      <Card title="Zona de peligro">
        <Paragraph muted>
          Esta acción borra todos los datos locales de CanoArk en este
          dispositivo. No afecta a los fondos que sigan en Arkade si conservas
          la frase de recuperación.
        </Paragraph>
        <Button
          title="Borrar billetera de este dispositivo"
          variant="danger"
          onPress={confirmWipe}
          disabled={busy}
        />
      </Card>

      <Notice tone="warning">
        CanoArk es software experimental. En Mutinynet usa bitcoin de prueba. En
        mainnet, verifica direcciones y comisiones antes de mover fondos.
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
  muted: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
});
