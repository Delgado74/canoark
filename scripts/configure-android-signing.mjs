import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Parchea android/app/build.gradle para firmar el APK release con un keystore
 * propio. Se ejecuta SIEMPRE después de `expo prebuild`, porque prebuild --clean
 * borra el directorio android/.
 *
 * Entradas (todas obligatorias para activar la firma):
 *   ANDROID_KEYSTORE_PATH  ruta local al .jks
 *   o ANDROID_KEYSTORE_BASE64  contenido del .jks en base64
 *   ANDROID_KEYSTORE_PASSWORD
 *   ANDROID_KEY_ALIAS
 *   ANDROID_KEY_PASSWORD
 *
 * Sin secretos no hace nada: Gradle seguirá firmando con el keystore de debug
 * que genera el SDK. Ese APK sirve para probar, no para publicar.
 */

const buildGradlePath = resolve('android/app/build.gradle');
if (!existsSync(buildGradlePath)) {
  console.error(
    'No existe android/app/build.gradle. Ejecuta primero `expo prebuild`.'
  );
  process.exit(1);
}

const keystorePath = process.env.ANDROID_KEYSTORE_PATH;
const keystoreBase64 = process.env.ANDROID_KEYSTORE_BASE64;
const storePassword = process.env.ANDROID_KEYSTORE_PASSWORD;
const keyAlias = process.env.ANDROID_KEY_ALIAS;
const keyPassword = process.env.ANDROID_KEY_PASSWORD;

const enabled =
  Boolean(keystorePath || keystoreBase64) &&
  Boolean(storePassword && keyAlias && keyPassword);

if (!enabled) {
  console.log(
    'Firma release no configurada: se usará el keystore de debug del SDK.'
  );
  process.exit(0);
}

let storeFileExpression;
if (keystoreBase64) {
  const output = resolve('android/app/release.keystore');
  writeFileSync(output, Buffer.from(keystoreBase64, 'base64'));
  storeFileExpression = "file('release.keystore')";
  console.log(`Keystore decodificado en ${output}`);
} else {
  const absolute = resolve(keystorePath);
  if (!existsSync(absolute)) {
    console.error(`No existe el keystore: ${absolute}`);
    process.exit(1);
  }
  storeFileExpression = `file(${JSON.stringify(absolute)})`;
}

let gradle = readFileSync(buildGradlePath, 'utf8');

const debugAnchor = `        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }`;

if (!gradle.includes(debugAnchor)) {
  console.error(
    'No se encontró el bloque signingConfigs.debug esperado en build.gradle.'
  );
  process.exit(1);
}

const buildTypesIndex = gradle.indexOf('    buildTypes {');
if (buildTypesIndex === -1) {
  console.error('No se encontró el bloque buildTypes en build.gradle.');
  process.exit(1);
}

const head = gradle.slice(0, buildTypesIndex);
const tail = gradle.slice(buildTypesIndex);

const releaseSigningPattern =
  /(release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/;
if (!releaseSigningPattern.test(tail)) {
  if (tail.includes('signingConfig signingConfigs.release')) {
    console.log('La firma release ya estaba configurada.');
    process.exit(0);
  }
  console.error(
    'No se encontró signingConfig signingConfigs.debug dentro de release.'
  );
  process.exit(1);
}

const patchedTail = tail.replace(
  releaseSigningPattern,
  '$1signingConfig signingConfigs.release'
);

const releaseSigningConfig = `
        release {
            storeFile ${storeFileExpression}
            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias System.getenv("ANDROID_KEY_ALIAS")
            keyPassword System.getenv("ANDROID_KEY_PASSWORD")
        }`;

const patchedHead = head.replace(
  debugAnchor,
  `${debugAnchor}\n${releaseSigningConfig}`
);

if (patchedHead === head) {
  console.error('No se pudo insertar el bloque signingConfigs.release.');
  process.exit(1);
}

gradle = patchedHead + patchedTail;
writeFileSync(buildGradlePath, gradle);
console.log('build.gradle parcheado para firmar el release con el keystore.');
