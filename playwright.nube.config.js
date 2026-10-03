/* Las pruebas de Firebase en el navegador: la web de verdad hablando con los
   emuladores de Authentication y Firestore. Aparte del humo normal porque
   necesitan los emuladores levantados (`npm run nube` en tests/firebase lo hace
   todo: los levanta, pasa esto y los apaga). */
const base = require("./playwright.config.js");

module.exports = {
  ...base,
  testDir: "./tests/nube",
  // Las cuentas de cada prueba llevan un correo propio, pero el emulador es uno
  // solo: de uno en uno, para que si algo falla se lea en orden.
  workers: 1,
};
