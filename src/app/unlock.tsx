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
  const { status, busy, unlock, wipe, network, error, requiresPassphrase } =
    useWallet();
  const [localError, setLocalError] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState('');

  if (status === 'unlocked') return <Redirect href="/(tabs)" />;
  if (status === 'empty') return <Redirect href="/onboarding" />;

  const onUnlock = async () => {
    setLocalError(null);
    if (requiresPassphrase && passphrase.length < 6) {
      setLocalError('La passphrase debe tener al menos 6 caracteres.');
      return;
    }
    try {
      await unlock(
        requiresPassphrase ? { passphrase } : undefined
      );
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
          {requiresPassphrase
            ? 'Esta billetera está protegida con passphrase. Ingrésala para desbloquear.'
            : 'La frase de recuperación está cifrada por Android Keystore. Si hay biometría configurada, se pedirá huella o rostro.'}
        </Paragraph>
        {requiresPassphrase ? (
          <Field
            label="Passphrase"
            value={passphrase}
            onChangeText={setPassphrase}
            placeholder="Tu passphrase"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
        ) : null}
        {localError ? <ErrorBanner message={localError} /> : null}
        {!localError && error ? <ErrorBanner message={error} /> : null}
        <Button title="Desbloquear" onPress={onUnlock} loading={busy} />
        <Button
          title="Eliminar billetera de este dispositivo"
          variant="danger"
          onPress={onWipe}
          disabled={busy}
        />
      </Card>

      <Notice tone="info">
        {requiresPassphrase
          ? 'La passphrase no se puede recuperar. Si la pierdes, deberás importar la frase de recuperación en una instalación limpia.'
          : 'Si cambiaron las huellas del dispositivo, Android Keystore puede invalidar la clave. En ese caso hay que importar de nuevo la frase en una instalación limpia.'}
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
