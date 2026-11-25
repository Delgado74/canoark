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

/**
 * Red L1 del destino onchain.
 *
 * Se deduce del prefijo de la dirección en vez de asumir siempre la red activa:
 * `l1ScriptForAddress` rechaza el HRP equivocado y una salida a una dirección
 * `bcrt1…` (regtest de CI) no se puede ni cotizar con los parámetros de
 * testnet. El script resultante es idéntico entre redes; el prefijo solo sirve
 * para decodificar la dirección.
 */
export function onchainNetworkOf(address: string): OnchainNetwork {
  const lower = address.toLowerCase();
  if (lower.startsWith('bcrt1')) return 'regtest';
  if (lower.startsWith('bc1') || lower.startsWith('1') || lower.startsWith('3')) {
    return 'bitcoin';
  }
  if (lower.startsWith('tb1') || /^[mn2]/.test(address)) return 'testnet';
  return ACTIVE_NETWORK.isMainnet ? 'bitcoin' : 'testnet';
}

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
 * Cotiza la salida sin aplicar ningún techo de comisión. La pantalla la usa
 * para enseñar el coste real antes de pedir al usuario que suba su máximo.
 */
export async function quoteCollaborativeExit(
  wallet: IWallet,
  destination: string,
  amountSats: number
): Promise<CollaborativeExitPlan> {
  return buildCollaborativeExit(wallet, destination, amountSats);
}

/**
 * Planifica la salida y rechaza si la comisión supera `maxFeeSats`. Se separa
 * de `settle` para validar antes de firmar.
 */
export async function planCollaborativeExit(
  wallet: IWallet,
  destination: string,
  amountSats: number,
  maxFeeSats: number
): Promise<CollaborativeExitPlan> {
  const plan = await buildCollaborativeExit(wallet, destination, amountSats);
  if (plan.feeSats > maxFeeSats) {
    throw new Error(
      `La salida onchain cuesta ${plan.feeSats} sats de comisión y el máximo es ${maxFeeSats}.`
    );
  }
  return plan;
}

async function buildCollaborativeExit(
  wallet: IWallet,
  destination: string,
  amountSats: number
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
    l1ScriptForAddress(destination, onchainNetworkOf(destination))
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
        // Menor número de inputs = menor comisión. Los outputs con más valor
        // neto van primero; el vencimiento solo desempata para no dejar
        // expirar los que estaban a punto.
        b.vtxo.value - b.inputFee - (a.vtxo.value - a.inputFee) ||
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

export type ConsolidationPlan = {
  inputs: NormalizedExtendedVirtualCoin[];
  outputs: { address: string; amount: bigint }[];
  /** Comisión total: intent fee de cada input + fee del output consolidado. */
  feeSats: number;
  /** Sats que quedan en el único output consolidado. */
  outputSats: number;
  inputCount: number;
};

/**
 * Consolida los VTXOs gastables en uno solo.
 *
 * No abarata un offboard inmediato: añade una ronda de settlement. Sirve para
 * reiniciar la profundidad de la rama (salida unilateral más barata) y para
 * evitar que el próximo pago tenga que gastar muchos inputs pequeños. No toca
 * outputs con assets: el activo viaja en su propio VTXO y no debe mezclarse.
 */
export async function planVtxoConsolidation(
  wallet: IWallet
): Promise<ConsolidationPlan> {
  const [vtxos, info, ownAddress] = await Promise.all([
    wallet.getSpendableVtxos({
      withRecoverable: false,
      genericallySpendableOnly: true,
    }),
    wallet.getOperatorInfo(),
    wallet.getAddress(),
  ]);

  const estimator = new Estimator(info.fees?.intentFee ?? {});
  const dust = Number(info.dust ?? 0);
  const priced = vtxos
    .filter(vtxo => !vtxo.assets?.length)
    .map(vtxo => ({
      vtxo,
      inputFee: estimator.evalOffchainInput({
        amount: BigInt(vtxo.value),
        type: 'vtxo',
        weight: 0,
        birth: vtxo.createdAt,
        expiry: vtxo.expiresAt,
      }).satoshis,
    }))
    .filter(({ vtxo, inputFee }) => inputFee < vtxo.value);

  if (priced.length < 2) {
    throw new Error(
      'No hay al menos dos VTXOs sin activos que merezca la pena consolidar.'
    );
  }

  const inputFees = priced.reduce((sum, item) => sum + item.inputFee, 0);
  const net = priced.reduce(
    (sum, { vtxo, inputFee }) => sum + vtxo.value - inputFee,
    0
  );
  const outputSats = outputAfterItsFee(estimator, ownAddress, net);
  if (outputSats <= 0 || outputSats < dust) {
    throw new Error(
      `La consolidación dejaría ${Math.max(
        0,
        outputSats
      )} sats, por debajo del mínimo del operador (${dust} sats).`
    );
  }

  return {
    inputs: priced.map(({ vtxo }) => vtxo),
    outputs: [{ address: ownAddress, amount: BigInt(outputSats) }],
    feeSats: inputFees + (net - outputSats),
    outputSats,
    inputCount: priced.length,
  };
}

export async function consolidateVtxos(wallet: IWallet): Promise<{
  txid: string;
  feeSats: number;
  outputSats: number;
  inputCount: number;
}> {
  const plan = await planVtxoConsolidation(wallet);
  const txid = await wallet.settle({
    inputs: plan.inputs,
    outputs: plan.outputs,
  });
  return {
    txid,
    feeSats: plan.feeSats,
    outputSats: plan.outputSats,
    inputCount: plan.inputCount,
  };
}
