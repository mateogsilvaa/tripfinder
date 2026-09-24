/* La fila del tablón dice si está abierta.

   Una fila del feed se anuncia como `role="button"` y al pulsarla se despliega
   con los tramos, el histórico y los cinco botones —ver vuelo, buscar
   alojamiento, comparar, calendario, compartir—. Pero no decía en qué estado
   estaba: quien la oye con un lector de pantalla recibía «botón» a secas, sin
   saber si pulsarlo abre algo o cierra lo que ya está abierto.

   `aria-expanded` es exactamente eso y no cambia ni un píxel del dibujo. */
const { test, expect } = require("@playwright/test");

test.describe("una fila del feed", () => {
  test("nace cerrada y lo dice", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);
    const fila = page.locator(".brow[data-open]").first();
    await expect(fila).toHaveAttribute("aria-expanded", "false");
    await expect(fila.locator(".brow-detail")).toBeHidden();
  });

  test("al abrirse lo dice, y al cerrarse vuelve a decirlo", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);
    const fila = page.locator(".brow[data-open]").first();

    await fila.click();
    await expect(fila).toHaveAttribute("aria-expanded", "true");
    await expect(fila.locator(".brow-detail")).toBeVisible();

    await fila.click();
    await expect(fila).toHaveAttribute("aria-expanded", "false");
    await expect(fila.locator(".brow-detail")).toBeHidden();
  });

  test("lo que dice y lo que enseña no se separan", async ({ page }) => {
    // Abrir una segunda fila no puede dejar a la primera diciendo que sigue
    // abierta, ni al revés: el atributo se mueve donde se abre y se cierra, no
    // en el que llama.
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);
    const filas = page.locator(".brow[data-open]");
    if ((await filas.count()) < 2) test.skip();
    await filas.nth(0).click();
    await filas.nth(1).click();
    for (const i of [0, 1]) {
      const fila = filas.nth(i);
      const dice = (await fila.getAttribute("aria-expanded")) === "true";
      const enseña = await fila.locator(".brow-detail").isVisible();
      expect(dice, `la fila ${i} dice ${dice} y enseña ${enseña}`).toBe(enseña);
    }
  });

  test("con el teclado también", async ({ page }) => {
    // La fila lleva `tabindex="0"`: se llega con Tab y se abre con Enter.
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);
    const fila = page.locator(".brow[data-open]").first();
    await fila.focus();
    await page.keyboard.press("Enter");
    await expect(fila).toHaveAttribute("aria-expanded", "true");
  });
});
