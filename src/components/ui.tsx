import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { colors, radius, spacing } from '../constants/theme';

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

export function Screen({
  children,
  scroll = true,
  refreshing = false,
  onRefresh,
}: {
  children: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const content = <View style={styles.content}>{children}</View>;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.primary}
                colors={[colors.primary]}
              />
            ) : undefined
          }
        >
          {content}
        </ScrollView>
      ) : (
        content
      )}
    </SafeAreaView>
  );
}

export function Card({
  title,
  subtitle,
  children,
  tone = 'surface',
}: {
  title?: string;
  subtitle?: string;
  children?: ReactNode;
  tone?: 'surface' | 'alt';
}) {
  return (
    <View style={[styles.card, tone === 'alt' && styles.cardAlt]}>
      {title ? <Text style={styles.cardTitle}>{title}</Text> : null}
      {subtitle ? <Text style={styles.cardSubtitle}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

export function Title({ children }: { children: ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Paragraph({
  children,
  muted = false,
}: {
  children: ReactNode;
  muted?: boolean;
}) {
  return (
    <Text style={[styles.paragraph, muted && styles.muted]}>{children}</Text>
  );
}

export function Balance({
  sats,
  caption,
}: {
  sats: string;
  caption?: string;
}) {
  return (
    <View>
      <View style={styles.balanceRow}>
        <Text style={styles.balanceValue} numberOfLines={1} adjustsFontSizeToFit>
          {sats}
        </Text>
        <Text style={styles.balanceUnit}>sats</Text>
      </View>
      {caption ? <Text style={styles.muted}>{caption}</Text> : null}
    </View>
  );
}

export function Badge({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'success' | 'danger' | 'warning' | 'primary';
}) {
  const toneColor =
    tone === 'success'
      ? colors.success
      : tone === 'danger'
        ? colors.danger
        : tone === 'warning'
          ? colors.warning
          : tone === 'primary'
            ? colors.primary
            : colors.textMuted;

  return (
    <View style={[styles.badge, { borderColor: toneColor }]}>
      <Text style={[styles.badgeText, { color: toneColor }]}>{label}</Text>
    </View>
  );
}

export function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono && styles.mono]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

export function Field({
  label,
  hint,
  ...props
}: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.primary}
        style={[styles.input, props.multiline && styles.inputMultiline]}
        {...props}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function CopyField({
  label,
  value,
  displayValue,
  onCopied,
}: {
  label: string;
  value: string;
  displayValue?: string;
  onCopied?: () => void;
}) {
  const copy = async () => {
    await Clipboard.setStringAsync(value);
    onCopied?.();
  };

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.copyRow}>
        <Text style={styles.copyValue} selectable>
          {displayValue ?? value}
        </Text>
        <Pressable
          onPress={copy}
          style={({ pressed }) => [styles.copyButton, pressed && styles.pressed]}
        >
          <Text style={styles.copyButtonText}>Copiar</Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
}) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        variant === 'ghost' && styles.buttonGhost,
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === 'primary' ? colors.primaryText : colors.text}
        />
      ) : (
        <Text
          style={[
            styles.buttonText,
            variant === 'primary' && styles.buttonTextPrimary,
            variant === 'danger' && styles.buttonTextDanger,
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <View style={styles.errorBanner}>
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

export function Notice({
  children,
  tone = 'warning',
}: {
  children: ReactNode;
  tone?: 'warning' | 'info' | 'danger';
}) {
  const accent =
    tone === 'danger'
      ? colors.danger
      : tone === 'info'
        ? colors.primary
        : colors.warning;
  return (
    <View style={[styles.notice, { borderLeftColor: accent }]}>
      <Text style={styles.noticeText}>{children}</Text>
    </View>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flexGrow: 1,
    paddingBottom: spacing.xl,
  },
  content: {
    padding: spacing.md,
    gap: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardAlt: {
    backgroundColor: colors.surfaceAlt,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  cardSubtitle: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '800',
  },
  paragraph: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
  muted: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  balanceValue: {
    color: colors.text,
    fontSize: 40,
    fontWeight: '800',
    flexShrink: 1,
  },
  balanceUnit: {
    color: colors.textMuted,
    fontSize: 16,
    fontWeight: '600',
    paddingBottom: 8,
  },
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    gap: spacing.md,
  },
  rowLabel: {
    color: colors.textMuted,
    fontSize: 14,
  },
  rowValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'right',
  },
  mono: {
    fontFamily: 'monospace',
    fontSize: 12,
  },
  field: {
    gap: spacing.xs,
  },
  label: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  inputMultiline: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  hint: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  copyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  copyValue: {
    flex: 1,
    color: colors.text,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 17,
  },
  copyButton: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  copyButtonText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  button: {
    minHeight: 50,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  buttonPrimary: {
    backgroundColor: colors.primary,
  },
  buttonSecondary: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  buttonDanger: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.danger,
  },
  buttonGhost: {
    backgroundColor: 'transparent',
  },
  buttonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  buttonTextPrimary: {
    color: colors.primaryText,
  },
  buttonTextDanger: {
    color: colors.danger,
  },
  pressed: {
    opacity: 0.75,
  },
  disabled: {
    opacity: 0.45,
  },
  errorBanner: {
    backgroundColor: 'rgba(240, 97, 109, 0.12)',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger,
    padding: spacing.md,
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
  },
  notice: {
    backgroundColor: colors.surfaceAlt,
    borderLeftWidth: 3,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  noticeText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 19,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
});
