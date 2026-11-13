import { Image, StyleSheet, Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { Badge, Button, Notice, Screen } from '../components/ui';
import { colors, spacing } from '../constants/theme';
import { useWallet } from '../hooks/useWallet';

export default function WelcomeScreen() {
  const { status, network } = useWallet();

  if (status === 'unlocked') return <Redirect href="/(tabs)" />;
  if (status === 'locked') return <Redirect href="/unlock" />;

  return (
    <Screen>
      <View style={styles.hero}>
        <Image
          source={require('../../assets/icon.png')}
          style={styles.logo}
          resizeMode="cover"
          accessibilityLabel="Icono de CanoArk"
        />
        <Text style={styles.title}>CanoArk</Text>
        <Text style={styles.subtitle}>
          Tu billetera Arkade en el móvil. Rápida, sin custodia y con tus llaves
          siempre en este dispositivo.
        </Text>
        <Badge label={network.label} tone="primary" />
      </View>

      <View style={styles.actions}>
        <Button
          title="Nueva billetera"
          onPress={() => router.push('/create')}
        />
        <Button
          title="Restaurar billetera"
          variant="secondary"
          onPress={() => router.push('/restore')}
        />
      </View>

      <Notice tone="info">
        {network.isMainnet
          ? 'Esta compilación usa Bitcoin mainnet: son fondos reales.'
          : 'Esta compilación usa Mutinynet: bitcoin de prueba.'}
      </Notice>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  logo: {
    width: 104,
    height: 104,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: {
    color: colors.text,
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    maxWidth: 340,
  },
  actions: {
    gap: spacing.sm,
  },
});
