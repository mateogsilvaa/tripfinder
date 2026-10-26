/* Ofrecer instalarla como app: en el móvil a la pantalla de inicio, en el
   ordenador como ventana propia. Sin dar la lata: nunca en la primera visita,
   y «Ahora no» calla un mes. */
const { test, expect } = require("@playwright/test");

/* Lo que haría Chrome cuando la web se puede instalar. */
const avisar = (page) =>
  page.evaluate(() => {
    window.__pedido = 0;
    const e = new Event("beforeinstallprompt");
    e.prompt = () => {
      window.__pedido++;
    };
    e.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(e);
  });

test("la primera visita no se ofrece nada, pero el pie ya lo deja hacer", async ({ page }) => {
  await page.goto("/index.html");
  await avisar(page);
  await page.waitForTimeout(4500);
  await expect(page.locator("#tfInstalar")).toHaveCount(0);
  await expect(page.locator("#tfInstalarPie")).toBeVisible();
});

test("desde la segunda, se ofrece abajo y «Instalar» abre el del navegador", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("tf_visitas", "1"));
  await page.goto("/index.html");
  await avisar(page);
  await expect(page.locator("#tfInstalar")).toBeVisible({ timeout: 8000 });
  await expect(page.locator("#tfInstalar")).toContainText("TripFinder");
  await page.locator("[data-instalar-si]").click();
  expect(await page.evaluate(() => window.__pedido)).toBe(1);
  await expect(page.locator("#tfInstalar")).toHaveCount(0);
});

test("«Ahora no» calla un mes", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("tf_visitas", "3"));
  await page.goto("/index.html");
  await avisar(page);
  await page.locator("[data-instalar-no]").click({ timeout: 8000 });
  await page.reload();
  await avisar(page);
  await page.waitForTimeout(4500);
  await expect(page.locator("#tfInstalar")).toHaveCount(0);
});
