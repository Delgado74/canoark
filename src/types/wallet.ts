export type BalanceView = {
  available: number;
  settled: number;
  preconfirmed: number;
  recoverable: number;
  /** Total onchain: confirmed + unconfirmed. */
  boarding: number;
  /** Depósitos onchain con confirmaciones, listos para el próximo batch. */
  boardingConfirmed: number;
  /** Depósitos onchain vistos en mempool, pendientes de confirmación. */
  boardingUnconfirmed: number;
};

export type CoinStatus =
  | 'settled'
  | 'preconfirmed'
  | 'unconfirmed'
  | 'recoverable'
  | 'spent'
  | 'swept';

export type CoinView = {
  id: string;
  kind: 'vtxo' | 'boarding';
  value: number;
  txid: string;
  vout: number;
  /** Momento de expiración en milisegundos, si el SDK lo conoce. */
  expiresAt: number | null;
  createdAt: number | null;
  status: CoinStatus;
  isSpent: boolean;
  isSwept: boolean;
};
