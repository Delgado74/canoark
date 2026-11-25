import {
  UnilateralExit,
  deserializeExitPackage,
  serializeExitPackage,
  type ExecutorEvent,
  type ExitPackage,
  type ExitQuote,
  type NetworkName,
  type OnchainProvider,
  type OnchainWallet,
  type Outpoint,
  type Wallet,
} from '@arkade-os/sdk';
import { ACTIVE_NETWORK } from '../../constants/network';

/**
 * Salida unilateral (unroll + CSV sweep).
 *
 * Es el último recurso si el operador deja de cofirmar: las transacciones ya
 * vienen prefirmadas por la wallet y el ejecutor no necesita claves ni el
 * operador, solo un endpoint Esplora. No es una operación rutinaria y no es
 * gratis: cada nivel de la rama y cada gasto offchain pagan una transacción
 * Bitcoin.
 */

/** Mutinynet comparte parámetros con testnet, pero el paquete debe llevar su nombre. */
const EXIT_NETWORK = ACTIVE_NETWORK.swapNetwork as NetworkName;

export type ExitEstimate = ExitQuote;

export async function estimateExit(params: {
  wallet: Wallet;
  onchainWallet: OnchainWallet;
  sweepAddress: string;
  vtxos?: Outpoint[];
  feeRate?: number;
}): Promise<ExitEstimate> {
  // Se cotiza en `graph`, el mismo modo con el que se prepara el paquete. El
  // `funded` reservaría un splitter que nunca se difunde y sobreestimaría el
  // coste real.
  const [quote, balanceSats] = await Promise.all([
    UnilateralExit.estimate({
      wallet: params.wallet,
      onchainWallet: params.onchainWallet,
      sweepAddress: params.sweepAddress,
      vtxos: params.vtxos,
      feeRate: params.feeRate,
      networkName: EXIT_NETWORK,
      mode: 'graph',
    }),
    params.onchainWallet.getBalance(),
  ]);

  return {
    ...quote,
    fundingAddress: params.onchainWallet.address,
    currentBalanceSats: balanceSats,
    shortfallSats: Math.max(0, quote.totals.fundingRequiredSats - balanceSats),
  };
}

export async function prepareExit(params: {
  wallet: Wallet;
  onchainWallet: OnchainWallet;
  sweepAddress: string;
  vtxos?: Outpoint[];
  feeRate?: number;
}): Promise<{ package: ExitPackage; envelope: string }> {
  const pkg = await UnilateralExit.prepare({
    wallet: params.wallet,
    onchainWallet: params.onchainWallet,
    sweepAddress: params.sweepAddress,
    vtxos: params.vtxos,
    feeRate: params.feeRate,
    networkName: EXIT_NETWORK,
    // "graph" no difunde el splitter al preparar: el fee se paga al ejecutar.
    // Así el plan se puede guardar como seguro sin gastar BTC por adelantado.
    mode: 'graph',
  });

  return { package: pkg, envelope: serializeExitPackage(pkg) };
}

/**
 * Ejecuta un paquete con el ejecutor sin claves. Es idempotente: si la app se
 * cierra a mitad, volver a ejecutarlo reanuda desde el estado de la cadena.
 */
export async function executeExitPackage(params: {
  envelope: string;
  provider: OnchainProvider;
  feeWallet: OnchainWallet;
  onEvent?: (event: ExecutorEvent) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const pkg = deserializeExitPackage(params.envelope);
  const executor = new UnilateralExit.Executor(pkg, params.provider, {
    feeWallet: params.feeWallet,
    signal: params.signal,
  });

  for await (const event of executor) {
    params.onEvent?.(event);
  }
}
