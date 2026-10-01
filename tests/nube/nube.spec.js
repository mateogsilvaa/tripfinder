/* Cuentas y encargos con Firebase: la web de verdad contra los emuladores.

   Lo que se prueba es lo que le pasa a una persona: se registra, queda a la
   espera, no puede lanzar nada, la aprueban y ya puede. Y lo que NO se le deja
   hacer, que es lo importante. */
const { test, expect } = require("@playwright/test");
const E = require("./emulador.js");

test.beforeEach(async ({ page }) => {
  await page.addInitScript((config) => {
    window.TF_NUBE = config;
  }, E.CONFIG);
});

const clave = "una-clave-larga-1";

/* Registrarse por la pantalla, como lo haría quien llega a la web. */
async function registrarse(page, { nombre = "Dani", correo = E.correoNuevo(), pass = clave, espera = true } = {}) {
  await page.goto("/index.html");
  await page.locator("#tfCuenta").click();
  await page.locator('[data-modo="registro"]').click();
  await page.locator("#nubeNombre").fill(nombre);
  await page.locator("#nubeCorreo").fill(correo);
  await page.locator("#nubePass").fill(pass);
  await page.locator("#nubeForm button[type=submit]").click();
  // El registro son tres llamadas seguidas: hasta que no hay sesión no ha acabado.
  if (espera) await page.waitForFunction(() => localStorage.getItem("tf_sesion"));
  return correo;
}

const sesion = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("tf_sesion") || "null"));

test("registrarse deja la cuenta pendiente y lo dice", async ({ page }) => {
  const correo = await registrarse(page);
  await expect(page.locator("#nubeMsg")).toContainText("pendiente de aprobación");
  const s = await sesion(page);
  expect(s.estado).toBe("pendiente");
  expect(s.name).toBe("Dani");
  // La ficha existe en Firestore, con el correo ahí y no en la sesión pública.
  const f = await E.ficha(s.uid);
  expect(f).toMatchObject({ nombre: "Dani", correo, estado: "pendiente" });
  expect(f.admin).toBeUndefined();
  expect(JSON.stringify(s)).not.toContain(correo);
});

test("una cuenta pendiente no puede lanzar nada y no queda ningún encargo", async ({ page }) => {
  await registrarse(page);
  const s = await sesion(page);
  const r = await page.evaluate(() => tfDispatch("search", { origin: "MAD" }));
  expect(r).toMatchObject({ ok: false, reason: "pendiente" });
  expect(await E.encargosDe(s.uid)).toEqual([]);
});

test("al aprobarla, la misma sesión ya puede lanzar y el encargo es suyo", async ({ page }) => {
  await registrarse(page);
  const s = await sesion(page);
  await E.aprobar(s.uid);
  // Sin recargar ni volver a entrar: al intentarlo la web mira la ficha.
  const r = await page.evaluate(() => tfDispatch("search", { origin: "MAD", destination: "ROM", nota: { a: 1 } }));
  expect(r.ok).toBe(true);
  const [e] = await E.encargosDe(s.uid);
  expect(e).toMatchObject({ tipo: "search", owner: s.uid, estado: "pendiente" });
  expect(e.payload).toEqual({ origin: "MAD", destination: "ROM", nota: { a: 1 } });
  expect((await sesion(page)).estado).toBe("aprobado");
});

test("un tipo que no es de scraper no se puede encargar", async ({ page }) => {
  await registrarse(page);
  const s = await sesion(page);
  await E.aprobar(s.uid);
  const r = await page.evaluate(() => tfDispatch("admin_password", { x: 1 }));
  expect(r.ok).toBe(false);
  expect(await E.encargosDe(s.uid)).toEqual([]);
});

test("más de diez propiedades se rechaza antes de llegar a GitHub", async ({ page }) => {
  await registrarse(page);
  const s = await sesion(page);
  await E.aprobar(s.uid);
  const once = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`p${i}`, i]));
  const r = await page.evaluate((p) => tfDispatch("search", p), once);
  expect(r.ok).toBe(false);
  expect(await E.encargosDe(s.uid)).toEqual([]);
});

