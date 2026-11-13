import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { WalletProvider } from '../hooks/useWallet';
import { colors } from '../constants/theme';

export default function RootLayout() {
  return (
    <WalletProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="welcome" />
        <Stack.Screen name="create" />
        <Stack.Screen name="restore" />
        <Stack.Screen name="send" />
        <Stack.Screen name="receive" />
        <Stack.Screen name="unlock" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </WalletProvider>
  );
}
