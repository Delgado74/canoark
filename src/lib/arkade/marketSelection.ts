import type { SwapPolicy } from '@arkade-os/swap';

/**
 * Elige qué tarjeta del registro cotiza un swap.
 *
 * El registro de Mutinynet publica dos tarjetas para el mismo par de activos
 * (`BTC/f121ac9b` de `ln-solver-mutinynet` y `BTC/USDT` de `frenchman`). La
 * tarjeta RFQ es la primera de la instantánea, así que sin política el cliente
 * la elige y el solver contesta `unsupported_pair`: ese par no lo atiende.
 *
 * Los mercados de precio cotizan contra el feed público y no abren rendezvous,
 * por eso mandan cuando existen; el resto conserva el orden del registro.
 */
type PreferredMarket = { key: string; solver: string };

let preferred: PreferredMarket | null = null;

/** Fija la tarjeta que debe cotizar, la que el usuario acaba de leer en pantalla. */
export function setPreferredSwapMarket(
  market: { key: string; solver: string } | null | undefined
): void {
  preferred = market ? { key: market.key, solver: market.solver } : null;
}

export function clearPreferredSwapMarket(): void {
  preferred = null;
}

export const selectSwapMarket: NonNullable<SwapPolicy['selectMarket']> =
  candidates => {
    if (candidates.length === 0) return undefined;

    if (preferred) {
      // `key` identifica el par, no la tarjeta: dos solvers que publican el
      // mismo par comparten clave. El solver es lo que las distingue.
      const chosen = candidates.find(
        candidate =>
          candidate.key === preferred?.key &&
          candidate.card.solver === preferred?.solver
      );
      if (chosen) return chosen;
    }

    return (
      candidates.find(candidate => candidate.backend === 'feed') ?? candidates[0]
    );
  };
