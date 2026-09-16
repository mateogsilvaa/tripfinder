/* Los vuelos en los que ya se buscó cama, marcados.

   Buscar alojamiento son tres minutos de workflow y el resultado queda
   publicado para siempre. Lo que faltaba era decirlo en la fila: sin marca, el
   tablón de mañana enseña el mismo vuelo como si nunca se hubiera mirado y se
   vuelve a pedir lo que ya está hecho.

   Dos fuentes, y las dos cuentan: el índice público —lo que ha buscado
   cualquiera, y que se abre al instante— y `tf_camas`, que es tuyo y vive solo
   en este navegador. */
const { test, expect } = require("@playwright/test");

const CON_INDICE = "ryanair-MAD-ACE-20270115"; // Lanzarote, en el índice
const SIN_NADA = "ryanair-MAD-BGY-20270108"; // Bérgamo, nadie ha mirado

const fila = (page, id) => page.locator(`#offer-${id}`);

const abrir = async (page) => {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".brow").first()).toBeVisible();
};

test("la fila de un vuelo con cama buscada va marcada", async ({ page }) => {
  await abrir(page);
  await expect(fila(page, CON_INDICE)).toHaveClass(/con-cama/);
  await expect(fila(page, CON_INDICE).locator(".cama-ok")).toHaveText("cama buscada");
});

test("y la de uno que nadie ha mirado, no", async ({ page }) => {
  await abrir(page);
  await expect(fila(page, SIN_NADA)).not.toHaveClass(/con-cama/);
  await expect(fila(page, SIN_NADA).locator(".cama-ok")).toHaveCount(0);
});

test("la marca no se come el nombre de la ciudad", async ({ page }) => {
  // La rejilla tiene seis columnas y el ancho es lo único que no sobra: la
  // marca va en el margen y en un renglón que ya existía, no en una columna
  // nueva.
  await abrir(page);
  const recortados = await page.evaluate(() =>
    [...document.querySelectorAll(".brow .city")]
      .filter((e) => e.scrollWidth > e.clientWidth + 1)
      .map((e) => e.textContent)
  );
  expect(recortados).toEqual([]);
});

test("el botón ya no dice «buscar», dice «ver»", async ({ page }) => {
  await abrir(page);
  await fila(page, CON_INDICE).click();
  const detalle = fila(page, CON_INDICE).locator(".brow-detail");
  await expect(detalle.locator("[data-stay]")).toHaveText(/Ver el alojamiento/);
});

test("y donde no hay nada buscado sigue diciendo «buscar»", async ({ page }) => {
  await abrir(page);
  await fila(page, SIN_NADA).click();
  await expect(fila(page, SIN_NADA).locator(".brow-detail [data-stay]")).toHaveText(
    /Buscar alojamiento/
  );
});

test("el precio de la escapada sale REAL sin abrir el panel", async ({ page }) => {
  // El índice trae el total de la escapada de lo que ya se buscó. Hasta ahora
  // ese número solo lo veía quien hubiera abierto el panel en esa sesión; al
  // recargar volvía a poner «≈» sobre algo que ya se había consultado.
  //
  // El total va aquí y no en el fixture de siempre porque ese lo comparten
  // otras pruebas que comprueban justo lo contrario: que donde no hay dato de
  // camas no se inventa un número.
  await page.route("**/data/stays/index.json*", (r) =>
    r.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        viajes: { [CON_INDICE]: { n: "Lanzarote", d: "2027-01-15", c: 23, t: 201.92 } },
      }),
    })
  );
  await abrir(page);
  const escapada = fila(page, CON_INDICE).locator(".escapada");
  await expect(escapada).toHaveClass(/real/);
  await expect(escapada).not.toContainText("≈");
  await expect(escapada).toContainText("202");
});

test("lo que has buscado tú también marca, aunque no esté en el índice", async ({ page }) => {
  const UID = "u-mateo";
  await page.addInitScript((uid) => {
    try {
      localStorage.setItem("tf_sesion", JSON.stringify({ uid, user: "mateo", name: "Mateo" }));
      localStorage.setItem(
        `tf_camas:${uid}`,
        JSON.stringify([{ id: "ryanair-MAD-BGY-20270108", ciudad: "Bergamo", ida: "2027-01-08" }])
      );
    } catch (e) { /* nada */ }
  }, UID);
  await abrir(page);
  await expect(fila(page, SIN_NADA)).toHaveClass(/con-cama/);
});

test("sin índice publicado el tablón no se rompe", async ({ page }) => {
  await page.route("**/data/stays/index.json*", (r) => r.fulfill({ status: 404, body: "" }));
  await abrir(page);
  await expect(page.locator(".brow").first()).toBeVisible();
  await expect(page.locator(".brow.con-cama")).toHaveCount(0);
});
