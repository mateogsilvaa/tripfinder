/* Verificar el correo, y las cuentas de antes de Firebase. Ya no se vinculan:
   quien no migró a tiempo entra como nueva. Las vinculadas siguen con lo suyo. */
const { test, expect } = require("@playwright/test");
const E = require("./emulador.js");

const clave = "una-clave-larga-1";
const ID_VIEJO = "u-1111aaaa";

test.beforeEach(async ({ page }) => {
  await page.addInitScript((config) => {
    window.TF_NUBE = config;
  }, E.CONFIG);
});

async function persona(browser) {
  const ctx = await browser.newContext();
  await ctx.addInitScript((config) => {
    window.TF_NUBE = config;
  }, E.CONFIG);
  return { ctx, page: await ctx.newPage() };
}

async function registrarse(page, { nombre, correo, listo = true }) {
  await page.goto("/index.html");
  await page.locator("#tfCuenta").click();
  await page.locator("#nubeCorreo").fill(correo);
  await page.locator("#nubePass").fill(clave);
  await page.locator("#nubeForm button[type=submit]").click();
  await page.waitForFunction(() => {
    const s = JSON.parse(localStorage.getItem("tf_sesion") || "null");
    return s && s.nube;
  });
  if (listo) {
    await page.locator("#nubeNombre").fill(nombre);
    await Promise.all([page.waitForEvent("load"), page.locator("#nubeListo").click()]);
  }
  return JSON.parse(await page.evaluate(() => localStorage.getItem("tf_sesion")));
}

/* Quien lleva la web: se registra y se le da el permiso a mano, como la primera vez. */
async function administradora(browser) {
  const { ctx, page } = await persona(browser);
  const s = await registrarse(page, { nombre: "Jefa", correo: E.correoNuevo() });
  await E.hacerAdmin(s.uid);
  return { ctx, page, uid: s.uid };
}

const sesion = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("tf_sesion") || "null"));

async function antiguaDe(correo) {
  await E.sembrarAntigua(ID_VIEJO, {
    usuario: "ana",
    nombre: "Ana",
    correo,
    activa: true,
    prefs: { chollos: "semanal", seguimientos: "diario" },
  });
}

test("al registrarse se manda el correo de verificación y consta como sin verificar", async ({ page }) => {
  const s = await registrarse(page, { nombre: "Ana", correo: E.correoNuevo(), listo: false });
  expect(s.verificado).toBe(false);
  await expect(page.locator("#nubeBienvenida")).toContainText("confirmar la dirección");
  expect((await E.ficha(s.uid)).verificado).toBeUndefined();
});

test("pinchar el enlace del correo la deja verificada, y la ficha lo dice", async ({ page }) => {
  const s = await registrarse(page, { nombre: "Ana", correo: E.correoNuevo() });
  await E.verificarCorreo(s.uid);
  const ahora = await page.evaluate(() => nubeSincronizar());
  expect(ahora.verificado).toBe(true);
  expect((await E.ficha(s.uid)).verificado).toBe(true);
});

test("tu cuenta avisa de que falta verificar y se comprueba con un botón", async ({ page }) => {
  const s = await registrarse(page, { nombre: "Ana", correo: E.correoNuevo() });
  await page.locator("#tfCuenta").click();
  await expect(page.locator("#nubeVerificar")).toContainText("Falta verificar tu correo");
  await page.locator("#nubeYaVerifique").click();
  await expect(page.locator("#nubeVerificarMsg")).toContainText("Todavía no consta");

  await E.verificarCorreo(s.uid);
  await page.locator("#nubeYaVerifique").click();
  await expect(page.locator("#nubeVerificar")).toHaveCount(0);
});

/* Vincular ya no se ofrece: quien no migró a tiempo entra como cuenta nueva.
   Las que SÍ se vincularon siguen teniendo lo suyo (`legado` en la ficha). */
test("el panel ya no ofrece vincular cuentas de antes", async ({ browser }) => {
  const correo = E.correoNuevo();
  await antiguaDe(correo);
  const { ctx, page } = await persona(browser);
  const s = await registrarse(page, { nombre: "Ana", correo });
  await E.verificarCorreo(s.uid);
  const jefa = await administradora(browser);
  await jefa.page.goto("/admin.html");
  await jefa.page.locator('[data-tab="cuentas"]').click();
  const fila = jefa.page.locator(`[data-cuenta="${s.uid}"]`);
  await expect(fila).toContainText("Ana");
  await expect(fila.locator("[data-vincular], select")).toHaveCount(0);
  await expect(jefa.page.locator("#nubeAdmin")).not.toContainText("cuentas de antes");
  // Y es una cuenta nueva: gratis, sin nada heredado.
  expect(await E.ficha(s.uid)).toMatchObject({ plan: "gratis" });
  expect((await E.ficha(s.uid)).legado).toBeUndefined();
  await ctx.close();
  await jefa.ctx.close();
});

async function vinculada(browser) {
  const { ctx, page } = await persona(browser);
  const s = await registrarse(page, { nombre: "Ana", correo: E.correoNuevo() });
  // Como la dejó el panel cuando aún se vinculaba.
  await E.poner(s.uid, { estado: "aprobado", plan: "premium", legado: ID_VIEJO });
  await page.evaluate(() => nubeSincronizar());
  return { ctx, page, s };
}

test("quien ya estaba vinculada sigue viendo lo suyo de antes", async ({ browser }) => {
  const { ctx, page, s } = await vinculada(browser);
  expect(await page.evaluate(() => tfUids())).toEqual([s.uid, ID_VIEJO]);
  await page.locator("#tfCuenta").click();
  await expect(page.locator("#nubeVinculada")).toContainText("Tu cuenta de antes está vinculada");
  await ctx.close();
});

test("el encargo de una cuenta vinculada se apunta a su nombre", async ({ browser }) => {
  const { ctx, page, s } = await vinculada(browser);
  await page.evaluate(() => tfDispatch("unwatch", { id: "roma-2026-12-11-aaaa" }));
  const [e] = await E.encargosDe(s.uid);
  // `owner` del encargo es la cuenta nueva; el servidor añade el id viejo desde la ficha.
  expect(e).toMatchObject({ tipo: "unwatch", owner: s.uid });
  await ctx.close();
});
