# CanoArk

Fuentes: APIs/términos Arkade → skill + MCP `arkade-docs`. Este archivo → decisiones del proyecto. Conflicto de API: gana doc oficial. Conflicto de decisión: gana este archivo.

## Versiones (no cambiar sin verificar peer)
- Expo 58 (`expo@~58.0.24`), RN 0.88.1, React 19.3.0
- `@arkade-os/sdk` 0.5.5, `@arkade-os/swap` 0.1.5, `@arkade-os/lnurl-client` 0.9.2
- `nostr-tools` **exacto `2.24.1`** (peer exacto de swap). No `^2.26.0`. No `--legacy-peer-deps`.
- Node 22, JDK 17

## Red (inlineada al compilar; no runtime)
`EXPO_PUBLIC_ARKADE_NETWORK` = `mutinynet` | `mainnet`

| red | operator/indexer | prefix | swapNetwork |
|---|---|---|---|
| mutinynet | `https://mutinynet.arkade.sh` | `tark1` | `mutinynet` |
| mainnet | `https://arkade.computer` | `ark1` | `bitcoin` |

- `src/constants/network.ts` centraliza urls, prefix, swapNetwork, vtxoThresholdSeconds. No duplicar.
- Mnemónica: `MnemonicIdentity.fromMnemonic(m, { isMainnet: ACTIVE_NETWORK.isMainnet })`.

## Expo/RN
- Usar `ExpoOperatorProvider` + `ExpoIndexerProvider` (`@arkade-os/sdk/adapters/expo`).
- **Obsoleto:** `ExpoArkProvider`, `arkProvider`. Migrar a `ExpoOperatorProvider`/`operatorProvider`.
- `index.js` debe polyfillear `crypto.getRandomValues` con `require` (no `import`) antes de `expo-router/entry`. `package.json`: `"main": "index.js"`.

## Mnemónica (no tocar sin migración + test de restore)
- 12 palabras (`@scure/bip39`), passphrase obligatoria ≥8, nunca en claro.
- Cifrado: PBKDF2-HMAC-SHA256 210000 iter, salt 16B + XChaCha20-Poly1305.
- Blob `{v,kdf,iter,salt,nonce,ciphertext}` en `expo-secure-store` `WHEN_UNLOCKED_THIS_DEVICE_ONLY`.
- Biometría opcional solo comodidad: passphrase en clave aparte con `requireAuthentication:true` si `canUseBiometricAuthentication()` (BIOMETRIC_STRONG/Class3).
- Android 10: `canUseBiometricAuthentication()` = false → no ofrecer biometría (evita `Biometric authentication status is unknown`).
- Marcador `canoark.hasWallet.v1` (no dispara prompt biométrico al arrancar).
- Migrar `canoark.mnemonic.v1` → esquema cifrado en primer unlock con passphrase.
- Huellas invalidadas → avisar, desbloquear con passphrase, no perder wallet.
- Bloqueo a 2 min en background (`AppState`): cierra sesión SDK + borra mnemónica de memoria.

## SQLite
- `src/lib/storage/sqlite.ts` adapta `expo-sqlite` a `SQLExecutor` (`run`/`get`/`all`).
- `canoark-wallet.db`: `SQLiteWalletRepository`, `SQLiteContractRepository`, `SQLiteIntentRepository`.
- `canoark-swaps.db`: `SQLiteAssetSwapRepository`.
- **Un executor por archivo durante todo el proceso.** Dos executors = escrituras intercaladas.
- `wipeStorageDatabases()`: cerrar conexiones + `SQLite.deleteDatabaseAsync()`. Ejecutar tras cerrar sesión SDK.

## Pagos
- Arkade: `wallet.send({ recipients:[{address, amount:sats}] })`. Instantáneo, sin solver.
- Lightning (BOLT11): `swaps.pay(invoice, { maxFee:{amount:BigInt(max), asset:btcOn('arkade', swapNetwork)} })`. Sin `amount`: lo lleva la factura.
- Lightning Address (`usuario@dominio`): `resolveLightningAddress(address, sats)` (`src/lib/arkade/lnurl-pay.ts`) pide la factura por LNURL-pay y luego `swaps.pay(invoice, {maxFee})`.
- Onchain: **no usa solver**. Enviar: `sendCollaborativeExit(wallet, dest, sats, maxFee)` en `src/lib/arkade/offboard.ts` → `wallet.settle({inputs, outputs})`; la salida sale en la commitment transaction. Recibir: depositar a la dirección de boarding; al liquidarse, los fondos pasan al saldo Arkade. `offboard.ts` decide inputs, fee y cambio.
- `pay()` → `{kind:'swap',swap}` | `{kind:'payment',txid}`.
- **Solver**: `discovery` = registro de la red + `localSolverCards()`. El registro de mainnet (`solver-registry/bitcoin.json`) está vacío (`markets: []`, `solvers: []`); el mercado Lightning lo aporta la tarjeta `beta-solver` bundleada en `src/lib/arkade/solver-cards/` (la misma que trae Arkade Wallet). Si Ark Labs rota la pubkey/relay, actualizar ese JSON.
- `SwapUpdate.outcome`: accepted|funding|funded|open|paid|claimed|refunded|lapsed|failed|needs_recovery.
- Mantener cliente swaps vivo + `onUpdate()` para claim/refund/estado. Sin pago del solver → refund al vencer `refundLocktime`.