test("entrar con la contraseña mal no entra, con la buena sí", async ({ page }) => {
  const correo = await registrarse(page);
  await page.evaluate(() => tfSalir());
  expect(await sesion(page)).toBeNull();

  await page.goto("/index.html");
  await page.locator("#tfCuenta").click();
  await page.locator("#nubeCorreo").fill(correo);
  await page.locator("#nubePass").fill("otra-clave-distinta");
  await page.locator("#nubeForm button[type=submit]").click();
  await expect(page.locator("#nubeMsg")).toContainText("Correo o contraseña incorrectos");
  expect(await sesion(page)).toBeNull();

  await page.locator("#nubePass").fill(clave);
  await page.locator("#nubeForm button[type=submit]").click();
  await expect(page.locator("#nubeMsg")).toContainText("pendiente de aprobación");
  expect((await sesion(page)).estado).toBe("pendiente");
});

test("no se puede registrar dos veces el mismo correo", async ({ page }) => {
  const correo = await registrarse(page);
  await page.evaluate(() => tfSalir());
  await registrarse(page, { correo, espera: false });
  await expect(page.locator("#nubeMsg")).toContainText("Ya hay una cuenta con ese correo");
  expect(await sesion(page)).toBeNull();
});

test("las contraseñas cortas y los correos raros se paran antes de llamar", async ({ page }) => {
  await page.goto("/index.html");
  let llamadas = 0;
  page.on("request", (r) => r.url().includes("identitytoolkit") && llamadas++);
  await page.locator("#tfCuenta").click();
  await page.locator('[data-modo="registro"]').click();
  await page.locator("#nubeNombre").fill("Dani");
  await page.locator("#nubeCorreo").fill("sin-arroba");
  await page.locator("#nubePass").fill(clave);
  await page.locator("#nubeForm button[type=submit]").click();
  await expect(page.locator("#nubeMsg")).toContainText("no parece un correo");
  await page.locator("#nubeCorreo").fill("dani@ejemplo.es");
  await page.locator("#nubePass").fill("corta");
  await page.locator("#nubeForm button[type=submit]").click();
  await expect(page.locator("#nubeMsg")).toContainText("8 caracteres");
  expect(llamadas).toBe(0);
});

test("una cuenta bloqueada no entra", async ({ page }) => {
  const correo = await registrarse(page);
  const s = await sesion(page);
  await E.poner(s.uid, { estado: "bloqueado" });
  await page.evaluate(() => tfSalir());
  await page.goto("/index.html");
  await page.locator("#tfCuenta").click();
  await page.locator("#nubeCorreo").fill(correo);
  await page.locator("#nubePass").fill(clave);
  await page.locator("#nubeForm button[type=submit]").click();
  await expect(page.locator("#nubeMsg")).toContainText("bloqueada");
  expect(await sesion(page)).toBeNull();
});

test("la sesión sobrevive a recargar y el token caducado se renueva solo", async ({ page }) => {
  await registrarse(page);
  const s = await sesion(page);
  await E.aprobar(s.uid);
  await page.evaluate(() => {
    const t = JSON.parse(localStorage.getItem("tf_nube"));
    t.id = "caducado";
    t.expira = 0;
    localStorage.setItem("tf_nube", JSON.stringify(t));
  });
  await page.reload();
  const token = await page.evaluate(() => nubeToken());
  expect(token).toBeTruthy();
  expect(token).not.toBe("caducado");
  const r = await page.evaluate(() => tfDispatch("watch", { id: "x" }));
  expect(r.ok).toBe(true);
});

/* El emulador no rechaza el refresco de una cuenta borrada, y Firebase de verdad
   sí (`USER_NOT_FOUND`): se simula esa respuesta, que es la que documenta. */
const caducar = (page) =>
  page.evaluate(() => {
    const t = JSON.parse(localStorage.getItem("tf_nube"));
    t.expira = 0;
    localStorage.setItem("tf_nube", JSON.stringify(t));
  });

test("si Firebase dice que la cuenta ya no existe, la sesión se cierra sola", async ({ page }) => {
  await registrarse(page);
  await page.route("**/securetoken.googleapis.com/**", (ruta) =>
    ruta.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: 400, message: "USER_NOT_FOUND", status: "INVALID_ARGUMENT" } }),
    })
  );
  await caducar(page);
  expect(await page.evaluate(() => nubeToken())).toBe("");
  expect(await sesion(page)).toBeNull();
});

test("un corte de red al renovar no tira la sesión", async ({ page }) => {
  await registrarse(page);
  await page.route("**/securetoken.googleapis.com/**", (ruta) => ruta.abort());
  await caducar(page);
  expect(await page.evaluate(() => nubeToken())).toBe("");
  expect((await sesion(page)).estado).toBe("pendiente");
  expect(await page.evaluate(() => localStorage.getItem("tf_nube"))).not.toBeNull();
});

