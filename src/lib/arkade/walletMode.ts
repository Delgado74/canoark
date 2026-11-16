import * as SecureStore from 'expo-secure-store';

/**
 * Estrategia de direcciones de recepción del SDK:
 *
 * - `static`: una sola dirección Arkade y una sola de boarding. Es el
 *   comportamiento histórico de CanoArk.
 * - `hd`: deriva una dirección nueva por índice (BIP86) y vigila una ventana
 *   de direcciones anteriores. Reduce la reutilización de direcciones.
 *
 * El SDK recomienda `MnemonicIdentity` (ya lo usamos) porque es HD-ready; el
 * modo se elige al crear/restaurar y se guarda aparte de la bóveda cifrada.
 */
export type WalletMode = 'static' | 'hd';

const MODE_KEY = 'canoark.walletMode.v1';

const secureOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const isWalletMode = (value: unknown): value is WalletMode =>
  value === 'static' || value === 'hd';

/**
 * Las instalaciones antiguas no tienen la clave: se comportan como `static`
 * para no cambiar la dirección que ya estaban usando.
 */
export async function loadWalletMode(): Promise<WalletMode> {
  try {
    const stored = await SecureStore.getItemAsync(MODE_KEY, secureOptions);
    return isWalletMode(stored) ? stored : 'static';
  } catch {
    return 'static';
  }
}

export async function saveWalletMode(mode: WalletMode): Promise<void> {
  await SecureStore.setItemAsync(MODE_KEY, mode, secureOptions);
}

export async function clearWalletMode(): Promise<void> {
  await SecureStore.deleteItemAsync(MODE_KEY).catch(() => undefined);
}

export function walletModeLabel(mode: WalletMode): string {
  return mode === 'hd' ? 'Direcciones rotativas (HD)' : 'Dirección estática';
}
