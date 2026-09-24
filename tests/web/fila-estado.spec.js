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

  test("y enseña que se abre antes de pulsarla", async ({ page }) => {
    // El chevrón: la fila tenía cursor de mano y se iluminaba al pasar por
    // encima, pero nada decía que dentro hay cinco botones y los dos tramos.
    // Gira al abrirse, así que también dice en qué estado está sin oírla.
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);
    const fila = page.locator(".brow[data-open]").first();
    const giro = () =>
      fila.evaluate((el) => getComputedStyle(el, "::after").transform);

    const cerrada = await giro();
    expect(cerrada).not.toBe("none");
    await fila.click();
    await expect(fila).toHaveAttribute("aria-expanded", "true");
    expect(await giro()).not.toBe(cerrada);
  });

  test("la flecha se queda en su renglón con el detalle abierto", async ({ page }) => {
    // `.brow-detail` vive DENTRO de la fila: con `top: 50%` la flecha se habría
    // ido a la mitad del panel desplegado, a pasear por el medio de la nada.
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);
    const fila = page.locator(".brow[data-open]").first();
    await fila.click();
    await expect(fila.locator(".brow-detail")).toBeVisible();
    const arriba = await fila.evaluate(
      (el) => parseFloat(getComputedStyle(el, "::after").top)
    );
    const alto = await fila.evaluate((el) => el.getBoundingClientRect().height);
    expect(alto).toBeGreaterThan(120); // está desplegada de verdad
    expect(arriba).toBeLessThan(44); // y la flecha sigue en el primer renglón
  });

  test("las filas que NO se abren no llevan flecha", async ({ page }) => {
    // El panel de cuentas reusa `.brow` para sus filas: una flecha ahí sería
    // una mentira, así que va atada a `[data-open]`.
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);
    const sin = await page.evaluate(() => {
      const d = document.createElement("div");
      d.className = "brow";
      document.querySelector(".rows").appendChild(d);
      const t = getComputedStyle(d, "::after").content;
      d.remove();
      return t;
    });
    expect(sin).toBe("none");
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
