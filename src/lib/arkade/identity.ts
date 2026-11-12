import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Crypto from 'expo-crypto';
import { generateMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { MnemonicIdentity, type Identity } from '@arkade-os/sdk';
import { ACTIVE_NETWORK } from '../../constants/network';

const MNEMONIC_KEY = 'canoark.mnemonic.v1';
const MNEMONIC_AUTH_KEY = 'canoark.mnemonicAuth.v1';
const PASSPHRASE_HASH_KEY = 'canoark.passphraseHash.v1';
const MARKER_KEY = 'canoark.hasWallet.v1';

/**
 * requireAuthentication hace que Android Keystore / iOS Keychain exijan
 * biometría o PIN al leer la mnemónica. El marcador NO pide autenticación:
 * sirve solo para saber si hay wallet sin disparar el prompt al arrancar.
 */
const secureOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export type SaveMode = 'biometric' | 'passphrase';

export interface SaveResult {
  mode: SaveMode;
  degraded: boolean;
  reason?: string;
}

/**
 * Comprueba si el dispositivo tiene hardware biométrico y si hay
 * biometría registrada. No garantiza que sea Class 3 (BIOMETRIC_STRONG),
 * que es lo que exige SecureStore en Android; por eso el guardado
 * biométrico siempre va envuelto en try/catch con fallback a passphrase.
 */
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

async function hashPassphrase(passphrase: string): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    passphrase
  );
}

export async function hasStoredWallet(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(MARKER_KEY)) === '1';
  } catch {
    return false;
  }
}

/**
 * Devuelve el modo de autenticación con el que se guardó la mnemónica.
 * Se usa al arrancar para que la pantalla de desbloqueo sepa si debe
 * pedir passphrase o si puede intentar biometría.
 */
export async function getMnemonicAuthMode(): Promise<SaveMode> {
  try {
    const flag = await SecureStore.getItemAsync(MNEMONIC_AUTH_KEY);
    return flag === '1' ? 'biometric' : 'passphrase';
  } catch {
    return 'passphrase';
  }
}

/**
 * Guarda la mnemónica con el modo elegido. Si el modo es 'biometric'
 * pero el dispositivo no puede usarlo (o falla en tiempo de ejecución),
 * degrada a 'passphrase' y devuelve `degraded: true` con el motivo.
 *
 * En modo 'passphrase' es obligatorio pasar `passphrase` (mínimo 6 chars).
 * La passphrase NO se guarda en claro: se guarda su hash SHA-256 como
 * verificador para validarla al desbloquear.
 */
export async function saveWalletMnemonic(
  mnemonic: string,
  options: { mode: SaveMode; passphrase?: string } = { mode: 'biometric' }
): Promise<SaveResult> {
  const phrase = normalizeMnemonic(mnemonic);
  if (!isValidMnemonic(phrase)) {
    throw new Error('La frase de recuperación no es válida.');
  }
  if (!(await SecureStore.isAvailableAsync())) {
    throw new Error(
      'El almacenamiento seguro no está disponible en este dispositivo.'
    );
  }

  let effectiveMode: SaveMode = options.mode;
  let degraded = false;
  let reason: string | undefined;

  // Detección previa: si el usuario pide biometría pero no hay, degradar.
  if (effectiveMode === 'biometric') {
    const biometricOk = await canUseBiometrics();
    if (!biometricOk) {
      effectiveMode = 'passphrase';
      degraded = true;
      reason =
        'Biometría no disponible o no es de nivel seguro (Class 3) en este dispositivo.';
    }
  }

  if (effectiveMode === 'passphrase') {
    if (!options.passphrase || options.passphrase.length < 6) {
      throw new Error('La passphrase debe tener al menos 6 caracteres.');
    }
  }

  try {
    if (effectiveMode === 'biometric') {
      await SecureStore.setItemAsync(MNEMONIC_KEY, phrase, {
        ...secureOptions,
        requireAuthentication: true,
      });
      await SecureStore.setItemAsync(MNEMONIC_AUTH_KEY, '1');
      // Limpiar cualquier hash de passphrase previo
      await SecureStore.deleteItemAsync(PASSPHRASE_HASH_KEY);
    } else {
      await SecureStore.setItemAsync(MNEMONIC_KEY, phrase, secureOptions);
      await SecureStore.setItemAsync(MNEMONIC_AUTH_KEY, '0');
      const hash = await hashPassphrase(options.passphrase!);
      await SecureStore.setItemAsync(PASSPHRASE_HASH_KEY, hash, secureOptions);
    }
    await SecureStore.setItemAsync(MARKER_KEY, '1');
    return { mode: effectiveMode, degraded, reason };
  } catch (error: any) {
    // Fallback si el guardado biométrico falla en tiempo de ejecución
    // (p. ej. Android 10 con BIOMETRIC_STATUS_UNKNOWN).
    if (effectiveMode === 'biometric') {
      if (!options.passphrase) {
        throw new Error(
          'No se pudo guardar con biometría. Define una passphrase como respaldo.'
        );
      }
      await SecureStore.setItemAsync(MNEMONIC_KEY, phrase, secureOptions);
      await SecureStore.setItemAsync(MNEMONIC_AUTH_KEY, '0');
      const hash = await hashPassphrase(options.passphrase);
      await SecureStore.setItemAsync(PASSPHRASE_HASH_KEY, hash, secureOptions);
      await SecureStore.setItemAsync(MARKER_KEY, '1');
      return {
        mode: 'passphrase',
        degraded: true,
        reason:
          error?.message ??
          'Fallo de biometría en tiempo de ejecución; se usó passphrase.',
      };
    }
    throw error;
  }
}

/**
 * Lee la mnemónica. En modo biometría pide autenticación; en modo
 * passphrase exige `options.passphrase` y valida contra el hash guardado.
 */
export async function loadWalletMnemonic(options?: {
  passphrase?: string;
}): Promise<string> {
  const needsAuth =
    (await SecureStore.getItemAsync(MNEMONIC_AUTH_KEY)) === '1';

  if (!needsAuth) {
    const storedHash = await SecureStore.getItemAsync(PASSPHRASE_HASH_KEY);
    if (!options?.passphrase) {
      throw new Error('Se requiere passphrase para desbloquear la billetera.');
    }
    const inputHash = await hashPassphrase(options.passphrase);
    if (storedHash !== inputHash) {
      throw new Error('Passphrase incorrecta.');
    }
    const phrase = await SecureStore.getItemAsync(MNEMONIC_KEY, secureOptions);
    if (!phrase || !isValidMnemonic(phrase)) {
      throw new Error('No se pudo leer la frase de recuperación.');
    }
    return phrase;
  }

  try {
    const phrase = await SecureStore.getItemAsync(MNEMONIC_KEY, {
      ...secureOptions,
      requireAuthentication: true,
    });
    if (!phrase || !isValidMnemonic(phrase)) {
      throw new Error('No se pudo leer la frase de recuperación.');
    }
    return phrase;
  } catch {
    throw new Error(
      'No se pudo desbloquear con biometría. Usa la passphrase o revisa la biometría del dispositivo.'
    );
  }
}

export async function deleteWalletSecrets(): Promise<void> {
  await SecureStore.deleteItemAsync(MNEMONIC_KEY);
  await SecureStore.deleteItemAsync(MNEMONIC_AUTH_KEY);
  await SecureStore.deleteItemAsync(PASSPHRASE_HASH_KEY);
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
