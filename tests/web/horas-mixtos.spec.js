/* Filtrar el tablón por la hora de salida, los viajes con ida y vuelta en
   compañías distintas, y la lente de la barra cuando el gesto se corta. */
const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");

const BASE = JSON.parse(fs.readFileSync(path.join(__dirname, "datos", "offers.json"), "utf8"));

const MIXTO = {
  ...BASE.offers[1],
  id: "mixto-MAD-BUD-20270108",
  provider: "mixto",
  destination: "BUD",
  destination_name: "Budapest",
  destination_country: "Hungría",
  depart_time: "07:15",
  airline: "Ryanair",
  airline_back: "Wizz Air",
  deep_link: "https://www.ryanair.com/ida",
  deep_link_back: "https://www.wizzair.com/vuelta",
  price: 45,
  score: 70,
};

const servir = (page, offers) =>
  page.route("**/data/offers.json*", (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ ...BASE, offers }) })
  );

const ciudades = (page) => page.locator("#hero .ticket .dest, .brow .city").allTextContents();

test("el filtro de salida deja solo lo que sale en esa franja", async ({ page }) => {
  await servir(page, [...BASE.offers, MIXTO]);
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".brow").first()).toBeVisible();
  await page.selectOption("#hora", "6-12");
  await expect.poll(async () => (await ciudades(page)).join("|")).toContain("Budapest");
  const quedan = await ciudades(page);
  // Las de ejemplo salen por la tarde (o sin hora): con «mañana» solo queda la de las 07:15.
  expect(quedan.filter((c) => /Bergamo|Manchester|Lanzarote/.test(c))).toEqual([]);
  await page.selectOption("#hora", "");
  await expect.poll(async () => (await ciudades(page)).length).toBeGreaterThan(2);
});

test("ida con una compañía y vuelta con otra: lo dice y da los dos enlaces", async ({ page }) => {
  await servir(page, [...BASE.offers, MIXTO]);
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  // El de ejemplo de Bérgamo puntúa más: Budapest va en el feed, no arriba.
  const fila = page.locator(".brow", { hasText: "Budapest" });
  await expect(fila).toContainText("Ryanair + Wizz Air");
  await fila.locator(".city").click();
  await expect(fila.locator(".det-acciones")).toContainText("Ida con Ryanair");
  await expect(fila.locator('a[href="https://www.wizzair.com/vuelta"]')).toContainText("Vuelta con Wizz Air");
});

test("si el gesto se corta a medias, la lente vuelve a su pestaña", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  const barra = page.locator(".tabbar");
  await expect(barra.locator(".tab-lente")).toBeAttached();
  const antes = await barra.locator(".tab-lente").evaluate((l) => l.style.transform);
  const caja = await barra.boundingBox();
  await barra.dispatchEvent("pointerdown", { pointerId: 7, clientX: caja.x + 40, button: 0, pointerType: "touch" });
  await barra.dispatchEvent("pointermove", { pointerId: 7, clientX: caja.x + 200, pointerType: "touch" });
  expect(await barra.locator(".tab-lente").evaluate((l) => l.style.transform)).not.toBe(antes);
  await barra.dispatchEvent("pointercancel", { pointerId: 7, clientX: caja.x + 200, pointerType: "touch" });
  await expect.poll(() => barra.locator(".tab-lente").evaluate((l) => l.style.transform)).toBe(antes);
  await expect(page.locator("html")).not.toHaveClass(/tf-arrastrando/);
});
