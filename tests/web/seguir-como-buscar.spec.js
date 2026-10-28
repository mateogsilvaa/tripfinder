/* Seguir tiene las mismas preguntas que buscar, y los días de la semana se
   eligen tocando la semana.

   Lo que se pidió: «que lo de seguir vuelos tenga las mismas opciones de
   selección que buscar. Y mejora la interfaz en la selección de días de
   semana». */
const { test, expect } = require("@playwright/test");

const conSesion = (page) =>
  page.addInitScript(() => {
    try {
      localStorage.setItem("tf_sesion", JSON.stringify({ uid: "u-s", user: "s", name: "S" }));
      localStorage.setItem("tf_token", "ghp_de_mentira");
    } catch (e) {
      /* nada */
    }
  });

const capturar = async (page) => {
  const enviados = [];
  await page.route("**/api.github.com/**", (r) => {
    enviados.push(JSON.parse(r.request().postData() || "{}"));
    return r.fulfill({ status: 204, body: "" });
  });
  return enviados;
};

const opciones = (page, sel) =>
  page.locator(`${sel} option`).evaluateAll((os) => os.map((o) => o.value));

test("seguir ofrece lo mismo que buscar: origen y las siete maneras de decir cuándo", async ({ page }) => {
  await page.goto("/buscar.html");
  const cuandoBuscar = await opciones(page, "#fWhen");
  const origenesBuscar = await opciones(page, "#fOrigen");
  await page.goto("/seguimientos.html");
  expect(await opciones(page, "#wWhen")).toEqual(cuandoBuscar);
  expect(await opciones(page, "#wOrigen")).toEqual(origenesBuscar);
});

test("seguir los findes de un mes desde Valencia lo apunta así", async ({ page }) => {
  await conSesion(page);
  const enviados = await capturar(page);
  await page.goto("/seguimientos.html", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#watchForm:not(.candado)", { timeout: 10000 });
  await page.selectOption("#wOrigen", "VLC");
  await page.selectOption("#wWhen", "mes-finde");
  await expect(page.locator("#wMesWrap")).toBeVisible();
  await expect(page.locator("#wMonthsWrap")).toBeHidden();
  await page.click('[form="watchForm"]');
  await expect.poll(() => enviados.length).toBe(1);
  const p = enviados[0].client_payload;
  expect(Object.keys(p).length).toBeLessThanOrEqual(10);
  expect(p.viaje.origin).toBe("VLC");
  expect(p.viaje.weekend).toBe("si");
  expect(p.viaje.desde).toMatch(/^\d{4}-\d{2}-01$/);
  expect(p.viaje.hasta > p.viaje.desde).toBe(true);
  expect(p.label).toContain("desde VLC");
  expect(p.label).toContain("findes de");
});

test("y unos días de la semana, tocando la semana", async ({ page }) => {
  await conSesion(page);
  const enviados = await capturar(page);
  await page.goto("/seguimientos.html", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#watchForm:not(.candado)", { timeout: 10000 });
  await page.selectOption("#wWhen", "dias");
  const semana = page.locator("#wDiasWrap .sem7");
  await expect(semana).toBeVisible();
  await semana.locator('[data-dia="3"]').click();
  await expect(semana.locator(".sem7-resumen")).toContainText("Ahora toca el día de vuelta");
  await semana.locator('[data-dia="6"]').click();
  await expect(semana.locator(".sem7-resumen")).toContainText("jueves");
  await expect(semana.locator(".sem7-resumen")).toContainText("3 noches");
  await expect(semana.locator('[data-dia="4"]')).toHaveClass(/dentro/);
  await page.click('[form="watchForm"]');
  await expect.poll(() => enviados.length).toBe(1);
  expect(enviados[0].client_payload.viaje.dias).toBe("3-6");
  expect(enviados[0].client_payload.label).toContain("jue → dom");
});

test.describe("la semana en buscar", () => {
  test("los atajos ponen los dos días y cuentan las noches", async ({ page }) => {
    await conSesion(page);
    await page.goto("/buscar.html");
    await page.waitForSelector("#finderForm:not(.candado)", { timeout: 10000 });
    await page.selectOption("#fWhen", "dias");
    const semana = page.locator("#diasWrap .sem7");
    await expect(semana).toBeVisible();
    // De casa, de lunes a jueves.
    await expect(semana.locator('[data-atajo="0-3"]')).toHaveAttribute("aria-pressed", "true");
    await semana.locator('[data-atajo="4-0"]').click();
    await expect(page.locator("#fDiaIda")).toHaveValue("4");
    await expect(page.locator("#fDiaVuelta")).toHaveValue("0");
    await expect(semana.locator(".sem7-resumen")).toContainText("3 noches");
    // Viernes → lunes pasa por el sábado y el domingo.
    await expect(semana.locator('[data-dia="5"]')).toHaveClass(/dentro/);
    await expect(semana.locator('[data-dia="6"]')).toHaveClass(/dentro/);
  });

  test("si el desplegable cambia por otro lado, la semana lo sigue", async ({ page }) => {
    await conSesion(page);
    await page.goto("/buscar.html");
    await page.waitForSelector("#finderForm:not(.candado)", { timeout: 10000 });
    await page.selectOption("#fWhen", "dias");
    await page.selectOption("#fDiaVuelta", "4");
    await expect(page.locator('#diasWrap [data-dia="4"]')).toHaveClass(/vuelta/);
  });
});
