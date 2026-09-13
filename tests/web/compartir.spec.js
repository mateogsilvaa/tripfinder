/* Sacar un viaje de aquí: al calendario y a quien te apetezca.

   Un chollo que sale hoy se vuela en noviembre, y hasta ahora lo único que se
   podía hacer con él era marcarlo como favorito —que vive en el `localStorage`
   de ESE navegador y se queda atrás en cuanto cambias de móvil—. */
const { test, expect } = require("@playwright/test");

const conOferta = (page, cambios = {}) =>
  page.route("**/data/offers.json*", async (route) => {
    const fs = require("node:fs");
    const path = require("node:path");
    const crudo = fs.readFileSync(
      path.join(__dirname, "datos", "offers.json"),
      "utf8"
    );
    const d = JSON.parse(crudo);
    Object.assign(d.offers[0], cambios);
    await route.fulfill({ body: JSON.stringify(d), contentType: "application/json" });
  });

const abierto = async (page) => {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".hero .ticket")).toBeVisible({ timeout: 15000 });
};

async function descargarICS(page, selector) {
  const [descarga] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(selector).click(),
  ]);
  const fs = require("node:fs");
  return {
    nombre: descarga.suggestedFilename(),
    texto: fs.readFileSync(await descarga.path(), "utf8"),
  };
}

test.describe("al calendario", () => {
  test("el viaje se descarga con su ida y su vuelta", async ({ page }) => {
    await conOferta(page);
    await abierto(page);
    const { nombre, texto } = await descargarICS(page, ".hero [data-ics]");
    expect(nombre).toMatch(/^tripfinder-.+-\d{4}-\d{2}-\d{2}\.ics$/);
    // CRLF: con \n a secas hay clientes que ni abren el fichero.
    expect(texto).toContain("BEGIN:VCALENDAR\r\n");
    expect(texto).toContain("END:VCALENDAR");
    expect((texto.match(/BEGIN:VEVENT/g) || []).length).toBe(2);
    expect(texto).toMatch(/SUMMARY:Vuelo MAD → /);
    // El enlace para volver a la oferta viaja dentro.
    expect(texto).toContain("?offer=");
  });

  test("un vuelo que aterriza de madrugada no termina antes de empezar", async ({ page }) => {
    // Sale a las 21:55 y aterriza a las 00:30: la llegada es del día siguiente.
    await conOferta(page, { depart_date: "2026-11-13", depart_time: "21:55", arrive_time: "00:30" });
    await abierto(page);
    const { texto } = await descargarICS(page, ".hero [data-ics]");
    const ida = texto.split("BEGIN:VEVENT")[1];
    expect(ida).toContain("DTSTART:20261113T215500");
    expect(ida).toContain("DTEND:20261114T003000");
  });

  test("sin hora, el vuelo entra como día entero y no a una hora inventada", async ({ page }) => {
    await conOferta(page, { depart_time: "", arrive_time: "", return_time: "", return_arrive_time: "" });
    await abierto(page);
    const { texto } = await descargarICS(page, ".hero [data-ics]");
    expect(texto).toContain("DTSTART;VALUE=DATE:");
    // El DTEND de un día entero es exclusivo: si no, un vuelo del 13 sale el 12.
    const ida = texto.split("BEGIN:VEVENT")[1];
    const [, desde] = ida.match(/DTSTART;VALUE=DATE:(\d{8})/);
    const [, hasta] = ida.match(/DTEND;VALUE=DATE:(\d{8})/);
    expect(Number(hasta)).toBe(Number(desde) + 1);
  });

  test("una coma en el nombre del destino no parte el fichero", async ({ page }) => {
    await conOferta(page, { destination_name: "Palma, Mallorca" });
    await abierto(page);
    const { texto } = await descargarICS(page, ".hero [data-ics]");
    expect(texto).toContain("Palma\\, Mallorca");
  });
});

test.describe("compartir", () => {
  test("sin navigator.share se copia el enlace y se dice", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await conOferta(page);
    await abierto(page);
    await page.evaluate(() => {
      delete navigator.share;
    });
    const boton = page.locator(".hero [data-share]");
    await boton.click();
    // Un botón que no da señal parece roto y se pulsa tres veces.
    await expect(boton).toHaveText("enlace copiado");
    const copiado = await page.evaluate(() => navigator.clipboard.readText());
    expect(copiado).toContain("?offer=");
    // Y vuelve a su sitio, no se queda con el aviso puesto.
    await expect(boton).toHaveText("Compartir", { timeout: 4000 });
  });

  test("con navigator.share se usa el del sistema, no el portapapeles", async ({ page }) => {
    await conOferta(page);
    await abierto(page);
    await page.evaluate(() => {
      window.__compartido = null;
      navigator.share = (d) => {
        window.__compartido = d;
        return Promise.resolve();
      };
    });
    await page.locator(".hero [data-share]").click();
    const datos = await page.evaluate(() => window.__compartido);
    expect(datos.url).toContain("?offer=");
    expect(datos.text).toContain("MAD →");
  });

  test("cancelar el diálogo de compartir no deja el botón tocado", async ({ page }) => {
    await conOferta(page);
    await abierto(page);
    await page.evaluate(() => {
      navigator.share = () => Promise.reject(Object.assign(new Error("no"), { name: "AbortError" }));
    });
    const boton = page.locator(".hero [data-share]");
    await boton.click();
    await page.waitForTimeout(200);
    await expect(boton).toHaveText("Compartir");
    await expect(boton).toBeEnabled();
  });
});

test.describe("el mínimo histórico", () => {
  test("sale en la lista sin tener que abrir el viaje", async ({ page }) => {
    await conOferta(page, { minimo_historico: true, minimo_anterior: 71 });
    await abierto(page);
    const marca = page.locator(".hero .minimo");
    await expect(marca).toHaveText("mínimo histórico");
    // Para quien no ve el color, el dato completo.
    await expect(marca).toHaveAttribute("aria-label", /71 €/);
  });

  test("sin la marca del backend no se inventa nada", async ({ page }) => {
    await conOferta(page, { minimo_historico: false });
    await abierto(page);
    expect(await page.locator(".minimo").count()).toBe(0);
  });
});
