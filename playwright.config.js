/* Las pruebas de humo de la web. Levantan un servidor propio que sirve `web/`
   con el JSON de ejemplo del repo: no hace falta desplegar nada ni tener red. */
const { defineConfig, devices } = require("@playwright/test");

const PUERTO = 4173;

module.exports = defineConfig({
  testDir: "./tests/web",
  // En CI nada de `.only` colado sin querer, y un reintento por si el runner
  // tiene un mal momento. En local, ni reintentos ni paralelismo raro.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 20_000,

  use: {
    baseURL: `http://localhost:${PUERTO}`,
    trace: "retain-on-failure",
    // El service worker se queda fuera salvo donde se prueba a proposito.
    // Motivo: las peticiones de datos las hace EL WORKER, y ni `page.route` ni
    // `context.setOffline` llegan hasta ahi. Con el activo, media docena de
    // pruebas que sirven un JSON de mentira dejaban de recibirlo y fallaban sin
    // que nada estuviera roto. Las de la #22 lo vuelven a encender con
    // `test.use({ serviceWorkers: "allow" })` y cortan la red en el servidor.
    serviceWorkers: "block",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    command: `node tests/web/servidor.js`,
    url: `http://localhost:${PUERTO}/index.html`,
    reuseExistingServer: !process.env.CI,
    env: { PUERTO: String(PUERTO) },
  },
});
