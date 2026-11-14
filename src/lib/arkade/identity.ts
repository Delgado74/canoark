import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  bytesToHex,
  hexToBytes,
  utf8ToBytes,
} from '@noble/hashes/utils.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { generateMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { MnemonicIdentity, type Identity } from '@arkade-os/sdk';
import { ACTIVE_NETWORK } from '../../constants/network';

/**
 * La mnemónica NUNCA se guarda legible: se cifra con una clave derivada de la
 * passphrase del usuario. SecureStore solo actúa como caja fuerte del blob ya
 * cifrado, de modo que la passphrase protege la semilla incluso si alguien
 * consigue leer los datos de la app.
 */
const VAULT_KEY = 'canoark.vault.v1';
/** Passphrase cifrada por el Keystore y protegida con biometría (opcional). */
const BIOMETRIC_KEY = 'canoark.passphraseBio.v1';
/** Bandera sin autenticación: indica que existe desbloqueo biométrico. */
const BIOMETRIC_FLAG_KEY = 'canoark.biometricEnabled.v1';
const MARKER_KEY = 'canoark.hasWallet.v1';

/** Claves del esquema anterior, solo para migrar y borrar. */
const LEGACY_MNEMONIC_KEY = 'canoark.mnemonic.v1';
const LEGACY_AUTH_KEY = 'canoark.mnemonicAuth.v1';

export const MIN_PASSPHRASE_LENGTH = 8;

const KDF_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const NONCE_BYTES = 24;
const KEY_BYTES = 32;

const secureOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const biometricOptions: SecureStore.SecureStoreOptions = {
  ...secureOptions,
  requireAuthentication: true,
  authenticationPrompt: 'Desbloquea CanoArk',
};

interface VaultBlob {
  v: 1;
  kdf: 'pbkdf2-sha256';
  iter: number;
  salt: string;
  nonce: string;
  ciphertext: string;
}

/**
 * Comprueba si `expo-secure-store` puede usar biometría en este dispositivo.
 * Es la misma condición que aplica el módulo nativo: exige BIOMETRIC_STRONG
 * (Class 3). En Android 10 devuelve `false`, que es justo lo que evita el
 * error "Biometric authentication status is unknown".
 */
export function canUseBiometrics(): boolean {
  try {
    return SecureStore.canUseBiometricAuthentication();
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

export function validatePassphrase(passphrase: string): void {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(
      `La passphrase debe tener al menos ${MIN_PASSPHRASE_LENGTH} caracteres.`
    );
  }
}

function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number
): Uint8Array {
  return pbkdf2(sha256, utf8ToBytes(passphrase.normalize('NFKC')), salt, {
    c: iterations,
    dkLen: KEY_BYTES,
  });
}

/** La frase es ASCII (palabras BIP39 + espacios), así que no hace falta UTF-8. */
function decodePhrase(bytes: Uint8Array): string {
  return String.fromCharCode(...Array.from(bytes));
}

function encryptPhrase(
  phrase: string,
  passphrase: string
): { blob: VaultBlob; passphrase: string } {
  const salt = Crypto.getRandomBytes(SALT_BYTES);
  const nonce = Crypto.getRandomBytes(NONCE_BYTES);
  const key = deriveKey(passphrase, salt, KDF_ITERATIONS);
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(
    utf8ToBytes(phrase)
  );

  return {
    blob: {
      v: 1,
      kdf: 'pbkdf2-sha256',
      iter: KDF_ITERATIONS,
      salt: bytesToHex(salt),
      nonce: bytesToHex(nonce),
      ciphertext: bytesToHex(ciphertext),
    },
    passphrase,
  };
}

