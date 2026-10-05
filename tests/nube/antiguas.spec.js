/* Las cuentas de antes de Firebase: que quien ya tenía una no pierda nada, y que
   nadie pueda quedarse con lo de otro.

   El camino: se registra con Firebase, verifica su correo, y quien lleva la web
   la aprueba y la vincula con la de antes. Desde ahí, lo suyo de antes —avisos,
   seguimientos, búsquedas, favoritos— es suyo con la cuenta nueva. */
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

async function registrarse(page, { nombre, correo }) {
  await page.goto("/index.html");
  await page.locator("#tfCuenta").click();
  await page.locator('[data-modo="registro"]').click();
  await page.locator("#nubeNombre").fill(nombre);
  await page.locator("#nubeCorreo").fill(correo);
  await page.locator("#nubePass").fill(clave);
  await page.locator("#nubeForm button[type=submit]").click();
  await page.waitForFunction(() => {
    const s = JSON.parse(localStorage.getItem("tf_sesion") || "null");
    return s && s.nube;
  });
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
  const s = await registrarse(page, { nombre: "Ana", correo: E.correoNuevo() });
  expect(s.verificado).toBe(false);
  await expect(page.locator("#nubeMsg")).toContainText("verificar que la dirección es tuya");
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
  await page.locator(".modal [data-cerrar]").click();
  await page.locator("#tfCuenta").click();
  await expect(page.locator("#nubeVerificar")).toContainText("Falta verificar tu correo");
  await page.locator("#nubeYaVerifique").click();
  await expect(page.locator("#nubeVerificarMsg")).toContainText("Todavía no consta");

  await E.verificarCorreo(s.uid);
  await page.locator("#nubeYaVerifique").click();
  await expect(page.locator("#nubeVerificar")).toHaveCount(0);
});

test("con el correo verificado, la administradora la vincula y hereda lo de antes", async ({ browser }) => {
  const correo = E.correoNuevo();
  await antiguaDe(correo);
  const { ctx: cp, page: ana } = await persona(browser);
  // Lo suyo de antes que solo vive en su navegador, con el id de antes.
  await ana.addInitScript((id) => {
    if (!localStorage.getItem("tf_favoritos:" + id)) localStorage.setItem("tf_favoritos:" + id, JSON.stringify(["MAD-ROM"]));
  }, ID_VIEJO);
  const s = await registrarse(ana, { nombre: "Ana", correo });
  await E.verificarCorreo(s.uid);
  await ana.evaluate(() => nubeSincronizar());

  const jefa = await administradora(browser);
  await jefa.page.goto("/admin.html");
  const fila = jefa.page.locator(`[data-cuenta="${s.uid}"]`);
  await expect(fila).toContainText("correo verificado");
  await expect(fila).toContainText("Su correo coincide con una cuenta de antes");
  // La que coincide por correo sale elegida.
  await expect(fila.locator("select")).toHaveValue(ID_VIEJO);
  await expect(jefa.page.locator("#stats")).toContainText("cuentas de antes sin vincular");

  await fila.locator("[data-vincular]").click();
  await expect(jefa.page.locator("#nubeAviso")).toContainText("aprobada y vinculada");

  // En la base de datos: aprobada, vinculada, con sus avisos de antes.
  const f = await E.ficha(s.uid);
  expect(f).toMatchObject({ estado: "aprobado", legado: ID_VIEJO });
  expect(f.prefs).toMatchObject({ chollos: "semanal", seguimientos: "diario" });
  expect((await E.antigua(ID_VIEJO)).vinculada).toBe(s.uid);

  // En su navegador, sin volver a entrar: es suya con las dos identidades.
  const ahora = await ana.evaluate(() => nubeSincronizar());
  expect(ahora).toMatchObject({ estado: "aprobado", legado: ID_VIEJO });
  expect(await ana.evaluate(() => tfUids())).toEqual([s.uid, ID_VIEJO]);
  const mio = await ana.evaluate((id) => [{ owner: id }, { owner: tfUid() }, { owner: "otra" }, {}].map((x) => !!(x.owner && tfUids().includes(x.owner))), ID_VIEJO);
  expect(mio).toEqual([true, true, false, false]);
  // Sus favoritos de antes, que estaban bajo el id viejo, vuelven.
  expect(await ana.evaluate((uid) => localStorage.getItem("tf_favoritos:" + uid), s.uid)).toBe('["MAD-ROM"]');
  // Y ya puede lanzar cosas.
  expect((await ana.evaluate(() => tfDispatch("search", { origin: "MAD" }))).ok).toBe(true);
  await cp.close();
  await jefa.ctx.close();
});

