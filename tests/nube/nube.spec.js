/* Cuentas y encargos con Firebase: la web de verdad contra los emuladores.

   Lo que se prueba es lo que le pasa a una persona: se registra, entra gratis
   y ve los chollos, no puede lanzar nada, le dan premium y ya puede. Y lo que NO se le deja
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
/* Una sola pantalla: correo, contraseña y «Continuar». Si la cuenta es nueva,
   un segundo paso pregunta el nombre (ya puesto, sacado del correo) y «Listo»
   recarga la página. `listo: false` se queda en ese segundo paso. */
async function registrarse(
  page,
  { nombre = "Dani", correo = E.correoNuevo(), pass = clave, espera = true, listo = true } = {}
) {
  await page.goto("/index.html");
  await page.locator("#tfCuenta").click();
  await page.locator("#nubeCorreo").fill(correo);
  await page.locator("#nubePass").fill(pass);
  await page.locator("#nubeForm button[type=submit]").click();
  // El registro son tres llamadas seguidas: hasta que no hay sesión no ha acabado.
  // La de Firebase (`nube`): puede haber una de las cuentas de antes ya guardada.
  if (espera) {
    await page.waitForFunction(() => {
      const s = JSON.parse(localStorage.getItem("tf_sesion") || "null");
      return s && s.nube;
    });
    await expect(page.locator("#nubeBienvenida")).toBeVisible();
    if (listo) {
      await page.locator("#nubeNombre").fill(nombre);
      await Promise.all([page.waitForEvent("load"), page.locator("#nubeListo").click()]);
    }
  }
  return correo;
}

const sesion = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("tf_sesion") || "null"));

test("una sola pantalla: con un correo nuevo, la cuenta se crea y pregunta el nombre", async ({ page }) => {
  const correo = E.correoNuevo();
  await registrarse(page, { correo, listo: false });
  await expect(page.locator("#nubeBienvenida")).toContainText("Cuenta creada");
  await expect(page.locator("#nubeBienvenida")).toContainText("Plan gratis");
  // El nombre de casa sale del correo, y se cambia ahí mismo.
  await expect(page.locator("#nubeNombre")).toHaveValue(/^Prueba/);
  await page.locator("#nubeNombre").fill("Dani");
  await Promise.all([page.waitForEvent("load"), page.locator("#nubeListo").click()]);
  expect((await E.ficha((await sesion(page)).uid)).nombre).toBe("Dani");
  await expect(page.locator("#tfCuenta")).toContainText("Dani");
});

test("registrarse abre una cuenta gratis al momento", async ({ page }) => {
  const correo = await registrarse(page);
  const s = await sesion(page);
  expect(s).toMatchObject({ estado: "aprobado", plan: "gratis" });
  expect(s.name).toBe("Dani");
  // La ficha existe en Firestore, con el correo ahí y no en la sesión pública.
  const f = await E.ficha(s.uid);
  expect(f).toMatchObject({ nombre: "Dani", correo, estado: "aprobado", plan: "gratis" });
  expect(f.admin).toBeUndefined();
  expect(JSON.stringify(s)).not.toContain(correo);
});

test("de momento premium no se exige: una cuenta gratis lanza y el encargo es suyo", async ({ page }) => {
  await registrarse(page);
  const s = await sesion(page);
  const r = await page.evaluate(() => tfDispatch("search", { origin: "MAD" }));
  expect(r.ok).toBe(true);
  const [e] = await E.encargosDe(s.uid);
  expect(e).toMatchObject({ tipo: "search", owner: s.uid });
});

test("una cuenta aprobada de antes de los planes es premium", async ({ page }) => {
  await registrarse(page);
  const s = await sesion(page);
  // Así quedan las de los conocidos: aprobadas y sin `plan`.
  await fetch(`http://127.0.0.1:8080/v1/projects/demo-tripfinder/databases/(default)/documents/usuarios/${s.uid}?updateMask.fieldPaths=plan`, {
    method: "PATCH",
    headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
    body: JSON.stringify({ fields: {} }),
  });
  const r = await page.evaluate(() => tfDispatch("search", { origin: "MAD" }));
  expect(r.ok).toBe(true);
  // Lo que dice la ficha al sincronizar: sin `plan`, premium.
  expect((await page.evaluate(() => nubeSincronizar())).plan).toBe("premium");
});

test("al hacerla premium, la misma sesión ya puede lanzar y el encargo es suyo", async ({ page }) => {
  await registrarse(page);
  const s = await sesion(page);
  await E.hacerPremium(s.uid);
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
  await E.hacerPremium(s.uid);
  const r = await page.evaluate(() => tfDispatch("admin_password", { x: 1 }));
  expect(r.ok).toBe(false);
  expect(await E.encargosDe(s.uid)).toEqual([]);
});

