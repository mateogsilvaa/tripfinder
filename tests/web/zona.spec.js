/* En qué zona dormir.

   El panel de alojamiento contestaba «cuánto cuesta» y «de quién es», pero no
   la pregunta con la que se abre: en qué parte de la ciudad me quedo. El dato
   ya venía en los anuncios —«Apartamento en Monastiraki»— y solo se veía
   suelto en cada ficha, así que había que leerse dieciocho para sacar la
   conclusión a mano.

   Lo que se prueba aquí es que la banda aparece cuando el backend ha sabido
   recomendar una zona, que NO aparece cuando no, y que no se come el sitio del
   precio, que es lo que de verdad decide. */
const { test, expect } = require("@playwright/test");

const SESION = { uid: "u-z", user: "z", name: "Z" };

const RESUMEN = {
  total: 264,
  per_person: 132,
  party: 2,
  flights: 145,
  stay: 119,
};

const CAMAS = [
  {
    name: "Casa en Monastiraki",
    provider: "airbnb",
    price_total: 195,
    price_per_night: 97,
    url: "https://example.com/a",
    area: "Apartamento en Monastiraki",
    km_centro: 0.7,
  },
  {
    name: "Otra en Monastiraki",
    provider: "airbnb",
    price_total: 240,
    price_per_night: 120,
    url: "https://example.com/b",
    area: "Apartamento en Monastiraki",
    km_centro: 0.8,
  },
];

const conPanel = async (page, resumen) => {
  await page.addInitScript((s) => {
    try {
      localStorage.setItem("tf_sesion", JSON.stringify(s));
      localStorage.setItem("tf_token", "ghp_de_mentira");
    } catch (e) { /* nada */ }
  }, SESION);
  await page.route("**/data/stays/*.json*", (r) =>
    r.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        offer_id: "x",
        generated_at: "2026-09-23",
        summary: resumen,
        stays: CAMAS,
      }),
    })
  );
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  await page.evaluate(() => document.querySelector(".hero [data-stay]")?.click());
  await expect(page.locator("#panel")).toBeVisible();
};

test.describe("la zona recomendada", () => {
  test("sale con nombre, cuántos sitios y desde cuánto", async ({ page }) => {
    await conPanel(page, {
      ...RESUMEN,
      zona: { zona: "Monastiraki", cuantos: 2, desde: 195, precio: 217.5, km: 0.72, de: 3 },
    });
    const banda = page.locator(".zona-rec");
    await expect(banda).toBeVisible();
    await expect(banda).toContainText("Monastiraki");
    await expect(banda).toContainText("2 sitios");
    await expect(banda).toContainText("195");
  });

  test("dice con cuántas zonas se ha comparado", async ({ page }) => {
    // Una recomendación entre tres barrios no vale lo mismo que entre uno, y
    // quien la lee tiene derecho a saber cuál de las dos está leyendo.
    await conPanel(page, {
      ...RESUMEN,
      zona: { zona: "Monastiraki", cuantos: 2, desde: 195, precio: 217.5, km: 0.72, de: 3 },
    });
    await expect(page.locator(".zona-rec small")).toContainText("3 zonas");
  });

  test("con una sola zona no presume de haber comparado", async ({ page }) => {
    await conPanel(page, {
      ...RESUMEN,
      zona: { zona: "Marrakech Medina", cuantos: 16, desde: 52, precio: 142, km: 0.7, de: 1 },
    });
    const banda = page.locator(".zona-rec");
    await expect(banda).toContainText("la única zona");
    await expect(banda).not.toContainText("mejor junta");
    await expect(banda).toContainText("16 sitios");
  });

  test("sin distancia al centro, la banda sale igual y sin el minuto a pie", async ({ page }) => {
    // `km_centro` se sabe a veces: sin ella se recomienda por precio, y lo que
    // no se sabe no se escribe.
    await conPanel(page, {
      ...RESUMEN,
      zona: { zona: "Sentrum", cuantos: 2, desde: 269, precio: 408.5, km: null, de: 2 },
    });
    const banda = page.locator(".zona-rec");
    await expect(banda).toContainText("Sentrum");
    await expect(banda).not.toContainText("a pie");
    await expect(banda).not.toContainText("min");
  });

  test("donde no hay zona que recomendar, no hay banda", async ({ page }) => {
    // Lo normal en ciudades pequeñas: todos los anuncios dicen el nombre de la
    // ciudad. Inventarse una zona es peor que callarse.
    await conPanel(page, RESUMEN);
    await expect(page.locator(".zona-rec")).toHaveCount(0);
    // Y el resto del panel sigue entero.
    await expect(page.locator("#panel .total")).toBeVisible();
  });

  test("una zona a medias no pinta nada", async ({ page }) => {
    // Un fichero guardado por una versión anterior, o un resumen recortado:
    // antes que una banda que diga «Dónde dormir:» y se quede en blanco, nada.
    await conPanel(page, { ...RESUMEN, zona: { cuantos: 2, desde: 195, de: 3 } });
    await expect(page.locator(".zona-rec")).toHaveCount(0);
  });

  test("el precio del viaje sigue por delante de la zona", async ({ page }) => {
    // El orden importa: lo primero que se lee es cuánto cuesta.
    await conPanel(page, {
      ...RESUMEN,
      zona: { zona: "Monastiraki", cuantos: 2, desde: 195, precio: 217.5, km: 0.72, de: 3 },
    });
    const orden = await page.evaluate(() => {
      const total = document.querySelector("#panel .total");
      const zona = document.querySelector("#panel .zona-rec");
      if (!total || !zona) return "falta";
      return total.compareDocumentPosition(zona) & Node.DOCUMENT_POSITION_FOLLOWING
        ? "zona despues"
        : "zona antes";
    });
    expect(orden).toBe("zona despues");
  });

  test("el nombre de la zona no puede meter etiquetas", async ({ page }) => {
    // Viene de raspar una web ajena: se escapa como todo lo demás.
    await conPanel(page, {
      ...RESUMEN,
      zona: { zona: "<img src=x onerror=alert(1)>Centro", cuantos: 2, desde: 99, km: 0.5, de: 2 },
    });
    await expect(page.locator(".zona-rec img")).toHaveCount(0);
    await expect(page.locator(".zona-rec")).toContainText("Centro");
  });
});