## Recibir Lightning
- `swaps.receive({via:'lightning', amount:BigInt(sats)})` → `request.artifact.kind==='invoice'` → `.bolt11`.
- App abierta hasta `claimed`|`lapsed`; cerrar detiene el cliente que reclama.
- LNURL-pay (importe exacto): `receive()` no sirve (pide de más). Usar `quote({via:'lightning',amount,amountOn:'give'})` → validar `quote.fee.amount <= maxFee` → `swaps.accept(quote)`. `accept()` no aplica techo de comisión.

## Lightning Address
- Env: `EXPO_PUBLIC_LNURL_BASE_URL`, `EXPO_PUBLIC_LNURL_DOMAIN`.
- **Modos por dominio** (`GET /lnurl/domain` → `allocationModes`): `self` (usuario elige nombre), `random` (servidor asigna), `admin` (reservas/códigos), `session` (sin nombre, LNURL de sesión).
- mainnet `lnurl.arkade.sh` (dominio visible `arkade.money`) = `random`+`admin`+`session`, **sin `self`**: elegir nombre da `403 forbidden_mode`. Solo se logra con `claimCode` emitido por el operador (Ark Labs, admin privado) o sirviendo un dominio propio.
- `getLnurlCapabilities()` adapta la UI; `registerLightningAddress` acepta `username?`/`claimCode?` (sin username = nombre aleatorio). `lnurlErrorMessage()` traduce los códigos del servidor.
- Token con **ECDSA** (no Schnorr; Schnorr aleatorio → token distinto cada arranque): `deriveSessionTokenWithSigner((m,t)=>wallet.identity.signMessage(m,t), domain)`.
- `registerAddress({token,username?,claimCode?,nameless?,domain})`; `registerArkadeIdentity({token,handle,domain,arkadeAddress,claimPublicKey,boardingAddress})`. `claimPublicKey` = pubkey comprimida 33B hex.
- `openSession({token}, handlers)` SSE; responder `invoice_request` con factura del solver.
- Al claim: preimagen vía `preimageForSwapRecord(wallet, projection)` desde `profile.hashlock`, verificar contra `paymentHash`, `session.reportSettled(preimage)`. Best-effort; si falla, pago offline por dirección Arkade.
- SSE solo foreground. App cerrada → servidor LNURL usa dirección Arkade registrada.

## Activos (Arkade Mint)
- Emitir: `wallet.assetManager.issue({ amount, metadata:{name,ticker,decimals,icon}, controlAssetId? })`.
- Enviar: `wallet.send({ recipients:[{ address, assets:[{ assetId, amount }] }] })`. Sólo dirección Arkade; `amount` de BTC por defecto = dust del operador (sats de portador).
- Recibir: el activo llega al VTXO de la dirección Arkade; no hay dirección por activo. Compartir dirección + `assetId`.
- Saldo: `WalletBalance.assets` (todo) y `availableAssets` (gastable, lo que usa `BalanceView.assets`).
- `assetId` en el saldo es hex sin prefijo; los mercados lo publican CAIP (`arkade:<red>/asset:<hex>`) → normalizar con `bareAssetId`.
- Metadatos (ticker/decimals): `assetManager.getAssetDetails`, con caché en `lib/arkade/assetInfo.ts`.
- UI: tocar un activo en Billetera abre `app/asset.tsx` (Enviar / Recibir / Swap); `send?assetId=` y `receive?assetId=` van en modo activo.

## Renovación
- `settlementConfig.vtxoThreshold` = 259200 s (3 días).
- `ExpoWallet.setup` sincroniza al arrancar pero **NO renueva**. Renovación solo con app abierta + gestor settlement activo.
- Al volver de background: sincronizar + dejar app abierta unos segundos.
- Bloqueo 2 min cierra sesión y detiene renovación (trade-off seguridad/desatendido).

## Build local (sin EAS)
npm install
cp .env.example .env.local
npx expo prebuild --platform android --clean
npx expo run:android

