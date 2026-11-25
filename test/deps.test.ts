import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * El peer de `nostr-tools` es exacto: un `^2.26.0` rompe la instalación con
 * ERESOLVE. Comprobar los manifest instalados detecta la rotura aunque el
 * lockfile se haya regenerado con `--legacy-peer-deps`.
 */
const root = resolve(__dirname, '..');

const manifest = (relative: string): Record<string, any> =>
  JSON.parse(readFileSync(resolve(root, relative), 'utf8'));

const app = manifest('package.json');
const sdk = manifest('node_modules/@arkade-os/sdk/package.json');
const swap = manifest('node_modules/@arkade-os/swap/package.json');
const lnurl = manifest('node_modules/@arkade-os/lnurl-client/package.json');
const nostr = manifest('node_modules/nostr-tools/package.json');

describe('manifiestos de dependencias Arkade', () => {
  it('fija versiones exactas en package.json', () => {
    for (const name of [
      '@arkade-os/sdk',
      '@arkade-os/swap',
      '@arkade-os/lnurl-client',
      'nostr-tools',
    ]) {
      expect(app.dependencies[name]).toBe(manifest(`node_modules/${name}/package.json`).version);
    }
  });

  it('respeta el peer exacto de nostr-tools que exige @arkade-os/swap', () => {
    expect(swap.peerDependencies['nostr-tools']).toBe(nostr.version);
    expect(app.dependencies['nostr-tools']).toBe(swap.peerDependencies['nostr-tools']);
  });

  it('mantiene sdk y swap en la versión que el paquete swap declara', () => {
    expect(swap.dependencies['@arkade-os/sdk']).toBe(sdk.version);
  });

  it('mantiene lnurl-client compatible con la versión instalada del SDK', () => {
    // El peer es `>=0.5.0-rc.0`: basta con que siga en la serie 0.5.x.
    expect(lnurl.peerDependencies['@arkade-os/sdk']).toContain('0.5.0');
    expect(sdk.version).toMatch(/^0\.5\./);
  });
});
