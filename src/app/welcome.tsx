import { Image, StyleSheet, Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { Badge, Button, Notice, Screen } from '../components/ui';
import { colors, spacing } from '../constants/theme';
import { useWallet } from '../hooks/useWallet';

function Bullet({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <View style={styles.bullet}>
      <View style={styles.bulletIcon}>
        <Text style={styles.bulletIconText}>{icon}</Text>
      </View>
      <View style={styles.bulletBody}>
        <Text style={styles.bulletTitle}>{title}</Text>
        <Text style={styles.bulletText}>{text}</Text>
      </View>
    </View>
  );
}

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
          Billetera Arkade sin custodia para Bitcoin y Lightning, con tus llaves
          siempre en este dispositivo.
        </Text>
        <Badge label={network.label} tone="primary" />
      </View>

      <View style={styles.bullets}>
        <Bullet
          icon="⚡"
          title="Pagos instantáneos"
          text="Envía y recibe dentro de Arkade sin esperar confirmaciones de bloque."
        />
        <Bullet
          icon="🔑"
          title="Tus llaves, tu billetera"
          text="La frase de recuperación se cifra en el dispositivo y nunca se envía a un servidor."
        />
        <Bullet
          icon="🌐"
          title="Lightning y onchain"
          text="Paga facturas Lightning con solvers. Envía bitcoin con una salida colaborativa y recibe depósitos onchain por boarding, sin solver."
        />
      </View>

      <View style={styles.actions}>
        <Button
          title="Crear billetera"
          onPress={() => router.push('/create')}
        />
        <Button
          title="Ya tengo una billetera"
          variant="secondary"
          onPress={() => router.push('/restore')}
        />
      </View>

      <Notice tone="info">
        {network.isMainnet
          ? 'Esta compilación usa Bitcoin mainnet: son fondos reales. Verifica direcciones y comisiones.'
          : 'Esta compilación usa Mutinynet: bitcoin de prueba. No envíes fondos reales a estas direcciones.'}
      </Notice>

      <Text style={styles.footnote}>
        Al continuar aceptas que CanoArk es software experimental y que eres el
        único responsable de tu frase de recuperación.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.lg,
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
  bullets: {
    gap: spacing.sm,
  },
  bullet: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
  },
  bulletIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
  },
  bulletIconText: {
    fontSize: 19,
  },
  bulletBody: {
    flex: 1,
    gap: 2,
  },
  bulletTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  bulletText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  actions: {
    gap: spacing.sm,
  },
  footnote: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
  },
});