- Release: `npm run android:release` → `android/app/build/outputs/apk/release/app-release.apk`.
- `android/` en `.gitignore`, se regenera con prebuild. Cambios nativos → config plugin/script, no solo `android/`.

## Firma APK
- Sin keystore propio → firma debug (instalable, no publicable).
- `keytool -genkeypair -v -keystore canoark-release.jks -alias canoark -keyalg RSA -keysize 2048 -validity 10000`
- Env: `ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
- `scripts/configure-android-signing.mjs` acepta `ANDROID_KEYSTORE_BASE64`, escribe `release.keystore`, idempotente.
- Nunca subir `.jks`, contraseñas ni `android/` generado.

## CI
Sin EAS. Dos workflows con el mismo pipeline base (Node22+JDK17+AndroidSDK → `npm ci` → `npx expo prebuild --platform android --clean --no-install` → gradle):
- `.github/workflows/build-apk.yml`: push a `main`/tags `v*` + dispatch. `assembleDebug` → artifact `canoark-debug-*` (`app-debug.apk`, 14 días). Pruebas, no publicable.
- `.github/workflows/release-apk.yml`: **solo** `workflow_dispatch` (input `network`). Exige secretos de firma, `assembleRelease`, verifica con `apksigner` que no sea clave debug y sube `canoark-<red>-v<version>-code<versionCode>-run<N>.apk` (90 días).
- Vars repo: `ARKADE_NETWORK`, `LNURL_BASE_URL`, `LNURL_DOMAIN`.
- Secretos firma: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
- `scripts/configure-android-signing.mjs` con `ANDROID_SIGNING_REQUIRED=1` falla si faltan secretos (evita APK release firmado con debug).
- `app.json` → `expo-build-properties` → `android.buildArchs` = `["arm64-v8a","armeabi-v7a"]`: fuera x86/x86_64 (solo emuladores). No compilar solo arm64: deja fuera móviles 32-bit.

## Troubleshooting
| síntoma | acción |
|---|---|
| Gradle timeout/403 | No insistir local; usar GitHub Actions. Opcional: `sed -i 's/networkTimeout=10000/networkTimeout=120000/' android/gradle/wrapper/gradle-wrapper.properties` |
| `ERESOLVE` nostr-tools | Fijar `"nostr-tools":"2.24.1"`. No `--legacy-peer-deps`. |
| `crypto.getRandomValues is not a function` | `"main":"index.js"` + polyfill con `require`. |
| No conecta al operador | Verificar red compilada + internet. Mutinynet puede caer. Endpoints inlineados. |
| Biometría falla tras cambiar huellas | Desbloquear con passphrase; reactivar recreando bóveda o reimportando frase. |
| Sin opción biometría (Xiaomi/Android10) | Esperado (BIOMETRIC_STRONG/Class3). Passphrase único método. |
| Recepción Lightning pendiente | Reabrir app: cliente swaps restaura registros; sincronizar + esperar. |
| Lightning Address no emite facturas | Sin SSE activa. Mantener Recibir abierta o usar dirección Arkade offline. |

## Avisos de pago recibido
- `useWallet` compara el saldo de cada sincronización (`available + boarding`) con el anterior; si sube, publica `receivedPayment` (sats y activos nuevos).
- `src/components/ReceivedPayment.tsx`, montado en `app/_layout.tsx`, muestra el aviso sobre cualquier pantalla; `dismissReceivedPayment()` lo cierra.
- Sólo la sincronización más reciente mueve la línea base (`connectSeqRef`) para no contar dos veces el mismo pago; dos recepciones seguidas se acumulan en el mismo aviso.
- La línea base se conserva al bloquear, así que un pago que llega con la app bloqueada avisa al desbloquear. Se reinicia al crear/restaurar o borrar la wallet.

## Pantallas
- `welcome` (nueva/restaurar), `create` (seed+confirm+biometría+passphrase), `restore`, `unlock` (passphrase+biometría).
- Tabs: Billetera (saldo, Recibir/Enviar), Historial (`wallet.getTransactionHistory()`), Configuración (General/Seguridad/Avanzado, filas expandibles).
- Stack: `receive` (tabs Arkade/Lightning/Onchain, QR, Copiar/Compartir/Añadir fondos), `send`.

## Refs
- <https://docs.arkadeos.com/llms.txt>
- <https://docs.arkadeos.com/wallets/advanced/expo-react-native>
- <https://docs.arkadeos.com/wallets/advanced/lightning-services>
- <https://docs.arkadeos.com/intents/build/lightning>

PWA `arkade-os/wallet` solo referencia de flujos UX; no copiar código. Usar APIs actuales del SDK/swap/LNURL.
