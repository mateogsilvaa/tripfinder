/* Los avisos como notificación: elegir «Notificaciones» guarda la suscripción
   de este aparato en la cuenta, y al abrir la app instalada se pregunta una
   vez por dónde. El servicio de push de verdad no existe en las pruebas: el
   navegador da una suscripción de mentira con la misma forma. */
const { test, expect } = require("@playwright/test");
const E = require("./emulador.js");

const clave = "una-clave-larga-1";

async function persona(browser, { instalada = false } = {}) {
  // Con service worker de verdad: es quien se suscribe y enseña las notificaciones.
  const ctx = await browser.newContext({ baseURL: "http://localhost:4173", serviceWorkers: "allow" });
  await ctx.grantPermissions(["notifications"], { origin: "http://localhost:4173" });
  await ctx.addInitScript(
    ({ c, instalada }) => {
      window.TF_NUBE = c;
      if (window.PushManager) {
        const sub = {
          endpoint: "https://fcm.googleapis.com/fcm/send/de-mentira",
          toJSON: () => ({ endpoint: sub.endpoint, keys: { p256dh: "BNc" + "x".repeat(84), auth: "a".repeat(22) } }),
          unsubscribe: async () => {
            localStorage.removeItem("tf_prueba_sub");
            return true;
          },
        };
        PushManager.prototype.subscribe = async function () {
          localStorage.setItem("tf_prueba_sub", "1");
          return sub;
        };
        PushManager.prototype.getSubscription = async () => (localStorage.getItem("tf_prueba_sub") ? sub : null);
      }
      if (instalada) {
        const original = window.matchMedia.bind(window);
        window.matchMedia = (q) =>
          /display-mode:\s*standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : original(q);
      }
    },
    { c: E.CONFIG, instalada }
  );
  const page = await ctx.newPage();
  await page.goto("/index.html");
  await page.locator("#tfCuenta").click();
  await page.locator("#nubeCorreo").fill(E.correoNuevo());
  await page.locator("#nubePass").fill(clave);
  await page.locator("#nubeForm button[type=submit]").click();
  await expect(page.locator("#nubeBienvenida")).toBeVisible();
  await Promise.all([page.waitForEvent("load"), page.locator("#nubeListo").click()]);
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem("tf_sesion")));
  return { ctx, page, uid: s.uid };
}

test("en Mi cuenta, «Notificaciones» activa este aparato y lo guarda", async ({ browser }) => {
  const { ctx, page, uid } = await persona(browser);
  await page.locator("#tfCuenta").click();
  await page.locator("#nubeAvisos").check();
  const canal = page.locator("#nubeCanal");
  await expect(canal.locator('[data-canal="correo"]')).toHaveAttribute("aria-checked", "true");
  await canal.locator('[data-canal="app"]').click();
  await expect(page.locator("#nubeAparato")).toContainText("Este aparato recibe las notificaciones");
  await expect(page.locator("#nubeProbar")).toBeVisible();
  await expect(page.locator("#nubePerfilMsg")).toHaveText("Guardado.");
  await expect.poll(async () => (await E.ficha(uid)).prefs).toMatchObject({ avisos: true, canal: "app" });
  const aparatos = await E.aparatosDe(uid);
  expect(aparatos).toHaveLength(1);
  expect(aparatos[0].endpoint).toBe("https://fcm.googleapis.com/fcm/send/de-mentira");

  // Volver al correo no borra el aparato: «Las dos» lo vuelve a usar sin pedir nada.
  await canal.locator('[data-canal="correo"]').click();
  await expect.poll(async () => (await E.ficha(uid)).prefs.canal).toBe("correo");
  await ctx.close();
});

test("con la app instalada se pregunta una vez por dónde van los avisos", async ({ browser }) => {
  const { ctx, page, uid } = await persona(browser, { instalada: true });
  const pregunta = page.locator("#tfModal .canal-opciones");
  await expect(pregunta).toBeVisible({ timeout: 8000 });
  await pregunta.locator('[data-canal="ambos"]').click();
  await expect(page.locator("#canalMsg")).toContainText("Hecho");
  await expect.poll(async () => (await E.ficha(uid)).prefs).toMatchObject({ avisos: true, canal: "ambos" });
  expect(await E.aparatosDe(uid)).toHaveLength(1);

  await page.reload();
  await page.waitForTimeout(3500);
  await expect(page.locator("#tfModal .canal-opciones")).toHaveCount(0);
  await ctx.close();
});

test("«Solo correo» también es una respuesta: no se vuelve a preguntar", async ({ browser }) => {
  const { ctx, page, uid } = await persona(browser, { instalada: true });
  const pregunta = page.locator("#tfModal .canal-opciones");
  await expect(pregunta).toBeVisible({ timeout: 8000 });
  await pregunta.locator('[data-canal="correo"]').click();
  await expect(pregunta).toHaveCount(0);
  expect(await E.aparatosDe(uid)).toHaveLength(0);
  await page.reload();
  await page.waitForTimeout(3500);
  await expect(page.locator("#tfModal .canal-opciones")).toHaveCount(0);
  await ctx.close();
});
