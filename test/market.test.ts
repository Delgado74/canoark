import type { SwapPolicy } from '@arkade-os/swap';
import {
  clearPreferredSwapMarket,
  selectSwapMarket,
  setPreferredSwapMarket,
} from '../src/lib/arkade/marketSelection';
import { localSolverCards } from '../src/lib/arkade/solverCards';
import { solverDiscoveryOptions } from '../src/lib/arkade/solverDiscovery';

type Candidate = Parameters<NonNullable<SwapPolicy['selectMarket']>>[0][number];

const candidate = (
  solver: string,
  backend: 'feed' | 'rfq',
  key = 'arkade:BTC/arkade:USDT'
): Candidate =>
  ({
    card: { solver },
    key,
    backend,
    give: 'arkade',
  }) as unknown as Candidate;

describe('selección de mercado de solvers', () => {
  afterEach(() => clearPreferredSwapMarket());

  it('prefiere el mercado de feed sobre el RFQ del mismo par', () => {
    const rfq = candidate('ln-solver-mutinynet', 'rfq');
    const feed = candidate('frenchman', 'feed');

    expect(selectSwapMarket([rfq, feed])).toBe(feed);
    expect(selectSwapMarket([feed, rfq])).toBe(feed);
  });

  it('respeta la tarjeta que la UI acaba de elegir, aunque sea RFQ', () => {
    const rfq = candidate('ln-solver-mutinynet', 'rfq');
    const feed = candidate('frenchman', 'feed');
    setPreferredSwapMarket({ key: rfq.key, solver: 'ln-solver-mutinynet' });

    expect(selectSwapMarket([feed, rfq])).toBe(rfq);
  });

  it('no elige una tarjeta fijada de otro par y conserva el orden', () => {
    const first = candidate('first', 'rfq');
    const second = candidate('second', 'rfq');
    setPreferredSwapMarket({ key: 'otro:par', solver: 'first' });

    expect(selectSwapMarket([first, second])).toBe(first);
    expect(selectSwapMarket([])).toBeUndefined();
  });

  it('la tarjeta beta de mainnet no se ofrece en mutinynet', () => {
    expect(localSolverCards('bitcoin')).toHaveLength(1);
    expect(localSolverCards('mutinynet')).toHaveLength(0);
    expect(localSolverCards('bitcoin')[0].label).toBe('beta-solver');
  });

  it('unifica discovery entre la lectura de mercados y el cliente de swaps', () => {
    const options = solverDiscoveryOptions({
      swapNetwork: 'bitcoin',
      solverRegistryUrl: 'https://example.test/solvers.json',
    });

    expect(options.network).toBe('bitcoin');
    expect(options.registryUrl).toBe('https://example.test/solvers.json');
    expect(options.localCards).toHaveLength(1);
    expect(typeof options.transportCards).toBe('object');
    expect(options.transportCards).not.toBeNull();
  });
});
