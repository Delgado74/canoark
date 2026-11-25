/** SecureStore en memoria, con la misma interfaz asíncrona que usa la app. */
const store = new Map<string, string>();

export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 'WHEN_UNLOCKED_THIS_DEVICE_ONLY';

export async function isAvailableAsync(): Promise<boolean> {
  return true;
}

export async function getItemAsync(key: string): Promise<string | null> {
  return store.get(key) ?? null;
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  store.set(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  store.delete(key);
}

/** En tests no hay biometría: la app debe funcionar solo con passphrase. */
export function canUseBiometricAuthentication(): boolean {
  return false;
}

export const __resetSecureStore = (): void => {
  store.clear();
};
