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

test.describe("enlaces que vienen de los datos", () => {
  test("un javascript: en un deep_link sale inerte y queda apuntado", async ({ page }) => {
    // Se sirve el JSON envenenado en lugar del normal.
    await page.route("**/offers.json*", (r) =>
      r.fulfill({ path: require.resolve("./datos/offers-envenenado.json") })
    );

    const apuntes = [];
    await page.exposeFunction("__apunte", (tipo, msg) => apuntes.push(`${tipo}: ${msg}`));
    await page.addInitScript(() => {
      // El registro de errores real guarda en localStorage; aqui basta con
      // enterarse de que se ha llamado.
      window.addEventListener("DOMContentLoaded", () => {
        const original = window.tfApuntar;
        window.tfApuntar = (tipo, msg, detalle) => {
          window.__apunte(tipo, msg);
          if (original) original(tipo, msg, detalle);
        };
      });
    });

    await page.goto("/index.html");
    await expect(page.locator(".ticket")).toBeVisible();

    // Ninguno de los enlaces de la plancha apunta a javascript: ni a data:.
    const hrefs = await page.locator(".ticket a").evaluateAll((as) =>
      as.map((a) => a.getAttribute("href"))
    );
    expect(hrefs.length).toBeGreaterThan(0);
    for (const h of hrefs) {
      expect(h).not.toMatch(/^\s*(javascript|data):/i);
    }
    // El envenenado se queda en "#": enlace que no lleva a ninguna parte.
    expect(hrefs).toContain("#");

    // Y ha quedado dicho en el registro.
    await expect.poll(() => apuntes.filter((a) => a.startsWith("url:")).length).toBeGreaterThan(0);
  });

  test("los enlaces normales siguen funcionando, con path y con query", async ({ page }) => {
    await page.route("**/offers.json*", (r) =>
      r.fulfill({ path: require.resolve("./datos/offers-envenenado.json") })
    );
    await page.goto("/index.html");
    // La segunda oferta lleva una URL de Wizz con path y query: tiene que
    // llegar entera al href, sin recortes ni escapes de mas.
    const fila = page.locator(".brow").first();
    await fila.click();
    const href = await fila.locator('a[href*="wizzair.com"]').first().getAttribute("href");
    expect(href).toBe(
      "https://wizzair.com/es-es/booking/select-flight/MAD/BGY/2027-01-08?adults=1"
    );
  });
});

/* Pendiente: el test de destinos ("de seis respuestas a tres propuestas") que
   pedia la issue #32. Todavia no existe —es el trabajo de #6 a #12—, asi que
   no hay nada que comprobar. Cuando se construya, aqui va su prueba. */
