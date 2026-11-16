import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Badge,
  Button,
  Card,
  Field,
  Notice,
  Paragraph,
  Segmented,
} from './ui';
import { colors, spacing } from '../constants/theme';
import {
  MIN_PASSPHRASE_LENGTH,
  normalizeMnemonic,
} from '../lib/arkade/identity';
import type { WalletMode } from '../lib/arkade/walletMode';

/* ------------------------------------------------------------------ */
/* Cabecera de paso                                                    */
/* ------------------------------------------------------------------ */

export function StepHeader({
  title,
  subtitle,
  step,
  total,
  onBack,
}: {
  title: string;
  subtitle?: string;
  step?: number;
  total?: number;
  onBack?: () => void;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        {onBack ? (
          <Pressable onPress={onBack} style={styles.back} accessibilityRole="button">
            <Text style={styles.backText}>‹ Atrás</Text>
          </Pressable>
        ) : (
          <View />
        )}
        {step && total ? (
          <Badge label={`Paso ${step} de ${total}`} tone="neutral" />
        ) : null}
      </View>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Semilla                                                             */
/* ------------------------------------------------------------------ */

export function SeedGrid({ words }: { words: string[] }) {
  return (
    <View style={styles.words}>
      {words.map((word, index) => (
        <View key={`${word}-${index}`} style={styles.word}>
          <Text style={styles.wordIndex}>{index + 1}</Text>
          <Text style={styles.wordText}>{word}</Text>
        </View>
      ))}
    </View>
  );
}

/** Tres posiciones aleatorias y estables para el paso de verificación. */
export function pickSeedIndexes(wordCount: number, seed: string): number[] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const chosen = new Set<number>();
  const positions = [0, 1, 2];
  for (const offset of positions) {
    const index = (hash + offset * 7 + offset * offset * 13) % wordCount;
    let candidate = index;
    while (chosen.has(candidate)) candidate = (candidate + 1) % wordCount;
    chosen.add(candidate);
    hash = (hash * 17 + candidate + 3) >>> 0;
  }
  return Array.from(chosen).sort((a, b) => a - b);
}

export function SeedVerification({
  words,
  indexes,
  answers,
  onChange,
}: {
  words: string[];
  indexes: number[];
  answers: Record<number, string>;
  onChange: (index: number, value: string) => void;
}) {
  return (
    <View style={styles.verify}>
      <Paragraph muted>
        Escribe las palabras que faltan para confirmar que guardaste la frase.
      </Paragraph>
      {indexes.map(index => (
        <Field
          key={index}
          label={`Palabra #${index + 1}`}
          value={answers[index] ?? ''}
          onChangeText={value => onChange(index, value)}
          placeholder={`Escribe la palabra ${index + 1}`}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
        />
      ))}
    </View>
  );
}

export function verifySeedAnswers(
  words: string[],
  indexes: number[],
  answers: Record<number, string>
): boolean {
  return indexes.every(
    index =>
      normalizeMnemonic(answers[index] ?? '').replace(/\s+/g, ' ') ===
      normalizeMnemonic(words[index] ?? '')
  );
}

/* ------------------------------------------------------------------ */
/* Seguridad                                                           */
/* ------------------------------------------------------------------ */

export type PassphraseStrength = 'weak' | 'fair' | 'strong';

export function passphraseStrength(value: string): PassphraseStrength {
  if (value.length < MIN_PASSPHRASE_LENGTH) return 'weak';
  const classes =
    (/[a-z]/.test(value) ? 1 : 0) +
    (/[A-Z]/.test(value) ? 1 : 0) +
    (/[0-9]/.test(value) ? 1 : 0) +
    (/[^A-Za-z0-9]/.test(value) ? 1 : 0);
  if (value.length >= 14 && classes >= 3) return 'strong';
  if (value.length >= 10 && classes >= 2) return 'fair';
  return 'weak';
}

const strengthLabel: Record<PassphraseStrength, string> = {
  weak: 'Débil',
  fair: 'Aceptable',
  strong: 'Fuerte',
};

const strengthColor: Record<PassphraseStrength, string> = {
  weak: colors.danger,
  fair: colors.warning,
  strong: colors.success,
};

export function PassphraseStrengthBar({ value }: { value: string }) {
  if (!value) return null;
  const level = passphraseStrength(value);
  return (
    <View style={styles.strengthRow}>
      <View style={styles.strengthTrack}>
        <View
          style={[
            styles.strengthFill,
            {
              width:
                level === 'weak' ? '33%' : level === 'fair' ? '66%' : '100%',
              backgroundColor: strengthColor[level],
            },
          ]}
        />
      </View>
      <Text style={[styles.strengthText, { color: strengthColor[level] }]}>
        {strengthLabel[level]}
      </Text>
    </View>
  );
}

const strengthTip: Record<PassphraseStrength, string> = {
  weak: `Usa al menos ${MIN_PASSPHRASE_LENGTH} caracteres. Mejor si mezclas mayúsculas, números y símbolos.`,
  fair: 'Puedes mejorarla añadiendo más longitud o símbolos.',
  strong: 'Buena passphrase: larga y con varios tipos de carácter.',
};

export function SecuritySetup({
  passphrase,
  confirm,
  onChangePassphrase,
  onChangeConfirm,
  useBiometrics,
  onToggleBiometrics,
  biometricAvailable,
  walletMode,
  onChangeWalletMode,
  allowWalletMode = true,
}: {
  passphrase: string;
  confirm: string;
  onChangePassphrase: (value: string) => void;
  onChangeConfirm: (value: string) => void;
  useBiometrics: boolean;
  onToggleBiometrics: () => void;
  biometricAvailable: boolean;
  walletMode: WalletMode;
  onChangeWalletMode: (mode: WalletMode) => void;
  allowWalletMode?: boolean;
}) {
  const level = passphraseStrength(passphrase);
  return (
    <>
      <Card
        title="Passphrase de desbloqueo"
        subtitle="Cifra la frase de recuperación en este dispositivo. No se guarda en claro."
      >
        <Field
          label="Passphrase"
          value={passphrase}
          onChangeText={onChangePassphrase}
          placeholder={`Mínimo ${MIN_PASSPHRASE_LENGTH} caracteres`}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
        />
        <PassphraseStrengthBar value={passphrase} />
        {passphrase ? (
          <Text style={styles.tip}>{strengthTip[level]}</Text>
        ) : null}
        <Field
          label="Confirmar passphrase"
          value={confirm}
          onChangeText={onChangeConfirm}
          placeholder="Repite la passphrase"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
        />
        {confirm && confirm !== passphrase ? (
          <Text style={styles.mismatch}>Las passphrases no coinciden.</Text>
        ) : null}
        <Paragraph muted>
          Si la olvidas, necesitarás la frase de recuperación para volver a
          entrar. No hay recuperación de la passphrase.
        </Paragraph>
      </Card>

      {allowWalletMode ? (
        <Card
          title="Direcciones de recepción"
          subtitle="Cómo deriva el SDK tus direcciones Arkade."
        >
          <Segmented
            value={walletMode}
            onChange={onChangeWalletMode}
            options={[
              { value: 'hd', label: 'Rotativas (HD)' },
              { value: 'static', label: 'Estática' },
            ]}
          />
          <Paragraph muted>
            {walletMode === 'hd'
              ? 'Recomendado. Cada recepción puede usar una dirección nueva; el SDK sigue vigilando las anteriores. Reduce la reutilización de direcciones.'
              : 'Una sola dirección para siempre. Más simple de compartir, pero reutiliza la misma dirección en cada cobro.'}
          </Paragraph>
          <Notice tone="info">
            Puedes cambiarlo después en Configuración → Seguridad. Las
            direcciones antiguas siguen siendo válidas.
          </Notice>
        </Card>
      ) : null}

      {biometricAvailable ? (
        <Pressable
          onPress={onToggleBiometrics}
          style={styles.checkRow}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: useBiometrics }}
        >
          <View style={[styles.checkbox, useBiometrics && styles.checkboxChecked]}>
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
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Éxito                                                               */
/* ------------------------------------------------------------------ */

export function OnboardingSuccess({
  title,
  text,
  address,
  onDone,
  doneLabel = 'Ir a la billetera',
}: {
  title: string;
  text: string;
  address?: string | null;
  onDone: () => void;
  doneLabel?: string;
}) {
  return (
    <>
      <View style={styles.success}>
        <View style={styles.successIcon}>
          <Text style={styles.successMark}>✓</Text>
        </View>
        <Text style={styles.successTitle}>{title}</Text>
        <Text style={styles.successText}>{text}</Text>
      </View>
      {address ? (
        <Card title="Tu dirección Arkade" subtitle="Ya puedes recibir sats.">
          <Text style={styles.address} selectable>
            {address}
          </Text>
        </Card>
      ) : null}
      <Button title={doneLabel} onPress={onDone} />
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.xs,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 28,
  },
  back: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  backText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
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
  verify: {
    gap: spacing.md,
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
  strengthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  strengthTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  strengthFill: {
    height: '100%',
    borderRadius: 3,
  },
  strengthText: {
    fontSize: 12,
    fontWeight: '700',
    minWidth: 64,
    textAlign: 'right',
  },
  tip: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  mismatch: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '600',
  },
  success: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xl,
  },
  successIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(60, 203, 127, 0.14)',
    borderWidth: 1,
    borderColor: colors.success,
  },
  successMark: {
    color: colors.success,
    fontSize: 42,
    fontWeight: '800',
  },
  successTitle: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
  },
  successText: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    maxWidth: 340,
  },
  address: {
    color: colors.text,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },
});
