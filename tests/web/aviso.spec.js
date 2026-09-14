/* El aviso de cambio de precio, y que «Enterado» signifique enterado.

   Cada página sincroniza los favoritos con una fuente distinta: el feed con el
   barrido diario, «lo que sigues» con los resultados del seguimiento y una
   búsqueda guardada con los suyos. Son tres fotos del mismo vuelo hechas a
   horas distintas, así que sus precios no tienen por qué coincidir —y cuando no
   coinciden, cada cambio de página inventaba un cambio de precio nuevo. Le
   dabas a «Enterado» en el feed, ibas a lo que sigues y la banda estaba otra
   vez ahí, con los mismos euros dando tumbos de una foto a la otra. */
const { test, expect } = require("@playwright/test");

const UID = "u-mateo";
const SESION = { uid: UID, user: "mateo", name: "Mateo" };
const ID = "wizzair-MAD-TIA-20270205";

const favorito = (precio, avisado) => ({
  [ID]: {
    id: ID, city: "Tirana", origin: "MAD", destination: "TIA",
    destination_name: "Tirana", depart_date: "2027-02-05",
    return_date: "2027-02-07", airline: "Wizz Air", adults: 1,
    precio_inicial: 99, precio_visto: precio,
    ...(avisado === undefined ? {} : { avisado }),
    visto_en: "2026-09-13",
    historia: [{ d: "2026-09-12", p: 99 }, { d: "2026-09-13", p: precio }],
    cambio: { antes: 99, ahora: precio, cuando: "2026-09-13", visto: true },
    fuente_en: "2026-09-13T20:05:36+00:00",
  },
});

const oferta = (precio, cuando) => ({
  provider: "wizzair", origin: "MAD", destination: "TIA",
  destination_name: "Tirana", destination_country: "Albania",
  depart_date: "2027-02-05", return_date: "2027-02-07", airline: "Wizz Air",
  price: precio, price_per_person: precio, currency: "EUR", adults: 1,
  nights: 2, id: ID, deep_link: "https://example.com", weekend: true,
  useful_hours: 44, found_at: cuando,
});

/* Se siembra SOLO SI NO HAY NADA: `addInitScript` corre en cada navegación,
   también en el reload, y volver a plantar el fixture borraría justo lo que la
   prueba quiere comprobar que se ha guardado. */
const conFav = (page, favs) =>
  page.addInitScript(([s, uid, f]) => {
    try {
      localStorage.setItem("tf_sesion", JSON.stringify(s));
      if (!localStorage.getItem(`tf_favoritos:${uid}`)) {
        localStorage.setItem(`tf_favoritos:${uid}`, JSON.stringify(f));
      }
    } catch (e) { /* nada */ }
  }, [SESION, UID, favs]);

/* La foto vieja no puede reabrir un aviso que ya cerraste: el seguimiento corrió
   cinco minutos ANTES que el barrido, así que su precio es el de antes. */
test("una foto más vieja no reabre el aviso", async ({ page }) => {
  await conFav(page, favorito(98));
  await page.route("**/data/watch.json*", (r) =>
    r.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        watches: [{
          slug: "w1", label: "Tirana", owner: UID, activo: true,
          last_offers: [oferta(104, "2026-09-13T20:00:00+00:00")],
        }],
      }),
    })
  );
  await page.goto("/seguimientos.html", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  await expect(page.locator("#favAviso")).toBeHidden();
});

/* Y una foto nueva con el mismo precio que ya te dijimos, tampoco. */
test("el mismo precio ya avisado no vuelve a avisar", async ({ page }) => {
  await conFav(page, favorito(98, 104));
  await page.route("**/data/watch.json*", (r) =>
    r.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        watches: [{
          slug: "w1", label: "Tirana", owner: UID, activo: true,
          last_offers: [oferta(104, "2026-09-14T09:00:00+00:00")],
        }],
      }),
    })
  );
  await page.goto("/seguimientos.html", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  await expect(page.locator("#favAviso")).toBeHidden();
});

/* Lo que sí tiene que avisar: un precio nuevo de verdad, de una foto nueva. */
test("una bajada nueva sí avisa, y «Enterado» la cierra para siempre", async ({ page }) => {
  await conFav(page, favorito(98, 98));
  await page.route("**/data/watch.json*", (r) =>
    r.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        watches: [{
          slug: "w1", label: "Tirana", owner: UID, activo: true,
          last_offers: [oferta(79, "2026-09-14T09:00:00+00:00")],
        }],
      }),
    })
  );
  await page.goto("/seguimientos.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#favAviso")).toBeVisible();
  await expect(page.locator("#favAviso")).toContainText("Baja");

  await page.locator("#favVisto").click();
  await expect(page.locator("#favAviso")).toBeHidden();

  // Y al volver a entrar sigue cerrada: es lo que significa «enterado».
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  await expect(page.locator("#favAviso")).toBeHidden();
});

/* -------------------------------------------- cuánto tiene que moverse -----

   Antes bastaba con medio euro, y medio euro sobre 98 es medio por ciento: las
   tarifas bailan eso solas varias veces al día, así que la banda saltaba una y
   otra vez para decir «baja 1 €» con un titular enorme. Una banda que sale por
   nada deja de mirarse, y entonces tampoco sirve el día que de verdad baja 30. */

const conWatch = (page, precio, cuando = "2026-09-14T09:00:00+00:00") =>
  page.route("**/data/watch.json*", (r) =>
    r.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        watches: [{
          slug: "w1", label: "Tirana", owner: UID, activo: true,
          last_offers: [oferta(precio, cuando)],
        }],
      }),
    })
  );

test("un euro no es noticia", async ({ page }) => {
  await conFav(page, favorito(99, 99));
  await conWatch(page, 98);
  await page.goto("/seguimientos.html", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  await expect(page.locator("#favAviso")).toBeHidden();
});

/* Los dos listones, y por qué hacen falta los dos. */
test("tres euros sobre un vuelo caro tampoco: es un 0,7 %", async ({ page }) => {
  await conFav(page, { ...favorito(400, 400), precio_inicial: 400 });
  await conWatch(page, 396);
  await page.goto("/seguimientos.html", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  await expect(page.locator("#favAviso")).toBeHidden();
});

test("un 4 % sobre un vuelo de 20 € tampoco: son ochenta céntimos", async ({ page }) => {
  await conFav(page, { ...favorito(20, 20), precio_inicial: 20 });
  await conWatch(page, 19);
  await page.goto("/seguimientos.html", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  await expect(page.locator("#favAviso")).toBeHidden();
});

test("una bajada de verdad sí, y una sola vez", async ({ page }) => {
  await conFav(page, favorito(99, 99));
  await conWatch(page, 78); // −21 €, −21 %
  await page.goto("/seguimientos.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#favAviso")).toBeVisible();
  await expect(page.locator("#favAviso")).toContainText("Baja 21 €");

  await page.locator("#favVisto").click();
  await expect(page.locator("#favAviso")).toBeHidden();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  await expect(page.locator("#favAviso")).toBeHidden();
});
