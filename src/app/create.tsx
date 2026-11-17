import { useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Redirect, router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  Notice,
  Paragraph,
  Screen,
  SectionLabel,
} from '../components/ui';
import {
  OnboardingSuccess,
  SecuritySetup,
  SeedGrid,
  SeedVerification,
  StepHeader,
  passphraseStrength,
  pickSeedIndexes,
  verifySeedAnswers,
} from '../components/Onboarding';
import { colors, spacing } from '../constants/theme';
import { useWallet } from '../hooks/useWallet';
import {
  generateWalletMnemonic,
  MIN_PASSPHRASE_LENGTH,
} from '../lib/arkade/identity';
import type { WalletMode } from '../lib/arkade/walletMode';
import { errorMessage } from '../lib/format';

type Step = 1 | 2 | 3 | 4;

export default function CreateWalletScreen() {
  const { status, busy, createWallet, biometricAvailable, address } =
    useWallet();

  const [step, setStep] = useState<Step>(1);
  const [mnemonic, setMnemonic] = useState(() => generateWalletMnemonic());
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [passphrase, setPassphrase] = useState('');
  const [passphraseConfirm, setPassphraseConfirm] = useState('');
  const [useBiometrics, setUseBiometrics] = useState(false);
  const [walletMode, setWalletMode] = useState<WalletMode>('static');
  const [localError, setLocalError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  if (status === 'unlocked' && !creating && step !== 4)
    return <Redirect href="/(tabs)" />;
  if (status === 'locked') return <Redirect href="/unlock" />;

  const words = useMemo(() => mnemonic.split(' '), [mnemonic]);
  const indexes = useMemo(
    () => pickSeedIndexes(words.length, mnemonic),
    [words.length, mnemonic]
  );

  const regenerate = () => {
    setMnemonic(generateWalletMnemonic());
    setAnswers({});
    setLocalError(null);
    setStep(1);
  };

  const copyPhrase = async () => {
    await Clipboard.setStringAsync(mnemonic);
    Alert.alert(
      'Frase copiada',
      'No la pegues en chats ni la guardes en la nube. Guárdala offline.'
    );
  };

  const nextFromSeed = () => {
    setLocalError(null);
    setStep(2);
  };

  const nextFromVerify = () => {
    setLocalError(null);
    if (!verifySeedAnswers(words, indexes, answers)) {
      setLocalError(
        'Alguna palabra no coincide. Revisa la frase y vuelve a intentarlo.'
      );
      return;
    }
    setStep(3);
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
      setCreating(true);
      await createWallet({
        mnemonic,
        passphrase,
        useBiometrics: useBiometrics && biometricAvailable,
        walletMode,
      });
      setStep(4);
    } catch (error) {
      setCreating(false);
      setLocalError(errorMessage(error));
    }
  };

  const back = () => {
    setLocalError(null);
    if (step === 1) {
      router.back();
      return;
    }
    if (step === 2) setStep(1);
    else if (step === 3) setStep(2);
  };

  if (step === 4) {
    return (
      <Screen>
        <OnboardingSuccess
          title="Billetera creada"
          text={
            walletMode === 'hd'
              ? 'Tu billetera usa direcciones rotativas. Guarda la frase de recuperación: es la única copia de tus llaves.'
              : 'Tu billetera está lista con una dirección estática. Guarda la frase de recuperación: es la única copia de tus llaves.'
          }
          address={address}
          onDone={() => router.replace('/(tabs)')}
        />
        <Notice tone="warning">
          La passphrase protege este dispositivo, pero no sustituye a la frase de
          recuperación. Si pierdes ambas, pierdes los fondos.
        </Notice>
      </Screen>
    );
  }

  return (
    <Screen>
      <StepHeader
        title="Nueva billetera"
        subtitle={
          step === 1
            ? 'Anota estas 12 palabras. Son la única forma de recuperar tus fondos.'
            : step === 2
              ? 'Verifica que la copia es correcta antes de continuar.'
              : 'Protege la billetera en este dispositivo y elige cómo recibir.'
        }
        step={step}
        total={3}
        onBack={back}
      />

      {localError ? <ErrorBanner message={localError} /> : null}

      {step === 1 ? (
        <>
          <Card>
            <View style={styles.revealHeader}>
              <SectionLabel>Frase de recuperación</SectionLabel>
              <Badge label="12 palabras" tone="primary" />
            </View>
            <SeedGrid words={words} />
            <View style={styles.inlineButtons}>
              <Button title="Copiar" variant="secondary" onPress={copyPhrase} />
              <Button
                title="Generar otra"
                variant="ghost"
                onPress={regenerate}
              />
            </View>
          </Card>

          <Notice tone="danger">
            Cualquiera con esta frase puede gastar tus fondos. No la escribas en
            capturas de pantalla ni en gestores de contraseñas sin cifrado.
          </Notice>

          <Button title="He anotado la frase" onPress={nextFromSeed} />
        </>
      ) : null}

      {step === 2 ? (
        <>
          <Card title="Confirmación" subtitle="Tres palabras al azar de tu frase.">
            <SeedVerification
              words={words}
              indexes={indexes}
              answers={answers}
              onChange={(index, value) =>
                setAnswers(previous => ({ ...previous, [index]: value }))
              }
            />
          </Card>
          <Pressable onPress={() => setStep(1)} style={styles.linkRow}>
            <Text style={styles.link}>Ver la frase otra vez</Text>
          </Pressable>
          <Button title="Continuar" onPress={nextFromVerify} />
        </>
      ) : null}

      {step === 3 ? (
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
            title="Crear billetera"
            onPress={submit}
            loading={busy}
            disabled={passphrase.length < MIN_PASSPHRASE_LENGTH}
          />
          <Paragraph muted>
            Al crear la billetera se abre una sesión con el operador de Arkade y
            se prepara una dirección de recepción estática.
          </Paragraph>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  revealHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  inlineButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  linkRow: {
    alignSelf: 'center',
    paddingVertical: spacing.xs,
  },
  link: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
});
