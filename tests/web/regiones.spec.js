/* Las regiones: el escalón que faltaba entre «Europa» —44 países— y la ciudad
   suelta. Nadie dice «me voy a Europa»; dice «me voy a los Balcanes».

   Lo que se prueba aquí es que la web y el backend no puedan decir cosas
   distintas: las dos listas —la del filtro del tablón y la del selector de
   destino— salen del MISMO `data/regiones.json` que escribe el backend desde su
   única definición. Y que el filtro sepa que una región no es un continente. */
const { test, expect } = require("@playwright/test");

/* El primer viaje de la lista no es una fila: es el destacado de arriba. Quien
   mira el tablón ve los dos sitios, así que lo que se cuenta aquí es lo que se
   ve, no una de las dos maquetas. */
const enPantalla = (page) =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll("#hero .ticket .dest"),
      ...document.querySelectorAll(".brow .city"),
    ].map((e) => e.firstChild.textContent.trim())
  );

test.describe("el filtro del tablón", () => {
  test("ofrece las regiones aparte, y solo las que hoy tienen vuelo", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".brow").first()).toBeVisible();

    const grupo = page.locator("#cont optgroup[label='Regiones']");
    await expect(grupo).toHaveCount(1);

    // ACE es la Península Ibérica y MAN las Islas Británicas; el Caribe y los
    // Balcanes están en el fichero y no en el tablón, así que no se ofrecen:
    // un desplegable con opciones que no dan nada es peor que no tenerlo.
    const opciones = await grupo.locator("option").allTextContents();
    expect(opciones).toEqual(["La Península Ibérica", "Las Islas Británicas"]);
  });

  test("las regiones se enseñan con su tilde y se guardan sin ella", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".brow").first()).toBeVisible();
    const op = page.locator("#cont option", { hasText: "Las Islas Británicas" });
    await expect(op).toHaveAttribute("value", "r:las islas britanicas");
  });

  test("elegir una región deja solo sus países", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".brow").first()).toBeVisible();
    expect(await enPantalla(page)).toEqual(["Manchester", "Bergamo", "Lanzarote"]);

    await page.selectOption("#cont", "r:las islas britanicas");
    await expect.poll(() => enPantalla(page)).toEqual(["Manchester"]);

    // Y la de al lado enseña otra cosa, no la misma lista recortada.
    await page.selectOption("#cont", "r:la peninsula iberica");
    await expect.poll(() => enPantalla(page)).toEqual(["Lanzarote"]);
  });

  test("y el continente de siempre sigue funcionando", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".brow").first()).toBeVisible();
    await page.selectOption("#cont", "Europa");
    // Los tres vuelos del ejemplo son europeos: la región recorta, el
    // continente no.
    await expect.poll(() => enPantalla(page)).toEqual(["Manchester", "Bergamo", "Lanzarote"]);
  });

  test("volver a «Todos» devuelve el tablón entero", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".brow").first()).toBeVisible();
    await page.selectOption("#cont", "r:la peninsula iberica");
    await expect.poll(() => enPantalla(page)).toEqual(["Lanzarote"]);
    await page.selectOption("#cont", "");
    await expect.poll(() => enPantalla(page)).toEqual(["Manchester", "Bergamo", "Lanzarote"]);
  });

  test("si no hay fichero de regiones el filtro no se rompe", async ({ page }) => {
    await page.route("**/data/regiones.json*", (r) => r.fulfill({ status: 404, body: "" }));
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".brow").first()).toBeVisible();
    await expect(page.locator("#cont optgroup")).toHaveCount(0);
    await expect(page.locator("#cont option", { hasText: "Europa" })).toHaveCount(1);
  });
});

test.describe("el selector de destino", () => {
  /* Sin cuenta el formulario sale apagado —escribe en el repo—, así que para
     abrir el selector hay que entrar. */
  const abrir = async (page) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("tf_sesion", JSON.stringify({ uid: "u-p", user: "p", name: "P" }));
        localStorage.setItem("tf_token", "ghp_de_mentira");
      } catch (e) { /* nada */ }
    });
    await page.goto("/buscar.html", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#finderForm:not(.candado)", { timeout: 10000 });
    await page.selectOption("#fWhere", "one");
    await page.click("#destBtn");
    await expect(page.locator("#destModal")).toBeVisible();
  };

  test("pone las regiones arriba del todo", async ({ page }) => {
    await abrir(page);
    await expect(page.locator("#destList .pais.regiones")).toHaveCount(1);
    // Arriba: es lo más ancho que se puede pedir, y quien abre esto sin un
    // sitio en la cabeza es justo a quien le sirve.
    const primero = page.locator("#destList > .pais").first();
    await expect(primero).toHaveClass(/regiones/);
  });

  test("las lista todas, también las que hoy no tienen vuelo", async ({ page }) => {
    await abrir(page);
    // Aquí no se filtra por el tablón: esto lanza una búsqueda nueva, así que
    // pedir los Balcanes es legítimo aunque hoy no haya ninguno barato.
    const nombres = await page.locator("#destList .ciudad.region").allTextContents();
    expect(nombres.map((t) => t.trim().replace(/\s+\d+$/, ""))).toEqual([
      "El Caribe",
      "La Península Ibérica",
      "Las Islas Británicas",
      "Los Balcanes",
    ]);
  });

  test("se buscan escribiendo, con tilde o sin ella", async ({ page }) => {
    await abrir(page);
    await page.fill("#destSearch", "balcan");
    await expect(page.locator("#destList .ciudad.region")).toHaveCount(1);
    await expect(page.locator("#destList .ciudad.region")).toContainText("Los Balcanes");
  });

  test("elegir una región la deja puesta como destino", async ({ page }) => {
    await abrir(page);
    await page.click("#destList .ciudad.region:has-text('Los Balcanes')");
    await expect(page.locator("#destModal")).toBeHidden();
    await expect(page.locator("#fDest")).toHaveValue("Los Balcanes");
    await expect(page.locator("#destBtn")).toContainText("Los Balcanes");
  });

  test("y los países de siempre siguen ahí", async ({ page }) => {
    await abrir(page);
    await page.fill("#destSearch", "espa");
    await expect(page.locator("#destList .ciudad.region")).toHaveCount(0);
    await expect(page.locator("#destList .pais:not(.regiones)").first()).toBeVisible();
  });
});