test("quien se registra con el correo de otro SIN verificarlo no puede quedarse con lo suyo", async ({ browser }) => {
  const correoDeAna = E.correoNuevo();
  await antiguaDe(correoDeAna);
  // El impostor llega antes que Ana y se registra con su correo, sin poder verificarlo.
  const { ctx, page: impostor } = await persona(browser);
  const s = await registrarse(impostor, { nombre: "Impostor", correo: correoDeAna });
  expect((await impostor.evaluate(() => nubeSincronizar())).verificado).toBe(false);

  const jefa = await administradora(browser);
  await jefa.page.goto("/admin.html");
  const fila = jefa.page.locator(`[data-cuenta="${s.uid}"]`);
  await expect(fila).toContainText("correo sin verificar");
  await expect(fila).toContainText("antes tiene que verificar su correo");
  await expect(fila.locator("[data-vincular]")).toHaveCount(0);

  // Aunque se salte la web y mande la escritura a mano con el token de la administradora,
  // las reglas lo paran.
  const r = await jefa.page.evaluate(([uid, id]) => nubeVincular(uid, id, {}), [s.uid, ID_VIEJO]);
  expect(r.ok).toBe(false);
  expect((await E.ficha(s.uid)).legado).toBeUndefined();
  expect((await E.antigua(ID_VIEJO)).vinculada).toBeUndefined();
  await ctx.close();
  await jefa.ctx.close();
});

test("una cuenta antigua no se vincula dos veces", async ({ browser }) => {
  const correo = E.correoNuevo();
  await antiguaDe(correo);
  const a = await persona(browser);
  const sa = await registrarse(a.page, { nombre: "Ana", correo });
  const b = await persona(browser);
  const sb = await registrarse(b.page, { nombre: "Otra", correo: E.correoNuevo() });
  await E.verificarCorreo(sa.uid);
  await E.verificarCorreo(sb.uid);
  await a.page.evaluate(() => nubeSincronizar());
  await b.page.evaluate(() => nubeSincronizar());

  const jefa = await administradora(browser);
  await jefa.page.goto("/admin.html");
  expect((await jefa.page.evaluate(([u, id]) => nubeVincular(u, id, {}), [sa.uid, ID_VIEJO])).ok).toBe(true);
  expect((await jefa.page.evaluate(([u, id]) => nubeVincular(u, id, {}), [sb.uid, ID_VIEJO])).ok).toBe(false);
  expect((await E.antigua(ID_VIEJO)).vinculada).toBe(sa.uid);
  await a.ctx.close();
  await b.ctx.close();
  await jefa.ctx.close();
});

test("quien cambió de correo se vincula igual: se elige la cuenta a mano", async ({ browser }) => {
  await antiguaDe("el-de-antes@ejemplo.es");
  const { ctx, page } = await persona(browser);
  const s = await registrarse(page, { nombre: "Ana", correo: E.correoNuevo() });
  await E.verificarCorreo(s.uid);
  await page.evaluate(() => nubeSincronizar());

  const jefa = await administradora(browser);
  await jefa.page.goto("/admin.html");
  const fila = jefa.page.locator(`[data-cuenta="${s.uid}"]`);
  await expect(fila).not.toContainText("Su correo coincide");
  await fila.locator("select").selectOption(ID_VIEJO);
  await fila.locator("[data-vincular]").click();
  await expect(jefa.page.locator("#nubeAviso")).toContainText("aprobada y vinculada");
  expect((await E.ficha(s.uid)).legado).toBe(ID_VIEJO);
  await ctx.close();
  await jefa.ctx.close();
});

test("tu cuenta dice que la de antes está vinculada", async ({ browser }) => {
  const correo = E.correoNuevo();
  await antiguaDe(correo);
  const { ctx, page } = await persona(browser);
  const s = await registrarse(page, { nombre: "Ana", correo });
  await E.verificarCorreo(s.uid);
  await page.evaluate(() => nubeSincronizar());
  const jefa = await administradora(browser);
  await jefa.page.goto("/admin.html");
  await jefa.page.locator(`[data-cuenta="${s.uid}"] [data-vincular]`).click();
  await expect(jefa.page.locator("#nubeAviso")).toContainText("vinculada");

  await page.locator(".modal [data-cerrar]").click();
  await page.locator("#tfCuenta").click();
  await expect(page.locator("#nubeVinculada")).toContainText("Tu cuenta de antes está vinculada");
  await ctx.close();
  await jefa.ctx.close();
});

test("el encargo de una cuenta vinculada se apunta a su nombre", async ({ browser }) => {
  const correo = E.correoNuevo();
  await antiguaDe(correo);
  const { ctx, page } = await persona(browser);
  const s = await registrarse(page, { nombre: "Ana", correo });
  await E.verificarCorreo(s.uid);
  await page.evaluate(() => nubeSincronizar());
  const jefa = await administradora(browser);
  await jefa.page.goto("/admin.html");
  await jefa.page.locator(`[data-cuenta="${s.uid}"] [data-vincular]`).click();
  await expect(jefa.page.locator("#nubeAviso")).toContainText("vinculada");
  await page.evaluate(() => nubeSincronizar());

  await page.evaluate(() => tfDispatch("unwatch", { id: "roma-2026-12-11-aaaa" }));
  const [e] = await E.encargosDe(s.uid);
  // `owner` del encargo es la cuenta nueva; el servidor añade el id viejo desde la ficha.
  expect(e).toMatchObject({ tipo: "unwatch", owner: s.uid });
  await ctx.close();
  await jefa.ctx.close();
});
