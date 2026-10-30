/* Subir la ilustración de una ciudad desde el panel: se elige país y ciudad,
   las dos imágenes y el encuadre, y queda en `ilustraciones_subidas` en WebP,
   esperando al workflow que la publica. */
const { test, expect } = require("@playwright/test");
const E = require("./emulador.js");

const clave = "una-clave-larga-1";
// Una imagen de verdad, para que el navegador la tenga que decodificar.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAKCAIAAAAy3EnLAAAAF0lEQVR4nGOUsznBQApgIkn1qIZBowEAPVIBNuSU8pAAAAAASUVORK5CYII=",
  "base64"
);

async function jefa(browser) {
  const ctx = await browser.newContext({ baseURL: "http://localhost:4173" });
  await ctx.addInitScript((c) => {
    window.TF_NUBE = c;
  }, E.CONFIG);
  // Los datos de prueba no traen la lista de aeropuertos: la de verdad.
  await ctx.route("**/data/airports.json*", (r) =>
    r.fulfill({ path: require("node:path").join(__dirname, "../../data/airports.json"), contentType: "application/json" })
  );
  const page = await ctx.newPage();
  await page.goto("/index.html");
  await page.locator("#tfCuenta").click();
  await page.locator("#nubeCorreo").fill(E.correoNuevo());
  await page.locator("#nubePass").fill(clave);
  await page.locator("#nubeForm button[type=submit]").click();
  await expect(page.locator("#nubeBienvenida")).toBeVisible();
  await Promise.all([page.waitForEvent("load"), page.locator("#nubeListo").click()]);
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem("tf_sesion")));
  await E.hacerAdmin(s.uid);
  return { ctx, page, uid: s.uid };
}

test("la administradora sube el día y la noche de una ciudad", async ({ browser }) => {
  const { ctx, page, uid } = await jefa(browser);
  await page.goto("/admin.html");
  await page.locator('[data-tab="ilustraciones"]').click();
  await expect(page.locator("#admIluLista li").first()).toBeVisible();

  await page.locator("#admIluPais").selectOption({ label: "Italia" });
  await page.locator("#admIluCiudad").selectOption("Roma");
  // Roma ya tiene: lo dice, y se ve lo que hay.
  await expect(page.locator("#admIluRuta")).toContainText("ilustraciones/italia/roma/");
  await expect(page.locator("#admIluRuta")).toContainText("Ya tiene");
  await expect(page.locator("#admIluVista-dia")).toHaveClass(/con/);

  await page.locator("#admIluFich-noche").setInputFiles({ name: "noche.png", mimeType: "image/png", buffer: PNG });
  await expect(page.locator("#admIluVista-noche")).toHaveCSS("background-image", /data:image\/webp/);
  await page.locator("#admIluY").fill("80");
  await page.locator("#admIluSubir").click();
  await expect(page.locator("#admIluMsg")).toContainText("Subida Roma", { timeout: 10000 });

  const d = (await E.coleccion("ilustraciones_subidas")).find((x) => x.autor === uid);
  expect(d).toMatchObject({ pais: "italia", ciudad: "roma", nombre: "Roma", encuadre: 80, autor: uid });
  expect(d.aeropuertos).toEqual(expect.arrayContaining(["FCO"]));
  // Solo la que se cambió, y ya en WebP (RIFF....WEBP en base64).
  expect(d.dia).toBeUndefined();
  expect(Buffer.from(d.noche, "base64").subarray(8, 12).toString()).toBe("WEBP");
  await expect(page.locator("#admIluPendientes")).toContainText("Roma");
  await ctx.close();
});

test("una ciudad nueva va a una carpeta nueva, y sin imágenes no se sube", async ({ browser }) => {
  const { ctx, page } = await jefa(browser);
  await page.goto("/admin.html");
  await page.locator('[data-tab="ilustraciones"]').click();
  await page.locator("#admIluPais").selectOption({ label: "Italia" });
  await page.locator("#admIluCiudad").selectOption("Bari");
  await expect(page.locator("#admIluRuta")).toContainText("Ciudad nueva");
  await expect(page.locator("#admIluRuta")).toContainText("ilustraciones/italia/bari/");
  await page.locator("#admIluSubir").click();
  await expect(page.locator("#admIluMsg")).toHaveText("Falta al menos una de las dos imágenes.");
  await ctx.close();
});
