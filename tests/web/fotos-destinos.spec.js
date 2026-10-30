/* La ilustración de cada destino (`web/js/fotos.js`): un dibujo de día y otro
   de noche por ciudad, de `web/ilustraciones/`, que va con el tema. */
const { test, expect } = require("@playwright/test");

const conFotos = (page) =>
  page.addInitScript(() => {
    window.TF_FOTOS = true;
  });

test("el chollo del día lleva su ilustración, de noche en oscuro y de día en claro", async ({ page }) => {
  await conFotos(page);
  await page.goto("/index.html");
  const foto = page.locator(".hero .ticket-foto");
  await expect(foto).toHaveClass(/con-foto/, { timeout: 15000 });
  // MAN es Mánchester: por aeropuerto, a su carpeta.
  await expect(foto).toHaveCSS("background-image", /ilustraciones\/uk\/manchester\/noche\.webp/);
  await page.evaluate(() => (document.documentElement.dataset.tema = "claro"));
  await expect(foto).toHaveCSS("background-image", /ilustraciones\/uk\/manchester\/dia\.webp/);
});

test("un destino sin ilustración se queda sin hueco", async ({ page }) => {
  await conFotos(page);
  await page.route("**/data/offers.json*", async (route) => {
    const r = await route.fetch();
    const d = await r.json();
    d.offers[0] = { ...d.offers[0], destination: "ZZZ", destination_name: "Ningunsitio" };
    await route.fulfill({ json: d });
  });
  await page.goto("/index.html");
  const foto = page.locator(".hero .ticket-foto");
  await expect(foto).toHaveClass(/sin-foto/, { timeout: 15000 });
  expect(await foto.evaluate((n) => n.getBoundingClientRect().height)).toBe(0);
});

test("ya no se le pide nada a Wikipedia", async ({ page }) => {
  let llamadas = 0;
  await page.route("https://*.wikipedia.org/**", (r) => {
    llamadas += 1;
    return r.abort();
  });
  await conFotos(page);
  await page.goto("/index.html");
  await expect(page.locator(".hero .ticket-foto")).toHaveClass(/con-foto/, { timeout: 15000 });
  expect(llamadas).toBe(0);
});

test("en las pruebas, sin pedirlas, no hay ilustraciones", async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.locator(".hero .ticket")).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(500);
  await expect(page.locator(".hero .ticket-foto")).not.toHaveClass(/con-foto/);
});