test("tu cuenta enseña el correo y el estado, y guarda el nombre y los avisos", async ({ page }) => {
  const correo = await registrarse(page);
  const s = await sesion(page);
  await page.locator(".modal [data-cerrar]").click();
  await page.locator("#tfCuenta").click();
  await expect(page.locator("#tfModal")).toContainText(correo);
  await expect(page.locator("#nubeEstado")).toContainText("pendiente de aprobación");
  await page.locator("#nubeNombre").fill("Daniela");
  await page.locator("#nubeChollos").selectOption("diario");
  await page.locator("#nubeTope").fill("120");
  await page.locator("#nubePerfil button[type=submit]").click();
  await expect(page.locator("#nubePerfilMsg")).toHaveText("Guardado.");
  const f = await E.ficha(s.uid);
  expect(f.nombre).toBe("Daniela");
  expect(f.prefs).toMatchObject({ chollos: "diario", chollos_max_precio: 120 });
  // El estado y el correo no se tocan al guardar.
  expect(f).toMatchObject({ estado: "pendiente", correo });
  expect((await sesion(page)).name).toBe("Daniela");
});

test("cambiar la contraseña: la vieja deja de valer y la nueva entra", async ({ page }) => {
  const correo = await registrarse(page);
  await page.locator(".modal [data-cerrar]").click();
  await page.locator("#tfCuenta").click();
  await page.locator("#nubeClaveVieja").fill("la-que-no-es-1");
  await page.locator("#nubeClaveNueva").fill("la-nueva-clave-2");
  await page.locator("#nubeClaveRepe").fill("la-nueva-clave-2");
  await page.locator("#nubeClaveForm button[type=submit]").click();
  await expect(page.locator("#nubeClaveMsg")).toContainText("no es esa");

  await page.locator("#nubeClaveVieja").fill(clave);
  await page.locator("#nubeClaveForm button[type=submit]").click();
  await expect(page.locator("#nubeClaveMsg")).toHaveText("Cambiada.");

  const viejo = await page.evaluate(([c, p]) => nubeEntrar(c, p), [correo, clave]);
  expect(viejo.ok).toBe(false);
  const nuevo = await page.evaluate(([c, p]) => nubeEntrar(c, p), [correo, "la-nueva-clave-2"]);
  expect(nuevo.ok).toBe(true);
});

test("olvidé la contraseña manda el correo sin decir si la cuenta existe", async ({ page }) => {
  const correo = await registrarse(page);
  await page.evaluate(() => tfSalir());
  for (const c of [correo, "no-existe@ejemplo.es"]) {
    await page.goto("/index.html");
    await page.locator("#tfCuenta").click();
    await page.locator("#nubeCorreo").fill(c);
    await page.locator("#nubeOlvide").click();
    await expect(page.locator("#nubeMsg")).toContainText("Si hay una cuenta con ese correo");
  }
});

