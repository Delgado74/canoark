import * as SecureStore from 'expo-secure-store';
import { decode as decodeBolt11 } from 'light-bolt11-decoder';
import { ArkAddress, isValidArkAddress } from '@arkade-os/sdk';
import {
  btcOn,
  isSwapError,
  type PayResult,
  type Swap,
} from '@arkade-os/swap';
import {
  preimageForSwapRecord,
  type SwapSecretsProjection,
} from '@arkade-os/swap/protocol';
import {
  createLnurlClient,
  deriveSessionTokenWithSigner,
  LnurlError,
  type LnurlAddressErrorCode,
  type LnurlSession,
  type RegisteredAddress,
} from '@arkade-os/lnurl-client';
import { ACTIVE_NETWORK } from '../../constants/network';
import { errorMessage } from '../format';
import { getArkadeSession } from './client';
import { compressedPublicKeyHex } from './identity';
import { isLightningAddress, resolveLightningAddress } from './lnurl-pay';

/** Asset id del BTC dentro de Arkade, en la red configurada. */
function btcAsset() {
  return btcOn('arkade', ACTIVE_NETWORK.swapNetwork);
}

export function isLightningInvoice(value: string): boolean {
  // lnurl1… es un enlace LNURL, no una factura BOLT11. Se rechaza aquí para
  // que el solver no reciba un destino que no sabe interpretar.
  return /^ln(?!url)[a-z0-9]+1/i.test(value.trim());
}

/** Milisats del HRP (`lnbc2500u1…`) o `undefined` si la factura no lleva importe. */
const amountSectionSats = (sections: { name: string; value?: unknown }[]) => {
  const each = sections.find(section => section.name === 'amount');
  const millisats = each?.value;
  if (typeof millisats !== 'string' || !/^\d+$/.test(millisats)) return undefined;
  const sats = Number(BigInt(millisats) / 1000n);
  return sats > 0 ? sats : undefined;
};

/**
 * Importe que lleva dentro una factura BOLT11. Sin esto, quien paga una
 * factura generada en CanoArk veía el campo de importe vacío y tenía que
 * escribirlo a mano, aunque la factura ya lo fijaba.
 *
 * Las facturas sin importe ("amountless") devuelven `undefined`: ese es el caso
 * en el que sí hay que preguntarlo.
 */
export function invoiceAmountSats(value: string): number | undefined {
  const invoice = value.trim().replace(/^lightning:/i, '');
  if (!isLightningInvoice(invoice)) return undefined;
  try {
    return amountSectionSats(decodeBolt11(invoice).sections);
  } catch {
    return undefined;
  }
}

export function isOnchainAddress(value: string): boolean {
  return /^(bc1|tb1|bcrt1)[a-z0-9]{8,}$/i.test(value.trim());
}

/**
 * HRP real de una dirección Arkade válida, sea de la red activa o no.
 * `isValidArkAddress` del SDK sólo comprueba el checksum bech32m: acepta tanto
 * `ark1…` como `tark1…`. Decodificar da el HRP sin el separador y permite
 * detectar direcciones de otra red.
 */
