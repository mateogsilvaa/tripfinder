/* Pedir una cuenta (2d del diseño).

   Hasta ahora, quien no tenía cuenta se encontraba los formularios apagados con
   el motivo puesto y ahí se acababa el camino: para conseguir una había que
   conocer a alguien y pedírsela por fuera.

   CÓMO SALE DE AQUÍ LA PETICIÓN. Quien pide una cuenta no tiene cuenta, luego
   no tiene token, luego no puede escribir en el repositorio como escribe todo
   lo demás en esta web. Lo único que puede hacer alguien de fuera es abrir una
   issue con su propio GitHub, así que eso es lo que se hace. */
const { test, expect } = require("@playwright/test");

const USUARIOS = {
  updated: "2026-09-14",
  admin: {},
  users: [
    { id: "u-1", user: "mateogsilvaa", name: "mateo", active: true },
    { id: "u-2", user: "ana", name: "Ana Garcia", active: true },
  ],
  site: {},
};

const conUsuarios = (page) =>
  page.route("**/data/users.json*", (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify(USUARIOS) })
  );

const abrir = async (page) => {
  await conUsuarios(page);
  await page.goto("/buscar.html", { waitUntil: "domcontentloaded" });
  const puerta = page.locator("[data-pedir-cuenta]").first();
  await puerta.waitFor({ state: "attached" });
  await puerta.evaluate((b) => b.click());
  await expect(page.locator("#pedirCuenta")).toBeVisible();
};

test("sin cuenta hay por dónde pedirla", async ({ page }) => {
  await conUsuarios(page);
  await page.goto("/buscar.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-pedir-cuenta]").first()).toBeAttached();
});

test("el formulario pide lo que pide el diseño", async ({ page }) => {
  await abrir(page);
  await expect(page.locator("#pcNombre")).toBeVisible();
  await expect(page.locator("#pcUser")).toBeVisible();
  await expect(page.locator("#pcPorque")).toBeVisible();
  // Y el contador de los 240.
  await page.locator("#pcPorque").fill("Hola");
  await expect(page.locator("#pcCuenta")).toHaveText("4/240");
});

/* El email NO se pide, y es apartarse del diseño a propósito: la petición acaba
   en una issue pública, y este proyecto ya publica `users.json` sin emails con
   un grep en el despliegue que falla si se cuela una arroba. */
test("el email no se pide aquí, y se dice por qué", async ({ page }) => {
  await abrir(page);
  await expect(page.locator("#pedirBody")).not.toContainText("Email");
  await expect(page.locator(".pedir-nota").first()).toContainText("queda publicado");
});

test("un usuario cogido se avisa, con alternativas que se pueden pulsar", async ({ page }) => {
  await abrir(page);
  await page.locator("#pcNombre").fill("Ana Garcia");
  await page.locator("#pcUser").fill("ana");
  await expect(page.locator("#pcUserPie")).toContainText("Ya hay una cuenta con ese usuario");
  const sug = page.locator("#pcSug button");
  await expect(sug.first()).toBeVisible();
  // Salen del nombre que ha escrito, no de un contador.
  await expect(page.locator("#pcSug")).toContainText("anagarcia");
  await sug.first().click();
  await expect(page.locator("#pcUser")).not.toHaveValue("ana");
  await expect(page.locator("#pcUserPie")).toHaveText("Libre.");
});

test("uno libre se dice libre", async ({ page }) => {
  await abrir(page);
  await page.locator("#pcUser").fill("lucia");
  await expect(page.locator("#pcUserPie")).toHaveText("Libre.");
});

test("no deja mandar media petición", async ({ page }) => {
  await abrir(page);
  await page.locator("#pcMandar").click();
  await expect(page.locator("#pcMsg")).toContainText("Falta el nombre");

  await page.locator("#pcNombre").fill("Lucía");
  await page.locator("#pcUser").fill("lucia");
  await page.locator("#pcMandar").click();
  await expect(page.locator("#pcMsg")).toContainText("quién eres");
});

/* Lo que de verdad manda la petición: una issue con el cuerpo ya escrito. */
test("mandarla abre GitHub con la petición escrita", async ({ page, context }) => {
  await abrir(page);
  await page.locator("#pcNombre").fill("Lucía Pérez");
  await page.locator("#pcUser").fill("lucia");
  await page
    .locator("#pcPorque")
    .fill("Soy la hermana de Mateo y volamos juntos casi todos los findes.");

  // GitHub no se visita desde aquí: se contesta con un sello para poder leer
  // la dirección a la que se iba, que es lo que comprueba esta prueba.
  await context.route("https://github.com/**", (r) =>
    r.fulfill({ contentType: "text/html", body: "<p>ok</p>" })
  );

  const [nueva] = await Promise.all([
    context.waitForEvent("page"),
    page.locator("#pcMandar").click(),
  ]);
  const url = nueva.url();
  expect(url).toContain("github.com/mateogsilvaa/tripfinder/issues/new");
  expect(decodeURIComponent(url)).toContain("labels=peticion-cuenta");
  expect(decodeURIComponent(url)).toContain("[cuenta] lucia");
  expect(decodeURIComponent(url)).toContain("Usuario: lucia");
  expect(decodeURIComponent(url)).toContain("hermana de Mateo");
  // Y en el cuerpo no viaja ninguna dirección.
  expect(decodeURIComponent(url)).not.toMatch(/[\w.]+@[\w.]+/);

  // Y la pantalla dice lo que falta, sin dar por hecho que ya está pedida.
  await expect(page.locator("#pedirBody")).toContainText("Submit new issue");
  await expect(page.locator("#pedirBody")).toContainText("lucia");
});
