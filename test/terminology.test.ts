import fs from 'node:fs';
import path from 'node:path';

/**
 * Guarda de terminología: evita que vuelvan los términos que Arkade ya marcó
 * como obsoletos en los textos visibles de la APK.
 *
 * Solo revisa `src/app` y `src/components` (UI). Los identificadores del SDK
 * (`Vtxo`, `getVtxos`, `VtxoManager`, `kind: 'vtxo'`) son válidos y no se
 * tocan. El match `No VTXOs found` se conserva porque es un literal del SDK.
 */

const ROOT = path.join(__dirname, '..');
const SCAN_DIRS = ['src/app', 'src/components'];

type Rule = { name: string; pattern: RegExp };

const RULES: Rule[] = [
  { name: 'VTXO en prosa (usar «salida virtual»)', pattern: /\bVTXOs?\b/ },
  { name: 'ronda (usar «intercambio por lotes» o «lote»)', pattern: /\brondas?\b/i },
  { name: 'commitment transaction (usar «transacción de compromiso»)', pattern: /\bcommitment transaction\b/i },
  { name: 'batch swap (usar «intercambio por lotes»)', pattern: /\bbatch swap\b/i },
  { name: 'Arkade Mint (usar «Arkade Assets»)', pattern: /\bArkade Mint\b/i },
  { name: 'ASP / Ark server (usar «operador»)', pattern: /\b(?:ASP|ark server)\b/i },
  { name: 'arkoor / out-of-round (usar «transacción Arkade»)', pattern: /\b(?:arkoor|out-of-round)\b/i },
  { name: 'virtual mempool (usar «ejecución offchain»)', pattern: /\bvirtual mempool\b/i },
  { name: 'etiqueta Batch (usar «Lote»)', pattern: /\bBatch\b/ },
  { name: 'pantalla Servidor (usar «Operador»)', pattern: /title="Servidor"/ },
];

function collectFiles(dir: string): string[] {
  const absolute = path.join(ROOT, dir);
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap(entry => {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectFiles(relative);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [relative] : [];
  });
}

describe('terminología de Arkade en la UI', () => {
  const files = SCAN_DIRS.flatMap(collectFiles);

  it('encuentra archivos que revisar', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(RULES)('no usa «$name»', rule => {
    const offenders: string[] = [];

    for (const file of files) {
      const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n');
      lines.forEach((line, index) => {
        // Literal de error que devuelve el SDK; no es texto propio.
        if (line.includes('No VTXOs found')) return;
        if (rule.pattern.test(line)) {
          offenders.push(`${file}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});
