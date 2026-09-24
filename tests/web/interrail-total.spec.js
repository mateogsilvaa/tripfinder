/* Interrail: el total de verdad y la ruta a tu medida.

   Se pidió que el coste sume el bono, los vuelos y el alojamiento, y que la
   ruta se pueda personalizar. Los ficheros de vuelo y de cama son falsos y se
   sirven con `page.route`: lo que se prueba es lo que la página hace con ellos.

   Europa central saliendo el 6 de noviembre, dos personas, desde Madrid:
   Ámsterdam 2 · Berlín 3 · Praga 2 · Viena 2 · Budapest 2 = 11 noches. */
const { test, expect } = require("@playwright/test");

const IDA = "2026-11-06";
const PARADAS = [
  ["AMS", "2026-11-06", 2],
  ["BER", "2026-11-08", 3],
  ["PRG", "2026-11-11", 2],
  ["VIE", "2026-11-13", 2],
  ["BUD", "2026-11-15", 2],
];
const idCama = (cod, dia, noches, n = 2) => `ir-centro-${cod}-${dia}-${noches}n-${n}`;

// Vuelos: ida a Eindhoven 41 €, vuelta desde Budapest 35 €.
const VUELOS = {
  "ir-vuelo-MAD-AMS-2026-11-06-ida": [{ price: 41, airline: "Ryanair", time: "07:10", origin: "MAD", destination: "EIN", deep_link: "https://www.ryanair.com/x" }],
  "ir-vuelo-MAD-BUD-2026-11-17-vuelta": [{ price: 35, airline: "Ryanair", time: "18:40", origin: "BUD", destination: "MAD", deep_link: "" }],
};

const cama = (cod) => ({
  stays: [{ provider: "holidu", note: "vía Expedia", kind: "stay", name: `Piso ${cod}`, url: `https://x.test/${cod}`, price_total: 200, area: "Apartamento" }],
});

const servir = async (page, { vuelos = VUELOS, camas = PARADAS } = {}) => {
  const idsCama = camas.map(([c, d, n]) => idCama(c, d, n));
  await page.route("**/data/stays/index.json*", (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ viajes: Object.fromEntries(idsCama.map((i) => [i, {}])) }) })
  );
  await page.route("**/data/interrail/index.json*", (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ vuelos: Object.keys(vuelos) }) })
  );
  await page.route("**/data/stays/ir-*.json*", (r) => {
    const nombre = r.request().url().split("/").pop().split(".json")[0];
    const par = camas.find(([c, d, n]) => idCama(c, d, n) === nombre);
    return par
      ? r.fulfill({ contentType: "application/json", body: JSON.stringify(cama(par[0])) })
      : r.fulfill({ status: 404, body: "" });
  });
  await page.route("**/data/interrail/ir-vuelo-*.json*", (r) => {
    const nombre = r.request().url().split("/").pop().split(".json")[0];
    return vuelos[nombre]
      ? r.fulfill({ contentType: "application/json", body: JSON.stringify({ id: nombre, legs: vuelos[nombre] }) })
      : r.fulfill({ status: 404, body: "" });
  });
};

