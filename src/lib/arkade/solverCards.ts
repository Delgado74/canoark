import betaSolverCard from './solver-cards/beta-solver.card.json';

/**
 * Tarjetas de solver incluidas en el build.
 *
 * El registro público de mainnet (`solver-registry/bitcoin.json`) se publica con
 * `markets: []` y `solvers: []`: no hay solver Lightning anunciado todavía. El
 * solver que sí atiende mainnet es el de Ark Labs, y su tarjeta viaja dentro de
 * la app (misma que bundlea Arkade Wallet) porque la tarjeta ya trae su propio
 * rendezvous (pubkey + relays Nostr), no una URL que consultar.
 *
 * Sin esto, `discovery` no encuentra mercado para `arkade:BTC -> bolt11:BTC` y
 * crear o pagar una factura Lightning en mainnet falla con «no market».
 *
 * Acotada a `bitcoin` a propósito: la pubkey y el relay son del solver de
 * producción; ofrecerla en mutinynet cotizaría con una contraparte de mainnet.
 */
export const LOCAL_SOLVER_CARDS = [
  {
    card: betaSolverCard,
    network: 'bitcoin' as const,
    label: 'beta-solver',
  },
];

/** Tarjetas locales que aplican a la red de swaps activa. */
export function localSolverCards(network: 'bitcoin' | 'mutinynet') {
  return LOCAL_SOLVER_CARDS.filter(entry => entry.network === network);
}
