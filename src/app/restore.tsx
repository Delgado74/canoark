import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
} from '../components/ui';
import {
  OnboardingSuccess,
  SecuritySetup,
  StepHeader,
  passphraseStrength,
} from '../components/Onboarding';
import { colors, spacing } from '../constants/theme';
import { useWallet } from '../hooks/useWallet';
import {
  isValidMnemonic,
  MIN_PASSPHRASE_LENGTH,
  normalizeMnemonic,
} from '../lib/arkade/identity';
import type { WalletMode } from '../lib/arkade/walletMode';
import { errorMessage } from '../lib/format';

type Step = 1 | 2 | 3;

export default function RestoreWalletScreen() {
  const { status, busy, createWallet, biometricAvailable, address } =
    useWallet();

  const [step, setStep] = useState<Step>(1);
  const [imported, setImported] = useState('');
  const [touched, setTouched] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [passphraseConfirm, setPassphraseConfirm] = useState('');
  const [useBiometrics, setUseBiometrics] = useState(false);
  const [walletMode, setWalletMode] = useState<WalletMode>('static');
  const [localError, setLocalError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  if (status === 'unlocked' && !restoring && step !== 3)
    return <Redirect href="/(tabs)" />;
  if (status === 'locked') return <Redirect href="/unlock" />;

  const phrase = normalizeMnemonic(imported);
  const wordCount = phrase ? phrase.split(' ').length : 0;
  const valid = wordCount > 0 && isValidMnemonic(phrase);

  const phraseError = useMemo(() => {
    if (!touched || wordCount === 0) return null;
    if (wordCount !== 12 && wordCount !== 24) {
      return `Has escrito ${wordCount} palabras. Una frase BIP39 tiene 12 o 24.`;
    }
    if (!isValidMnemonic(phrase)) {
      return 'La última palabra no cuadra con la suma de comprobación. Revisa el orden y las palabras.';
    }
    return null;
  }, [touched, wordCount, phrase]);

  const paste = async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text) {
        setImported(text);
        setTouched(true);
        setLocalError(null);
      }
    } catch (error) {
      setLocalError(errorMessage(error));
    }
  };

  const next = () => {
    setTouched(true);
    setLocalError(null);
    if (!valid) {
      setLocalError(
        phraseError ??
          'La frase no es válida. Deben ser 12 o 24 palabras del diccionario BIP39.'
      );
      return;
    }
    setStep(2);
  };

  const submit = async () => {
    setLocalError(null);
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
    if (passphraseStrength(passphrase) === 'weak') {
      setLocalError(
        'Elige una passphrase más fuerte: añade longitud, mayúsculas, números o símbolos.'
      );
      return;
    }

    try {
      setRestoring(true);
      await createWallet({
        mnemonic: phrase,
        passphrase,
        useBiometrics: useBiometrics && biometricAvailable,
        walletMode,
      });
      setStep(3);
    } catch (error) {
      setRestoring(false);
      setLocalError(errorMessage(error));
    }
  };

  if (step === 3) {
    return (
      <Screen>
        <OnboardingSuccess
          title="Billetera restaurada"
          text="La sesión con el operador está abierta y el saldo se sincronizará en unos segundos. Si tenías direcciones antiguas, el SDK las vigila igualmente."
          address={address}
          onDone={() => router.replace('/(tabs)')}
          doneLabel="Ver mi billetera"
        />
        <Notice tone="warning">
          Comprueba que la red de esta compilación coincide con la red de la
          billetera que restauraste. Una frase en la red equivocada deriva otras
          claves.
        </Notice>
      </Screen>
    );
  }

  return (
    <Screen>
      <StepHeader
        title="Restaurar billetera"
        subtitle={
          step === 1
            ? 'Escribe o pega la frase de recuperación de 12 o 24 palabras.'
            : 'Elige una passphrase nueva para cifrar la billetera en este dispositivo.'
        }
        step={step}
        total={2}
        onBack={() => {
          setLocalError(null);
          if (step === 1) router.back();
          else setStep(1);
        }}
      />

      {localError ? <ErrorBanner message={localError} /> : null}

      {step === 1 ? (
        <>
          <Card
            title="Frase de recuperación"
            subtitle="Las palabras deben estar en orden y separadas por espacios."
          >
            <Field
              label="Frase"
              value={imported}
              onChangeText={value => {
                setImported(value);
                setLocalError(null);
                if (!touched) setTouched(true);
              }}
              placeholder="palabra1 palabra2 palabra3…"
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              numberOfLines={4}
            />
            <View style={styles.metaRow}>
              <Text
                style={[
                  styles.meta,
                  valid && styles.metaOk,
                  phraseError && styles.metaError,
                ]}
              >
                {wordCount === 0
                  ? 'Sin palabras todavía'
                  : `${wordCount} ${wordCount === 1 ? 'palabra' : 'palabras'}${
                      valid ? ' · válida' : ''
                    }`}
              </Text>
              <Pressable onPress={paste} style={styles.linkRow}>
                <Text style={styles.link}>Pegar</Text>
              </Pressable>
            </View>
            {phraseError ? (
              <Text style={styles.errorText}>{phraseError}</Text>
            ) : null}
            <Paragraph muted>
              Se aceptan frases BIP39 en inglés, que es el diccionario que usa el
              SDK. La frase no sale de este dispositivo.
            </Paragraph>
          </Card>
          <Button title="Continuar" onPress={next} />
        </>
      ) : null}

      {step === 2 ? (
        <>
          <SecuritySetup
            passphrase={passphrase}
            confirm={passphraseConfirm}
            onChangePassphrase={setPassphrase}
            onChangeConfirm={setPassphraseConfirm}
            useBiometrics={useBiometrics}
            onToggleBiometrics={() => setUseBiometrics(value => !value)}
            biometricAvailable={biometricAvailable}
            walletMode={walletMode}
            onChangeWalletMode={setWalletMode}
            allowWalletMode={false}
          />
          <Button
            title="Restaurar billetera"
            onPress={submit}
            loading={busy}
            disabled={passphrase.length < MIN_PASSPHRASE_LENGTH}
          />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  meta: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  metaOk: {
    color: colors.success,
  },
  metaError: {
    color: colors.danger,
  },
  errorText: {
    color: colors.danger,
    fontSize: 12,
    lineHeight: 17,
  },
  linkRow: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  link: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
});
