/* Humo de frontend: lo minimo para que un cambio que deja la web en blanco no
   llegue a main. No comprueba que este bonita, comprueba que este.

   Nada de esto toca la red: los datos salen de `tests/web/datos/` y las
   fuentes de Google se bloquean, que si no cada prueba depende de que
   fonts.googleapis.com conteste. */
const { test, expect } = require("@playwright/test");

const OFERTAS = require("./datos/offers.json");

// Sin esto cada prueba se queda esperando a Google Fonts, que ademas no hace
// falta para nada de lo que se comprueba aqui.
test.beforeEach(async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
});

test.describe("la hoja del día", () => {
  test("pinta la plancha del día y una fila por oferta", async ({ page }) => {
    await page.goto("/index.html");

    // La plancha: el toponimo grande y la cifra en rojo del mejor chollo.
    const plancha = page.locator(".ticket");
    await expect(plancha).toBeVisible();
    await expect(plancha.locator(".dest")).toHaveText(
      new RegExp(OFERTAS.offers[0].destination_name)
    );
    await expect(plancha.locator(".amount")).toContainText(
      String(Math.round(OFERTAS.offers[0].price))
    );

    // Y el resto, una entrada de indice cada una.
    await expect(page.locator(".brow")).toHaveCount(OFERTAS.offers.length - 1);

    // La cabecera de columnas y los puntos guia, que son el gesto del sistema.
    await expect(page.locator("#boardHead")).toBeVisible();
    await expect(page.locator(".brow .leader").first()).toBeAttached();
  });

  test("el esqueleto de carga se quita cuando llegan los datos", async ({ page }) => {
    await page.goto("/index.html");
    await expect(page.locator(".ticket")).toBeVisible();
    await expect(page.locator("#cargando")).toHaveCount(0);
  });

  test("si los datos no llegan, lo dice en vez de quedarse en blanco", async ({ page }) => {
    await page.route("**/offers.json*", (r) => r.abort());
    await page.goto("/index.html");
    await expect(page.locator("#cargando")).toContainText(/no se han podido leer/i);
  });
});

test.describe("las cuentas", () => {
  test("sin sesión los formularios salen apagados y con el motivo", async ({ page }) => {
    await page.goto("/buscar.html");
    const form = page.locator("#finderForm");
    await expect(form).toHaveClass(/candado/);
    await expect(form.locator(".candado-nota")).toContainText(/hace falta una cuenta/i);
    // Apagados de verdad, no solo con pinta de apagados.
    for (const sel of ["#fWhere", "#fMax", 'button[type="submit"]']) {
      await expect(form.locator(sel)).toBeDisabled();
    }
  });
});

test.describe("la 404", () => {
  test("una dirección que no existe da la página de la web, con estilos", async ({ page }) => {
    const r = await page.goto("/esto-no-existe");
    expect(r.status()).toBe(404);
    await expect(page.locator("h1")).toContainText(/fuera de la carta/i);
    await expect(page.locator("#perdidaRef")).toContainText("/esto-no-existe");
    // Con estilos: si la hoja no cargara, el fondo seria el del navegador.
    const fondo = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(fondo).not.toBe("rgba(0, 0, 0, 0)");
    // Y una salida.
    await expect(page.locator('main a[href="./"]')).toBeVisible();
  });
});

test.describe("el armazón que comparten las páginas", () => {
  for (const [pagina, activa] of [
    ["/index.html", "hoja del día"],
    ["/buscar.html", "trazar un viaje"],
    ["/seguimientos.html", "en observación"],
  ]) {
    test(`${pagina} monta cabecera, zonas y pie`, async ({ page }) => {
      await page.goto(pagina);
      await expect(page.locator(".zona")).toHaveCount(3);
      await expect(page.locator(".zona.activa")).toHaveText(activa);
      await expect(page.locator("#tema")).toBeVisible();
      await expect(page.locator(".foot .build")).toBeVisible();
    });
  }

  test("sin JavaScript se dice, en vez de dejar la página muda", async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    // Sin JS no hay nada que esperar despues del HTML, y esperar al `load`
    // son doce segundos de fuentes que ademas aqui van bloqueadas.
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".sin-js")).toBeVisible();
    await ctx.close();
  });
});

/* Pendiente: el test de destinos ("de seis respuestas a tres propuestas") que
   pedia la issue #32. Todavia no existe —es el trabajo de #6 a #12—, asi que
   no hay nada que comprobar. Cuando se construya, aqui va su prueba. */
