/* La rejilla de los formularios, sin huecos. Con «Donde sea» y «Un finde
   cualquiera» quedaban tres celdas a la vista en una rejilla de dos columnas:
   «¿Cuándo?» se quedaba sola con un hueco al lado que parecía una celda rota. */
const { test, expect } = require("@playwright/test");

const anchos = (page, sel) =>
  page.locator(`${sel} > :not([hidden]):not(.party):not(.horas-wrap)`).evaluateAll((els) =>
    els.map((e) => Math.round(e.getBoundingClientRect().width))
  );

const conSesion = (page) =>
  page.addInitScript(() => {
    try {
      localStorage.setItem("tf_sesion", JSON.stringify({ uid: "u-r", user: "r", name: "R" }));
    } catch (e) { /* nada */ }
  });

/* Por debajo de 900 px el formulario es la rejilla de dos columnas. */
test("la última celda sola ocupa la fila entera, y deja de hacerlo cuando ya no está sola", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 900 });
  // Con sesión: sin ella el formulario sale apagado y no se puede cambiar.
  await page.addInitScript(() => {
    try {
      localStorage.setItem("tf_sesion", JSON.stringify({ uid: "u-r", user: "r", name: "R" }));
    } catch (e) { /* nada */ }
  });
  await page.goto("/buscar.html");
  const form = await page.locator("#finderForm").boundingBox();
  // Sea cual sea el número de celdas: si es impar, la última ocupa la fila
  // entera; si es par, ninguna pasa de media fila.
  const cuadra = async () => {
    const w = await anchos(page, "#finderForm");
    if (w.length % 2) expect(w[w.length - 1]).toBeGreaterThan(form.width - 4);
    else expect(Math.max(...w)).toBeLessThan(form.width / 2 + 4);
    return w.length;
  };
  // Donde sea y un finde: origen, a dónde, por dónde y cuándo.
  const antes = await cuadra();
  // Con «Un mes entero» aparece el mes: una celda más, y sigue sin huecos.
  await page.selectOption("#fWhen", "mes");
  expect(await cuadra()).toBe(antes + 1);
  // Y con un sitio concreto, «¿Por dónde?» se va y entra el destino.
  await page.selectOption("#fWhere", "one");
  await cuadra();
});

/* En el ordenador, los campos van en fila, como en cualquier buscador de
   vuelos, y no uno debajo de otro. */
test("en el ordenador los campos van en fila, no en columna", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await conSesion(page);
  for (const [pagina, form] of [["/buscar.html", "#finderForm"], ["/seguimientos.html", "#watchForm"]]) {
    await page.goto(pagina);
    const arriba = await page
      .locator(`${form} > label:not([hidden])`)
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    // Origen, a dónde y cuándo: los tres en la misma línea.
    expect(new Set(arriba.slice(0, 3)).size, `${pagina}: ${arriba}`).toBe(1);
  }
});