test("más de diez propiedades se rechaza antes de llegar a GitHub", async ({ page }) => {
  await registrarse(page);
  const s = await sesion(page);
  await E.hacerPremium(s.uid);
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
  await expect(page.locator("#nubeMsg")).toContainText("la contraseña no es esa");
  expect(await sesion(page)).toBeNull();

  await page.locator("#nubePass").fill(clave);
  await page.locator("#nubeForm button[type=submit]").click();
  await page.waitForFunction(() => !!localStorage.getItem("tf_sesion"));
  expect(await sesion(page)).toMatchObject({ estado: "aprobado", plan: "gratis" });
});

test("con un correo que ya tiene cuenta y otra contraseña, no crea otra: dice que la contraseña no es", async ({ page }) => {
  const correo = await registrarse(page);
  await page.evaluate(() => tfSalir());
  await registrarse(page, { correo, pass: "otra-clave-larga-2", espera: false });
  await expect(page.locator("#nubeMsg")).toContainText("ya tiene cuenta y la contraseña no es esa");
  await expect(page.locator("#nubeOlvide")).toHaveClass(/resalta/);
  expect(await sesion(page)).toBeNull();
});

test("con el correo y la contraseña de siempre, Continuar entra sin preguntar nada", async ({ page }) => {
  const correo = await registrarse(page);
  await page.evaluate(() => tfSalir());
  await page.goto("/index.html");
  await page.locator("#tfCuenta").click();
  // El correo de la última vez ya está puesto.
  await expect(page.locator("#nubeCorreo")).toHaveValue(correo);
  await page.locator("#nubePass").fill(clave);
  await Promise.all([page.waitForEvent("load"), page.locator("#nubeForm button[type=submit]").click()]);
  expect((await sesion(page)).nube).toBe(true);
});

test("las contraseñas cortas y los correos raros se paran antes de llamar", async ({ page }) => {
  await page.goto("/index.html");
  let llamadas = 0;
  page.on("request", (r) => r.url().includes("identitytoolkit") && llamadas++);
  await page.locator("#tfCuenta").click();
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
  await E.hacerPremium(s.uid);
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
  expect((await sesion(page)).estado).toBe("aprobado");
  expect(await page.evaluate(() => localStorage.getItem("tf_nube"))).not.toBeNull();
});

test("tu cuenta enseña el correo y el estado, y guarda el nombre y los avisos", async ({ page }) => {
  const correo = await registrarse(page);
  const s = await sesion(page);
  await page.locator("#tfCuenta").click();
  await expect(page.locator("#tfModal")).toContainText(correo);
  await expect(page.locator("#nubeEstado")).toContainText("Plan gratis");
  await page.locator("#nubeNombre").fill("Daniela");
  // Apagados de casa: hay que encenderlos para elegir.
  await expect(page.locator("#nubeChollos")).toBeHidden();
  await page.locator("#nubeAvisos").check();
  await page.locator("#nubeChollos").selectOption("diario");
  await page.locator("#nubeTope").fill("120");
  // Sin botón: se guarda solo al dejar de tocar.
  await expect(page.locator("#nubePerfilMsg")).toHaveText("Guardado.");
  await expect(page.locator("#cuentaNombreVer")).toHaveText("Daniela");
  const f = await E.ficha(s.uid);
  expect(f.nombre).toBe("Daniela");
  expect(f.prefs).toMatchObject({ avisos: true, chollos: "diario", chollos_max_precio: 120 });
  // El estado y el correo no se tocan al guardar.
  expect(f).toMatchObject({ estado: "aprobado", plan: "gratis", correo });
  expect((await sesion(page)).name).toBe("Daniela");
});

