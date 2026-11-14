import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Badge, Notice, Screen, Title } from './ui';
import { colors, spacing } from '../constants/theme';

/** Cabecera con botón de vuelta para las pantallas de ajustes. */
export function SettingsHeader({
  title,
  badge,
}: {
  title: string;
  badge?: string;
}) {
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Volver"
        onPress={() => router.back()}
        style={({ pressed }) => [styles.back, pressed && styles.pressed]}
      >
        <Text style={styles.backText}>‹</Text>
      </Pressable>
      <Title>{title}</Title>
      {badge ? <Badge label={badge} /> : <View style={styles.back} />}
    </View>
  );
}

export function SettingsScreen({
  title,
  badge,
  children,
  onRefresh,
  refreshing,
}: {
  title: string;
  badge?: string;
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  return (
    <Screen onRefresh={onRefresh} refreshing={refreshing}>
      <SettingsHeader title={title} badge={badge} />
      {children}
    </Screen>
  );
}

export function SettingsGroup({ children }: { children: ReactNode }) {
  return <View style={styles.group}>{children}</View>;
}

export function ChoiceRow({
  label,
  hint,
  selected,
  onPress,
}: {
  label: string;
  hint?: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.choice, pressed && styles.pressed]}
    >
      <View style={styles.choiceText}>
        <Text style={styles.choiceLabel}>{label}</Text>
        {hint ? <Text style={styles.choiceHint}>{hint}</Text> : null}
      </View>
      <Text style={[styles.check, selected && styles.checkSelected]}>
        {selected ? '✓' : ''}
      </Text>
    </Pressable>
  );
}

export function UnavailableNotice({ children }: { children: ReactNode }) {
  return <Notice tone="info">{children}</Notice>;
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: 36,
  },
  back: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: {
    color: colors.text,
    fontSize: 30,
    lineHeight: 32,
    marginTop: -2,
  },
  pressed: {
    opacity: 0.6,
  },
  group: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  choiceText: {
    flex: 1,
    gap: 2,
  },
  choiceLabel: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  choiceHint: {
    color: colors.textMuted,
    fontSize: 12,
  },
  check: {
    color: 'transparent',
    fontSize: 16,
    fontWeight: '800',
    width: 20,
    textAlign: 'center',
  },
  checkSelected: {
    color: colors.primary,
  },
});
