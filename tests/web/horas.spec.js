/* Las horas que prefieres, en buscar y en seguir.

   Lo que se pidió: «poder regular la hora de salida y llegadas si tienes
   preferencia, en el buscador y seguidor de vuelos». */
const { test, expect } = require("@playwright/test");

const conSesion = (page) =>
  page.addInitScript(() => {
    try {
      localStorage.setItem("tf_sesion", JSON.stringify({ uid: "u-h", user: "h", name: "H" }));
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

for (const [pagina, pref, form] of [
  ["/buscar.html", "f", "finderForm"],
  ["/seguimientos.html", "w", "watchForm"],
]) {
  test(`${pagina}: sin tocar nada, me da igual y no se manda franja`, async ({ page }) => {
    await conSesion(page);
    const enviados = await capturar(page);
    await page.goto(pagina, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(`#${form}:not(.candado)`, { timeout: 10000 });
    await expect(page.locator(`#${pref}HorasWrap .horas-resumen`)).toHaveText("me da igual");
    await page.click(`[form="${form}"]`);
    await expect.poll(() => enviados.length).toBe(1);
    expect(enviados[0].client_payload.viaje.horas).toBe("");
  });

  test(`${pagina}: salir por la mañana y volver por la tarde viaja con el encargo`, async ({ page }) => {
    await conSesion(page);
    const enviados = await capturar(page);
    await page.goto(pagina, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(`#${form}:not(.candado)`, { timeout: 10000 });
    const horas = page.locator(`#${pref}HorasWrap .horas`);
    await horas.locator("summary").click();
    await horas.locator('[data-tramo="0"] [data-franja="6-12"]').click();
    await horas.locator('[data-tramo="2"] [data-franja="16-21"]').click();
    // Y la llegada de la vuelta, a mano: antes de las 23.
    await horas.locator('[data-tramo="3"] [data-franja="otra"]').click();
    await horas.locator('[data-tramo="3"] [data-desde]').selectOption("15");
    await horas.locator('[data-tramo="3"] [data-hasta]').selectOption("23");
    await expect(horas.locator(".horas-resumen")).toContainText("sale por la mañana");
    await expect(horas.locator(".horas-resumen")).toContainText("vuelve por la tarde");
    await page.click(`[form="${form}"]`);
    await expect.poll(() => enviados.length).toBe(1);
    const p = enviados[0].client_payload;
    expect(p.viaje.horas).toBe("6-12,,16-21,15-23");
    expect(p.label).toContain("sale por la mañana");
    expect(Object.keys(p).length).toBeLessThanOrEqual(10);
  });
}

test("desde la portada, las horas llegan a la herramienta entera", async ({ page }) => {
  await conSesion(page);
  await page.goto("/buscar.html?horas=6-12%2C%2C%2C", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#fHorasWrap .horas-resumen")).toHaveText("sale por la mañana");
});
