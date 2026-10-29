/* El modo HOP contra los emuladores: crear (premium), invitar, unirse (cualquier
   cuenta), proponer, votar y hablar. Y el tope: un HOP activo en premium, los
   que quieras en Max. */
const { test, expect } = require("@playwright/test");
const E = require("./emulador.js");

const clave = "una-clave-larga-1";

async function persona(browser, nombre) {
  const ctx = await browser.newContext({ baseURL: "http://localhost:4173", timezoneId: "Europe/Madrid" });
  await ctx.addInitScript((c) => {
    window.TF_NUBE = c;
  }, E.CONFIG);
  const page = await ctx.newPage();
  await page.goto("/index.html");
  await page.locator("#tfCuenta").click();
  await page.locator("#nubeCorreo").fill(E.correoNuevo());
  await page.locator("#nubePass").fill(clave);
  await page.locator("#nubeForm button[type=submit]").click();
  await expect(page.locator("#nubeBienvenida")).toBeVisible();
  await page.locator("#nubeNombre").fill(nombre);
  await Promise.all([page.waitForEvent("load"), page.locator("#nubeListo").click()]);
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem("tf_sesion")));
  return { ctx, page, uid: s.uid };
}

const dentroDeUnMes = () => {
  const d = new Date(Date.now() + 30 * 864e5);
  return d.toISOString().slice(0, 10);
};

async function crear(page, nombre) {
  await page.goto("/hop.html");
  await page.locator("#hopCrear [name=nombre]").fill(nombre);
  await page.locator("#hopCrear [name=fin]").fill(dentroDeUnMes());
  await page.locator("#hopCrear button[type=submit]").click();
  await expect(page.locator(".hop-top h2")).toHaveText(nombre);
  return new URL(page.url()).searchParams.get("j");
}

test("gratis no crea un HOP; premium sí, y lo comparte con un enlace", async ({ browser }) => {
  const gus = await persona(browser, "Gus");
  await gus.page.goto("/hop.html");
  await expect(gus.page.locator(".hop-crear")).toContainText("Crear un HOP es de premium");
  await expect(gus.page.locator("#hopCrear")).toHaveCount(0);

  const ana = await persona(browser, "Ana");
  await E.hacerPremium(ana.uid);
  const id = await crear(ana.page, "Roma en primavera");
  await expect(ana.page.locator("#hopEnlace")).toContainText(`?j=${id}`);
  await gus.ctx.close();
  await ana.ctx.close();
});

test("con el enlace se une cualquiera, y se propone, se vota y se habla", async ({ browser }) => {
  test.setTimeout(60000);
  const ana = await persona(browser, "Ana");
  await E.hacerPremium(ana.uid);
  const id = await crear(ana.page, "Escapada");

  const gus = await persona(browser, "Gus");
  await gus.page.goto(`/hop.html?j=${id}`);
  await expect(gus.page.locator(".hop-unirse")).toContainText("La organiza Ana");
  await gus.page.locator("#hopUnirme").click();
  await expect(gus.page.locator(".hop-top h2")).toHaveText("Escapada");

  // Gus propone un viaje.
  await gus.page.locator('[data-nueva="viaje"]').click();
  await gus.page.locator("#hopPropForm [name=titulo]").fill("Lisboa barata");
  await gus.page.locator("#hopPropForm [name=destino]").fill("Lisboa");
  await gus.page.locator("#hopPropForm [name=precio]").fill("79");
  await gus.page.locator("#hopPropForm button[type=submit]").click();
  const prop = gus.page.locator(".hop-prop", { hasText: "Lisboa barata" });
  await expect(prop).toContainText("79 €");
  await prop.locator('[data-voto="si"]').click();
  await expect(prop.locator('[data-voto="si"]')).toHaveAttribute("aria-pressed", "true");

  // Y escribe en el chat.
  await gus.page.locator("#hopEscribir textarea").fill("¿Lisboa en mayo?");
  await gus.page.locator("#hopEscribir button").click();
  await expect(gus.page.locator(".hop-msj.mio")).toContainText("¿Lisboa en mayo?");

  // Ana lo ve todo, vota y contesta.
  await ana.page.goto(`/hop.html?j=${id}`);
  const suya = ana.page.locator(".hop-prop", { hasText: "Lisboa barata" });
  await expect(suya.locator('[data-voto="si"] b')).toHaveText("1");
  await expect(suya).toContainText("Falta: Ana");
  await suya.locator('[data-voto="quiza"]').click();
  await expect(suya).toContainText("Ya han votado todos");
  await expect(ana.page.locator(".hop-msj").first()).toContainText("¿Lisboa en mayo?");
  await ana.page.locator("#hopEscribir textarea").fill("Me vale");
  await ana.page.keyboard.press("Enter");

  // Y a Gus le llega solo, sin recargar.
  await expect(gus.page.locator(".hop-msj:not(.mio)")).toContainText("Me vale", { timeout: 10000 });
  await gus.ctx.close();
  await ana.ctx.close();
});

test("premium tiene un HOP activo; Max, los que quiera", async ({ browser }) => {
  const ana = await persona(browser, "Ana");
  await E.hacerPremium(ana.uid);
  await crear(ana.page, "La primera");
  await ana.page.goto("/hop.html");
  await expect(ana.page.locator(".hop-crear")).toContainText("Ya tienes un HOP activo");
  // Ni saltándose la página.
  const r = await ana.page.evaluate((f) => nubeHopCrear({ nombre: "Otra", fin: f }), dentroDeUnMes());
  expect(r.ok).toBe(false);

  const max = await persona(browser, "Max");
  await E.poner(max.uid, { estado: "aprobado", plan: "max" });
  await crear(max.page, "Una");
  await crear(max.page, "Dos");
  await max.page.goto("/hop.html");
  await expect(max.page.locator(".hop-tarjeta")).toHaveCount(2);
  await expect(max.page.locator(".hop-cupo")).toContainText("sin límite");
  await ana.ctx.close();
  await max.ctx.close();
});

test("quien lo crea lo borra, y entonces puede crear otro", async ({ browser }) => {
  const ana = await persona(browser, "Ana");
  await E.hacerPremium(ana.uid);
  await crear(ana.page, "Para borrar");
  ana.page.on("dialog", (d) => d.accept());
  await ana.page.locator("#hopBorrar").click();
  await ana.page.waitForURL(/hop$/);
  await expect(ana.page.locator("#hopCrear")).toBeVisible();
  await ana.ctx.close();
});