async function readVault(): Promise<VaultBlob | null> {
  try {
    const raw = await SecureStore.getItemAsync(VAULT_KEY, secureOptions);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VaultBlob;
    if (
      parsed?.v !== 1 ||
      parsed.kdf !== 'pbkdf2-sha256' ||
      typeof parsed.salt !== 'string' ||
      typeof parsed.nonce !== 'string' ||
      typeof parsed.ciphertext !== 'string'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function decryptVault(blob: VaultBlob, passphrase: string): string {
  let phrase: string;
  try {
    const key = deriveKey(
      passphrase,
      hexToBytes(blob.salt),
      blob.iter || KDF_ITERATIONS
    );
    const plaintext = xchacha20poly1305(key, hexToBytes(blob.nonce)).decrypt(
      hexToBytes(blob.ciphertext)
    );
    phrase = decodePhrase(plaintext);
  } catch {
    throw new Error('Passphrase incorrecta. Inténtalo de nuevo.');
  }

  if (!isValidMnemonic(phrase)) {
    throw new Error('El contenido guardado no es una frase válida.');
  }
  return normalizeMnemonic(phrase);
}

async function writeVault(phrase: string, passphrase: string): Promise<void> {
  const { blob } = encryptPhrase(phrase, passphrase);
  await SecureStore.setItemAsync(VAULT_KEY, JSON.stringify(blob), secureOptions);
}

async function deleteLegacySecrets(): Promise<void> {
  await Promise.all(
    [LEGACY_MNEMONIC_KEY, LEGACY_AUTH_KEY].map(key =>
      SecureStore.deleteItemAsync(key).catch(() => undefined)
    )
  );
}

/**
 * Lee una wallet del esquema antiguo (semilla guardada directamente en
 * SecureStore). Solo sirve para migrarla al esquema cifrado con passphrase.
 */
async function readLegacyMnemonic(): Promise<string | null> {
  const needsAuth =
    (await SecureStore.getItemAsync(LEGACY_AUTH_KEY).catch(() => null)) === '1';

  try {
    const raw = await SecureStore.getItemAsync(LEGACY_MNEMONIC_KEY, {
      ...secureOptions,
      ...(needsAuth ? biometricOptions : {}),
    });
    if (!raw) return null;
    const phrase = normalizeMnemonic(raw);
    return isValidMnemonic(phrase) ? phrase : null;
  } catch {
    return null;
  }
}

export async function hasStoredWallet(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(MARKER_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function hasBiometricUnlock(): Promise<boolean> {
  try {
    if ((await SecureStore.getItemAsync(BIOMETRIC_FLAG_KEY)) !== '1') {
      return false;
    }
    return canUseBiometrics();
  } catch {
    return false;
  }
}

export interface CreateWalletOptions {
  mnemonic: string;
  passphrase: string;
  useBiometrics?: boolean;
}

export interface CreateWalletResult {
  biometricEnabled: boolean;
}

/**
 * Crea la bóveda cifrada. La passphrase es siempre obligatoria; la biometría
 * es solo un atajo opcional que guarda la passphrase bajo `requireAuthentication`.
 */
export async function createWalletSecrets({
  mnemonic,
  passphrase,
  useBiometrics = false,
}: CreateWalletOptions): Promise<CreateWalletResult> {
  const phrase = normalizeMnemonic(mnemonic);
  if (!isValidMnemonic(phrase)) {
    throw new Error('La frase de recuperación no es válida.');
  }
  validatePassphrase(passphrase);

  if (!(await SecureStore.isAvailableAsync())) {
    throw new Error(
      'El almacenamiento seguro no está disponible en este dispositivo.'
    );
  }

  // Limpia restos de intentos anteriores antes de escribir la nueva bóveda.
  await Promise.all(
    [BIOMETRIC_KEY, BIOMETRIC_FLAG_KEY].map(key =>
      SecureStore.deleteItemAsync(key).catch(() => undefined)
    )
  );
  await writeVault(phrase, passphrase);

  let biometricEnabled = false;
  if (useBiometrics && canUseBiometrics()) {
    try {
      await SecureStore.setItemAsync(
        BIOMETRIC_KEY,
        passphrase,
        biometricOptions
      );
      await SecureStore.setItemAsync(BIOMETRIC_FLAG_KEY, '1', secureOptions);
      biometricEnabled = true;
    } catch {
      // Si la biometría falla, la wallet sigue siendo usable con passphrase.
      await SecureStore.deleteItemAsync(BIOMETRIC_KEY).catch(() => undefined);
      await SecureStore.deleteItemAsync(BIOMETRIC_FLAG_KEY).catch(
        () => undefined
      );
    }
  }

  await SecureStore.setItemAsync(MARKER_KEY, '1', secureOptions);
  await deleteLegacySecrets();

  return { biometricEnabled };
}

export async function loadWalletMnemonicWithPassphrase(
  passphrase: string
): Promise<string> {
  const vault = await readVault();

  if (vault) {
    return decryptVault(vault, passphrase);
  }

  // Sin bóveda nueva: intenta migrar desde el esquema antiguo.
  const legacy = await readLegacyMnemonic();
  if (!legacy) {
    throw new Error(
      'No se encontró una billetera guardada. Vuelve a importar tu frase.'
    );
  }

  validatePassphrase(passphrase);
  await writeVault(legacy, passphrase);
  await SecureStore.setItemAsync(MARKER_KEY, '1', secureOptions);
  await deleteLegacySecrets();
  return legacy;
}

export async function loadWalletMnemonicWithBiometrics(): Promise<string> {
  if (!(await hasBiometricUnlock())) {
    throw new Error('El desbloqueo con biometría no está configurado.');
  }

  let passphrase: string | null = null;
  try {
    passphrase = await SecureStore.getItemAsync(
      BIOMETRIC_KEY,
      biometricOptions
    );
  } catch {
    // Huellas cambiadas o clave invalidada por el Keystore.
    throw new Error(
      'No se pudo usar la biometría. Introduce tu passphrase para desbloquear.'
    );
  }

  if (!passphrase) {
    throw new Error(
      'No se pudo recuperar la passphrase biométrica. Introduce tu passphrase.'
    );
  }

  return loadWalletMnemonicWithPassphrase(passphrase);
}

export interface ChangePassphraseResult {
  biometricEnabled: boolean;
}

/**
 * Re-cifra la MISMA semilla con una passphrase nueva. No cambia el esquema de
 * custodia: sigue siendo PBKDF2 + XChaCha20-Poly1305 en SecureStore.
 */
export async function changeWalletPassphrase(
  currentPassphrase: string,
  nextPassphrase: string,
  useBiometrics: boolean
): Promise<ChangePassphraseResult> {
  const phrase = await loadWalletMnemonicWithPassphrase(currentPassphrase);
  validatePassphrase(nextPassphrase);
  await writeVault(phrase, nextPassphrase);

  let biometricEnabled = false;
  if (useBiometrics && canUseBiometrics()) {
    try {
      await SecureStore.setItemAsync(
        BIOMETRIC_KEY,
        nextPassphrase,
        biometricOptions
      );
      await SecureStore.setItemAsync(BIOMETRIC_FLAG_KEY, '1', secureOptions);
      biometricEnabled = true;
    } catch {
      await SecureStore.deleteItemAsync(BIOMETRIC_KEY).catch(() => undefined);
      await SecureStore.deleteItemAsync(BIOMETRIC_FLAG_KEY).catch(
        () => undefined
      );
    }
  } else {
    await SecureStore.deleteItemAsync(BIOMETRIC_KEY).catch(() => undefined);
    await SecureStore.deleteItemAsync(BIOMETRIC_FLAG_KEY).catch(
      () => undefined
    );
  }

  await SecureStore.setItemAsync(MARKER_KEY, '1', secureOptions);
  return { biometricEnabled };
}

export async function deleteWalletSecrets(): Promise<void> {  await Promise.all(
    [
      VAULT_KEY,
      BIOMETRIC_KEY,
      BIOMETRIC_FLAG_KEY,
      MARKER_KEY,
      LEGACY_MNEMONIC_KEY,
      LEGACY_AUTH_KEY,
    ].map(key => SecureStore.deleteItemAsync(key).catch(() => undefined))
  );
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
