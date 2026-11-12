import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useWallet } from '../hooks/useWallet';
import { colors, spacing } from '../constants/theme';

export default function IndexScreen() {
  const { status } = useWallet();

  if (status === 'loading') {
    return (
      <View style={styles.container}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.text}>Abriendo CanoArk…</Text>
      </View>
    );
  }

  if (status === 'empty') return <Redirect href="/onboarding" />;
  if (status === 'locked') return <Redirect href="/unlock" />;
  return <Redirect href="/(tabs)" />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    gap: spacing.md,
  },
  text: {
    color: colors.textMuted,
    fontSize: 14,
  },
});
