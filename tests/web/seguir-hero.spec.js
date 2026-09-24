/* El «Seguir» del viaje destacado (el hero). Se ataba dos veces —con el feed y
   con el hero—, así que con sesión cada pulsación lo apuntaba y lo desapuntaba
   (no pasaba nada), y sin sesión abría el login dos veces: el segundo vaciaba
   al primero y la página reventaba con un error. */
const { test, expect } = require("@playwright/test");

test("sin sesión, el «Seguir» del destacado abre el login, entero y sin errores", async ({ page }) => {
  const errores = [];
  page.on("pageerror", (e) => errores.push(e.message));
  await page.goto("/index.html");
  const fav = page.locator("#hero .fav").first();
  await expect(fav).toBeVisible();
  await fav.click();
  await expect(page.locator("#tfLoginForm")).toBeVisible();
  await expect(page.locator("#tfLoginUser")).toBeVisible();
  expect(errores).toEqual([]);
});

test("con sesión, una pulsación lo apunta (y no lo desapunta en el acto)", async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("tf_sesion", JSON.stringify({ uid: "u-prueba", user: "p", name: "P" }));
    } catch (e) { /* nada */ }
  });
  await page.goto("/index.html");
  const fav = page.locator("#hero .fav").first();
  await expect(fav).toHaveAttribute("aria-pressed", "false");
  await fav.click();
  await expect(fav).toHaveAttribute("aria-pressed", "true");
});

test("abrir el login dos veces seguidas no lo deja en blanco", async ({ page }) => {
  const errores = [];
  page.on("pageerror", (e) => errores.push(e.message));
  await page.goto("/index.html");
  await page.evaluate(() => Promise.all([tfAbrirLogin(), tfAbrirLogin()]));
  await expect(page.locator("#tfLoginForm")).toBeVisible();
  expect(errores).toEqual([]);
});
