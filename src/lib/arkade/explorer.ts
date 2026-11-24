import { ACTIVE_NETWORK, type NetworkConfig } from '../../constants/network';

const trim = (url: string) => url.replace(/\/+$/, '');

/**
 * Explorador de Arkade (offchain). Muestra transacciones Arkade, no onchain:
 * un depósito al boarding todavía no aparece aquí hasta liquidarse.
 */
export function arkadeExplorerTxUrl(
  txid: string,
  network: NetworkConfig = ACTIVE_NETWORK
): string {
  return `${trim(network.explorerUrl)}/tx/${txid}`;
}

/** Explorador del chain base (mempool) para transacciones onchain. */
export function onchainExplorerTxUrl(
  txid: string,
  network: NetworkConfig = ACTIVE_NETWORK
): string {
  return `${trim(network.onchainExplorerUrl)}/tx/${txid}`;
}
