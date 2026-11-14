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
  /** Esplora usado para detectar depósitos onchain (boarding). */
  esploraUrl: string;
  /** Explorador Arkade (vmempool) para transacciones offchain. */
  explorerUrl: string;
  /**
   * Explorador del chain base (mempool), el que hay que mirar para verificar un
   * depósito al boarding. Es distinto del Arkade: un UTXO onchain no aparece en
   * el vmempool hasta que se liquida.
   */
  onchainExplorerUrl: string;
  addressPrefix: 'ark1' | 'tark1';
  /** Servicio de delegación de renovaciones, igual que Arkade Wallet. */
  delegateUrl: string | null;
  /** Índice de solvers publicado por arkade-os/solver-registry. */
  solverRegistryUrl: string;
  /** Servidor LNURL/Lightning Address. */
  lnurlServer: string;
  /** Dominio que se muestra en la dirección Lightning (usuario@dominio). */
  lnurlDomain: string;
  /** Segundos antes de expirar en los que la wallet renueva un virtual output. */
  vtxoThresholdSeconds: number;
};

const SOLVER_REGISTRY_BASE = 'https://arkade-os.github.io/solver-registry';

export const NETWORKS: Record<ArkadeNetworkName, NetworkConfig> = {
  mainnet: {
    name: 'mainnet',
    label: 'Bitcoin mainnet',
    isMainnet: true,
    swapNetwork: 'bitcoin',
    operatorUrl: 'https://arkade.computer',
    indexerUrl: 'https://arkade.computer',
    esploraUrl: 'https://mempool.arkade.sh/api',
    explorerUrl: 'https://arkade.space',
    onchainExplorerUrl: 'https://mempool.space',
    addressPrefix: 'ark1',
    delegateUrl: 'https://delegate.arkade.money',
    solverRegistryUrl: `${SOLVER_REGISTRY_BASE}/bitcoin.json`,
    lnurlServer: 'https://lnurl.arkade.sh',
    lnurlDomain: 'arkade.money',
    vtxoThresholdSeconds: 60 * 60 * 24 * 3,
  },
  mutinynet: {
    name: 'mutinynet',
    label: 'Mutinynet (pruebas)',
    isMainnet: false,
    swapNetwork: 'mutinynet',
    operatorUrl: 'https://mutinynet.arkade.sh',
    indexerUrl: 'https://mutinynet.arkade.sh',
    esploraUrl: 'https://mempool.mutinynet.arkade.sh/api',
    explorerUrl: 'https://explorer.mutinynet.arkade.sh',
    onchainExplorerUrl: 'https://mutinynet.com',
    addressPrefix: 'tark1',
    delegateUrl: 'https://delegator.mutinynet.arkade.sh',
    solverRegistryUrl: `${SOLVER_REGISTRY_BASE}/mutinynet.json`,
    lnurlServer: 'https://lnurl.mutinynet.arkade.sh',
    lnurlDomain: 'lnurl.mutinynet.arkade.sh',
    vtxoThresholdSeconds: 60 * 60 * 24 * 3,
  },
};

const requested = process.env.EXPO_PUBLIC_ARKADE_NETWORK;

export const ACTIVE_NETWORK_NAME: ArkadeNetworkName =
  requested === 'mainnet' ? 'mainnet' : 'mutinynet';

const base = NETWORKS[ACTIVE_NETWORK_NAME];

const env = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const delegateOverride = env(process.env.EXPO_PUBLIC_DELEGATOR_URL);

/**
 * Los valores por defecto replican la configuración de Arkade Wallet
 * (delegator, registro de solvers y LNURL). Las variables de entorno solo
 * permiten apuntar a un despliegue propio.
 */
export const ACTIVE_NETWORK: NetworkConfig = {
  ...base,
  operatorUrl: env(process.env.EXPO_PUBLIC_ARKADE_SERVER_URL) ?? base.operatorUrl,
  indexerUrl:
    env(process.env.EXPO_PUBLIC_ARKADE_INDEXER_URL) ?? base.indexerUrl,
  esploraUrl:
    env(process.env.EXPO_PUBLIC_ARKADE_ESPLORA_URL) ?? base.esploraUrl,
  delegateUrl:
    delegateOverride === undefined
      ? base.delegateUrl
      : delegateOverride.toLowerCase() === 'none'
        ? null
        : delegateOverride,
  solverRegistryUrl:
    env(process.env.EXPO_PUBLIC_SOLVER_REGISTRY_URL) ??
    base.solverRegistryUrl,
  lnurlServer:
    env(process.env.EXPO_PUBLIC_LNURL_SERVER) ??
    env(process.env.EXPO_PUBLIC_LNURL_BASE_URL) ??
    base.lnurlServer,
  lnurlDomain:
    env(process.env.EXPO_PUBLIC_LNURL_DOMAIN) ?? base.lnurlDomain,
};
