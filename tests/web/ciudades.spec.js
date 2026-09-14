/* El nombre del sitio es lo último que se cede, y era lo primero.

   El tablón es una rejilla de seis columnas. Las fijas —seguir, precio,
   compartir— y los huecos suman 424 px que no se encogen; las otras tres
   llevaban `minmax(0, …)`, o sea permiso para bajar hasta CERO. Así que al
   estrechar la ventana el reparto se comía justo lo que hay que leer: entre 761
   y 1000 px, «Dublín» medía 14 px y en la lista de viajes apuntados el nombre
   llegaba a medir 0.

   Y no se veía, porque justo por debajo de esa franja empieza la maqueta
   apilada del móvil: a 1280 se ve bien y a 390 también. El fallo vivía
   exactamente en los anchos de ventana de portátil, que es donde más se mira
   esto. De ahí que esta prueba BARRA anchos en vez de comprobar dos. */
const { test, expect } = require("@playwright/test");

const UID = "u-mateo";
const ID = "ryanair-MAD-MAN-20261120";

/* Manchester a propósito: es el nombre largo de verdad del tablón, y el que
   decide dónde está el suelo. Con «Pisa» cualquier rejilla parece correcta. */
const FAV = {
  [ID]: {
    id: ID, origin: "MAD", destination: "MAN", destination_name: "Manchester",
    destination_country: "Reino Unido", depart_date: "2026-11-20",
    return_date: "2026-11-22", nights: 2, airline: "Ryanair", adults: 1,
    deep_link: "https://example.com", precio_inicial: 80, precio_visto: 73,
    visto_en: "2026-09-13", desde: 1,
    historia: [{ d: "2026-09-12", p: 80 }, { d: "2026-09-13", p: 73 }],
    cambio: null,
  },
};

const conCuenta = (page) =>
  page.addInitScript(([uid, f]) => {
    try {
      localStorage.setItem("tf_sesion", JSON.stringify({ uid, user: "mateo", name: "Mateo" }));
      localStorage.setItem(`tf_favoritos:${uid}`, JSON.stringify(f));
    } catch (e) { /* nada */ }
  }, [UID, FAV]);

/* Lo que importa no es un umbral de píxeles —«Pisa» son 29 px legítimos— sino
   si el nombre CABE en su hueco. */
const recortados = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".city, .term-ciudad, .cambio header h4")]
      .filter((e) => e.offsetParent !== null && e.textContent.trim())
      .filter((e) => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().width < 12)
      .map((e) => `${e.textContent.trim()} (${Math.round(e.getBoundingClientRect().width)}px)`)
  );

// 761 y 1080 son los bordes de la franja: ahí es donde se rompía.
const ANCHOS = [1440, 1200, 1081, 1080, 1000, 900, 820, 761, 760, 600, 390];

for (const ancho of ANCHOS) {
  test(`el tablón dice el nombre del sitio entero a ${ancho} px`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: 1000 });
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".brow .city").first()).toBeVisible();
    expect(await recortados(page)).toEqual([]);
  });
}

for (const ancho of [1080, 1000, 900, 820, 761]) {
  test(`y los viajes apuntados, a ${ancho} px`, async ({ page }) => {
    await conCuenta(page);
    await page.setViewportSize({ width: ancho, height: 1000 });
    await page.goto("/seguimientos.html", { waitUntil: "domcontentloaded" });
    const ciudad = page.locator("#favoritos .city").first();
    await expect(ciudad).toBeVisible();
    await expect(ciudad).toHaveText("Manchester");
    expect(await recortados(page)).toEqual([]);
  });
}

/* El suelo, dicho como regla y no como número suelto: por debajo de esto no
   cabe el nombre de una ciudad, así que la rejilla no puede bajar de ahí. */
test("la columna del destino tiene suelo, no `minmax(0, …)`", async ({ page }) => {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  const cols = await page.evaluate(() =>
    getComputedStyle(document.querySelector(".rows")).getPropertyValue("--cols").trim()
  );
  expect(cols).not.toMatch(/minmax\(\s*0\s*,\s*1\.05fr/);
  expect(cols).toMatch(/minmax\(\s*\d+ch/);
});
