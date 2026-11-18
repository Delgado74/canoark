/**
 * Polyfill mínimo de `crypto.subtle` para React Native.
 *
 * `@arkade-os/sdk` firma con `@noble/secp256k1` v3, que usa WebCrypto para:
 * - `digest('SHA-256', …)` en la firma Schnorr asíncrona.
 * - `importKey` + `sign('HMAC', …)` en el DRBG RFC6979 de la firma ECDSA
 *   (la que deriva el token de Lightning Address).
 *
 * Hermes no trae `crypto.subtle`, así que sin este polyfill esas rutas fallan
 * con «crypto.subtle must be defined, consider polyfill». Se implementa solo lo
 * que consume el SDK, con `@noble/hashes` (ya es dependencia de la app).
 */
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';

const HASH_NAME = 'SHA-256';
const HMAC_MARK = '__canoarkHmacKey';

type HmacKey = {
  [HMAC_MARK]: true;
  hash: string;
  key: Uint8Array;
};

const toBytes = (data: unknown): Uint8Array => {
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  throw new TypeError('WebCrypto: se esperaba un ArrayBuffer o TypedArray.');
};

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;

const algorithmName = (algorithm: unknown): string => {
  if (typeof algorithm === 'string') return algorithm;
  if (algorithm && typeof algorithm === 'object') {
    const name = (algorithm as { name?: unknown }).name;
    if (typeof name === 'string') return name;
  }
  throw new TypeError('WebCrypto: algoritmo no válido.');
};

const hashNameOf = (algorithm: unknown): string => {
  if (algorithm && typeof algorithm === 'object') {
    const hash = (algorithm as { hash?: unknown }).hash;
    if (typeof hash === 'string') return hash;
    if (hash && typeof hash === 'object') {
      const name = (hash as { name?: unknown }).name;
      if (typeof name === 'string') return name;
    }
  }
  return algorithmName(algorithm);
};

const assertSha256 = (name: string) => {
  if (name.toUpperCase() !== HASH_NAME) {
    throw new Error(
      `WebCrypto: solo se admite ${HASH_NAME} en este polyfill (recibido ${name}).`
    );
  }
};

const subtle = {
  async digest(algorithm: unknown, data: unknown): Promise<ArrayBuffer> {
    assertSha256(algorithmName(algorithm));
    return toArrayBuffer(sha256(toBytes(data)));
  },

  async importKey(
    format: string,
    keyData: unknown,
    algorithm: unknown
  ): Promise<HmacKey> {
    if (format !== 'raw') {
      throw new Error(`WebCrypto: formato de clave no soportado (${format}).`);
    }
    assertSha256(hashNameOf(algorithm));
    return {
      [HMAC_MARK]: true,
      hash: HASH_NAME,
      key: toBytes(keyData),
    };
  },

  async sign(
    algorithm: unknown,
    key: HmacKey,
    data: unknown
  ): Promise<ArrayBuffer> {
    if (algorithmName(algorithm).toUpperCase() !== 'HMAC') {
      throw new Error('WebCrypto: solo se admite firmar con HMAC.');
    }
    if (!key || key[HMAC_MARK] !== true) {
      throw new TypeError('WebCrypto: clave HMAC no válida.');
    }
    assertSha256(key.hash);
    return toArrayBuffer(hmac(sha256, key.key, toBytes(data)));
  },
};

type CryptoLike = {
  subtle?: unknown;
  getRandomValues?: unknown;
};

const target = globalThis as unknown as { crypto?: CryptoLike };

if (!target.crypto) target.crypto = {};

if (!target.crypto.subtle) {
  target.crypto.subtle = subtle;
}
