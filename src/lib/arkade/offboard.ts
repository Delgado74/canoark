import {
  ArkAddress,
  Estimator,
  type IWallet,
  type NormalizedExtendedVirtualCoin,
} from '@arkade-os/sdk';
import {
  l1ScriptForAddress,
  type OnchainNetwork,
} from '@arkade-os/swap/protocol';
import { ACTIVE_NETWORK } from '../../constants/network';

/**
 * Salida colaborativa (offboarding) de Arkade → L1.
 *
 * No hay swap ni HTLC: se gastan VTXOs propios en una ronda de settlement del
 * operador (`wallet.settle`) y la commitment transaction de esa ronda paga la
 * dirección Bitcoin de destino. Es exactamente el mecanismo de Arkade Wallet
 * para "enviar onchain".
 *
 * La única contraparte es el ASP, que cofirma la ronda: no hay solver, no hay
 * preimagen y no hay nada que reclamar después.
 */

/** El operador de Mutinynet comparte parámetros con testnet. */
const onchainNetwork = (): OnchainNetwork =>
  ACTIVE_NETWORK.isMainnet ? 'bitcoin' : 'testnet';

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

const OUTPUT_FEE_ROUNDS = 8;

/**
 * Importe de salida que cumple `out + fee(out) = amount`. Igual que Arkade
 * Wallet: el operador cobra sobre el importe que recibe, así que restar la
 * comisión una sola vez se queda corto.
 */
function outputAfterItsFee(
  estimator: Estimator,
  address: string,
  amount: number
): number {
  const script = toHex(ArkAddress.decode(address).pkScript);
  let out = amount;
  for (let round = 0; round < OUTPUT_FEE_ROUNDS; round += 1) {
    const next =
      amount -
      estimator.evalOffchainOutput({
        amount: BigInt(Math.max(out, 0)),
        script,
      }).satoshis;
    if (next === out) return Math.max(out, 0);
    out = next;
  }
  throw new Error(`La comisión de salida no cuadra para ${amount} sats.`);
}

const byExpiryAsc = (
  a: { expiresAt?: Date | null },
  b: { expiresAt?: Date | null }
): number =>
  (a.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY) -
  (b.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY);

export type CollaborativeExitPlan = {
  inputs: NormalizedExtendedVirtualCoin[];
  outputs: { address: string; amount: bigint }[];
  /** Comisión total: intent fee de cada input, la salida onchain y el cambio. */
  feeSats: number;
  /** Cambio que vuelve como VTXO; 0 cuando no supera el dust. */
  changeSats: number;
};

export type SendOnchainResult = {
  txid: string;
  feeSats: number;
  changeSats: number;
};

/**
 * Planifica la salida sin tocar la red más allá de leer saldo y comisiones.
 * Se separa de `settle` para poder validar la comisión máxima antes de firmar
 * y para mostrar el coste real en la pantalla de envío.
 */
