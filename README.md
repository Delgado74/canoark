# CanoArk

Billetera Android de [Arkade](https://docs.arkadeos.com) construida con Expo,
React Native y el SDK oficial `@arkade-os/sdk`. La app permite:

- Recibir y enviar pagos instantáneos dentro de Arkade.
- Pagar facturas Lightning y direcciones Bitcoin onchain mediante solvers.
- Recibir Lightning con facturas BOLT11 y con una Lightning Address (LNURL).
- Guardar la mnemónica cifrada por Android Keystore y persistir el estado de la
  billetera en SQLite.

No usa EAS Build. El APK se compila en local con Gradle o en GitHub Actions.

## Requisitos

- Node.js 22
- JDK 17
- Android SDK con `ANDROID_HOME` configurado
- Un dispositivo o emulador Android

## Puesta en marcha

```bash
npm install
cp .env.example .env.local   # elige red y, si aplica, servidor LNURL
npx expo prebuild --platform android --clean
npx expo run:android
```

`npm install` instala también las dependencias nativas. Si cambias algo del
directorio `android/` generado, recuerda que `prebuild --clean` lo recrea.

## Compilar un APK release

```bash
npm run android:release
```

El APK queda en:

```text
android/app/build/outputs/apk/release/app-release.apk
```

Sin un keystore de release configurado, Gradle firma con el keystore de debug
del SDK. Ese APK sirve para probar, pero no para publicar. Para firmar de
verdad, consulta [GUIA.md](GUIA.md#firma-del-apk) o usa los secretos de GitHub
Actions.

## GitHub Actions

El workflow `.github/workflows/build-apk.yml` compila el APK en cada push a
`main`, en tags `v*` o al lanzarlo a mano desde la pestaña Actions. El artifact
se descarga desde la ejecución.

Es la vía recomendada si tu red tiene geobloqueos: GitHub aloja los runners y
evita los 403/timeouts de `services.gradle.org` o de repositorios Maven.

Secretos opcionales para firma release:

| Secreto | Contenido |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | keystore `.jks` codificado en base64 |
| `ANDROID_KEYSTORE_PASSWORD` | contraseña del keystore |
| `ANDROID_KEY_ALIAS` | alias de la clave |
| `ANDROID_KEY_PASSWORD` | contraseña de la clave |

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

CanoArk es software experimental. Mutinynet usa bitcoin de prueba. En mainnet,
verifica siempre direcciones, importes y comisiones antes de firmar. La frase de
recuperación es la única forma de restaurar la billetera.

La guía técnica detallada está en [GUIA.md](GUIA.md).
