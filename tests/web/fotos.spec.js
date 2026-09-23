/* Las fotos del alojamiento.

   Nadie elige dónde duerme sin ver la casa, y el panel era una lista de texto
   — con las fotos ya guardadas en el fichero, sin pintar en ninguna parte.

   El carrusel es CSS puro (`scroll-snap`): sin librería, sin JavaScript y sin
   estado que mantener. Lo que se prueba aquí es lo que se ve y lo que protege
   la conexión, que con seis fotos por alojamiento y dieciocho alojamientos no
   es un detalle. */
const { test, expect } = require("@playwright/test");

const SESION = { uid: "u-p", user: "p", name: "P" };

const FOTOS = [
  "https://ejemplo.test/uno.jpg",
  "https://ejemplo.test/dos.jpg",
  "https://ejemplo.test/tres.jpg",
];

const conPanel = async (page, stays) => {
  await page.addInitScript((s) => {
    try {
      localStorage.setItem("tf_sesion", JSON.stringify(s));
      localStorage.setItem("tf_token", "ghp_de_mentira");
    } catch (e) { /* nada */ }
  }, SESION);
  // Las fotos no se descargan de verdad: un píxel basta y la prueba no depende
  // de que exista un servidor de imágenes.
  await page.route("https://ejemplo.test/**", (r) =>
    r.fulfill({
      contentType: "image/gif",
      body: Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"),
    })
  );
  await page.route("**/data/stays/*.json*", (r) =>
    r.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        offer_id: "x",
        generated_at: "2026-09-23",
        summary: { total: 264, per_person: 132, party: 2, flights: 145, stay: 119 },
        stays,
      }),
    })
  );
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  await page.evaluate(() => document.querySelector(".hero [data-stay]")?.click());
  await expect(page.locator("#panel")).toBeVisible();
};

const cama = (extra = {}) => ({
  name: "Casa del Centro",
  provider: "airbnb",
  price_total: 119,
  price_per_night: 59,
  url: "https://example.com",
  km_centro: 0.8,
  ...extra,
});

test("con varias fotos hay carrusel, y dice cuántas", async ({ page }) => {
  await conPanel(page, [cama({ images: FOTOS })]);
  await expect(page.locator(".stay-fotos img")).toHaveCount(3);
  await expect(page.locator(".stay-cuantas")).toHaveText("3 fotos");
  await expect(page.locator(".stay-fotos")).toHaveClass(/varias/);
});

test("con una sola, foto sin carrusel", async ({ page }) => {
  await conPanel(page, [cama({ images: [FOTOS[0]] })]);
  await expect(page.locator(".stay-fotos img")).toHaveCount(1);
  await expect(page.locator(".stay-cuantas")).toHaveCount(0);
});

test("lo guardado antes, con una sola `image`, sigue viéndose", async ({ page }) => {
  // Los ficheros de `data/stays/` de antes de esto no tienen `images`.
  await conPanel(page, [cama({ image: FOTOS[0] })]);
  await expect(page.locator(".stay-fotos img")).toHaveCount(1);
});

test("sin foto no se pinta un hueco gris", async ({ page }) => {
  // Una ficha con un cuadro vacío donde debería ir una casa es peor que una
  // ficha sin foto.
  await conPanel(page, [cama()]);
  await expect(page.locator(".stay-fotos")).toHaveCount(0);
  await expect(page.locator(".stay")).not.toHaveClass(/con-foto/);
  await expect(page.locator(".stay .name")).toHaveText("Casa del Centro");
});

test("una foto que no es https no se pinta", async ({ page }) => {
  // En una página https el navegador no la pinta y encima avisa: mejor no
  // pedirla.
  await conPanel(page, [cama({ images: ["http://inseguro.test/x.jpg"] })]);
  await expect(page.locator(".stay-fotos")).toHaveCount(0);
});

test("las fotos van en diferido y con su hueco reservado", async ({ page }) => {
  /* Seis fotos por alojamiento y dieciocho alojamientos: sin `lazy` se traga la
     conexión al abrir el panel, y sin hueco reservado la lista salta entera
     mientras cargan. */
  await conPanel(page, [cama({ images: FOTOS })]);
  const primera = page.locator(".stay-fotos img").first();
  await expect(primera).toHaveAttribute("loading", "lazy");
  await expect(primera).toHaveAttribute("decoding", "async");
  const ratio = await primera.evaluate((n) => getComputedStyle(n).aspectRatio);
  expect(ratio.replace(/\s/g, "")).toBe("4/3");
});

test("la foto no se lleva por delante el nombre ni el precio", async ({ page }) => {
  await conPanel(page, [cama({ images: FOTOS })]);
  await expect(page.locator(".stay .name")).toHaveText("Casa del Centro");
  await expect(page.locator(".stay .amount-s")).toContainText("119");
});
