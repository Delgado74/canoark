import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  Field,
  Notice,
  Paragraph,
  Screen,
  Title,
} from '../components/ui';
import { colors, spacing } from '../constants/theme';
import { useWallet } from '../hooks/useWallet';
import { errorMessage } from '../lib/format';

export default function UnlockScreen() {
  const {
    status,
    busy,
    unlock,
    wipe,
    network,
    error,
    biometricAvailable,
    biometricEnabled,
  } = useWallet();
  const [localError, setLocalError] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState('');

  if (status === 'unlocked') return <Redirect href="/(tabs)" />;
  if (status === 'empty') return <Redirect href="/onboarding" />;

  const onUnlockWithPassphrase = async () => {
    setLocalError(null);
    if (!passphrase) {
      setLocalError('Escribe tu passphrase para desbloquear.');
      return;
    }
    try {
      await unlock({ passphrase });
      router.replace('/(tabs)');
    } catch (err) {
      setLocalError(errorMessage(err));
    }
  };

  const onUnlockWithBiometrics = async () => {
    setLocalError(null);
    try {
      await unlock({ useBiometrics: true });
      router.replace('/(tabs)');
    } catch (err) {
      setLocalError(errorMessage(err));
    }
  };

  const onWipe = () => {
    Alert.alert(
      'Eliminar billetera',
      'Se borrarán la frase y las bases de datos locales de este dispositivo. Sin la frase de recuperación, los fondos se pierden. ¿Continuar?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await wipe();
              } catch (err) {
                setLocalError(errorMessage(err));
              }
            })();
          },
        },
      ]
    );
  };

  const canUseBiometricsButton = biometricAvailable && biometricEnabled;

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <Text style={styles.logo}>◈</Text>
          <Title>CanoArk</Title>
        </View>
        <Badge label={network.label} tone="primary" />
      </View>

      <Card
        title="Billetera bloqueada"
        subtitle="Desbloquea para abrir la sesión con el operador de Arkade."
      >
        <Text style={styles.lockIcon}>🔒</Text>
        <Paragraph muted>
          Tu frase está cifrada con tu passphrase. Se descifra solo en este
          dispositivo y nunca se guarda en texto plano.
        </Paragraph>
        {localError ? <ErrorBanner message={localError} /> : null}
        {!localError && error ? <ErrorBanner message={error} /> : null}

        <Field
          label="Passphrase"
          value={passphrase}
          onChangeText={setPassphrase}
          placeholder="Tu passphrase de desbloqueo"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
        />
        <Button
          title="Desbloquear"
          onPress={onUnlockWithPassphrase}
          loading={busy}
        />
        {canUseBiometricsButton ? (
          <Button
            title="Desbloquear con huella"
            variant="secondary"
            onPress={onUnlockWithBiometrics}
            disabled={busy}
          />
        ) : null}
        <Button
          title="Eliminar billetera de este dispositivo"
          variant="danger"
          onPress={onWipe}
          disabled={busy}
        />
      </Card>

      {!biometricAvailable ? (
        <Notice tone="info">
          Este dispositivo no ofrece biometría compatible con el almacenamiento
          seguro, así que el desbloqueo siempre usa la passphrase. Es el
          comportamiento esperado en Android 10.
        </Notice>
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
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  logo: {
    color: colors.primary,
    fontSize: 26,
  },
  lockIcon: {
    fontSize: 34,
    textAlign: 'center',
    paddingVertical: spacing.sm,
  },
});
