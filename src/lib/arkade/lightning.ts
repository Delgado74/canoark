import * as SecureStore from 'expo-secure-store';
import { btcOn, isSwapError, type PayResult } from '@arkade-os/swap';
import {
  preimageForSwapRecord,
  type SwapSecretsProjection,
} from '@arkade-os/swap/protocol';
import {
  createLnurlClient,
  deriveSessionTokenWithSigner,
  type LnurlSession,
  type RegisteredAddress,
} from '@arkade-os/lnurl-client';
import { ACTIVE_NETWORK } from '../../constants/network';
import { getArkadeSession } from './client';
import { compressedPublicKeyHex } from './identity';

/** Asset id del BTC dentro de Arkade, en la red configurada. */
function btcAsset() {
  return btcOn('arkade', ACTIVE_NETWORK.swapNetwork);
}

export function isLightningInvoice(value: string): boolean {
  // lnurl1… es un enlace LNURL, no una factura BOLT11. Se rechaza aquí para
  // que el solver no reciba un destino que no sabe interpretar.
  return /^ln(?!url)[a-z0-9]+1/i.test(value.trim());
}

export function isOnchainAddress(value: string): boolean {
  return /^(bc1|tb1|bcrt1)[a-z0-9]{8,}$/i.test(value.trim());
}

export function isArkadeAddress(value: string): boolean {
  return new RegExp(`^${ACTIVE_NETWORK.addressPrefix}1[a-z0-9]+$`, 'i').test(
    value.trim()
  );
}

const feeCeiling = (maxFeeSats: number) => ({
  amount: BigInt(Math.max(0, Math.floor(maxFeeSats))),
  asset: btcAsset(),
});

/**
 * Envía a una factura BOLT11 o a una dirección onchain. El usuario bloquea BTC
 * dentro de Arkade y el solver paga el destino. Si el solver no paga, el lockup
 * se reembolsa solo tras `refundLocktime`.
 */
export async function payThroughSolver(
  destination: string,
  amountSats: number,
  maxFeeSats = 500
): Promise<PayResult> {
  const { swaps } = getArkadeSession();
  const invoice = isLightningInvoice(destination);
  const onchain = isOnchainAddress(destination);

  if (!invoice && !onchain) {
    throw new Error(
      'Destino no soportado por el solver. Usa una factura Lightning, una dirección onchain o una dirección Arkade.'
    );
  }
  if (onchain && amountSats <= 0) {
    throw new Error('Indica cuántos sats quieres enviar onchain.');
  }

  return swaps.pay(destination.trim(), {
    ...(onchain ? { amount: BigInt(Math.floor(amountSats)) } : {}),
    maxFee: feeCeiling(maxFeeSats),
  });
}

/**
 * Pide un pago Lightning. Devuelve una factura hold: hay que mantener la app
 * (y el swap client) viva hasta que el pago llegue o la ventana expire.
 */
export async function receiveLightning(
  amountSats: number
): Promise<{ id: string; invoice: string }> {
  const { swaps } = getArkadeSession();
  const request = await swaps.receive({
    via: 'lightning',
    amount: BigInt(Math.max(1, Math.floor(amountSats))),
  });

  if (request.artifact.kind !== 'invoice') {
    throw new Error('El solver no devolvió una factura BOLT11.');
  }

  return { id: request.id, invoice: request.artifact.bolt11 };
}

/**
 * LNURL-pay exige una factura por EXACTAMENTE el importe del callback
 * (LUD-06). `receive()` pide de más para cubrir la comisión, así que aquí se
 * usa el flujo quote -> accept con `amountOn: 'give'`.
 */
export async function receiveExactForLnurl(
  amountSats: number,
  maxFeeSats = 500
): Promise<{ id: string; invoice: string }> {
  const { swaps } = getArkadeSession();
  const amount = BigInt(Math.max(1, Math.floor(amountSats)));

  const quote = await swaps.quote({
    via: 'lightning',
    amount,
    amountOn: 'give',
  });

  if (quote.fee.amount > feeCeiling(maxFeeSats).amount) {
    throw new Error(
      `La comisión del solver (${quote.fee.amount} sats) supera el máximo permitido.`
    );
  }

  const swap = await swaps.accept(quote);
  if (swap.artifact?.kind !== 'invoice') {
    throw new Error('El solver no devolvió una factura BOLT11.');
  }

  return { id: swap.id, invoice: swap.artifact.bolt11 };
}