test("«Pedir una cuenta» abre el registro", async ({ page }) => {
  await page.goto("/index.html");
  await page.locator("[data-pedir-cuenta]").first().click();
  await expect(page.locator('[data-modo="registro"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#nubeNombre")).toBeVisible();
});

test("sin configuración la web sigue con las cuentas de siempre", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/index.html");
  expect(await page.evaluate(() => nubeActiva())).toBe(false);
  await page.locator("#tfCuenta").click();
  await expect(page.locator("#tfLoginUser")).toBeVisible();
  await ctx.close();
});

/* ------------------------------------------------------------------- el panel */
/* Un navegador aparte por persona: la sesión vive en localStorage. */
async function otraPersona(browser) {
  const ctx = await browser.newContext();
  await ctx.addInitScript((config) => {
    window.TF_NUBE = config;
  }, E.CONFIG);
  return { ctx, page: await ctx.newPage() };
}

test("el panel pide entrar y no deja pasar a quien no es administrador", async ({ browser, page }) => {
  await registrarse(page, { nombre: "Normal" });
  const correo = await page.evaluate(() => nubeTokens().correo);
  await page.evaluate(() => tfSalir());

  const { ctx, page: panel } = await otraPersona(browser);
  await panel.goto("/admin.html");
  await expect(panel.locator("#nubeAdminForm")).toBeVisible();
  await panel.locator("#nubeAdminCorreo").fill(correo);
  await panel.locator("#nubeAdminPass").fill(clave);
  await panel.locator("#nubeAdminForm button[type=submit]").click();
  await expect(panel.locator("#nubeAdmin")).toContainText("no es administradora");
  await expect(panel.locator("#nubeCuentas")).toHaveCount(0);
  await ctx.close();
});

test("el administrador ve a quien pide entrar, lo aprueba y lo bloquea", async ({ browser, page }) => {
  // Quien pide entrar.
  await registrarse(page, { nombre: "Pidiendo" });
  const pide = await sesion(page);

  // Quien lleva la web: se registra y se le da el permiso a mano, como se haría
  // la primera vez desde la consola de Firebase.
  const { ctx, page: panel } = await otraPersona(browser);
  const correoAdmin = E.correoNuevo();
  await registrarse(panel, { nombre: "Jefa", correo: correoAdmin });
  const jefa = await sesion(panel);
  await E.hacerAdmin(jefa.uid);

  await panel.goto("/admin.html");
  await expect(panel.locator("#nubeCuentas")).toBeVisible();
  const fila = panel.locator(`[data-cuenta="${pide.uid}"]`);
  await expect(fila).toContainText("Pidiendo");
  await expect(fila).toContainText("Pendiente");
  // El administrador no se toca a sí mismo.
  await expect(panel.locator(`[data-cuenta="${jefa.uid}"]`)).toContainText("tú");
  await expect(panel.locator(`[data-cuenta="${jefa.uid}"] [data-estado]`)).toHaveCount(0);
  // Los pendientes salen los primeros.
  expect(await panel.locator(".nube-cuenta").first().getAttribute("data-cuenta")).toBe(pide.uid);

  await fila.locator('[data-estado="aprobado"]').click();
  await expect(panel.locator("#nubeAviso")).toContainText("Pidiendo: aprobada");
  expect((await E.ficha(pide.uid)).estado).toBe("aprobado");

  // Y quien pedía ya puede lanzar, sin volver a entrar.
  const r = await page.evaluate(() => tfDispatch("search", { origin: "MAD" }));
  expect(r.ok).toBe(true);

  await panel.locator(`[data-cuenta="${pide.uid}"] [data-estado="bloqueado"]`).click();
  await expect(panel.locator("#nubeAviso")).toContainText("Pidiendo: bloqueada");
  expect((await E.ficha(pide.uid)).estado).toBe("bloqueado");
  const otra = await page.evaluate(() => tfDispatch("search", { origin: "BCN" }));
  expect(otra).toMatchObject({ ok: false, reason: "bloqueada" });
  await ctx.close();
});

test("el panel dice cuántas cuentas hay y cuántas esperan", async ({ browser }) => {
  const { ctx, page: panel } = await otraPersona(browser);
  await registrarse(panel, { nombre: "Jefa" });
  await E.hacerAdmin((await sesion(panel)).uid);
  await panel.goto("/admin.html");
  await expect(panel.locator("#stats")).toContainText("pendientes");
  await expect(panel.locator("#stats")).toContainText("aprobadas");
  await ctx.close();
});

/* ------------------------------------------------------- el formulario de verdad */
test("buscar sin estar aprobada explica la espera y no apunta nada", async ({ page }) => {
  await registrarse(page);
  const s = await sesion(page);
  await page.goto("/buscar.html");
  await page.locator('button[form="finderForm"]').click();
  await expect(page.locator(".token-box")).toContainText("pendiente de aprobación");
  expect(await E.encargosDe(s.uid)).toEqual([]);
});

test("buscar con la cuenta aprobada apunta el encargo con lo que sale del formulario", async ({ page }) => {
  await registrarse(page);
  const s = await sesion(page);
  await E.aprobar(s.uid);
  await page.goto("/buscar.html");
  await page.locator('button[form="finderForm"]').click();
  await expect(page.locator("#searches")).toContainText("preguntando destino a destino");
  const [e] = await E.encargosDe(s.uid);
  // Lo que entra por las reglas es lo mismo que acaba en un `repository_dispatch`
  // del workflow `custom-search.yml`: una búsqueda, a nombre de esta cuenta.
  expect(e).toMatchObject({ tipo: "search", owner: s.uid, estado: "pendiente" });
  expect(Object.keys(e.payload).length).toBeLessThanOrEqual(10);
  expect(e.payload.viaje).toBeTruthy();
});
