import { ArkAddress } from '@arkade-os/sdk';
import { InsufficientFunds, btcOn, isSwapError } from '@arkade-os/swap';
import {
  arkadeAddressHrp,
  invoiceAmountSats,
  isArkadeAddress,
  isLightningInvoice,
  isOnchainAddress,
  isPendingSwapOutcome,
  swapErrorMessage,
} from '../src/lib/arkade/lightning';
import { parseDestination } from '../src/lib/bip21';

const arkAddress = (hrp: 'tark' | 'ark') =>
  new ArkAddress(
    new Uint8Array(32).fill(1),
    new Uint8Array(32).fill(2),
    hrp
  ).encode();

describe('destinos y estados de pago', () => {
  it('clasifica facturas BOLT11, LNURL y direcciones sin confundirlas', () => {
    expect(isLightningInvoice('lnbc2500u1p5xyz')).toBe(true);
    expect(isLightningInvoice('lightning:lnbc2500u1p5xyz')).toBe(false);
    expect(isLightningInvoice('lnurl1dp68gurn8ghj7')).toBe(false);
    expect(isOnchainAddress('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx')).toBe(
      true
    );
    expect(isOnchainAddress('tark1qqqq')).toBe(false);
  });

  it('una factura sin HRP de importe no inventa amount', () => {
    expect(invoiceAmountSats('lnbc1invalid')).toBeUndefined();
    expect(invoiceAmountSats('lnurl1dp68gurn8ghj7')).toBeUndefined();
  });

  it('rechaza direcciones Arkade de otra red por el HRP', () => {
    const testnet = arkAddress('tark');
    const mainnet = arkAddress('ark');

    expect(arkadeAddressHrp(testnet)).toBe('tark');
    // La app compila para Mutinynet en los tests: rechaza ark1.
    expect(isArkadeAddress(testnet)).toBe(true);
    expect(isArkadeAddress(mainnet)).toBe(false);
  });

  it('parsea BIP21 sin perder la dirección ni el importe', () => {
    const parsed = parseDestination(
      'bitcoin:tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx?amount=0.0001'
    );
    expect(parsed.kind).toBe('onchain');
    expect(parsed.amountSats).toBe(10_000);
  });

  it('conoce el asset id de BTC del namespace y red de swaps', () => {
    expect(btcOn('arkade', 'mutinynet')).toBe('arkade:mutinynet/slip44:1');
    expect(btcOn('arkade', 'bitcoin')).toBe('arkade:bitcoin/slip44:0');
  });

  it('conserva la taxonomía de errores y outcomes del swap client', () => {
    const error = new InsufficientFunds(btcOn('arkade', 'bitcoin'), 1000n, 500n);
    expect(isSwapError(error)).toBe(true);
    expect(swapErrorMessage(error)).toContain('InsufficientFunds');

    expect(isPendingSwapOutcome('funding')).toBe(true);
    expect(isPendingSwapOutcome('claimed')).toBe(false);
  });
});