export function watchSwap(
  swapId: string,
  onOutcome: (outcome: string) => void
): () => void {
  const { swaps } = getArkadeSession();
  return swaps.onUpdate(({ swap, outcome }) => {
    if (swap.id === swapId) onOutcome(outcome);
  });
}

export function swapErrorMessage(error: unknown): string {
  if (isSwapError(error)) return `${error.name}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

/* ------------------------------------------------------------------ */
/* Preimagen para reportar la liquidación al servidor LNURL            */
/* ------------------------------------------------------------------ */

const hexOf = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

type HashlockProfile = {
  signer?: { signingDescriptor?: string };
  hashlock?: {
    preimageHex?: string;
    preimageSaltHex?: string;
    paymentHash?: string;
  };
};

/**
 * El servidor LNURL necesita la preimagen para marcar la factura como pagada.
 * En una recepción, la preimagen es el secreto de claim que el cliente guardó
 * en `profile.hashlock`; se re-deriva con la wallet y se verifica contra el
 * `paymentHash` del registro.
 */
export async function settlementPreimage(
  swapId: string
): Promise<string | null> {
  const { wallet, storage } = getArkadeSession();
  const record = await storage.swapRepository.getSwapRecord(swapId);
  if (!record || record.family !== 'rfq') return null;

  if (record.settlementPreimageHex) return record.settlementPreimageHex;
  if (record.kind !== 'lightning_receive') return null;

  const profile = record.profile as HashlockProfile;
  if (!profile.hashlock) return null;

  const projection: SwapSecretsProjection & { paymentHash?: string } = {
    signingDescriptor: profile.signer?.signingDescriptor,
    preimageHex: profile.hashlock.preimageHex,
    preimageSaltHex: profile.hashlock.preimageSaltHex,
    paymentHash: profile.hashlock.paymentHash,
  };

  const preimage = await preimageForSwapRecord(wallet, projection);
  return hexOf(preimage);
}

/* ------------------------------------------------------------------ */
/* Lightning Address (LNURL)                                          */
/* ------------------------------------------------------------------ */

export type LnurlConfig = {
  baseUrl: string;
  domain: string;
};

export function getLnurlConfig(): LnurlConfig | null {
  // Mismos valores que Arkade Wallet: servidor y dominio se pueden sobrescribir
  // por entorno, pero por defecto salen de la red activa.
  const baseUrl =
    process.env.EXPO_PUBLIC_LNURL_BASE_URL?.trim() ||
    process.env.EXPO_PUBLIC_LNURL_SERVER?.trim() ||
    ACTIVE_NETWORK.lnurlServer;
  if (!baseUrl) return null;

  const configuredDomain =
    process.env.EXPO_PUBLIC_LNURL_DOMAIN?.trim() || ACTIVE_NETWORK.lnurlDomain;
  let domain = configuredDomain;
  if (!domain) {
    try {
      domain = new URL(baseUrl).host;
    } catch {
      return null;
    }
  }
  return { baseUrl, domain };
}

const safeDomain = (domain: string) =>
  domain.replace(/[^a-zA-Z0-9._-]/g, '_');

const tokenStorageKey = (domain: string) =>
  `canoark.lnurl.token.${safeDomain(domain)}`;

const addressStorageKey = (domain: string) =>
  `canoark.lnurl.address.${safeDomain(domain)}`;

async function getStoredToken(domain: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(tokenStorageKey(domain));
  } catch {
    return null;
  }
}

async function saveToken(domain: string, token: string): Promise<void> {
  await SecureStore.setItemAsync(tokenStorageKey(domain), token);
}

export async function loadLightningAddress(): Promise<string | null> {
  const config = getLnurlConfig();
  if (!config) return null;
  try {
    const value = await SecureStore.getItemAsync(
      addressStorageKey(config.domain)
    );
    return value || null;
  } catch {
    return null;
  }
}

async function saveLightningAddress(address: string): Promise<void> {
  const config = getLnurlConfig();
  if (!config) return;
  await SecureStore.setItemAsync(
    addressStorageKey(config.domain),
    address
  );
}

/**
 * Deriva (o reutiliza) el token de sesión. Se usa
 * deriveSessionTokenWithSigner con ECDSA: la firma Schnorr por defecto es
 * aleatoria y generaría un token nuevo en cada arranque.
 */
export async function getOrCreateLnurlToken(domain: string): Promise<string> {
  const stored = await getStoredToken(domain);
  if (stored) return stored;

  const { wallet } = getArkadeSession();
  const token = await deriveSessionTokenWithSigner(
    (message, signatureType) =>
      wallet.identity.signMessage(message, signatureType),
    domain
  );
  await saveToken(domain, token);
  return token;
}

export async function forgetLnurlSecrets(): Promise<void> {
  const config = getLnurlConfig();
  if (!config) return;
  await SecureStore.deleteItemAsync(tokenStorageKey(config.domain)).catch(
    () => undefined
  );
  await SecureStore.deleteItemAsync(addressStorageKey(config.domain)).catch(
    () => undefined
  );
}

export async function registerLightningAddress(params: {
  username: string;
  arkadeAddress: string;
  boardingAddress?: string;
}): Promise<{ token: string; registered: RegisteredAddress }> {
  const config = getLnurlConfig();
  if (!config) {
    throw new Error(
      'Configura EXPO_PUBLIC_LNURL_BASE_URL para usar Lightning Address.'
    );
  }

  const { wallet } = getArkadeSession();
  const client = createLnurlClient({ baseUrl: config.baseUrl });
  const token = await getOrCreateLnurlToken(config.domain);

  const registered = await client.registerAddress({
    token,
    username: params.username.trim().toLowerCase(),
    domain: config.domain,
  });

  const claimPublicKey = await compressedPublicKeyHex(wallet.identity);
  await client.registerArkadeIdentity({
    token,
    handle: registered.handle,
    domain: registered.domain,
    arkadeAddress: params.arkadeAddress,
    claimPublicKey,
    boardingAddress: params.boardingAddress,
  });

  if (registered.lightningAddress) {
    await saveLightningAddress(registered.lightningAddress);
  }

  return { token, registered };
}

export type LightningAddressSessionHandlers = {
  onInvoice?: (invoice: {
    id: string;
    invoice: string;
    sats: number;
  }) => void;
  onOutcome?: (swapId: string, outcome: string) => void;
  onSettled?: (data: Record<string, unknown>) => void;
  onError?: (error: Error) => void;
};

/**
 * Abre la sesión SSE que recibe los `invoice_request` del servidor LNURL.
 * Hay que mantenerla abierta para recibir mientras la app está en primer plano.
 */
export async function openLightningAddressSession(
  handlers: LightningAddressSessionHandlers = {}
): Promise<LnurlSession> {
  const config = getLnurlConfig();
  if (!config) {
    throw new Error(
      'Configura EXPO_PUBLIC_LNURL_BASE_URL para usar Lightning Address.'
    );
  }

  const client = createLnurlClient({ baseUrl: config.baseUrl });
  const token = await getOrCreateLnurlToken(config.domain);
  let session: LnurlSession | null = null;

  const opened = await client.openSession(
    { token, reconnect: { maxAttempts: 5, baseDelayMs: 1_500 } },
    {
      onInvoiceRequest: async (request, respond) => {
        const sats = Math.floor(request.amountMsat / 1_000);
        if (sats <= 0) {
          await respond.rejectInvoice('El importe debe ser al menos 1 sat.');
          return;
        }

        try {
          const invoice = await receiveExactForLnurl(sats);
          await respond.answerInvoice(invoice.invoice);
          handlers.onInvoice?.({ ...invoice, sats });

          const unsubscribe = watchSwap(invoice.id, outcome => {
            handlers.onOutcome?.(invoice.id, outcome);

            if (outcome === 'claimed') {
              unsubscribe();
              void (async () => {
                try {
                  const preimage = await settlementPreimage(invoice.id);
                  if (preimage && session && !session.closed) {
                    await session.reportSettled(preimage);
                  }
                } catch (error) {
                  handlers.onError?.(
                    error instanceof Error ? error : new Error(String(error))
                  );
                }
              })();
            } else if (
              outcome === 'lapsed' ||
              outcome === 'refunded' ||
              outcome === 'failed' ||
              outcome === 'needs_recovery'
            ) {
              unsubscribe();
            }
          });
        } catch (error) {
          await respond.rejectInvoice(
            swapErrorMessage(error).slice(0, 500)
          );
        }
      },
      onSettled: handlers.onSettled,
      onError: handlers.onError,
    }
  );

  session = opened;
  return opened;
}
