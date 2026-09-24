/* De Madrid, en tren.

   Una escapada dentro de España no empieza en un avión, y la web no lo
   contemplaba: si no había vuelo, no había viaje. De Madrid el AVE llega a
   Sevilla en 2 h 21 y a Zaragoza en 1 h 15, del centro al centro.

   LO QUE ESTA PÁGINA NO HACE, y es la decisión que la define: no dice precios.
   Renfe publica sus horarios en abierto pero no sus tarifas; las que saliesen
   aquí serían raspadas de una web ajena y se quedarían viejas sin avisar. Un
   precio viejo es peor que ningún precio — la misma regla que ya sigue
   `stays/deeplinks.py` con Booking. Hay pruebas de que sigue sin haberlos. */
const { test, expect } = require("@playwright/test");

const abrir = async (page) => {
  await page.goto("/trenes.html", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  await expect(page.locator("#trenRows .brow").first()).toBeVisible();
};

test.describe("la página de los trenes", () => {
  test("pinta los destinos ordenados por lo que se tarda", async ({ page }) => {
    await abrir(page);
    const tiempos = await page
      .locator("#trenRows .tren-tiempo")
      .allTextContents();
    expect(tiempos.length).toBeGreaterThan(5);
    // «27 min», «1 h 15», «2 h 21» → a minutos, para comprobar el orden.
    const min = tiempos.map((t) => {
      const h = /(\d+)\s*h/.exec(t);
      const m = /h\s*(\d+)/.exec(t) || (h ? null : /(\d+)\s*min/.exec(t));
      return (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0);
    });
    expect(min).toEqual([...min].sort((a, b) => a - b));
    expect(min[0]).toBeGreaterThan(0);
  });

  test("el tope de viaje recorta la lista de verdad", async ({ page }) => {
    await abrir(page);
    const dos = await page.locator("#trenRows .brow").count();
    await page.selectOption("#trenTope", "90");
    await page.waitForTimeout(150);
    const hora_y_media = await page.locator("#trenRows .brow").count();
    expect(hora_y_media).toBeLessThan(dos);

    await page.selectOption("#trenTope", "0");
    await page.waitForTimeout(150);
    expect(await page.locator("#trenRows .brow").count()).toBeGreaterThan(dos);
  });

  test("y se puede pedir una sola estación", async ({ page }) => {
    // No son intercambiables: presentarse en la que no es son cuarenta minutos
    // de metro, y eso se lleva por delante la ventaja del tren.
    await abrir(page);
    await page.selectOption("#trenTope", "0");
    await page.selectOption("#trenSalida", "Chamartín");
    await page.waitForTimeout(150);
    const textos = await page.locator("#trenRows .tren-estacion").allTextContents();
    expect(textos.length).toBeGreaterThan(3);
    textos.forEach((t) => expect(t).toContain("Chamartín"));
  });

  test("si el tope no da para ningún tren, lo dice en vez de quedarse en blanco", async ({
    page,
  }) => {
    await abrir(page);
    await page.selectOption("#trenTope", "90");
    await page.selectOption("#trenSalida", "Chamartín");
    await page.waitForTimeout(150);
    const filas = await page.locator("#trenRows .brow").count();
    const pista = await page.locator("#trenHint").textContent();
    if (filas === 0) expect(pista).toContain("no llega el tren");
    else expect(pista).toContain("destino");
  });

  test("no hay ni un precio en toda la página, y explica por qué", async ({ page }) => {
    await abrir(page);
    await page.selectOption("#trenTope", "0");
    await page.waitForTimeout(150);
    const texto = await page.locator("main").innerText();
    expect(texto).not.toMatch(/\d+\s*€/);
    expect(texto).not.toMatch(/€\s*\d+/);
    expect(texto).toContain("Aquí no hay precios");
    // Y el enlace a Renfe, que es donde sí está el precio.
    const renfe = page.locator('a[href^="https://www.renfe.com"]');
    await expect(renfe).toHaveAttribute("target", "_blank");
    await expect(renfe).toHaveAttribute("rel", /noopener/);
  });

  test("las filas no fingen que se abren", async ({ page }) => {
    // Reusa `.brow` del tablón, pero aquí no hay detalle que desplegar: ni
    // chevrón, ni cursor de mano, ni `role="button"`.
    await abrir(page);
    const fila = page.locator("#trenRows .brow").first();
    await expect(fila).not.toHaveAttribute("data-open", /.*/);
    const cursor = await fila.evaluate((el) => getComputedStyle(el).cursor);
    expect(cursor).toBe("default");
    const flecha = await fila.evaluate(
      (el) => getComputedStyle(el, "::after").content
    );
    expect(flecha).toBe("none");
  });

  test("el nav lleva a los trenes desde cualquier página", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
    const enlace = page.locator('.zonas a[href="trenes.html"]');
    await expect(enlace).toBeVisible();
    await enlace.click();
    await expect(page).toHaveURL(/trenes\.html/);
    await expect(page.locator('.zona[data-zona="tren"]')).toHaveAttribute(
      "aria-current",
      "page"
    );
  });

  test("en el móvil el tiempo va primero, como dice la cabecera", async ({ page }) => {
    // La maqueta apilada del tablón coloca a los hijos de `.brow` por casillas
    // fijas, y una fila de tren ES un `.brow`: sin anularlas, la ciudad se iba
    // a la izquierda y el tiempo a la derecha, al revés de lo que se lee.
    await page.setViewportSize({ width: 390, height: 800 });
    await abrir(page);
    const fila = page.locator("#trenRows .brow").first();
    const t = await fila.locator(".tren-tiempo").boundingBox();
    const c = await fila.locator(".dest-cell").boundingBox();
    expect(t.x).toBeLessThan(c.x);
  });
});
