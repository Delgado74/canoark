import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
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
  generateWalletMnemonic,
  MIN_PASSPHRASE_LENGTH,
} from '../lib/arkade/identity';
import { errorMessage } from '../lib/format';

export default function CreateWalletScreen() {
  const { status, busy, createWallet, biometricAvailable } = useWallet();
  const [mnemonic, setMnemonic] = useState(() => generateWalletMnemonic());
  const [confirmed, setConfirmed] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [passphraseConfirm, setPassphraseConfirm] = useState('');
  const [useBiometrics, setUseBiometrics] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  if (status === 'unlocked') return <Redirect href="/(tabs)" />;
  if (status === 'locked') return <Redirect href="/unlock" />;

  const words = mnemonic.split(' ');

  const submit = async () => {
    setLocalError(null);
    if (!confirmed) {
      setLocalError('Confirma que guardaste la frase antes de continuar.');
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
        mnemonic,
        passphrase,
        useBiometrics: useBiometrics && biometricAvailable,
      });
      router.replace('/(tabs)');
    } catch (error) {
      setLocalError(errorMessage(error));
    }
  };

  const copyPhrase = async () => {
    await Clipboard.setStringAsync(mnemonic);
    Alert.alert(
      'Frase copiada',
      'No la pegues en chats. Guárdala offline en un lugar seguro.'
    );
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Title>Nueva billetera</Title>
        <Text style={styles.step}>1 de 1</Text>
      </View>

      {localError ? <ErrorBanner message={localError} /> : null}

      <Card
        title="Tu frase de recuperación"
        subtitle="Anota estas 12 palabras en papel. Son la única forma de recuperar tus fondos."
      >
        <View style={styles.words}>
          {words.map((word, index) => (
            <View key={`${word}-${index}`} style={styles.word}>
              <Text style={styles.wordIndex}>{index + 1}</Text>
              <Text style={styles.wordText}>{word}</Text>
            </View>
          ))}
        </View>
        <View style={styles.inlineButtons}>
          <Button
            title="Copiar"
            variant="secondary"
            onPress={copyPhrase}
          />
          <Button
            title="Generar otra"
            variant="ghost"
            onPress={() => {
              setMnemonic(generateWalletMnemonic());
              setConfirmed(false);
            }}
          />
        </View>
      </Card>

      <Pressable
        onPress={() => setConfirmed(value => !value)}
        style={styles.checkRow}
      >
        <View style={[styles.checkbox, confirmed && styles.checkboxChecked]}>
          <Text style={styles.checkboxMark}>{confirmed ? '✓' : ''}</Text>
        </View>
        <Text style={styles.checkLabel}>
          Guardé la frase en un lugar seguro y entiendo que sin ella no puedo
          recuperar la billetera.
        </Text>
      </Pressable>

      <Card
        title="Passphrase de desbloqueo"
        subtitle="Cifra tu frase en este dispositivo y protege el acceso a la app."
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
        title="Crear billetera"
        onPress={submit}
        loading={busy}
        disabled={!confirmed}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  step: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  words: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
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
  inlineButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
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
