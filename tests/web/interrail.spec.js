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

  /* ---------------------------------------------------- sin bono y con bono */

  test("cada tramo lleva en pequeño lo que cuesta el billete suelto", async ({ page }) => {
    await abrir(page);
    const tramos = page.locator("#ruta-centro .ir-tramo");
    await expect(tramos).toHaveCount(4);
    for (let i = 0; i < 4; i += 1) {
      await expect(tramos.nth(i).locator(".ir-billete")).toContainText("billete suelto ≈");
    }
  });

  test("cada ruta da el precio del tren sin bono y con bono", async ({ page }) => {
    await abrir(page);
    const precio = page.locator("#ruta-italia .ir-precio");
    await expect(precio).toContainText("Sin bono");
    await expect(precio).toContainText("Con bono");
    await expect(precio.locator(".ir-veredicto")).not.toBeEmpty();
  });

  test("con bono cuenta el pase MÁS BARATO que cubre la ruta", async ({ page }) => {
    // Tienes pensado uno de 7 días, pero Europa central gasta 4: para ESTE
    // viaje comprarías el de 4, y es con el que tiene sentido comparar.
    await abrir(page);
    await page.selectOption("#irDias", "7");
    await page.waitForTimeout(100);
    await expect(page.locator("#ruta-centro .ir-precio")).toContainText("pase de 4 días");
    await expect(page.locator("#ruta-vuelta .ir-precio")).toContainText("pase de 7 días");
  });

  test("la edad cambia el precio con bono y no el de sin bono", async ({ page }) => {
    await abrir(page);
    const leer = async () => ({
      sin: await page.locator("#ruta-centro .ir-precio dl > div:nth-child(1) dd").textContent(),
      con: await page.locator("#ruta-centro .ir-precio dl > div:nth-child(2) dd").textContent(),
    });
    await page.selectOption("#irEdad", "adulto");
    await page.waitForTimeout(100);
    const adulto = await leer();
    await page.selectOption("#irEdad", "joven");
    await page.waitForTimeout(100);
    const joven = await leer();
    expect(joven.sin).toBe(adulto.sin);
    expect(parseInt(joven.con.replace(/\D+/g, " ").trim(), 10)).toBeLessThan(
      parseInt(adulto.con.replace(/\D+/g, " ").trim(), 10)
    );
  });

  test("solo marca un ganador cuando las horquillas no se pisan", async ({ page }) => {
    // Italia para un adulto: billetes 75–200 contra 323–343 con bono. Gana
    // sin bono y se marca. Los nórdicos se pisan: no se marca ninguno, porque
    // marcar uno sería afirmar lo que no se sabe.
    await abrir(page);
    await page.selectOption("#irEdad", "adulto");
    await page.waitForTimeout(100);
    const italia = page.locator("#ruta-italia .ir-precio");
    await expect(italia).toHaveAttribute("data-veredicto", "sin");
    await expect(italia.locator(".gana")).toHaveCount(1);
    await expect(italia.locator(".gana dt")).toHaveText("Sin bono");

    const norte = page.locator("#ruta-norte .ir-precio");
    await expect(norte).toHaveAttribute("data-veredicto", "depende");
    await expect(norte.locator(".gana")).toHaveCount(0);
    await expect(norte.locator(".ir-veredicto")).toContainText("Depende");
  });

  test("el apunte de que los precios son orientativos está, y dice por qué", async ({ page }) => {
    await abrir(page);
    const apunte = page.locator("#interrail .ir-apunte");
    await expect(apunte).toContainText("orientativos");
    await expect(apunte).toContainText("tren a tren");
  });

  /* ------------------------------------------------------- entre dos fechas */

  test("con fecha de vuelta, solo las rutas que caben entre medias", async ({ page }) => {
    // Del 6 al 15 de noviembre son 9 noches: Europa central (11) e Italia (11)
    // no caben; los nórdicos (9) justo.
    await abrir(page);
    await page.selectOption("#irDias", "5");
    await page.fill("#irIda", "2026-11-06");
    await page.dispatchEvent("#irIda", "change");
    await page.fill("#irVuelta", "2026-11-15");
    await page.dispatchEvent("#irVuelta", "change");
    await page.waitForTimeout(100);
    await expect(page.locator("#ruta-centro")).toHaveCount(0);
    await expect(page.locator("#ruta-italia")).toHaveCount(0);
    await expect(page.locator("#ruta-norte")).toHaveCount(1);
    await expect(page.locator("#irHint")).toContainText("9 noches");
  });

  test("y dice cuántas noches te quedan libres", async ({ page }) => {
    // 10 noches de hueco y Suiza dura 8: sobran 2.
    await abrir(page);
    await page.fill("#irIda", "2026-11-06");
    await page.dispatchEvent("#irIda", "change");
    await page.fill("#irVuelta", "2026-11-16");
    await page.dispatchEvent("#irVuelta", "change");
    await page.waitForTimeout(100);
    await expect(page.locator("#ruta-suiza .ir-cifras")).toContainText("y 2 libres");
  });

  test("una vuelta anterior a la ida no deja la página en blanco sin decir nada", async ({
    page,
  }) => {
    await abrir(page);
    await page.fill("#irIda", "2026-11-16");
    await page.dispatchEvent("#irIda", "change");
    await page.fill("#irVuelta", "2026-11-06");
    await page.dispatchEvent("#irVuelta", "change");
    await page.waitForTimeout(100);
    await expect(page.locator("#irHint")).toContainText("antes que la ida");
  });

  test("sin fecha de vuelta no se filtra por noches", async ({ page }) => {
    await abrir(page);
    await page.selectOption("#irDias", "7");
    await page.fill("#irVuelta", "");
    await page.dispatchEvent("#irVuelta", "change");
    await page.waitForTimeout(100);
    await expect(page.locator("#irRutas .ir-ruta")).toHaveCount(12);
  });
});
