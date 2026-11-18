# CanoArk

Billetera Android de [Arkade](https://docs.arkadeos.com) con Expo, React Native y `@arkade-os/sdk`.

- Pagos instantáneos dentro de Arkade.
- Envío y recepción de activos Arkade (Arkade Mint) entre billeteras.
- Pagos Lightning vía solvers: factura BOLT11 o Lightning Address (se resuelve a BOLT11 con LNURL-pay).
- Envíos onchain por salida colaborativa con el operador (`wallet.settle`), sin solver.
- Recepción Lightning con factura o Lightning Address (LNURL).
- Mnemónica cifrada con Android Keystore; estado en SQLite.
- Sin EAS Build: APK local con Gradle o GitHub Actions.

## Qué leer según la tarea

| Tarea | Archivo |
| --- | --- |
| Contexto y decisiones del proyecto (versiones, gotchas, flujos) | [`AGENTS.md`](AGENTS.md) |
| APIs, términos y redes de Arkade | skill de Arkade + MCP `arkade-docs` |
| Compilar, firmar, CI, troubleshooting | [`AGENTS.md`](AGENTS.md#build-local-sin-eas) |

Si hay conflicto: doc oficial de Arkade gana para APIs; `AGENTS.md` gana para decisiones del proyecto.

## Requisitos

- Node.js 22
- JDK 17
- Android SDK con `ANDROID_HOME`
- Dispositivo o emulador Android

## Puesta en marcha

```bash
npm install
cp .env.example .env.local   # red y, si aplica, servidor LNURL
npx expo prebuild --platform android --clean
npx expo run:android
```

`prebuild --clean` recrea `android/`. Si editas código nativo, guárdalo en un config plugin o script.

## APK release

```bash
npm run android:release
```

Salida: `android/app/build/outputs/apk/release/app-release.apk`.

Sin keystore de release, Gradle firma con el de debug (instalable, no publicable). Firma real: ver [`AGENTS.md`](AGENTS.md#firma-apk) o los secretos de GitHub Actions.

## GitHub Actions

`.github/workflows/build-apk.yml` compila en push a `main`, tags `v*` o manualmente. Artifact descargable desde la ejecución.

Recomendado si tu red tiene geobloqueos: evita 403/timeouts de `services.gradle.org` y Maven.

Secretos opcionales de firma: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

## Variables de entorno

Se inlinean al compilar; no son secretos de ejecución.

| Variable | Valores | Por defecto |
| --- | --- | --- |
| `EXPO_PUBLIC_ARKADE_NETWORK` | `mutinynet`, `mainnet` | `mutinynet` |
| `EXPO_PUBLIC_LNURL_BASE_URL` | URL del servidor LNURL | vacío |
| `EXPO_PUBLIC_LNURL_DOMAIN` | dominio de la Lightning Address | host de la URL |

## Estructura

```text
src/app/                 Rutas de expo-router
src/components/          Componentes de interfaz
src/hooks/useWallet.tsx  Estado central de la billetera
src/lib/arkade/          Identidad, cliente SDK y Lightning
src/lib/storage/         Adaptador SQLite y repositorios
src/constants/           Red y tema
```

## Aviso

Software experimental. Mutinynet usa bitcoin de prueba. En mainnet, verifica direcciones, importes y comisiones antes de firmar. La frase de recuperación es la única forma de restaurar la billetera.