test("cambiar la contraseña: la vieja deja de valer y la nueva entra", async ({ page }) => {
  const correo = await registrarse(page);
  await page.locator("#tfCuenta").click();
  await page.locator("#nubeClaveCaja summary").click();
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
  await expect(page.locator("#tfModal h2")).toHaveText("Crea tu cuenta");
  await expect(page.locator("#nubeCorreo")).toBeVisible();
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

test("el administrador da premium, lo quita y bloquea", async ({ browser, page }) => {
  // Quien se acaba de registrar: gratis.
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
  await expect(fila).toContainText("Gratis");
  // El administrador no se toca a sí mismo.
  await expect(panel.locator(`[data-cuenta="${jefa.uid}"]`)).toContainText("tú");
  await expect(panel.locator(`[data-cuenta="${jefa.uid}"] [data-estado]`)).toHaveCount(0);

  await fila.locator('[data-plan="premium"]').click();
  await expect(panel.locator("#nubeAviso")).toContainText("Pidiendo: ahora es premium");
  expect(await E.ficha(pide.uid)).toMatchObject({ estado: "aprobado", plan: "premium" });

  // Y ya puede lanzar, sin volver a entrar.
  const r = await page.evaluate(() => tfDispatch("search", { origin: "MAD" }));
  expect(r.ok).toBe(true);

  await panel.locator(`[data-cuenta="${pide.uid}"] [data-plan="gratis"]`).click();
  await expect(panel.locator("#nubeAviso")).toContainText("Pidiendo: ahora es gratis");
  expect((await E.ficha(pide.uid)).plan).toBe("gratis");

  await panel.locator(`[data-cuenta="${pide.uid}"] [data-estado="bloqueado"]`).click();
  await expect(panel.locator("#nubeAviso")).toContainText("Pidiendo: bloqueada");
  expect((await E.ficha(pide.uid)).estado).toBe("bloqueado");
  const otra = await page.evaluate(() => tfDispatch("search", { origin: "BCN" }));
  expect(otra).toMatchObject({ ok: false, reason: "bloqueada" });
  await ctx.close();
});

test("el panel dice cuántas cuentas hay y cuántas son premium", async ({ browser }) => {
  const { ctx, page: panel } = await otraPersona(browser);
  await registrarse(panel, { nombre: "Jefa" });
  await E.hacerAdmin((await sesion(panel)).uid);
  await panel.goto("/admin.html");
  await expect(panel.locator("#stats")).toContainText("premium");
  await expect(panel.locator("#stats")).toContainText("gratis");
  await ctx.close();
});

/* ------------------------------------------------------- el formulario de verdad */
test("con cuenta gratis, mientras premium no se exija, el buscador funciona", async ({ page }) => {
  await registrarse(page);
  await page.goto("/buscar.html");
  await expect(page.locator(".premium-nota")).toHaveCount(0);
  await expect(page.locator('button[form="finderForm"]')).toBeEnabled();
});

test("buscar con la cuenta premium apunta el encargo con lo que sale del formulario", async ({ page }) => {
  await registrarse(page);
  const s = await sesion(page);
  await E.hacerPremium(s.uid);
  // La sesión guardada aún dice gratis: la página lo descubre al cargar y se
  // recarga sola con el formulario encendido.
  await page.goto("/buscar.html");
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("tf_sesion") || "{}").plan === "premium");
  await expect(page.locator('button[form="finderForm"]')).toBeEnabled();
  await page.locator('button[form="finderForm"]').click();
  await expect(page.locator("#searches")).toContainText("preguntando destino a destino");
  const [e] = await E.encargosDe(s.uid);
  // Lo que entra por las reglas es lo mismo que acaba en un `repository_dispatch`
  // del workflow `custom-search.yml`: una búsqueda, a nombre de esta cuenta.
  expect(e).toMatchObject({ tipo: "search", owner: s.uid, estado: "pendiente" });
  expect(Object.keys(e.payload).length).toBeLessThanOrEqual(10);
  expect(e.payload.viaje).toBeTruthy();
});

/* ------------------------------------------------- venir de las cuentas de antes */
test("una sesión de las cuentas de antes no cuenta como haber entrado", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("tf_sesion", JSON.stringify({ uid: "u-viejo", user: "vieja", name: "Vieja" }));
  });
  await page.goto("/index.html");
  expect(await page.evaluate(() => tfSesion())).toBeNull();
  expect(await page.evaluate(() => tfUid())).toBe("");
  // Sale como quien no ha entrado, y no como «pendiente de aprobación».
  await expect(page.locator("#tfCuenta")).toContainText("entrar");
  const r = await page.evaluate(() => tfDispatch("search", { origin: "MAD" }));
  expect(r).toMatchObject({ ok: false, reason: "sin-cuenta" });
});

test("al entrar con Firebase se llevan los favoritos de la cuenta de antes", async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("tf_sesion")) return; // solo la primera carga
    localStorage.setItem("tf_sesion", JSON.stringify({ uid: "u-viejo", user: "vieja", name: "Vieja" }));
    localStorage.setItem("tf_favoritos:u-viejo", JSON.stringify(["MAD-ROM-2026-12-11"]));
    localStorage.setItem("tf_quiz:u-viejo", JSON.stringify({ hecho: true }));
  });
  await registrarse(page);
  const s = await sesion(page);
  expect(s.nube).toBe(true);
  const suyos = await page.evaluate((uid) => localStorage.getItem(`tf_favoritos:${uid}`), s.uid);
  expect(JSON.parse(suyos)).toEqual(["MAD-ROM-2026-12-11"]);
  expect(await page.evaluate((uid) => localStorage.getItem(`tf_quiz:${uid}`), s.uid)).toContain("hecho");
  // Solo se copia: lo de antes se queda donde estaba.
  expect(await page.evaluate(() => localStorage.getItem("tf_favoritos:u-viejo"))).not.toBeNull();
});

test("lo que ya había en el cajón nuevo no se pisa", async ({ page }) => {
  await page.goto("/index.html");
  const correo = await registrarse(page);
  const s = await sesion(page);
  await page.evaluate(
    ([uid]) => {
      localStorage.setItem(`tf_favoritos:${uid}`, JSON.stringify(["lo-nuevo"]));
      localStorage.setItem("tf_sesion", JSON.stringify({ uid: "u-viejo", user: "v", name: "V" }));
      localStorage.setItem("tf_favoritos:u-viejo", JSON.stringify(["lo-viejo"]));
    },
    [s.uid]
  );
  const r = await page.evaluate(([c, p]) => nubeEntrar(c, p), [correo, clave]);
  expect(r.ok).toBe(true);
  expect(await page.evaluate((uid) => localStorage.getItem(`tf_favoritos:${uid}`), s.uid)).toBe('["lo-nuevo"]');
});
