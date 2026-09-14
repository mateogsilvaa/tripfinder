/* La banda de cambio de precio: mínima, y que solo salte una vez.

   Era un cartel —rúbrica en script, titular a cuerpo de portada, y una ficha
   por viaje con su caja, su sello y tres botones— para decir que algo ha bajado
   catorce euros, encima de una lista donde ese viaje ya sale. Ahora es una
   línea por viaje con su curva pegada al lado: qué ha cambiado, cuál, cuánto y
   cómo viene. Lo que se HACE con el viaje está en la lista de abajo. */
const { test, expect } = require("@playwright/test");

const UID = "u-mateo";
const ID = "wizzair-MAD-TIA-20270205";

const fav = (cambio, extra = {}) => ({
  [ID]: {
    id: ID, origin: "MAD", destination: "TIA", destination_name: "Tirana",
    destination_country: "Albania", depart_date: "2027-02-05",
    return_date: "2027-02-07", nights: 2, airline: "Wizz Air", adults: 1,
    deep_link: "https://example.com", precio_inicial: 120,
    precio_visto: cambio ? cambio.ahora : 98, visto_en: "2026-09-14", desde: 1,
    historia: [{ d: "2026-09-11", p: 120 }, { d: "2026-09-14", p: 98 }],
    cambio, ...extra,
  },
});

/* Sin watch.json la página sincroniza con datos reales y reescribe el cambio:
   estas pruebas hablan de lo que se PINTA, así que la fuente se deja quieta. */
const conBanda = async (page, favs) => {
  await page.route("**/data/watch.json*", (r) =>
    r.fulfill({ contentType: "application/json", body: '{"watches":[]}' })
  );
  // Se siembra SOLO SI NO HAY NADA: `addInitScript` corre en cada navegación,
  // también en el reload, y replantar el fixture borraría justo lo que la
  // prueba quiere comprobar que se ha guardado.
  await page.addInitScript(([uid, f]) => {
    try {
      localStorage.setItem("tf_sesion", JSON.stringify({ uid, user: "mateo", name: "Mateo" }));
      if (!localStorage.getItem(`tf_favoritos:${uid}`)) {
        localStorage.setItem(`tf_favoritos:${uid}`, JSON.stringify(f));
      }
    } catch (e) { /* nada */ }
  }, [UID, favs]);
  await page.goto("/seguimientos.html", { waitUntil: "domcontentloaded" });
};

const CAMBIO = { antes: 112, ahora: 98, cuando: "2026-09-14", visto: false };

test("una línea por viaje, con su curva al lado", async ({ page }) => {
  await conBanda(page, fav(CAMBIO));
  const fila = page.locator("#favAviso .cambio");
  await expect(fila).toHaveCount(1);
  await expect(fila).toContainText("Tirana");
  await expect(fila).toContainText("112 €");
  await expect(fila).toContainText("98 €");
  await expect(fila).toContainText("−14 €");
  // La curva, dentro de la MISMA fila: es de lo que habla.
  await expect(fila.locator(".cambio-curva svg")).toBeVisible();
});

/* Lo que se quitó, y a propósito: el cartel. */
test("ni titular gigante, ni rúbrica en script, ni botonera", async ({ page }) => {
  await conBanda(page, fav(CAMBIO));
  const banda = page.locator("#favAviso");
  await expect(banda.locator(".kicker")).toHaveCount(0);
  await expect(banda.locator("h3")).toHaveCount(0);
  await expect(banda.locator(".insignia")).toHaveCount(0);
  await expect(banda.locator("[data-share], [data-cama]")).toHaveCount(0);

  // Y la banda entera cabe en el alto de unas pocas filas, no de un cartel.
  const alto = await banda.evaluate((e) => e.getBoundingClientRect().height);
  expect(alto).toBeLessThan(140);
});

/* La curva va del color del CAMBIO, no del de la serie entera: un vuelo que
   lleva semanas bajando y hoy sube salía con la curva verde al lado de un
   «+9 €» naranja, la misma fila diciendo dos cosas. */
test("la curva y la diferencia dicen lo mismo", async ({ page }) => {
  await conBanda(page, fav({ antes: 50, ahora: 59, cuando: "2026-09-14", visto: false }));
  const fila = page.locator("#favAviso .cambio");
  await expect(fila).toHaveClass(/sube/);
  const colores = await fila.evaluate((f) => ({
    dif: getComputedStyle(f.querySelector(".cambio-dif")).color,
    curva: getComputedStyle(f.querySelector(".spark")).color,
  }));
  expect(colores.curva).toBe(colores.dif);
});

test("«Enterado» la cierra, y no vuelve al recargar", async ({ page }) => {
  await conBanda(page, fav(CAMBIO));
  await expect(page.locator("#favAviso")).toBeVisible();
  await page.locator("#favVisto").click();
  await expect(page.locator("#favAviso")).toBeHidden();

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  await expect(page.locator("#favAviso")).toBeHidden();
});

/* Y el listón: las tarifas bailan un euro solas varias veces al día, y una
   banda que sale por nada deja de mirarse. */
test("un euro no es noticia", async ({ page }) => {
  await conBanda(page, fav(null, { precio_visto: 99, avisado: 99 }));
  await page.route("**/data/watch.json*", (r) =>
    r.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        watches: [{
          slug: "w", label: "Tirana", owner: UID, activo: true,
          last_offers: [{
            provider: "wizzair", origin: "MAD", destination: "TIA",
            destination_name: "Tirana", depart_date: "2027-02-05",
            return_date: "2027-02-07", price: 98, price_per_person: 98,
            currency: "EUR", adults: 1, nights: 2, id: ID,
            found_at: "2026-09-15T09:00:00+00:00",
          }],
        }],
      }),
    })
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  await expect(page.locator("#favAviso")).toBeHidden();
});
