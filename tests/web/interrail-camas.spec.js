/* El alojamiento del Interrail: cada parada, su cama, y el total con ella.

   Lo que se pidió, dicho tal cual: que salgan las mejores opciones —baratas,
   cerca del centro y alojamiento ENTERO, nada de habitaciones—, y que si entras
   y cambias una, te cambie el precio.

   Los ficheros de aquí son falsos y se sirven con `page.route`: lo que se
   prueba es lo que la página hace con ellos, no el scraper. Cada uno lleva a
   propósito una HABITACIÓN la primera de la lista, con el precio más bajo, para
   comprobar que la última puerta —la del navegador— también la deja fuera. */
const { test, expect } = require("@playwright/test");

// Europa central saliendo el 6 de noviembre, dos personas.
const IDA = "2026-11-06";
const PARADAS = [
  ["AMS", "2026-11-06", 2],
  ["BER", "2026-11-08", 3],
  ["PRG", "2026-11-11", 2],
  ["VIE", "2026-11-13", 2],
  ["BUD", "2026-11-15", 2],
];
// Ruta, ciudad, llegada, noches y personas: cambiar una es otra cama.
const id = (cod, dia, noches, n = 2) => `ir-centro-${cod}-${dia}-${noches}n-${n}`;

const fichero = (cod, dia, noches) => ({
  offer_id: id(cod, dia, noches),
  generated_at: "2026-10-01",
  summary: {},
  stays: [
    // La trampa: la más barata y la primera, pero es una habitación.
    { provider: "airbnb", kind: "stay", name: `Cuarto en ${cod}`, url: `https://x.test/${cod}/cuarto`,
      price_total: 30, area: "Habitación privada en el centro", km_centro: 0.3 },
    { provider: "airbnb", kind: "stay", name: `Piso céntrico ${cod}`, url: `https://x.test/${cod}/a`,
      price_total: 200, area: "Apartamento en el centro", km_centro: 0.5, image: "" },
    { provider: "airbnb", kind: "stay", name: `Loft ${cod}`, url: `https://x.test/${cod}/b`,
      price_total: 260, area: "Loft en el centro", km_centro: 1.2 },
    { provider: "airbnb", kind: "hotel", name: `Hotel ${cod}`, url: `https://x.test/${cod}/h`,
      price_total: 150, area: "Habitación de hotel", km_centro: 0.4 },
    { provider: "deeplinks", kind: "link", name: "Booking.com", url: "https://booking.test", price_total: null },
  ],
});

/* Sirve los ficheros de las paradas que se le digan. */
const conCamas = async (page, cuales = PARADAS) => {
  const ids = new Set(cuales.map(([c, d, n]) => id(c, d, n)));
  await page.route("**/data/stays/index.json*", (r) =>
    r.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ viajes: Object.fromEntries([...ids].map((i) => [i, { c: 5 }])) }),
    })
  );
  await page.route("**/data/stays/ir-*.json*", (r) => {
    const nombre = r.request().url().split("/").pop().split(".json")[0];
    const par = PARADAS.find(([c, d, n]) => id(c, d, n) === nombre);
    if (!par || !ids.has(nombre)) return r.fulfill({ status: 404, body: "" });
    return r.fulfill({ contentType: "application/json", body: JSON.stringify(fichero(...par)) });
  });
};

