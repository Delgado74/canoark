import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import {
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
import {
  isValidMnemonic,
  MIN_PASSPHRASE_LENGTH,
  normalizeMnemonic,
} from '../lib/arkade/identity';
import { errorMessage } from '../lib/format';

export default function RestoreWalletScreen() {
  const { status, busy, createWallet, biometricAvailable } = useWallet();
  const [imported, setImported] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [passphraseConfirm, setPassphraseConfirm] = useState('');
  const [useBiometrics, setUseBiometrics] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  if (status === 'unlocked') return <Redirect href="/(tabs)" />;
  if (status === 'locked') return <Redirect href="/unlock" />;

  const submit = async () => {
    setLocalError(null);
    const phrase = normalizeMnemonic(imported);

    if (!isValidMnemonic(phrase)) {
      setLocalError(
        'La frase no es válida. Deben ser 12 o 24 palabras del diccionario BIP39.'
      );
      return;
    }
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
      setLocalError(
        `La passphrase debe tener al menos ${MIN_PASSPHRASE_LENGTH} caracteres.`
      );
      return;
    }
    if (passphrase !== passphraseConfirm) {
      setLocalError('La passphrase y su confirmación no coinciden.');
      return;
    }

    try {
      await createWallet({
        mnemonic: phrase,
        passphrase,
        useBiometrics: useBiometrics && biometricAvailable,
      });
      router.replace('/(tabs)');
    } catch (error) {
      setLocalError(errorMessage(error));
    }
  };

  return (
    <Screen>
      <Title>Restaurar billetera</Title>

      {localError ? <ErrorBanner message={localError} /> : null}

      <Card
        title="Frase de recuperación"
        subtitle="Escribe las 12 o 24 palabras separadas por espacios."
      >
        <Field
          label="Frase"
          value={imported}
          onChangeText={setImported}
          placeholder="palabra1 palabra2 palabra3…"
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          numberOfLines={4}
        />
      </Card>

      <Card
        title="Passphrase de desbloqueo"
        subtitle="Protege el acceso a la billetera en este dispositivo."
      >
        <Field
          label="Passphrase"
          value={passphrase}
          onChangeText={setPassphrase}
          placeholder={`Mínimo ${MIN_PASSPHRASE_LENGTH} caracteres`}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
        />
        <Field
          label="Confirmar passphrase"
          value={passphraseConfirm}
          onChangeText={setPassphraseConfirm}
          placeholder="Repite la passphrase"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
        />
        <Paragraph muted>
          Si la olvidas, necesitarás volver a importar la frase de recuperación.
        </Paragraph>
      </Card>

      {biometricAvailable ? (
        <Pressable
          onPress={() => setUseBiometrics(value => !value)}
          style={styles.checkRow}
        >
          <View
            style={[styles.checkbox, useBiometrics && styles.checkboxChecked]}
          >
            <Text style={styles.checkboxMark}>{useBiometrics ? '✓' : ''}</Text>
          </View>
          <Text style={styles.checkLabel}>
            Desbloquear también con huella o rostro en este dispositivo.
          </Text>
        </Pressable>
      ) : (
        <Notice tone="info">
          Este dispositivo no ofrece biometría compatible con SecureStore. Usarás
          tu passphrase para desbloquear.
        </Notice>
      )}

      <Button
        title="Restaurar billetera"
        onPress={submit}
        loading={busy}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkboxMark: {
    color: colors.primaryText,
    fontSize: 14,
    fontWeight: '800',
  },
  checkLabel: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
});