export function arkadeAddressHrp(value: string): string | null {
  const address = value.trim();
  if (!isValidArkAddress(address)) return null;
  try {
    return ArkAddress.decode(address).hrp.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Dirección Arkade válida para la red activa. El SDK valida el checksum; aquí
 * se añade la comprobación de red para no enviar a un `ark1…` desde Mutinynet
 * (o al revés) y perder el pago.
 */
export function isArkadeAddress(value: string): boolean {
  return arkadeAddressHrp(value) === ACTIVE_NETWORK.addressHrp;
}

const feeCeiling = (maxFeeSats: number) => ({
  amount: BigInt(Math.max(0, Math.floor(maxFeeSats))),
  asset: btcAsset(),
});

/**
 * Paga una factura BOLT11 con el solver. Los envíos onchain **no** pasan por
 * aquí: se resuelven con una salida colaborativa (`wallet.settle`), que paga la
 * dirección de destino sin swap ni HTLC.
 *
 * Acepta también una Lightning Address (`usuario@dominio`): se resuelve con
 * LNURL-pay a una factura BOLT11 por el importe indicado antes de pagar.
 */
export async function payThroughSolver(
  destination: string,
  amountSats: number,
  maxFeeSats = 500
): Promise<PayResult> {
  const { swaps } = getArkadeSession();

  const target = destination.trim();
  const invoice = isLightningAddress(target)
    ? await resolveLightningAddress(target, amountSats)
    : target;

  if (!isLightningInvoice(invoice)) {
    throw new Error(
      'El solver sólo paga facturas Lightning. Para enviar onchain usa una dirección Bitcoin (la salida colaborativa).'
    );
  }

  // Con importe en la factura, el solver toma el importe de ahí y pasar otro
  // sería `AmountMismatch`. Sólo las facturas sin importe necesitan que se lo
  // indiquemos nosotros.
  const amountless = invoiceAmountSats(invoice) === undefined;
  if (amountless && amountSats <= 0) {
    throw new Error('La factura no incluye importe: indica cuántos sats pagar.');
  }

  return swaps.pay(invoice, {
    ...(amountless ? { amount: BigInt(Math.floor(amountSats)) } : {}),
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

/** Estados en los que el drive todavía tiene trabajo pendiente. */
export const PENDING_SWAP_OUTCOMES = [
  'accepted',
  'funding',
  'funded',
  'open',
  'filled',
  'cancelling',
  'refunding',
] as const;

export function isPendingSwapOutcome(outcome: string): boolean {
  return (PENDING_SWAP_OUTCOMES as readonly string[]).includes(outcome);
}

/** Todos los swaps guardados, con su estado actual. */
export async function listSwaps(): Promise<Swap[]> {
  const { swaps } = getArkadeSession();
  return swaps.swaps();
}

/**
 * Si hay un swap sin terminar. Se consulta antes de bloquear la wallet: cerrar
 * la sesión detiene el drive, y un envío onchain necesita reclamar su HTLC.
 */
export async function hasPendingSwaps(): Promise<boolean> {
  try {
    const swaps = await listSwaps();
    return swaps.some(swap => isPendingSwapOutcome(swap.outcome));
  } catch {
    return false;
  }
}

export function swapErrorMessage(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const message =
      current instanceof Error
        ? depth === 0 && isSwapError(current)
          ? `${current.name}: ${current.message}`
          : current.message
        : String(current);
    if (message && !parts.includes(message)) parts.push(message);
    current =
      current instanceof Error
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  if (parts.length === 0) return String(error);
  return parts.join('\nCausa: ');
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
  arkadeAddress: string;
  boardingAddress?: string;
  /** Nombre elegido por el usuario; el servidor lo asigna al azar si se omite. */
  username?: string;
  /** Código de reclamo emitido por el operador del dominio. */
  claimCode?: string;
  /** Receptor sin dirección (LNURL de sesión), útil si el dominio no permite nombres. */
  nameless?: boolean;
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

  const username = params.username?.trim().toLowerCase();
  const claimCode = params.claimCode?.trim();

  const registered = await client.registerAddress({
    token,
    domain: config.domain,
    ...(username ? { username } : {}),
    ...(claimCode ? { claimCode } : {}),
    ...(params.nameless && !username && !claimCode ? { nameless: true } : {}),
  });

  // Sin dirección (nameless) no hay handle LUD-16 que enlazar; el servidor
  // atiende la sesión por SSE y no admite identidad Arkade offline.
  if (!registered.nameless) {
    const claimPublicKey = await compressedPublicKeyHex(wallet.identity);
    await client.registerArkadeIdentity({
      token,
      handle: registered.handle,
      domain: registered.domain,
      arkadeAddress: params.arkadeAddress,
      claimPublicKey,
      boardingAddress: params.boardingAddress,
    });
  }

  if (registered.lightningAddress) {
    await saveLightningAddress(registered.lightningAddress);
  }

  return { token, registered };
}

export type LnurlCapabilities = {
  /** Dominio que se muestra en la dirección (`usuario@dominio`). */
  domain: string;
  /** Modos que permite el servidor: self, random, admin, session. */
  allocationModes: string[];
  usernameRules: {
    minLen: number;
    maxLen: number;
    pattern: string;
  };
};

/**
 * Qué permite el servidor LNURL activo. En mainnet (`lnurl.arkade.sh`) no
 * aparece `self`: no se puede elegir nombre, solo aceptar uno aleatorio, usar
 * un código de reclamo del operador o recibir por sesión.
 */
export async function getLnurlCapabilities(): Promise<LnurlCapabilities | null> {
  const config = getLnurlConfig();
  if (!config) return null;
  try {
    const client = createLnurlClient({ baseUrl: config.baseUrl });
    const capabilities = await client.domainCapabilities();
    return {
      domain: config.domain,
      allocationModes: capabilities.allocationModes,
      usernameRules: capabilities.usernameRules,
    };
  } catch {
    // Servidor caído o build antiguo: la pantalla cae al formulario clásico.
    return null;
  }
}

const LNURL_ERROR_MESSAGES: Partial<Record<LnurlAddressErrorCode, string>> = {
  forbidden_mode:
    'Este servidor no permite elegir el nombre. Genera una dirección automática o usa un código de reclamo.',
  invalid_claim: 'El código de reclamo no es válido o ya se usó.',
  username_required: 'Ese código de reclamo necesita un nombre de usuario.',
  invalid_username:
    'Nombre no válido: minúsculas, números, punto, guion o guion bajo.',
  taken: 'Ese nombre ya está en uso. Prueba con otro.',
  blacklisted: 'Ese nombre no está permitido en este servidor.',
  limit_reached: 'Alcanzaste el máximo de direcciones de este servidor.',
  invalid_token:
    'La sesión con el servidor LNURL no es válida. Vuelve a intentarlo.',
  not_found: 'El servidor no encuentra esa dirección.',
  already_named: 'Esa dirección ya tiene nombre.',
  invalid_rails: 'El servidor rechazó las opciones de pago de la dirección.',
};

/** Traduce los códigos del servidor LNURL a algo legible en la app. */
export function lnurlErrorMessage(error: unknown): string {
  if (error instanceof LnurlError) {
    if (error.httpStatus === 429) {
      return 'Demasiados intentos. Espera un minuto y vuelve a probar.';
    }
    const mapped = error.code
      ? LNURL_ERROR_MESSAGES[error.code as LnurlAddressErrorCode]
      : undefined;
    return mapped ?? error.reason ?? error.message;
  }
  return errorMessage(error);
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
