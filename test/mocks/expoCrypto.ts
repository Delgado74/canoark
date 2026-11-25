import { randomBytes, randomFillSync } from 'node:crypto';

/** `expo-crypto` implementado con el RNG del sistema, sin módulo nativo. */
export function getRandomBytes(length: number): Uint8Array {
  return new Uint8Array(randomBytes(length));
}

export function getRandomValues<T extends ArrayBufferView>(array: T): T {
  randomFillSync(array as unknown as NodeJS.ArrayBufferView);
  return array;
}

export const CryptoDigestAlgorithm = { SHA256: 'SHA-256' };

export async function digestStringAsync(
  _algorithm: string,
  value: string
): Promise<string> {
  const { createHash } = await import('node:crypto');
  const bytes = createHash('sha256').update(value, 'utf8').digest();
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
