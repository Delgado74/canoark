import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
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
import {
  generateWalletMnemonic,
  isValidMnemonic,
  normalizeMnemonic,
} from '../lib/arkade/identity';
import { errorMessage } from '../lib/format';

type Mode = 'create' | 'import';

export default function OnboardingScreen() {
  const { status, busy, createWallet } = useWallet();
  const [mode, setMode] = useState<Mode>('create');
  const [mnemonic] = useState(() => generateWalletMnemonic());
  const [imported, setImported] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  if (status === 'unlocked') return <Redirect href="/(tabs)" />;
  if (status === 'locked') return <Redirect href="/unlock" />;

  const words = mnemonic.split(' ');

  const submit = async () => {
    setLocalError(null);
    const phrase = mode === 'create' ? mnemonic : normalizeMnemonic(imported);

    if (!isValidMnemonic(phrase)) {
      setLocalError(
        'La frase no es válida. Deben ser 12 o 24 palabras del diccionario BIP39.'
      );
      return;
    }
    if (mode === 'create' && !confirmed) {
      setLocalError('Confirma que guardaste la frase antes de continuar.');
      return;
    }

    try {
      await createWallet(phrase);
      router.replace('/(tabs)');
    } catch (error) {
      setLocalError(errorMessage(error));
    }
  };

  const copyPhrase = async () => {
    await Clipboard.setStringAsync(mnemonic);
    Alert.alert(
      'Frase copiada',
      'No la pegues en chats ni la dejes en el portapapeles. Guárdala offline.'
    );
  };

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <Text style={styles.logo}>◈</Text>
          <Title>CanoArk</Title>
        </View>
        <Badge
          label={status === 'empty' ? 'Billetera nueva' : 'Configuración'}
          tone="primary"
        />
      </View>

      <Paragraph muted>
        Una billetera Arkade para Android. Tus llaves se generan en el
        dispositivo; nadie más las tiene.
      </Paragraph>

      <View style={styles.segment}>
        <SegmentButton
          label="Crear"
          active={mode === 'create'}
          onPress={() => {
            setMode('create');
            setLocalError(null);
          }}
        />
        <SegmentButton
          label="Importar"
          active={mode === 'import'}
          onPress={() => {
            setMode('import');
            setLocalError(null);
          }}
        />
      </View>

      {localError ? <ErrorBanner message={localError} /> : null}

      {mode === 'create' ? (
        <>
          <Card
            title="Tu frase de recuperación"
            subtitle="12 palabras. Es la única forma de recuperar tus fondos."
          >
            <View style={styles.words}>
              {words.map((word, index) => (
                <View key={`${word}-${index}`} style={styles.word}>
                  <Text style={styles.wordIndex}>{index + 1}</Text>
                  <Text style={styles.wordText}>{word}</Text>
                </View>
              ))}
            </View>
            <Button
              title="Copiar frase"
              variant="secondary"
              onPress={copyPhrase}
            />
          </Card>

          <Notice tone="danger">
            Quien tenga esta frase puede gastar tus fondos. No la compartas, no
            la fotografíes y no la guardes en la nube.
          </Notice>

          <PressableCheck
            checked={confirmed}
            onPress={() => setConfirmed(value => !value)}
            label="Guardé la frase en un lugar seguro y entiendo que sin ella no puedo recuperar la billetera."
          />

          <Button
            title="Crear billetera"
            onPress={submit}
            loading={busy}
            disabled={!confirmed}
          />
        </>
      ) : (
        <>
          <Card
            title="Recuperar billetera"
            subtitle="Escribe la frase de 12 o 24 palabras separadas por espacios."
          >
            <Field
              label="Frase de recuperación"
              value={imported}
              onChangeText={setImported}
              placeholder="palabra1 palabra2 palabra3…"
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              numberOfLines={4}
            />
            <Button
              title="Importar billetera"
              onPress={submit}
              loading={busy}
            />
          </Card>

          <Notice tone="info">
            Al importar, CanoArk solo guarda la frase en el almacenamiento
            seguro del dispositivo. La red se elige al compilar la app.
          </Notice>
        </>
      )}

      <Notice tone="info">
        Si el dispositivo tiene biometría, Android Keystore pedirá huella o
        rostro para leer la mnemónica al desbloquear. La frase nunca se guarda
        en texto plano.
      </Notice>
    </Screen>
  );
}

function SegmentButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Text
      onPress={onPress}
      style={[styles.segmentButton, active && styles.segmentButtonActive]}
    >
      {label}
    </Text>
  );
}

function PressableCheck({
  checked,
  onPress,
  label,
}: {
  checked: boolean;
  onPress: () => void;
  label: string;
}) {
  return (
    <Pressable onPress={onPress} style={styles.checkRow}>
      <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
        <Text
          style={[
            styles.checkboxMark,
            checked && styles.checkboxMarkChecked,
          ]}
        >
          {checked ? '✓' : ''}
        </Text>
      </View>
      <Text style={styles.checkLabel}>{label}</Text>
    </Pressable>
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
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 4,
    gap: 4,
  },
  segmentButton: {
    flex: 1,
    textAlign: 'center',
    color: colors.textMuted,
    fontWeight: '700',
    paddingVertical: 10,
    borderRadius: 9,
    overflow: 'hidden',
  },
  segmentButtonActive: {
    backgroundColor: colors.surfaceAlt,
    color: colors.text,
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
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
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
  checkboxMarkChecked: {
    color: colors.primaryText,
  },
  checkLabel: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
});
