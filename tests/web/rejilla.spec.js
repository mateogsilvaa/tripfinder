/* La rejilla de los formularios, sin huecos. Con «Donde sea» y «Un finde
   cualquiera» quedaban tres celdas a la vista en una rejilla de dos columnas:
   «¿Cuándo?» se quedaba sola con un hueco al lado que parecía una celda rota. */
const { test, expect } = require("@playwright/test");

const anchos = (page, sel) =>
  page.locator(`${sel} > :not([hidden]):not(.party)`).evaluateAll((els) =>
    els.map((e) => Math.round(e.getBoundingClientRect().width))
  );

test("la última celda sola ocupa la fila entera, y deja de hacerlo cuando ya no está sola", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  // Con sesión: sin ella el formulario sale apagado y no se puede cambiar.
  await page.addInitScript(() => {
    try {
      localStorage.setItem("tf_sesion", JSON.stringify({ uid: "u-r", user: "r", name: "R" }));
    } catch (e) { /* nada */ }
  });
  await page.goto("/buscar.html");
  const form = await page.locator("#finderForm").boundingBox();
  let w = await anchos(page, "#finderForm");
  expect(w.length % 2).toBe(1);
  expect(w[w.length - 1]).toBeGreaterThan(form.width - 4);

  // Con «Un mes entero» aparece el mes: cuatro celdas, dos filas completas.
  await page.selectOption("#fWhen", "mes");
  w = await anchos(page, "#finderForm");
  expect(w.length % 2).toBe(0);
  expect(Math.max(...w)).toBeLessThan(form.width / 2 + 4);
});
