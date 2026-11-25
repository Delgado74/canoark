/**
 * Un rename o un export eliminado en @arkade-os/* debe romper este test aunque
 * la app no llegue a ejecutar la ruta afectada. Importamos los módulos reales
 * de CanoArk que consumen los paquetes de Arkade.
 */
import * as client from '../src/lib/arkade/client';
import * as lightning from '../src/lib/arkade/lightning';
import * as offboard from '../src/lib/arkade/offboard';
import * as exit from '../src/lib/arkade/exit';
import * as identity from '../src/lib/arkade/identity';
import * as assets from '../src/lib/arkade/assets';
import * as lnurlPay from '../src/lib/arkade/lnurl-pay';
import * as solverDiscovery from '../src/lib/arkade/solverDiscovery';
import * as solverCards from '../src/lib/arkade/solverCards';
import * as marketSelection from '../src/lib/arkade/marketSelection';
import * as bip21 from '../src/lib/bip21';
import * as sqlite from '../src/lib/storage/sqlite';
import * as sdk from '@arkade-os/sdk';
import * as swap from '@arkade-os/swap';
import * as protocol from '@arkade-os/swap/protocol';
import * as advanced from '@arkade-os/swap/advanced';

describe('Arkade SDK/swap exports usados por la app', () => {
  it('carga todos los módulos que tocan Arkade con las dependencias reales', () => {
    expect(typeof client.openArkadeSession).toBe('function');
    expect(typeof lightning.isLightningInvoice).toBe('function');
    expect(typeof offboard.sendCollaborativeExit).toBe('function');
    expect(typeof exit.estimateExit).toBe('function');
    expect(typeof exit.prepareExit).toBe('function');
    expect(typeof exit.executeExitPackage).toBe('function');
    expect(typeof identity.identityFromMnemonic).toBe('function');
    expect(typeof marketSelection.selectSwapMarket).toBe('function');
    expect(typeof sqlite.createExecutor).toBe('function');
    expect(typeof assets.parseUnits).toBe('function');
    expect(typeof lnurlPay.resolveLightningAddress).toBe('function');
    expect(typeof solverDiscovery.solverDiscoveryOptions).toBe('function');
    expect(typeof solverCards.localSolverCards).toBe('function');
    expect(typeof bip21.parseDestination).toBe('function');
  });

  it('expone los símbolos del SDK que el cableado necesita', () => {
    expect(typeof sdk.Wallet.create).toBe('function');
    expect(typeof sdk.MnemonicIdentity.fromMnemonic).toBe('function');
    expect(typeof sdk.EsploraProvider).toBe('function');
    expect(typeof sdk.RestDelegateProvider).toBe('function');
    expect(typeof sdk.contractSigner).toBe('function');
    expect(typeof swap.createSwapClient).toBe('function');
    expect(typeof swap.btcOn).toBe('function');
    expect(typeof swap.isSwapError).toBe('function');
    expect(typeof protocol.preimageForSwapRecord).toBe('function');
    expect(typeof protocol.l1ScriptForAddress).toBe('function');
    expect(typeof advanced.corridorRecordStore).toBe('function');
  });

  it('instala los polyfills antes de cargar el SDK', () => {
    expect(typeof globalThis.crypto.getRandomValues).toBe('function');
    expect(typeof globalThis.crypto.subtle).toBe('object');

    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    expect(Array.from(bytes).some(value => value !== 0)).toBe(true);
  });
});
