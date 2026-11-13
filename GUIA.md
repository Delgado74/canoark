# CanoArk — guía técnica

Esta guía describe cómo está construida CanoArk, qué APIs de Arkade usa y cómo
compilarla sin EAS. Las versiones y nombres de API están verificados contra los
paquetes publicados en npm y la documentación oficial
([docs.arkadeos.com](https://docs.arkadeos.com)).

## 1. Versiones de referencia

| Componente | Versión |
| --- | --- |
| Expo SDK | 58 (`expo@~58.0.24`) |
| React Native | 0.88.1 |
| React | 19.3.0 |
| `@arkade-os/sdk` | 0.5.5 |
| `@arkade-os/swap` | 0.1.5 |
| `@arkade-os/lnurl-client` | 0.9.2 |
| `nostr-tools` | 2.24.1 (fijada) |
| Node.js | 22 |
| JDK | 17 |

`nostr-tools` se fija a `2.24.1` porque `@arkade-os/swap@0.1.5` lo declara como
peer opcional exacto. Con `^2.26.0` npm falla con `ERESOLVE`.

## 2. Redes y endpoints

La red se elige al compilar con `EXPO_PUBLIC_ARKADE_NETWORK`:

```text
mutinynet  → https://mutinynet.arkade.sh   (bitcoin de prueba)
mainnet    → https://arkade.computer       (bitcoin real)
```

`src/constants/network.ts` centraliza:

- `operatorUrl` e `indexerUrl`.
- `addressPrefix` (`tark1` en Mutinynet, `ark1` en mainnet).
- `swapNetwork` (`mutinynet` o `bitcoin`), que se pasa a `btcOn()` para
  construir el asset id de BTC.
- `vtxoThresholdSeconds`, el margen de renovación de outputs virtuales.

La red se inlinea en el bundle. No se puede cambiar en tiempo de ejecución sin
recompilar, y la mnemónica debe crearse con `isMainnet` coherente:

```ts
MnemonicIdentity.fromMnemonic(mnemonic, {
  isMainnet: ACTIVE_NETWORK.isMainnet,
});
```

## 3. Proveedores para Expo

En React Native no hay `EventSource` nativo. El SDK expone adaptadores que usan
`expo/fetch` para SSE:

```ts
import {
  ExpoOperatorProvider,
  ExpoIndexerProvider,
} from '@arkade-os/sdk/adapters/expo';

const wallet = await Wallet.create({
  identity,
  operatorProvider: new ExpoOperatorProvider(ACTIVE_NETWORK.operatorUrl),
  indexerProvider: new ExpoIndexerProvider(ACTIVE_NETWORK.indexerUrl),
  storage,
  settlementConfig: {
    vtxoThreshold: ACTIVE_NETWORK.vtxoThresholdSeconds,
  },
});
```

`ExpoArkProvider` y `arkProvider` son alias obsoletos: usa
`ExpoOperatorProvider` y `operatorProvider`.

### Polyfill de criptografía

El SDK necesita `crypto.getRandomValues()`. `index.js` lo instala antes de
cargar `expo-router/entry`:

```js
const Crypto = require('expo-crypto');
if (!global.crypto) global.crypto = {};
if (typeof global.crypto.getRandomValues !== 'function') {
  global.crypto.getRandomValues = Crypto.getRandomValues;
}
require('expo-router/entry');
```

Debe ser `require`, no `import`: los imports se hoistean y se evaluarían antes
del polyfill.

## 4. Seguridad de la mnemónica

- Se genera con `@scure/bip39` (12 palabras, 128 bits).
- La passphrase es obligatoria (mínimo 8 caracteres) y nunca se guarda en claro.
- La mnemónica se cifra con una clave derivada por PBKDF2-HMAC-SHA256
  (210 000 iteraciones, salt de 16 bytes) y XChaCha20-Poly1305.
- El blob cifrado `{ v, kdf, iter, salt, nonce, ciphertext }` se guarda en
  `expo-secure-store` (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`). Ni la semilla ni la
  passphrase quedan legibles para quien lea el almacén.
- La biometría es opcional y solo como comodidad: si
  `SecureStore.canUseBiometricAuthentication()` devuelve `true` (BIOMETRIC_STRONG,
  Class 3), la passphrase se guarda en una clave aparte con
  `requireAuthentication: true`. Si el usuario no la activa, o el dispositivo no
  la soporta, se desbloquea siempre con la passphrase.
- En Android 10 `canUseBiometricAuthentication()` devuelve `false` y la opción
  biométrica no se ofrece: así se evita el error
  `Biometric authentication status is unknown`.
- Un marcador separado (`canoark.hasWallet.v1`) indica si existe billetera sin
  disparar el prompt biométrico al arrancar.
- Las claves del esquema antiguo (`canoark.mnemonic.v1`) se migran al esquema
  cifrado la primera vez que se desbloquea con passphrase.

Si el usuario borra sus huellas, Android puede invalidar la clave biométrica.
La app avisa y permite desbloquear con la passphrase sin perder la billetera.

La app se bloquea automáticamente tras 2 minutos en segundo plano, medidos con
`AppState`. Al bloquear se cierra la sesión del SDK y se borra la mnemónica de
memoria.

## 5. Persistencia con SQLite

`src/lib/storage/sqlite.ts` adapta `expo-sqlite` a la interfaz `SQLExecutor`
del SDK:

```ts
const executor = {
  run: (sql, params) => db.runAsync(sql, params),
  get: (sql, params) => db.getFirstAsync(sql, params),
  all: (sql, params) => db.getAllAsync(sql, params),
};
```

Se abren dos bases:

- `canoark-wallet.db`: `SQLiteWalletRepository`, `SQLiteContractRepository` y
  `SQLiteIntentRepository`.
- `canoark-swaps.db`: `SQLiteAssetSwapRepository` de `@arkade-os/swap`.

Cada archivo tiene **un solo executor** durante toda la vida del proceso. Dos
executors sobre el mismo archivo pueden intercalar escrituras. Los repositorios
de swaps guardan los registros que permiten reclamar o reembolsar operaciones
aunque la app se reinicie.

`wipeStorageDatabases()` cierra las conexiones y llama a
`SQLite.deleteDatabaseAsync()`. Debe ejecutarse después de cerrar la sesión.

## 6. Enviar pagos

Hay dos caminos:

### Dirección Arkade

Se paga dentro de Arkade con `wallet.send`:

```ts
const txid = await wallet.send({
  recipients: [{ address, amount: sats }],
});
```

Es instantáneo y no usa solver.

### Factura Lightning o dirección onchain

Se usa el cliente de swaps. La wallet bloquea sats en Arkade y el solver paga el
destino:

```ts
const result = await swaps.pay(destination, {
  amount: BigInt(sats),      // solo onchain; una factura ya fija el importe
  maxFee: {
    amount: BigInt(maxFeeSats),
    asset: btcOn('arkade', ACTIVE_NETWORK.swapNetwork),
  },
});
```

`pay()` devuelve:

- `{ kind: 'swap', swap }` si creó un swap.
- `{ kind: 'payment', txid }` si el SDK pudo pagar directamente.

Estados relevantes de `SwapUpdate.outcome`: `accepted`, `funding`, `funded`,
`open`, `paid`, `claimed`, `refunded`, `lapsed`, `failed`, `needs_recovery`.

La app mantiene el cliente de swaps vivo y escucha `onUpdate()` para reclamar,
reembolsar o mostrar el estado final. Si el solver no paga, el lockup se
reembolsa al vencer `refundLocktime`.

## 7. Recibir Lightning

Para una factura normal:

```ts
const request = await swaps.receive({
  via: 'lightning',
  amount: BigInt(sats),
});

if (request.artifact.kind === 'invoice') {
  // request.artifact.bolt11
}
```

La factura es un swap de recepción. Hay que mantener la app abierta hasta que el
pago llegue (`claimed`) o la ventana expire (`lapsed`). Al cerrar la app se
detiene el cliente que reclama el lockup.

### LNURL-pay: factura por importe exacto

Un callback LUD-06 exige una factura por **exactamente** el importe solicitado.
`receive()` no sirve porque pide de más para cubrir la comisión. El flujo
correcto es cotizar y aceptar:

```ts
const quote = await swaps.quote({
  via: 'lightning',
  amount: BigInt(sats),
  amountOn: 'give',
});

if (quote.fee.amount > maxFee) throw new Error('Comisión demasiado alta');

const swap = await swaps.accept(quote);
```

`accept()` no aplica el techo de comisión, así que la comprobación se hace antes.

## 8. Lightning Address (LNURL)

Se configura con:

```env
EXPO_PUBLIC_LNURL_BASE_URL=https://lnurl.example.com
EXPO_PUBLIC_LNURL_DOMAIN=example.com
```

El flujo es:

1. Derivar el token de sesión con la identidad de la wallet, usando **ECDSA**.
   La firma Schnorr es aleatoria y generaría un token distinto en cada arranque.

   ```ts
   const token = await deriveSessionTokenWithSigner(
     (message, type) => wallet.identity.signMessage(message, type),
     domain,
   );
   ```

2. `registerAddress({ token, username, domain })`.
3. `registerArkadeIdentity({ token, handle, domain, arkadeAddress, claimPublicKey, boardingAddress })`.
   `claimPublicKey` es la clave pública comprimida de 33 bytes en hex.
4. Abrir la sesión SSE con `openSession({ token }, handlers)`. El servidor envía
   `invoice_request`; la app responde con una factura del solver.
5. Cuando el swap se reclama, derivar la preimagen y llamar
   `session.reportSettled(preimage)`. La sesión debe seguir conectada.

La preimagen se obtiene del registro de swap (`profile.hashlock`) con
`preimageForSwapRecord(wallet, projection)` y se verifica contra el
`paymentHash`. Es una operación best-effort: si no se puede derivar, el pago
offline sigue funcionando por la dirección Arkade registrada.

La sesión SSE solo vive en primer plano. Para cobrar con la app cerrada, el
servidor LNURL usa la dirección Arkade registrada.

## 9. Renovación, expiración y segundo plano

Los outputs virtuales expiran. `settlementConfig.vtxoThreshold` define con
cuánta antelación se renuevan; CanoArk usa 3 días (259 200 s).

Importante: `ExpoWallet.setup` sincroniza el estado al arrancar, pero **no
renueva** outputs. La renovación ocurre mientras la app está abierta y el
gestor de settlement está activo. Al volver del segundo plano conviene
sincronizar y dejar la app abierta unos segundos.

La billetera se bloquea a los 2 minutos en segundo plano. Esto cierra la sesión
y detiene la renovación; es un intercambio deliberado entre seguridad y
operación desatendida.

## 10. Compilar en local

### Requisitos

- Node.js 22
- JDK 17 (`JAVA_HOME` apuntando a él)
- Android SDK, `ANDROID_HOME` y `platform-tools` en `PATH`
- Un dispositivo o emulador

### Desarrollo

```bash
npm install
cp .env.example .env.local
npx expo prebuild --platform android --clean
npx expo run:android
```

### APK release

```bash
npm run android:release
# equivale a:
# npx expo prebuild --platform android --clean
# cd android && ./gradlew assembleRelease
```

Salida:

```text
android/app/build/outputs/apk/release/app-release.apk
```

El directorio `android/` está en `.gitignore` porque se regenera con prebuild.
Si editas código nativo, guarda los cambios en un config plugin o script, no
solo en `android/`.

## 11. Firma del APK

Sin keystore propio, Gradle firma el release con el keystore de debug del SDK.
Es instalable, pero no apto para publicar.

Para firmar en local:

```bash
keytool -genkeypair -v \
  -keystore canoark-release.jks \
  -alias canoark \
  -keyalg RSA -keysize 2048 -validity 10000
```

Configura las variables y ejecuta el script que parchea el `build.gradle`
generado:

```bash
export ANDROID_KEYSTORE_PATH="$PWD/canoark-release.jks"
export ANDROID_KEYSTORE_PASSWORD='...'
export ANDROID_KEY_ALIAS='canoark'
export ANDROID_KEY_PASSWORD='...'
npm run android:release
```

`scripts/configure-android-signing.mjs` acepta también un keystore en base64
(`ANDROID_KEYSTORE_BASE64`) y escribe `release.keystore` dentro de
`android/app/`. El script es idempotente y no hace nada si faltan secretos.

Nunca subas el `.jks`, las contraseñas ni el `android/` generado al
repositorio.

## 12. GitHub Actions

`.github/workflows/build-apk.yml`:

1. Instala Node 22, JDK 17 y Android SDK.
2. Ejecuta `npm ci`.
3. Ejecuta `npx expo prebuild --platform android --clean --no-install`.
4. Aplica la firma release si existen los secretos.
5. Ejecuta `./gradlew assembleRelease --no-daemon`.
6. Sube `app-release.apk` como artifact.

No se usa EAS Build en ningún paso.

Variables de repositorio opcionales (Settings → Variables):

- `ARKADE_NETWORK`: `mutinynet` o `mainnet`.
- `LNURL_BASE_URL`, `LNURL_DOMAIN`.

Secretos opcionales de firma:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

## 13. Problemas frecuentes

### La descarga de Gradle falla con timeout o 403

Algunos proveedores y CDN bloquean rangos de IP por geolocalización. Si
`./gradlew` no puede descargar `gradle-9.4.1-bin.zip`, no insistas con la build
local: sube los cambios y usa el workflow de GitHub Actions, que se ejecuta en
los runners de GitHub. El workflow sube el APK como artifact.

También puedes aumentar el timeout del wrapper si la descarga es lenta pero
permitida:

```bash
sed -i 's/networkTimeout=10000/networkTimeout=120000/' \
  android/gradle/wrapper/gradle-wrapper.properties
```

### `ERESOLVE` con `nostr-tools`

Mantén la versión exacta:

```json
"nostr-tools": "2.24.1"
```

No uses `^2.26.0` ni `--legacy-peer-deps` para ocultar el conflicto.

### `crypto.getRandomValues is not a function`

El polyfill de `index.js` no se ejecutó antes del SDK. Comprueba que
`package.json` tenga `"main": "index.js"` y que el polyfill use `require`.

### La app no conecta al operador

Comprueba la red compilada y que el dispositivo tenga internet. Mutinynet es un
entorno público de pruebas; puede estar caído o reiniciarse. Los endpoints se
inlinan al compilar.

### La biometría falla tras cambiar huellas

Android Keystore invalidó la clave de la passphrase biométrica. Escribe tu
passphrase en la pantalla de desbloqueo: la billetera sigue siendo accesible.
Puedes volver a activar la biometría recreando la bóveda desde Ajustes o
importando la frase de nuevo en una instalación limpia.

### La opción de biometría no aparece (Xiaomi / Android 10)

Es lo esperado. `expo-secure-store` exige `BIOMETRIC_STRONG` (Class 3) y en
Android 10 la comprobación devuelve `BIOMETRIC_STATUS_UNKNOWN`; la app usa la
passphrase como único método. No es un fallo de configuración del dispositivo.

### Una recepción Lightning queda pendiente

La app debe seguir abierta hasta `claimed` o `lapsed`. Si se cerró, al reabrir
el cliente de swaps restaura los registros y continúa el seguimiento; sincroniza
y espera unos segundos.

### La Lightning Address no emite facturas

Sin sesión SSE activa el servidor no puede pedir facturas. Mantén la pestaña
Recibir abierta con la sesión iniciada, o usa la dirección Arkade registrada
para pagos offline.

## 14. Referencia de flujos de la PWA

La PWA oficial `arkade-os/wallet` se consultó solo para entender flujos de
usuario (onboarding, envío, recepción, ajustes). No se copió código. La
implementación de CanoArk usa las APIs actuales del SDK y de los paquetes de
swap/LNURL, no las APIs antiguas que aparecen en algunos ejemplos.

Documentación oficial:

- Índice: <https://docs.arkadeos.com/llms.txt>
- Expo / React Native: <https://docs.arkadeos.com/wallets/advanced/expo-react-native>
- Lightning Services: <https://docs.arkadeos.com/wallets/advanced/lightning-services>
- Lightning Payments: <https://docs.arkadeos.com/intents/build/lightning>
