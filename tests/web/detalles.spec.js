/* Los detalles pequeños del rediseño: cada uno hace una cosa, y se prueba que
   la haga. */
const { test, expect } = require("@playwright/test");

test("«/» lleva al buscador del feed, y no salta mientras escribes", async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.locator("#q")).toBeVisible();
  await expect(page.locator(".field .tecla")).toHaveText("/");
  await page.locator("body").press("/");
  await expect(page.locator("#q")).toBeFocused();
  // Escribiendo en un campo, la barra es una barra.
  await page.locator("#q").fill("a/b");
  await expect(page.locator("#q")).toHaveValue("a/b");
});

test("el antetítulo dice de cuándo son los datos", async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.locator("#antetitulo")).toContainText(/actualizado hace/);
});

test("la pestaña de «Mis avisos» lleva cuántos viajes sigues, y sin ninguno no lleva nada", async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.locator('.zona[data-zona="follows"] .insignia')).toHaveCount(0);
  await page.evaluate(() => {
    localStorage.setItem("tf_favoritos", JSON.stringify({ a: {}, b: {} }));
  });
  await page.reload();
  await expect(page.locator('.zona[data-zona="follows"] .insignia')).toHaveText("2");
});

test("en el móvil se navega con la barra de abajo, y marca dónde estás", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/buscar.html");
  const barra = page.locator(".tabbar");
  await expect(barra).toBeVisible();
  await expect(page.locator(".topbar .zonas")).toBeHidden();
  await expect(barra.locator(".tab.activa")).toHaveText("Buscar");
  const caja = await barra.boundingBox();
  expect(caja.y + caja.height).toBeGreaterThan(830);
});

test("los planes: gratis y premium, y «Me interesa» sin cuenta pide entrar", async ({ page }) => {
  await page.goto("/planes.html");
  await expect(page.locator(".plan")).toHaveCount(2);
  await expect(page.locator("#planPremium")).toContainText("Premium");
  await expect(page.locator("#planesEstreno")).toBeVisible();
  await page.locator("#planQuiero").click();
  await expect(page.locator("#tfModal")).toBeVisible();
});
