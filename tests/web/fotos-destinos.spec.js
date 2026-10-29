/* Las fotos de cada destino, sacadas de Wikipedia (`web/js/fotos.js`).

   Aquí Wikipedia es de mentira: la prueba contesta a su API y sirve un píxel
   como foto. Lo que se mira es lo que hace la web con lo que le llega: qué
   artículo pide, qué archivos descarta (banderas, mapas, SVG), que la foto
   lleve su crédito y que lo guardado no se vuelva a pedir. */
const { test, expect } = require("@playwright/test");

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

async function wikipedia(page) {
  const pedidas = [];
  await page.addInitScript(() => {
    window.TF_FOTOS = true;
  });
  await page.route("https://es.wikipedia.org/w/api.php?**", (r) => {
    const q = new URL(r.request().url()).searchParams;
    pedidas.push(Object.fromEntries(q));
    if (q.get("prop") === "imageinfo") {
      const pages = q.get("titles").split("|").map((t) => {
        const nombre = t.replace(/^Archivo:/, "");
        const ancho = nombre.startsWith("Retrato") ? 900 : 2000;
        return {
          title: t,
          imageinfo: [{
            mime: "image/jpeg", width: ancho, height: 1300, thumburl: `https://upload.wikimedia.org/x/${encodeURIComponent(nombre)}`,
            thumbwidth: 960, thumbheight: 624, descriptionurl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(nombre)}`,
            extmetadata: { Artist: { value: '<a href="//x">Ana Foto</a>' }, LicenseShortName: { value: "CC BY-SA 4.0" } },
          }],
        };
      });
      return r.fulfill({ json: { query: { pages } } });
    }
    return r.fulfill({
      json: {
        query: {
          pages: [{
            title: q.get("titles"), pageimage: "Vista_general.jpg",
            images: [
              { title: "Archivo:Bandera de Inglaterra.svg" }, { title: "Archivo:Escudo de Mánchester.jpg" },
              { title: "Archivo:Puerto viejo.jpg" }, { title: "Archivo:Retrato del alcalde.jpg" },
              { title: "Archivo:Catedral.JPG" },
            ],
          }],
        },
      },
    });
  });
  await page.route("https://upload.wikimedia.org/**", (r) => r.fulfill({ body: PIXEL, contentType: "image/jpeg" }));
  return pedidas;
}

test("el chollo del día lleva la foto de su destino, con su crédito", async ({ page }) => {
  const pedidas = await wikipedia(page);
  await page.goto("/index.html");
  const foto = page.locator(".hero .ticket-foto");
  await expect(foto).toHaveClass(/con-foto/, { timeout: 15000 });
  await expect(foto).toHaveCSS("background-image", /Vista%20general/);
  await expect(foto.locator(".foto-credito")).toHaveText("Ana Foto · CC BY-SA 4.0");
  await expect(foto.locator(".foto-credito")).toHaveAttribute("href", /commons\.wikimedia\.org/);
  // Por código de aeropuerto, al artículo de la ciudad.
  expect(pedidas[0].titles).toBe("Mánchester");
  // Ni la bandera (SVG) ni el escudo se piden siquiera.
  const info = pedidas.find((p) => p.prop === "imageinfo");
  expect(info.titles).not.toMatch(/Bandera|Escudo/);
});

test("al abrir una fila sale la galería del destino, sin retratos estrechos", async ({ page }) => {
  await wikipedia(page);
  await page.goto("/index.html");
  const fila = page.locator(".brow[data-open]").first();
  await fila.click();
  const galeria = fila.locator(".galeria");
  await expect(galeria).toBeVisible({ timeout: 15000 });
  await expect(galeria.locator("img")).toHaveCount(3); // cabecera, puerto y catedral
  await expect(galeria.locator('img[src*="Retrato"]')).toHaveCount(0);
  // Tocar una foto no cierra la fila.
  await galeria.locator("img").first().click({ force: true });
  await expect(fila).toHaveAttribute("aria-expanded", "true");
});

test("lo que ya se ha pedido no se vuelve a pedir", async ({ page }) => {
  const pedidas = await wikipedia(page);
  await page.goto("/index.html");
  await expect(page.locator(".hero .ticket-foto")).toHaveClass(/con-foto/, { timeout: 15000 });
  const antes = pedidas.length;
  await page.reload();
  await expect(page.locator(".hero .ticket-foto")).toHaveClass(/con-foto/, { timeout: 15000 });
  expect(pedidas.length).toBe(antes);
});

test("en las pruebas, sin pedirlas, no hay fotos", async ({ page }) => {
  let llamadas = 0;
  await page.route("https://es.wikipedia.org/**", (r) => {
    llamadas += 1;
    return r.abort();
  });
  await page.goto("/index.html");
  await expect(page.locator(".hero .ticket")).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(500);
  expect(llamadas).toBe(0);
  await expect(page.locator(".hero .ticket-foto")).not.toHaveClass(/con-foto/);
});
