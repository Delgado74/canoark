export type ArkadeNetworkName = 'mainnet' | 'mutinynet';

export type NetworkConfig = {
  name: ArkadeNetworkName;
  label: string;
  isMainnet: boolean;
  /** Nombre que espera @arkade-os/swap para construir asset ids. */
  swapNetwork: 'bitcoin' | 'mutinynet';
  operatorUrl: string;
  /** En las redes públicas el indexer se sirve desde el mismo host del operator. */
  indexerUrl: string;
  explorerUrl: string;
  addressPrefix: 'ark1' | 'tark1';
  /** Segundos antes de expirar en los que la wallet renueva un virtual output. */
  vtxoThresholdSeconds: number;
};

export const NETWORKS: Record<ArkadeNetworkName, NetworkConfig> = {
  mainnet: {
    name: 'mainnet',
    label: 'Bitcoin mainnet',
    isMainnet: true,
    swapNetwork: 'bitcoin',
    operatorUrl: 'https://arkade.computer',
    indexerUrl: 'https://arkade.computer',
    explorerUrl: 'https://arkade.space',
    addressPrefix: 'ark1',
    vtxoThresholdSeconds: 60 * 60 * 24 * 3,
  },
  mutinynet: {
    name: 'mutinynet',
    label: 'Mutinynet (pruebas)',
    isMainnet: false,
    swapNetwork: 'mutinynet',
    operatorUrl: 'https://mutinynet.arkade.sh',
    indexerUrl: 'https://mutinynet.arkade.sh',
    explorerUrl: 'https://explorer.mutinynet.arkade.sh',
    addressPrefix: 'tark1',
    vtxoThresholdSeconds: 60 * 60 * 24 * 3,
  },
};

const requested = process.env.EXPO_PUBLIC_ARKADE_NETWORK;

export const ACTIVE_NETWORK_NAME: ArkadeNetworkName =
  requested === 'mainnet' ? 'mainnet' : 'mutinynet';

export const ACTIVE_NETWORK = NETWORKS[ACTIVE_NETWORK_NAME];
