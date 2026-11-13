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