const abrir = async (page) => {
  await page.goto("/trenes.html", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(400);
  await page.selectOption("#irEdad", "adulto");
  await page.fill("#irIda", IDA);
  await page.dispatchEvent("#irIda", "change");
  await page.waitForTimeout(400);
};

test.describe("el total del viaje", () => {
  test.use({ timezoneId: "Europe/Madrid" });

  test("suma el bono o los billetes, los vuelos y el alojamiento", async ({ page }) => {
    // Por persona: vuelos 41 + 35 = 76; cama 5 × 200 / 2 = 500. Tren sin bono
    // 105–270; con bono, el pase de 4 días, 283 (sin reservas en esta ruta).
    await servir(page);
    await abrir(page);
    const precio = page.locator("#ruta-centro .ir-precio");
    await expect(precio.locator(".ir-precio-titulo")).toHaveText("El viaje, por persona");
    await expect(precio.locator("dl > div:nth-child(1) dd")).toHaveText("≈ 681–846 €");
    await expect(precio.locator("dl > div:nth-child(2) dd")).toHaveText("≈ 859 €");
    await expect(precio.locator(".ir-desglose")).toContainText("vuelos 76 € (ida 41 € + vuelta 35 €)");
    await expect(precio.locator(".ir-desglose")).toContainText("alojamiento 500 € por persona");
    await expect(precio).toHaveAttribute("data-completo", "si");
  });

  test("y lo da para el grupo entero", async ({ page }) => {
    await servir(page);
    await abrir(page);
    await expect(page.locator("#ruta-centro .ir-grupo")).toContainText("Para 2: ≈ 1362–1692 € sin bono");
    await expect(page.locator("#ruta-centro .ir-grupo")).toContainText("≈ 1718 € con bono");
  });

  test("cada vuelo dice su precio, compañía y aeropuerto", async ({ page }) => {
    await servir(page);
    await abrir(page);
    const ida = page.locator("#ruta-centro .ir-vuelo").first();
    await expect(ida.locator(".ir-vuelo-precio")).toContainText("41 € por persona");
    await expect(ida.locator(".ir-vuelo-precio")).toContainText("MAD → EIN");
    await expect(ida.locator('.ir-vuelo-precio a[href="https://www.ryanair.com/x"]')).toHaveCount(1);
  });

  test("un vuelo que no existe ese día no se suma, y se dice", async ({ page }) => {
    await servir(page, { vuelos: { ...VUELOS, "ir-vuelo-MAD-BUD-2026-11-17-vuelta": [] } });
    await abrir(page);
    const ruta = page.locator("#ruta-centro");
    await expect(ruta.locator(".ir-vuelo").last().locator(".ir-vuelo-precio.sin")).toContainText("no vuela ese día");
    await expect(ruta.locator(".ir-desglose")).toContainText("vuelos 41 €");
    await expect(ruta.locator(".ir-desglose")).toContainText("sin precio");
    await expect(ruta.locator(".ir-precio")).toHaveAttribute("data-completo", "no");
  });

  test("el bono no cambia vuelos ni cama: el veredicto sigue siendo del tren", async ({ page }) => {
    await servir(page);
    await abrir(page);
    await expect(page.locator("#ruta-centro .ir-precio")).toHaveAttribute("data-veredicto", "sin");
  });
});

test.describe("la ruta a tu medida", () => {
  test.use({ timezoneId: "Europe/Madrid" });

  const abrirPanel = async (page) => {
    await page.locator("#ruta-centro .ir-ajustar > summary").click();
    await expect(page.locator("#ruta-centro .ir-ajustar-cuerpo")).toBeVisible();
  };
  const accion = (page, tipo, cod) =>
    page.locator(`#ruta-centro [data-ir-accion="${tipo}"]${cod ? `[data-cod="${cod}"]` : ""}`).click();

  test("al revés: se entra por la última y se sale por la primera", async ({ page }) => {
    await servir(page, { vuelos: {}, camas: [] });
    await abrir(page);
    await abrirPanel(page);
    await accion(page, "rev");
    const ruta = page.locator("#ruta-centro");
    await expect(ruta.locator(".ir-parada b").first()).toHaveText("Budapest");
    await expect(ruta.locator(".ir-vuelo").first()).toContainText("Madrid → Budapest");
    await expect(ruta.locator(".ir-vuelo").last()).toContainText("Ámsterdam → Madrid");
    await expect(ruta).toHaveClass(/ajustada/);
    // El panel se queda abierto: se repinta todo, pero no se le cierra a
    // quien lo está usando.
    await expect(ruta.locator(".ir-ajustar-cuerpo")).toBeVisible();
  });

  test("una noche más en una parada mueve las fechas y la vuelta", async ({ page }) => {
    await servir(page, { vuelos: {}, camas: [] });
    await abrir(page);
    await abrirPanel(page);
    await accion(page, "mas", "BER");
    const ruta = page.locator("#ruta-centro");
    await expect(ruta.locator(".ir-cifras")).toContainText("12");
    await expect(ruta.locator(".ir-parada").nth(1)).toContainText("4 noches");
    // Praga ya no es el 11 sino el 12, y la vuelta pasa del 17 al 18.
    await expect(ruta.locator(".ir-parada").nth(2)).toContainText("jue 12 nov");
    await expect(ruta.locator(".ir-vuelo").last()).toContainText("mié 18 nov");
  });

  test("saltarse una parada junta sus trenes y gasta un día de bono menos", async ({ page }) => {
    await servir(page, { vuelos: {}, camas: [] });
    await abrir(page);
    await abrirPanel(page);
    await accion(page, "quitar", "PRG");
    const ruta = page.locator("#ruta-centro");
    await expect(ruta.locator(".ir-parada")).toHaveCount(4);
    await expect(ruta.locator(".ir-cifras div:first-child dd")).toContainText("3");
    await expect(ruta.locator(".ir-tramo").nth(1)).toContainText("pasas por Praga sin parar");
    // Berlín–Praga 4 h 15 + Praga–Viena 4 h = 8 h 15 en el mismo día.
    await expect(ruta.locator(".ir-tramo").nth(1)).toContainText("8 h 15");
    // Y se puede volver a poner.
    await expect(ruta.locator('.ir-ajustar li.fuera')).toContainText("Praga");
    await accion(page, "poner", "PRG");
    await expect(ruta.locator(".ir-parada")).toHaveCount(5);
  });

  test("no deja una ruta de una sola parada", async ({ page }) => {
    await servir(page, { vuelos: {}, camas: [] });
    await abrir(page);
    await abrirPanel(page);
    for (const cod of ["BER", "PRG", "VIE"]) await accion(page, "quitar", cod);
    const ruta = page.locator("#ruta-centro");
    await expect(ruta.locator(".ir-parada")).toHaveCount(2);
    const quitar = ruta.locator('.ir-ajustar li:not(.fuera) [data-ir-accion="quitar"]');
    await expect(quitar.first()).toBeDisabled();
  });

  test("lo ajustado se queda al volver, y se puede deshacer", async ({ page }) => {
    await servir(page, { vuelos: {}, camas: [] });
    await abrir(page);
    await abrirPanel(page);
    await accion(page, "rev");
    await abrir(page);
    const ruta = page.locator("#ruta-centro");
    await expect(ruta.locator(".ir-parada b").first()).toHaveText("Budapest");
    await abrirPanel(page);
    await accion(page, "reset");
    await expect(ruta.locator(".ir-parada b").first()).toHaveText("Ámsterdam");
    await expect(ruta).not.toHaveClass(/ajustada/);
  });

  test("cambiar las noches es otra cama: el alojamiento de antes no se usa", async ({ page }) => {
    // El fichero es para Berlín 3 noches; con 4, no vale y no se suma.
    await servir(page, { vuelos: {} });
    await abrir(page);
    const ruta = page.locator("#ruta-centro");
    await expect(ruta.locator(".ir-cama-sel")).toHaveCount(5);
    await abrirPanel(page);
    await accion(page, "mas", "BER");
    await expect(ruta.locator(".ir-cama-sel")).toHaveCount(1); // solo Ámsterdam sigue igual
    await expect(ruta.locator(".ir-desglose")).toContainText("faltan 4 paradas");
  });

  test("si solo se ha movido la vuelta, dice que falta la vuelta y no «los vuelos»", async ({ page }) => {
    // Una noche más en Berlín: la ida sigue siendo el 6, la vuelta pasa al 18.
    await servir(page);
    await abrir(page);
    await page.locator("#ruta-centro .ir-ajustar > summary").click();
    await accion(page, "mas", "BER");
    const desglose = page.locator("#ruta-centro .ir-desglose");
    await expect(desglose).toContainText("falta el vuelo de vuelta");
    await expect(desglose).toContainText("vuelos 41 € (ida 41 €)");
  });

  test("el aeropuerto de salida cambia los vuelos", async ({ page }) => {
    await servir(page, { vuelos: {}, camas: [] });
    await abrir(page);
    await page.selectOption("#irOrigen", "BCN");
    await page.waitForTimeout(200);
    const ruta = page.locator("#ruta-centro");
    await expect(ruta.locator(".ir-vuelo").first()).toContainText("Barcelona → Ámsterdam");
    const href = await ruta.locator(".ir-vuelo a").first().getAttribute("href");
    expect(href).toContain("from=BCN");
  });

  test("hay doce rutas para elegir", async ({ page }) => {
    await servir(page, { vuelos: {}, camas: [] });
    await abrir(page);
    await page.selectOption("#irDias", "15");
    await page.waitForTimeout(200);
    await expect(page.locator("#irRutas .ir-ruta")).toHaveCount(12);
    for (const id of ["benelux", "alpes", "danubio", "riviera", "polonia", "hamburgo"]) {
      await expect(page.locator(`#ruta-${id}`)).toHaveCount(1);
    }
  });
});
