import { ACTIVE_NETWORK, type NetworkConfig } from '../../constants/network';

/**
 * Comprobación directa contra Esplora.
 *
 * El saldo de boarding que muestra la wallet viene del SDK, que solo pinta
 * UTXOs que su proveedor onchain ha visto. Si un depósito no aparece, conviene
 * mirar la fuente original: la API de Esplora de la red compilada.
 */
export type OnchainUtxo = {
  txid: string;
  vout: number;
  value: number;
  confirmed: boolean;
  blockHeight?: number;
};

export type OnchainAddressStatus = {
  address: string;
  /** Sats recibidos en total (confirmados + mempool). */
  received: number;
  /** Sats ya gastados por esta dirección. */
  spent: number;
  /** Sats disponibles según Esplora. */
  balance: number;
  txCount: number;
  mempoolTxCount: number;
  mempoolReceived: number;
  utxos: OnchainUtxo[];
  tipHeight: number | null;
  checkedAt: number;
};

type EsploraAddressStats = {
  chain_stats?: {
    funded_txo_count?: number;
    funded_txo_sum?: number;
    spent_txo_count?: number;
    spent_txo_sum?: number;
    tx_count?: number;
  };
  mempool_stats?: {
    funded_txo_count?: number;
    funded_txo_sum?: number;
    spent_txo_count?: number;
    spent_txo_sum?: number;
    tx_count?: number;
  };
};

const num = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Esplora respondió ${response.status} en ${url}`);
  }
  return (await response.json()) as T;
}

function esploraBase(network: NetworkConfig): string {
  return network.esploraUrl.replace(/\/+$/, '');
}

export async function inspectOnchainAddress(
  address: string,
  network: NetworkConfig = ACTIVE_NETWORK
): Promise<OnchainAddressStatus> {
  const base = esploraBase(network);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const [stats, utxos, tip] = await Promise.all([
      getJson<EsploraAddressStats>(
        `${base}/address/${encodeURIComponent(address)}`,
        controller.signal
      ),
      getJson<
        { txid: string; vout: number; value: number; status?: { confirmed?: boolean; block_height?: number } }[]
      >(`${base}/address/${encodeURIComponent(address)}/utxo`, controller.signal),
      getJson<number>(`${base}/blocks/tip/height`, controller.signal).catch(
        () => null
      ),
    ]);

    const chain = stats.chain_stats ?? {};
    const mempool = stats.mempool_stats ?? {};
    const received =
      num(chain.funded_txo_sum) + num(mempool.funded_txo_sum);
    const spent = num(chain.spent_txo_sum) + num(mempool.spent_txo_sum);

    return {
      address,
      received,
      spent,
      balance: Math.max(0, received - spent),
      txCount: num(chain.tx_count) + num(mempool.tx_count),
      mempoolTxCount: num(mempool.tx_count),
      mempoolReceived: num(mempool.funded_txo_sum),
      utxos: utxos.map(utxo => ({
        txid: utxo.txid,
        vout: utxo.vout,
        value: num(utxo.value),
        confirmed: Boolean(utxo.status?.confirmed),
        blockHeight: utxo.status?.block_height,
      })),
      tipHeight: typeof tip === 'number' ? tip : null,
      checkedAt: Date.now(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Comprueba que la dirección pertenece a la red compilada. Un `bc1…` en
 * Mutinynet (o al revés) explica la mayoría de depósitos que "desaparecen":
 * la transacción existe, pero en otra cadena.
 */
export function addressNetworkWarning(
  address: string,
  network: NetworkConfig = ACTIVE_NETWORK
): string | null {
  const value = address.trim().toLowerCase();
  if (!value) return null;

  if (network.isMainnet) {
    if (value.startsWith('tb1') || value.startsWith('bcrt1')) {
      return `Esta dirección parece de testnet/signet, pero la app está compilada para mainnet. No envíes fondos reales a una dirección de pruebas ni al contrario.`;
    }
    if (!value.startsWith('bc1')) {
      return 'La dirección no empieza por bc1: comprueba que es una dirección onchain de Bitcoin mainnet.';
    }
    return null;
  }

  if (value.startsWith('bc1')) {
    return `Esta dirección empieza por bc1 (mainnet), pero la app está compilada para ${network.label}. Enviar aquí desde mainnet no aparecerá en mutinynet.com.`;
  }
  if (value.startsWith('bcrt1')) {
    return 'Esta dirección es de regtest; la app está apuntando a una red pública de pruebas.';
  }
  if (!value.startsWith('tb1')) {
    return 'La dirección no empieza por tb1: comprueba que es una dirección onchain de Mutinynet/signet.';
  }
  return null;
}

export function onchainExplorerAddressUrl(
  address: string,
  network: NetworkConfig = ACTIVE_NETWORK
): string {
  return `${network.onchainExplorerUrl.replace(/\/+$/, '')}/address/${address}`;
}

export function onchainExplorerTxUrl(
  txid: string,
  network: NetworkConfig = ACTIVE_NETWORK
): string {
  return `${network.onchainExplorerUrl.replace(/\/+$/, '')}/tx/${encodeURIComponent(
    txid
  )}`;
}

export function arkadeExplorerTxUrl(
  txid: string,
  network: NetworkConfig = ACTIVE_NETWORK
): string {
  return `${network.explorerUrl.replace(/\/+$/, '')}/tx/${encodeURIComponent(
    txid
  )}`;
}

export function esploraAddressUrl(
  address: string,
  network: NetworkConfig = ACTIVE_NETWORK
): string {
  return `${esploraBase(network)}/address/${address}`;
}
