/**
 * Se ejecuta ANTES de que cualquier test importe @arkade-os/sdk.
 * Reproduce el orden de `index.js`: primero los polyfills, después los mocks de
 * las fronteras nativas. Si esto se invierte, MuSig2 y la firma ECDSA mueren
 * con `crypto.getRandomValues is not a function` / `crypto.subtle missing`.
 */
import { randomFillSync, webcrypto } from 'node:crypto';

const globals = globalThis as typeof globalThis & {
  crypto: Crypto;
};

if (!globals.crypto) {
  globals.crypto = {} as Crypto;
}
if (typeof globals.crypto.getRandomValues !== 'function') {
  globals.crypto.getRandomValues = (<T extends ArrayBufferView>(array: T): T => {
    randomFillSync(array as unknown as NodeJS.ArrayBufferView);
    return array;
  }) as Crypto['getRandomValues'];
}
if (!globals.crypto.subtle) {
  Object.defineProperty(globals.crypto, 'subtle', {
    value: webcrypto.subtle,
    configurable: true,
  });
}

jest.mock('expo-sqlite', () => require('./mocks/expoSqlite'));
jest.mock('expo-secure-store', () => require('./mocks/expoSecureStore'));
jest.mock('expo-crypto', () => require('./mocks/expoCrypto'));
