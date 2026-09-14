/* Volver a la cama que ya buscaste.

   Buscar alojamiento cuesta tres minutos de workflow y el resultado se guarda
   para siempre. Lo que no había era forma de VOLVER: el único botón que abría
   la hoja vivía en el tablón de chollos, y el tablón se renueva dos veces al
   día. Al día siguiente el vuelo ya no estaba, el botón tampoco, y lo buscado
   quedaba ahí sin que nadie pudiera verlo. */
const { test, expect } = require("@playwright/test");

const UID = "u-mateo";
const SESION = { uid: UID, user: "mateo", name: "Mateo" };
// Un vuelo que YA NO ESTÁ en la tanda de hoy: ese es justo el caso.
const ID = "ryanair-MAD-ACE-20270115";

const FAV = {
  [ID]: {
    id: ID, destination: "ACE", destination_name: "Lanzarote",
    destination_country: "España", origin: "MAD", depart_date: "2027-01-15",
    return_date: "2027-01-17", airline: "Ryanair", adults: 1, nights: 2,
    precio_inicial: 72, precio_visto: 72, visto_en: "2026-09-13",
    historia: [{ d: "2026-09-13", p: 72 }], cambio: null, desde: 1,
  },
};

const CAMA = {
  offer_id: ID,
  offer: {
    provider: "ryanair", origin: "MAD", destination: "ACE",
    destination_name: "Lanzarote", destination_country: "España",
    depart_date: "2027-01-15", return_date: "2027-01-17", airline: "Ryanair",
    price: 72.46, currency: "EUR", adults: 1, nights: 2, id: ID,
    deep_link: "https://example.com",
  },
  checkin: "2027-01-15", checkout: "2027-01-17", generated_at: "2026-09-12",
  summary: { party: 2, flights: 144.92, stay: 57, total: 201.92, per_person: 100.96 },
  errors: [],
  stays: [
    { name: "Casa del Puerto", provider: "airbnb", price_total: 57,
      price_per_night: 28.5, url: "https://example.com/1", km_centro: 0.9 },
  ],
};

const conFav = (page) =>
  page.addInitScript(([s, uid, f]) => {
    try {
      localStorage.setItem("tf_sesion", JSON.stringify(s));
      localStorage.setItem(`tf_favoritos:${uid}`, JSON.stringify(f));
    } catch (e) { /* nada */ }
  }, [SESION, UID, FAV]);

test("desde un viaje apuntado se vuelve a lo ya buscado", async ({ page }) => {
  await conFav(page);
  await page.route(`**/data/stays/${ID}.json*`, (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify(CAMA) })
  );
  await page.goto("/seguimientos.html", { waitUntil: "domcontentloaded" });

  const boton = page.locator(`#favoritos [data-cama="${ID}"]`);
  await expect(boton).toBeVisible();
  await boton.click();

  await expect(page.locator("#panel")).toBeVisible();
  await expect(page.locator("#panelTitle")).toHaveText("Lanzarote");
  // Y sale lo GUARDADO, no el formulario de volver a buscar.
  await expect(page.locator("#panelBody")).toContainText("Casa del Puerto");
  await expect(page.locator("#panelBody")).not.toContainText("¿Cuántos viajáis?");
});

/* El vuelo ya no está en ninguna lista y el fichero sí: con el id basta, porque
   el propio fichero lleva dentro el vuelo entero. */
test("con el fichero basta, aunque el vuelo ya no esté en ninguna lista", async ({ page }) => {
  await page.addInitScript((s) => {
    try {
      localStorage.setItem("tf_sesion", JSON.stringify(s));
    } catch (e) { /* nada */ }
  }, SESION);
  await page.route(`**/data/stays/${ID}.json*`, (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify(CAMA) })
  );
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.evaluate(async (id) => {
    const m = await import("/js/alojamiento.js");
    await m.openStays(id);
  }, ID);
  await expect(page.locator("#panelTitle")).toHaveText("Lanzarote");
  await expect(page.locator("#panelBody")).toContainText("Casa del Puerto");
});

/* Y cuando no hay ni vuelo ni fichero, se dice. Antes era `return` a secas: la
   hoja no se abría y el botón parecía roto. */
test("sin vuelo y sin fichero, lo dice en vez de no hacer nada", async ({ page }) => {
  await page.addInitScript((s) => {
    try {
      localStorage.setItem("tf_sesion", JSON.stringify(s));
    } catch (e) { /* nada */ }
  }, SESION);
  await page.route("**/data/stays/*.json*", (r) => r.fulfill({ status: 404, body: "no" }));
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    const m = await import("/js/alojamiento.js");
    await m.openStays("vuelo-que-ya-no-existe");
  });
  await expect(page.locator("#panel")).toBeVisible();
  await expect(page.locator("#panelBody")).toContainText("ya no está en la tanda de hoy");
});

/* Lo abierto se apunta, para poder ofrecerlo luego sin volver a adivinar. */
test("lo abierto queda apuntado en esta cuenta", async ({ page }) => {
  await conFav(page);
  await page.route(`**/data/stays/${ID}.json*`, (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify(CAMA) })
  );
  await page.goto("/seguimientos.html", { waitUntil: "domcontentloaded" });
  await page.locator(`#favoritos [data-cama="${ID}"]`).click();
  await expect(page.locator("#panelBody")).toContainText("Casa del Puerto");

  const apuntadas = await page.evaluate(
    (uid) => JSON.parse(localStorage.getItem(`tf_camas:${uid}`) || "[]"),
    UID
  );
  expect(apuntadas.map((c) => c.id)).toContain(ID);
  expect(apuntadas[0].ciudad).toBe("Lanzarote");
});