export async function planCollaborativeExit(
  wallet: IWallet,
  destination: string,
  amountSats: number,
  maxFeeSats: number
): Promise<CollaborativeExitPlan> {
  if (!Number.isSafeInteger(amountSats) || amountSats <= 0) {
    throw new Error('Indica cuántos sats quieres enviar onchain.');
  }

  const [vtxos, info, ownAddress] = await Promise.all([
    wallet.getSpendableVtxos({
      withRecoverable: true,
      genericallySpendableOnly: true,
    }),
    wallet.getOperatorInfo(),
    wallet.getAddress(),
  ]);

  const estimator = new Estimator(info.fees?.intentFee ?? {});
  const dust = Number(info.dust ?? 0);

  // Límites del operador para salidas onchain (los mismos que aplica Arkade
  // Wallet antes de firmar).
  const utxoMin = Number(info.utxoMinAmount ?? 0);
  const utxoMax = Number(info.utxoMaxAmount ?? -1);
  if (utxoMax === 0) {
    throw new Error('El operador no permite salidas onchain en esta red.');
  }
  if (utxoMin > 0 && amountSats < utxoMin) {
    throw new Error(
      `La salida onchain mínima del operador es ${utxoMin} sats.`
    );
  }
  if (utxoMax > 0 && amountSats > utxoMax) {
    throw new Error(
      `La salida onchain máxima del operador es ${utxoMax} sats.`
    );
  }

  // Comisión que el operador cobra por crear la salida onchain.
  const outputScript = toHex(
    l1ScriptForAddress(destination, onchainNetwork())
  );
  const exitFee = estimator.evalOnchainOutput({
    amount: BigInt(amountSats),
    script: outputScript,
  }).satoshis;

  const candidates = vtxos
    .map(vtxo => ({
      vtxo,
      inputFee: estimator.evalOffchainInput({
        amount: BigInt(vtxo.value),
        type: vtxo.isSwept ? 'recoverable' : 'vtxo',
        weight: 0,
        birth: vtxo.createdAt,
        expiry: vtxo.expiresAt,
      }).satoshis,
    }))
    .filter(({ vtxo, inputFee }) => inputFee < vtxo.value)
    .sort(
      (a, b) =>
        Number(Boolean(a.vtxo.assets?.length)) -
          Number(Boolean(b.vtxo.assets?.length)) ||
        Number(a.inputFee > 0) - Number(b.inputFee > 0) ||
        byExpiryAsc(a.vtxo, b.vtxo)
    );

  const wanted = amountSats + exitFee;
  const inputs: NormalizedExtendedVirtualCoin[] = [];
  let net = 0;
  let inputFees = 0;
  let carriesAssets = false;

  for (const { vtxo, inputFee } of candidates) {
    inputs.push(vtxo);
    net += vtxo.value - inputFee;
    inputFees += inputFee;
    carriesAssets ||= Boolean(vtxo.assets?.length);
    if (net < wanted) continue;

    const left = net - wanted;
    if (left > 0) {
      const change = outputAfterItsFee(estimator, ownAddress, left);
      if (change > 0 && change >= dust) {
        const feeSats = inputFees + exitFee + left - change;
        if (feeSats > maxFeeSats) {
          throw new Error(
            `La salida onchain cuesta ${feeSats} sats de comisión y el máximo es ${maxFeeSats}.`
          );
        }
        return {
          inputs,
          outputs: [
            { address: destination, amount: BigInt(amountSats) },
            { address: ownAddress, amount: BigInt(change) },
          ],
          feeSats,
          changeSats: change,
        };
      }
    }
    if (carriesAssets) continue;

    const feeSats = inputFees + exitFee + left;
    if (feeSats > maxFeeSats) {
      throw new Error(
        `La salida onchain cuesta ${feeSats} sats de comisión y el máximo es ${maxFeeSats}.`
      );
    }
    return {
      inputs,
      outputs: [{ address: destination, amount: BigInt(amountSats) }],
      feeSats,
      changeSats: 0,
    };
  }

  const total = candidates.reduce((sum, { vtxo, inputFee }) => {
    return sum + vtxo.value - inputFee;
  }, 0);
  throw new Error(
    candidates.length === 0
      ? 'No hay VTXOs gastables para una salida onchain.'
      : `Saldo insuficiente para la salida onchain: hay ${total} sats netos y hacen falta ${wanted}.`
  );
}

/**
 * Ejecuta el offboarding: una ronda de settlement del operador paga la
 * dirección de destino con los VTXOs seleccionados.
 */
export async function sendCollaborativeExit(
  wallet: IWallet,
  destination: string,
  amountSats: number,
  maxFeeSats: number
): Promise<SendOnchainResult> {
  const plan = await planCollaborativeExit(
    wallet,
    destination,
    amountSats,
    maxFeeSats
  );

  const txid = await wallet.settle({
    inputs: plan.inputs,
    outputs: plan.outputs,
  });

  return {
    txid,
    feeSats: plan.feeSats,
    changeSats: plan.changeSats,
  };
}
