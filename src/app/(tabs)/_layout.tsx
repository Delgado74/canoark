import { Text, type ColorValue } from 'react-native';
import { Redirect, Tabs } from 'expo-router';
import { colors, spacing } from '../../constants/theme';
import { useWallet } from '../../hooks/useWallet';

const icon = (glyph: string) =>
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Text style={{ color, fontSize: size - 2 }}>{glyph}</Text>;
  };

export default function TabsLayout() {
  const { status } = useWallet();

  if (status === 'loading') return null;
  if (status === 'locked') return <Redirect href="/unlock" />;
  if (status === 'empty') return <Redirect href="/onboarding" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 64,
          paddingTop: spacing.xs,
          paddingBottom: spacing.sm,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '700',
        },
        sceneStyle: { backgroundColor: colors.background },
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Billetera', tabBarIcon: icon('◈') }}
      />
      <Tabs.Screen
        name="send"
        options={{ title: 'Enviar', tabBarIcon: icon('↑') }}
      />
      <Tabs.Screen
        name="receive"
        options={{ title: 'Recibir', tabBarIcon: icon('↓') }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Ajustes', tabBarIcon: icon('⚙') }}
      />
    </Tabs>
  );
}