const abrir = async (page) => {
  await page.goto("/trenes.html", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  await page.fill("#irIda", IDA);
  await page.dispatchEvent("#irIda", "change");
  await page.waitForTimeout(400);
};

test.describe("el alojamiento del interrail", () => {
  test.use({ timezoneId: "Europe/Madrid" });

  test("cada parada sale con su alojamiento, y ninguno es una habitación", async ({ page }) => {
    await conCamas(page);
    await abrir(page);
    const ruta = page.locator("#ruta-centro");
    await expect(ruta.locator(".ir-cama .ir-cama-sel")).toHaveCount(5);
    // Sale el piso, no el cuarto de 30 € que iba primero y más barato.
    await expect(ruta.locator(".ir-cama-sel a").first()).toHaveText("Piso céntrico AMS");
    await expect(ruta).not.toContainText("Cuarto en");
    // Ni el hotel, que es una habitación, ni el enlace, que no es un sitio.
    await expect(ruta).not.toContainText("Hotel AMS");
    await expect(ruta.locator(".ir-cama", { hasText: "Booking.com" })).toHaveCount(0);
  });

  test("con cama, el precio pasa a ser el del viaje y dice de dónde sale", async ({ page }) => {
    // Cinco pisos de 200 € para dos: 1.000 €, 500 por persona.
    await conCamas(page);
    await abrir(page);
    const precio = page.locator("#ruta-centro .ir-precio");
    await expect(precio.locator(".ir-precio-titulo")).toHaveText("El viaje, por persona");
    await expect(precio.locator(".ir-desglose")).toContainText("500 € por persona");
    await expect(precio.locator(".ir-desglose")).toContainText("1000 € para 2");
    // Sin vuelos buscados, el total lo dice en vez de callárselo.
    await expect(precio.locator(".ir-desglose")).toContainText("faltan los vuelos");
    // Y el total de verdad: billetes 105–270 + 500 = 605–770.
    await expect(precio.locator("dl > div:nth-child(1) dd")).toHaveText("≈ 605–770 €");
  });

  test("si cambias una, cambia el precio", async ({ page }) => {
    await conCamas(page);
    await abrir(page);
    const ruta = page.locator("#ruta-centro");
    const desglose = ruta.locator(".ir-desglose");
    await expect(desglose).toContainText("1000 € para 2");

    // En Ámsterdam, el loft de 260 en vez del piso de 200: +60 para el grupo.
    await ruta.locator(".ir-cama").first().locator("summary").click();
    await ruta.locator('.ir-elegir[data-url="https://x.test/AMS/b"]').click();
    await expect(desglose).toContainText("1060 € para 2");
    await expect(desglose).toContainText("530 € por persona");
    await expect(ruta.locator(".ir-cama-sel a").first()).toHaveText("Loft AMS");
  });

  test("y la elección se queda al volver", async ({ page }) => {
    await conCamas(page);
    await abrir(page);
    const ruta = page.locator("#ruta-centro");
    await ruta.locator(".ir-cama").first().locator("summary").click();
    await ruta.locator('.ir-elegir[data-url="https://x.test/AMS/b"]').click();
    await expect(ruta.locator(".ir-cama-sel a").first()).toHaveText("Loft AMS");

    await abrir(page);
    await expect(page.locator("#ruta-centro .ir-cama-sel a").first()).toHaveText("Loft AMS");
  });

  test("las opciones para cambiar tampoco traen habitaciones", async ({ page }) => {
    await conCamas(page);
    await abrir(page);
    const otras = page.locator("#ruta-centro .ir-cama").first().locator(".ir-elegir");
    await expect(otras).toHaveCount(1); // el loft; ni el cuarto ni el hotel
  });

  test("con paradas sin cama, el total avisa de que le faltan", async ({ page }) => {
    await conCamas(page, PARADAS.slice(0, 3));
    await abrir(page);
    await expect(page.locator("#ruta-centro .ir-desglose")).toContainText("faltan 2 paradas");
    await expect(page.locator("#ruta-centro [data-ir-camas]")).toContainText("Buscar lo que falta");
  });

  test("otra cantidad de gente es otro alojamiento", async ({ page }) => {
    // Los ficheros son para 2: para 3 no valen, y no se usan.
    await conCamas(page);
    await abrir(page);
    await page.selectOption("#irPersonas", "3");
    await page.waitForTimeout(300);
    await expect(page.locator("#ruta-centro .ir-cama-sel")).toHaveCount(0);
    await expect(page.locator("#ruta-centro .ir-precio-titulo")).toHaveText("El tren, por persona");
  });
});

test.describe("pedir el alojamiento", () => {
  test.use({ timezoneId: "Europe/Madrid" });

  test("un solo encargo con todas las paradas", async ({ page }) => {
    // Uno por parada perdería los del medio: GitHub solo guarda una ejecución
    // en espera por cola, y cancela las demás sin avisar.
    await page.addInitScript(() => {
      try {
        localStorage.setItem("tf_sesion", JSON.stringify({ uid: "u-i", user: "i", name: "I" }));
        localStorage.setItem("tf_token", "ghp_de_mentira");
      } catch (e) { /* nada */ }
    });
    const enviados = [];
    await page.route("**/api.github.com/repos/**/dispatches", async (r) => {
      enviados.push(JSON.parse(r.request().postData() || "{}"));
      await r.fulfill({ status: 204, body: "" });
    });
    await conCamas(page, []);
    await abrir(page);
    await page.locator("#ruta-centro [data-ir-camas]").click();
    await expect.poll(() => enviados.length).toBe(1);

    const [e] = enviados;
    expect(e.event_type).toBe("interrail");
    expect(Object.keys(e.client_payload).length).toBeLessThanOrEqual(10);
    expect(e.client_payload.adults).toBe("2");
    expect(e.client_payload.paradas.map((p) => p.offer_id)).toEqual(
      PARADAS.map(([c, d, n]) => id(c, d, n))
    );
    // Y los dos vuelos, de ida sola, en el mismo encargo.
    expect(e.client_payload.vuelos.map((v) => v.id)).toEqual([
      "ir-vuelo-MAD-AMS-2026-11-06-ida",
      "ir-vuelo-MAD-BUD-2026-11-17-vuelta",
    ]);
    expect(e.client_payload.vuelos[0].aeropuertos).toEqual(["AMS", "EIN", "RTM"]);
    // La salida de cada parada es la llegada a la siguiente.
    expect(e.client_payload.paradas[0]).toMatchObject({
      city: "Ámsterdam",
      country: "Países Bajos",
      checkin: "2026-11-06",
      checkout: "2026-11-08",
    });

    // Y se ve que está en marcha.
    await expect(page.locator("#ruta-centro .ir-buscando")).toBeVisible();
  });

  test("sin cuenta, dice que hace falta en vez de fallar callado", async ({ page }) => {
    await conCamas(page, []);
    await abrir(page);
    await page.locator("#ruta-centro [data-ir-camas]").click();
    await expect(page.locator("#ruta-centro .ir-acceso")).toContainText("Hace falta una cuenta");
  });
});
