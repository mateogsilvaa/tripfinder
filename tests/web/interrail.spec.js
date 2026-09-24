/* Con los días del bono, el viaje entero (#145).

   Le dices cuántos días de viaje tiene tu bono y cuándo sales, y te da rutas
   que caben: el vuelo de entrada, los trenes, las noches en cada parada y el
   vuelo de salida —desde OTRA ciudad, que es media gracia de un Interrail—, con
   su fecha calculada.

   La prueba más importante es la de los vuelos, porque es la que la primera
   versión tenía mal: los enlaces iban al buscador de la casa, que solo hace
   ida y vuelta desde España, y «Vuelo de Budapest a Madrid» abría una búsqueda
   Madrid → Budapest. Justo lo contrario de lo que decía el rótulo. */
const { test, expect } = require("@playwright/test");

const abrir = async (page) => {
  await page.goto("/trenes.html", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  await expect(page.locator("#irRutas .ir-ruta").first()).toBeVisible();
};

/* Lee el `from`, el `to` y el `dep` de un enlace de eDreams. */
const partes = (href) => {
  const m = /results\/(.+)$/.exec(href || "");
  const out = {};
  (m ? m[1] : "").split(";").forEach((kv) => {
    const [k, v] = kv.split("=");
    if (k) out[k] = v;
  });
  return out;
};

test.describe("el interrail", () => {
  // En hora de España: si el navegador corriese en UTC, la prueba del cambio
  // de hora pasaría sin probar nada, porque en UTC no hay cambio de hora.
  test.use({ timezoneId: "Europe/Madrid" });

  test("solo enseña las rutas que caben en el bono", async ({ page }) => {
    await abrir(page);
    await page.selectOption("#irDias", "4");
    await page.waitForTimeout(100);
    const con4 = await page.locator("#irRutas .ir-ruta").count();
    const dias4 = await page
      .locator("#irRutas .ir-cifras div:first-child dd")
      .allTextContents();
    dias4.forEach((d) => expect(parseInt(d, 10)).toBeLessThanOrEqual(4));

    await page.selectOption("#irDias", "7");
    await page.waitForTimeout(100);
    expect(await page.locator("#irRutas .ir-ruta").count()).toBeGreaterThan(con4);
  });

  test("dice cuántos días de bono te sobran", async ({ page }) => {
    // Un bono de 5 con una ruta de 4: el día que sobra es un día que se puede
    // gastar, y hay que decirlo.
    await abrir(page);
    await page.selectOption("#irDias", "5");
    await page.waitForTimeout(100);
    await expect(page.locator("#ruta-centro .ir-cifras")).toContainText("te sobra 1");
  });

  test("el vuelo de ida sale de Madrid y el de vuelta VUELVE a Madrid", async ({ page }) => {
    await abrir(page);
    await page.fill("#irIda", "2026-11-06");
    await page.dispatchEvent("#irIda", "change");
    await page.waitForTimeout(100);

    const ruta = page.locator("#ruta-centro");
    const enlaces = ruta.locator(".ir-vuelo a");
    await expect(enlaces).toHaveCount(2);

    const ida = partes(await enlaces.nth(0).getAttribute("href"));
    expect(ida.type).toBe("O"); // ida sola
    expect(ida.from).toBe("MAD");
    expect(ida.to).toBe("AMS");
    expect(ida.dep).toBe("2026-11-06");

    const vuelta = partes(await enlaces.nth(1).getAttribute("href"));
    expect(vuelta.type).toBe("O");
    expect(vuelta.from).toBe("BUD"); // desde la ÚLTIMA ciudad, no desde Madrid
    expect(vuelta.to).toBe("MAD");
  });

  test("la fecha de vuelta es la de salida más las noches de la ruta", async ({ page }) => {
    // Europa central son 2+3+2+2+2 = 11 noches: del 6 de noviembre al 17.
    await abrir(page);
    await page.fill("#irIda", "2026-11-06");
    await page.dispatchEvent("#irIda", "change");
    await page.waitForTimeout(100);
    const ruta = page.locator("#ruta-centro");
    await expect(ruta.locator(".ir-cifras")).toContainText("11");
    const vuelta = partes(await ruta.locator(".ir-vuelo a").nth(1).getAttribute("href"));
    expect(vuelta.dep).toBe("2026-11-17");
  });

  test("y cruza bien el cambio de hora y el de mes", async ({ page }) => {
    // Del 25 de octubre (la noche que se atrasa la hora) + 11 noches = 5 nov.
    // Con `toISOString` a secas esto restaba un día en España.
    await abrir(page);
    await page.fill("#irIda", "2026-10-25");
    await page.dispatchEvent("#irIda", "change");
    await page.waitForTimeout(100);
    const vuelta = partes(
      await page.locator("#ruta-centro .ir-vuelo a").nth(1).getAttribute("href")
    );
    expect(vuelta.dep).toBe("2026-11-05");
  });

  test("las reservas obligatorias se dicen y se suman", async ({ page }) => {
    // «Un plan que las ignore miente en el total.» Italia las lleva en todos
    // los tramos; Europa central en ninguno.
    await abrir(page);
    const italia = page.locator("#ruta-italia");
    await expect(italia.locator(".ir-reserva")).toHaveCount(4);
    await expect(italia.locator(".ir-cifras")).toContainText("€");

    const centro = page.locator("#ruta-centro");
    await expect(centro.locator(".ir-reserva")).toHaveCount(0);
    await expect(centro.locator(".ir-cifras")).toContainText("ninguna");
  });

  test("los enlaces de vuelo se abren fuera y sin pasar el referer", async ({ page }) => {
    await abrir(page);
    const a = page.locator("#ruta-centro .ir-vuelo a").first();
    await expect(a).toHaveAttribute("target", "_blank");
    await expect(a).toHaveAttribute("rel", /noopener/);
  });

  test("con fecha vacía no hay enlaces a medias", async ({ page }) => {
    // Sin fecha no se puede calcular la vuelta: antes que un enlace sin día,
    // ninguno.
    await abrir(page);
    await page.fill("#irIda", "");
    await page.dispatchEvent("#irIda", "change");
    await page.waitForTimeout(100);
    await expect(page.locator("#ruta-centro .ir-vuelo a")).toHaveCount(0);
    await expect(page.locator("#ruta-centro .ir-vuelo")).toHaveCount(2);
  });

  test("sale con una fecha puesta, para que se vea entero sin tocar nada", async ({ page }) => {
    await abrir(page);
    const valor = await page.locator("#irIda").inputValue();
    expect(valor).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await expect(page.locator("#ruta-centro .ir-vuelo a")).toHaveCount(2);
  });
});
