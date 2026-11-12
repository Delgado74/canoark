// PRIMERA línea ejecutable de la app.
// El SDK de Arkade necesita crypto.getRandomValues() para MuSig2 y otras
// operaciones criptográficas. En React Native no existe, así que se instala
// antes de que cualquier módulo importe @arkade-os/sdk.
//
// Se usa require() y no import: los import de ES modules se hoistean y se
// evaluarían antes que este polyfill.
const Crypto = require('expo-crypto');

if (!global.crypto) {
  global.crypto = {};
}
if (typeof global.crypto.getRandomValues !== 'function') {
  global.crypto.getRandomValues = Crypto.getRandomValues;
}

require('expo-router/entry');
