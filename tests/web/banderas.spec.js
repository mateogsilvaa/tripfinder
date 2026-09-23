/* Las banderas de los países.

   Una bandera se reconoce antes que un nombre: en una lista de veinte destinos
   es la diferencia entre leer y ojear.

   SIN IMÁGENES Y SIN CDN. Un emoji de bandera son las dos letras del código ISO
   desplazadas al bloque de símbolos regionales del Unicode, así que pesa cero,
   lo dibuja el sistema y sigue estando sin cobertura — que es justo lo que una
   CDN de banderitas rompería, porque esta web abre sin red.

   La tabla de nombre de país a código venía dentro del mapamundi. Al quitarlo
   (#144) se habría ido con él; por eso vive ahora en `web/js/paises.js`, que es
   lo que se prueba aquí. */
const { test, expect } = require("@playwright/test");

const abrir = async (page) => {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".brow").first()).toBeVisible();
};

/* El módulo, directamente: es lo que decide todo lo demás. */
const traducir = (page, paises) =>
  page.evaluate(async (lista) => {
    const { isoDe, banderaDe } = await import("./js/paises.js");
    return lista.map((p) => [p, isoDe(p), banderaDe(p)]);
  }, paises);

test.describe("de un nombre de país a su bandera", () => {
  test("los países de los datos se reconocen", async ({ page }) => {
    await abrir(page);
    expect(await traducir(page, ["Italia", "España", "Reino Unido", "Marruecos"])).toEqual([
      ["Italia", "IT", "🇮🇹"],
      ["España", "ES", "🇪🇸"],
      ["Reino Unido", "GB", "🇬🇧"],
      ["Marruecos", "MA", "🇲🇦"],
    ]);
  });

  test("sin tilde también, porque así llegan algunos", async ({ page }) => {
    // El scraper escribe unos con tilde y otros sin ella; se comparan pelados.
    await abrir(page);
    const r = await traducir(page, ["Turquia", "Turquía", "Paises Bajos", "Países Bajos"]);
    expect(r.map((x) => x[1])).toEqual(["TR", "TR", "NL", "NL"]);
  });

  test("y en inglés, que es como los devuelve a veces el scraper", async ({ page }) => {
    await abrir(page);
    const r = await traducir(page, ["South Korea", "North Macedonia", "Singapore", "Qatar"]);
    expect(r.map((x) => x[1])).toEqual(["KR", "MK", "SG", "QA"]);
  });

  test("lo que no se reconoce no inventa nada", async ({ page }) => {
    // Cadena vacía y no un cuadrado roto: mejor sin bandera que con una mala.
    await abrir(page);
    expect(await traducir(page, ["Narnia", "", "  "])).toEqual([
      ["Narnia", "", ""],
      ["", "", ""],
      ["  ", "", ""],
    ]);
  });
});

test.describe("dónde se ven", () => {
  test("en la fila, delante del país", async ({ page }) => {
    await abrir(page);
    const pais = page.locator(".brow .country").first();
    await expect(pais.locator(".bandera")).toHaveCount(1);
    await expect(pais).toContainText(/\p{Regional_Indicator}{2}/u);
  });

  test("y en el destacado", async ({ page }) => {
    await abrir(page);
    await expect(page.locator(".ticket .dest small")).toContainText(
      /\p{Regional_Indicator}{2}/u
    );
  });

  test("la bandera no la lee el lector de pantalla", async ({ page }) => {
    // El país ya está escrito al lado: «bandera de Italia, Italia» sobra.
    await abrir(page);
    await expect(page.locator(".brow .bandera").first()).toHaveAttribute("aria-hidden", "true");
  });

  test("y no se come el nombre de la ciudad", async ({ page }) => {
    // Esa rejilla ya se comió el nombre una vez. La bandera va DENTRO del país,
    // que es el elemento que cede primero, así que se encoge con él.
    await page.setViewportSize({ width: 820, height: 1000 });
    await abrir(page);
    const recortados = await page.evaluate(() =>
      [...document.querySelectorAll(".brow .city")]
        .filter((e) => e.scrollWidth > e.clientWidth + 1)
        .map((e) => e.textContent)
    );
    expect(recortados).toEqual([]);
  });
});

test("el selector de destino también las lleva", async ({ page }) => {
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
  await expect(page.locator("#destList .pais-todo .bandera").first()).toBeVisible();
});
