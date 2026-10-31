/* Más vuelos en el tablón: lo que no cabe en `offers.json` llega después, el
   tablón se puede mirar desde otras ciudades de salida, y los viajes con
   escala propia enseñan sus cuatro billetes.

   Todo con datos de mentira servidos por la prueba: `data/tablon/` no existe
   en los datos de ejemplo, y sin él la portada tiene que seguir como siempre. */
const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");

const BASE = JSON.parse(fs.readFileSync(path.join(__dirname, "datos", "offers.json"), "utf8"));

const viaje = (id, dest, nombre, extra = {}) => ({
  ...BASE.offers[1],
  id,
  destination: dest,
  destination_name: nombre,
  destination_country: "Albania",
  score: 40,
  ...extra,
});

const ESCALA = viaje("escala-MAD-TIA-20270108", "TIA", "Tirana", {
  provider: "escala",
  price: 88,
  stops: 1,
  via: "BGY",
  via_name: "Bérgamo",
  escala_ida: 230,
  escala_vuelta: 200,
  tramos: [
    { origin: "MAD", destination: "BGY", date: "2027-01-08", time: "07:00", arrive: "09:10", price: 20, airline: "Ryanair", deep_link: "https://www.ryanair.com/a" },
    { origin: "BGY", destination: "TIA", date: "2027-01-08", time: "13:00", arrive: "14:40", price: 25, airline: "Ryanair", deep_link: "https://www.ryanair.com/b" },
    { origin: "TIA", destination: "BGY", date: "2027-01-10", time: "11:00", arrive: "12:40", price: 18, airline: "Ryanair", deep_link: "https://www.ryanair.com/c" },
    { origin: "BGY", destination: "MAD", date: "2027-01-10", time: "16:00", arrive: "18:10", price: 25, airline: "Ryanair", deep_link: "https://www.ryanair.com/d" },
  ],
});

const MAD = { origin: "MAD", origin_name: "Madrid", offers: [...BASE.offers, ESCALA] };
const BCN = {
  origin: "BCN",
  origin_name: "Barcelona",
  offers: [viaje("ryanair-BCN-OPO-20270108", "OPO", "Oporto", { origin: "BCN", destination_country: "Portugal" })],
};
const INDICE = {
  origenes: [
    { iata: "MAD", nombre: "Madrid", count: 4, destinos: 4 },
    { iata: "BCN", nombre: "Barcelona", count: 1, destinos: 1 },
  ],
};

const servir = async (page) => {
  const json = (cuerpo) => (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(cuerpo) });
  await page.route("**/data/tablon/index.json*", json(INDICE));
  await page.route("**/data/tablon/MAD.json*", json(MAD));
  await page.route("**/data/tablon/BCN.json*", json(BCN));
};

const ciudades = (page) => page.locator("#hero .ticket .dest, .brow .city").allTextContents();

test("sin tablón entero, la portada sigue como siempre", async ({ page }) => {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".brow").first()).toBeVisible();
  await expect(page.locator("#desdeCampo")).toBeHidden();
});

test("lo que no cabía en la portada llega después, sin recargar", async ({ page }) => {
  await servir(page);
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".brow .city", { hasText: "Tirana" })).toBeVisible();
  await expect(page.locator("#feedCuenta")).toContainText("de 4 ofertas");
});

test("se puede mirar desde otra ciudad, y se recuerda", async ({ page }) => {
  await servir(page);
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#desdeCampo")).toBeAttached();
  await expect(page.locator("#desde option")).toHaveCount(2);
  await page.selectOption("#desde", "BCN");
  await expect.poll(async () => (await ciudades(page)).join(" ")).toContain("Oporto");
  await expect(page.locator(".brow .city", { hasText: "Tirana" })).toHaveCount(0);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect.poll(async () => (await ciudades(page)).join(" ")).toContain("Oporto");
  await expect(page.locator("#desde")).toHaveValue("BCN");
});

test("la escala propia avisa y enseña sus cuatro billetes", async ({ page }) => {
  await servir(page);
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  const fila = page.locator(".brow", { hasText: "Tirana" });
  await expect(fila).toBeVisible();
  await expect(fila).toContainText("escala propia en Bérgamo");
  await fila.locator(".city").click();
  const detalle = fila.locator(".brow-detail");
  await expect(detalle.locator(".escala-warn")).toContainText("Escala por tu cuenta en Bérgamo");
  await expect(detalle.locator(".esc-tramo")).toHaveCount(4);
  await expect(detalle.locator(".esc-pausa").first()).toContainText("3 h 50");
  await expect(detalle.locator(".esc-link").nth(1)).toHaveAttribute("href", "https://www.ryanair.com/b");
});
