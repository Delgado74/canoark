# CanoArk

Billetera Android de [Arkade](https://docs.arkadeos.com) con Expo, React Native y `@arkade-os/sdk`.

- Pagos instantáneos dentro de Arkade.
- Envío y recepción de activos Arkade (Arkade Mint) entre billeteras.
- Pagos Lightning vía solvers: factura BOLT11 o Lightning Address (se resuelve a BOLT11 con LNURL-pay).
- Envíos a direcciones Bitcoin desde la app por salida colaborativa (`wallet.settle`): el operador participa en la liquidación y no interviene un solver. El destino puede ser cualquier dirección Bitcoin, no solo una dirección propia.
- Recepción onchain por boarding: se deposita en la dirección de boarding y el operador liquida el depósito; no interviene un solver.
- Arkade Intents también define pagos onchain dirigidos con solver: el usuario paga desde su saldo Arkade y el solver aporta el BTC onchain que el cliente reclama para el destinatario. Esta ruta está disponible en Mutinynet y es distinta del envío que hoy ofrece la app.
- Recepción Lightning con factura o Lightning Address (LNURL).
- Aviso a pantalla completa cuando entra un pago (Arkade, Lightning u onchain).
- Mnemónica cifrada con Android Keystore; estado en SQLite.
- Sin EAS Build: APK local con Gradle o GitHub Actions.

## Qué leer según la tarea

| Tarea | Archivo |
| --- | --- |
| Contexto y decisiones del proyecto (versiones, gotchas, flujos) | [`AGENTS.md`](AGENTS.md) |
| APIs, términos y redes de Arkade | skill de Arkade + MCP `arkade-docs` |
| Compilar, firmar, CI, troubleshooting | [`AGENTS.md`](AGENTS.md#build-local-sin-eas) |

Si hay conflicto: doc oficial de Arkade gana para APIs; `AGENTS.md` gana para decisiones del proyecto.

Para distinguir las dos formas de enviar a una dirección Bitcoin, consulta [Pagos onchain en Arkade Intents](https://docs.arkadeos.com/intents/build/onchain.md) y [Boarding y offboarding](https://docs.arkadeos.com/wallets/advanced/boarding.md).

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
