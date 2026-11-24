import {
  nostrCardFetcher,
  sharedNostrPool,
} from '@arkade-os/swap/nostr';
import type { DiscoverMarketsOptions } from '@arkade-os/swap/protocol';
import type { NetworkConfig } from '../../constants/network';
import { localSolverCards } from './solverCards';

let transportCards: ReturnType<typeof nostrCardFetcher> | null = null;

const sharedTransportCards = (): ReturnType<typeof nostrCardFetcher> => {
  if (!transportCards) {
    transportCards = nostrCardFetcher({ pool: sharedNostrPool() });
  }
  return transportCards;
};

/** Unifica la configuración de lectura del registro y la que usa el cliente al cotizar. */
export function solverDiscoveryOptions(
  network: Pick<NetworkConfig, 'swapNetwork' | 'solverRegistryUrl'>
): Omit<DiscoverMarketsOptions, 'repository' | 'useCache'> {
  return {
    network: network.swapNetwork,
    registryUrl: network.solverRegistryUrl,
    localCards: localSolverCards(network.swapNetwork),
    transportCards: sharedTransportCards(),
    logger: (...args) => console.warn('[solver discovery]', ...args),
  };
}
