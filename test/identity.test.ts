import { MnemonicIdentity } from '@arkade-os/sdk';
import {
  compressedPublicKeyHex,
  createWalletSecrets,
  generateWalletMnemonic,
  identityFromMnemonic,
  isValidMnemonic,
  loadWalletMnemonicWithPassphrase,
  normalizeMnemonic,
} from '../src/lib/arkade/identity';
import { __resetSecureStore } from './mocks/expoSecureStore';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

beforeEach(() => {
  __resetSecureStore();
});

describe('identidad Arkade', () => {
  it('deriva la ruta BIP86 de testnet en la red configurada por defecto', () => {
    const identity = identityFromMnemonic(MNEMONIC);
    expect(identity.descriptor).toContain("86'/1'/0'");
    expect(identity.descriptor).toContain('tpub');
  });

  it('deriva la ruta BIP86 de mainnet desde el SDK', async () => {
    const identity = MnemonicIdentity.fromMnemonic(MNEMONIC, {
      isMainnet: true,
    });
    expect(identity.descriptor).toContain("86'/0'/0'");
    expect(identity.descriptor).toContain('xpub');
  });

  it('publica una clave comprimida de 33 bytes', async () => {
    const identity = identityFromMnemonic(MNEMONIC);
    const publicKey = await compressedPublicKeyHex(identity);
    expect(publicKey).toMatch(/^(02|03)[0-9a-f]{64}$/);
  });

  it('la firma ECDSA del token LNURL es determinista; la Schnorr no', async () => {
    const identity = identityFromMnemonic(MNEMONIC);
    const message = new TextEncoder().encode('canoark:lnurl:session');

    const ecdsaA = await identity.signMessage(message, 'ecdsa');
    const ecdsaB = await identity.signMessage(message, 'ecdsa');
    expect(Buffer.from(ecdsaA).equals(Buffer.from(ecdsaB))).toBe(true);

    const schnorrA = await identity.signMessage(message, 'schnorr');
    const schnorrB = await identity.signMessage(message, 'schnorr');
    expect(Buffer.from(schnorrA).equals(Buffer.from(schnorrB))).toBe(false);
  });

  it('normaliza y valida frases BIP39 de 12 palabras', () => {
    const generated = generateWalletMnemonic();
    expect(generated.trim().split(/\s+/)).toHaveLength(12);
    expect(isValidMnemonic(normalizeMnemonic(`  ${generated.toUpperCase()}  `))).toBe(
      true
    );
    expect(isValidMnemonic('no es una frase')).toBe(false);
  });

  it('cifra la bóveda con passphrase y la restaura sin exponer la frase', async () => {
    const passphrase = 'passphrase-de-prueba';
    await createWalletSecrets({ mnemonic: MNEMONIC, passphrase });

    const restored = await loadWalletMnemonicWithPassphrase(passphrase);
    expect(restored).toBe(MNEMONIC);
    await expect(
      loadWalletMnemonicWithPassphrase('passphrase-equivocada')
    ).rejects.toThrow('Passphrase incorrecta');
  });
});
