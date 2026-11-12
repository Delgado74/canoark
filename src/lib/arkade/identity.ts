import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import { generateMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { MnemonicIdentity, type Identity } from '@arkade-os/sdk';
import { ACTIVE_NETWORK } from '../../constants/network';

const MNEMONIC_KEY = 'canoark.mnemonic.v1';
const MNEMONIC_AUTH_KEY = 'canoark.mnemonicAuth.v1';
const MARKER_KEY = 'canoark.hasWallet.v1';

/**
 * requireAuthentication hace que Android Keystore / iOS Keychain exijan
 * biometría o PIN al leer la mnemónica. El marcador NO pide autenticación:
 * sirve solo para saber si hay wallet sin disparar el prompt al arrancar.
 */
const secureOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export async function canUseBiometrics(): Promise<boolean> {
  try {
    const [hardware, enrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return hardware && enrolled;
  } catch {
    return false;
  }
}

export function generateWalletMnemonic(): string {
  return generateMnemonic(wordlist, 128);
}

export function isValidMnemonic(mnemonic: string): boolean {
  return validateMnemonic(mnemonic.trim().toLowerCase(), wordlist);
}

export function normalizeMnemonic(mnemonic: string): string {
  return mnemonic.trim().toLowerCase().split(/\s+/).join(' ');
}

export async function hasStoredWallet(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(MARKER_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function saveWalletMnemonic(
  mnemonic: string,
  requireAuthentication = true
): Promise<void> {
  const phrase = normalizeMnemonic(mnemonic);
  if (!isValidMnemonic(phrase)) {
    throw new Error('La frase de recuperación no es válida.');
  }
  if (!(await SecureStore.isAvailableAsync())) {
    throw new Error(
      'El almacenamiento seguro no está disponible en este dispositivo.'
    );
  }

  await SecureStore.setItemAsync(MNEMONIC_KEY, phrase, {
    ...secureOptions,
    requireAuthentication,
  });
  await SecureStore.setItemAsync(MNEMONIC_AUTH_KEY, requireAuthentication ? '1' : '0');
  await SecureStore.setItemAsync(MARKER_KEY, '1');
}

export async function loadWalletMnemonic(): Promise<string> {
  const needsAuth =
    (await SecureStore.getItemAsync(MNEMONIC_AUTH_KEY)) === '1';

  let phrase: string | null = null;
  try {
    phrase = await SecureStore.getItemAsync(MNEMONIC_KEY, {
      ...secureOptions,
      requireAuthentication: needsAuth,
    });
  } catch (error) {
    // En Android, si el usuario borra sus huellas, la clave del Keystore queda
    // inservible. Mensaje accionable en vez de un error críptico.
    throw new Error(
      needsAuth
        ? 'No se pudo desbloquear con biometría. Verifica que siga configurada en el dispositivo.'
        : 'No se pudo leer la frase de recuperación.'
    );
  }

  if (!phrase || !isValidMnemonic(phrase)) {
    throw new Error('No se pudo leer la frase de recuperación.');
  }
  return phrase;
}

export async function deleteWalletSecrets(): Promise<void> {
  await SecureStore.deleteItemAsync(MNEMONIC_KEY);
  await SecureStore.deleteItemAsync(MNEMONIC_AUTH_KEY);
  await SecureStore.deleteItemAsync(MARKER_KEY);
}

export function identityFromMnemonic(mnemonic: string): MnemonicIdentity {
  return MnemonicIdentity.fromMnemonic(normalizeMnemonic(mnemonic), {
    isMainnet: ACTIVE_NETWORK.isMainnet,
  });
}

/** Public key comprimida (33 bytes) en hex, la que espera lnurl-server. */
export async function compressedPublicKeyHex(
  identity: Identity
): Promise<string> {
  const bytes = await identity.compressedPublicKey();
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
