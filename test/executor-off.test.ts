import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

/**
 * Decisión de producto: no activamos la delegación al Executor (el servicio
 * que renueva y hace boarding con la wallet cerrada). El daemon sigue en 0.0.x,
 * los operadores de Mutinynet/mainnet no anuncian su URL y cambia la semántica
 * de la dirección de boarding y de la renovación.
 *
 * `UnilateralExit.Executor` es otra cosa y sigue en uso: es el ejecutor local
 * de la salida unilateral, no el servicio de delegación.
 */
const root = resolve(__dirname, '..', 'src');

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return ['.ts', '.tsx'].includes(extname(entry.name)) ? [full] : [];
  });

const sources = sourceFiles(root).map(file => ({
  file,
  text: readFileSync(file, 'utf8'),
}));

const forbidden = [
  /\bexecutorProvider\b/,
  /\bIExecutorManager\b/,
  /\bRestExecutorProvider\b/,
  /\bregisterBoarding\b/,
  /\bregisterRenewal\b/,
  /\bexecutorManager\b/,
];

describe('delegación al Executor desactivada', () => {
  it('no configura ni invoca el servicio de delegación en ninguna pantalla', () => {
    const offenders = sources
      .filter(({ text }) => forbidden.some(pattern => pattern.test(text)))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});
