/* Organizar el finde: fechas y sitio concretos, y que te monte las dos mitades.

   Hasta ahora había que encadenarlo a mano: lanzar la búsqueda, esperar ocho
   minutos, abrir el mejor viaje y pedir el alojamiento, esperar otros tres. Dos
   workflows disparados por una persona que tiene que acordarse del segundo.

   Ahora sale en el mismo encargo, y el alojamiento se busca para el MEJOR vuelo
   que haya salido — que es el único cuyas fechas están decididas.

   Lo que se prueba aquí es sobre todo CUÁNDO se ofrece: con «donde sea» no hay
   ciudad y con fechas flexibles no hay fechas, así que ofrecerlo sería ofrecer
   algo que no puede funcionar. */
const { test, expect } = require("@playwright/test");

const SESION = { uid: "u-p", user: "p", name: "P" };

const abrir = async (page) => {
  await page.addInitScript((s) => {
    try {
      localStorage.setItem("tf_sesion", JSON.stringify(s));
      localStorage.setItem("tf_token", "ghp_de_mentira");
    } catch (e) { /* nada */ }
  }, SESION);
  await page.route("**/data/searches/index.json*", (r) =>
    r.fulfill({ contentType: "application/json", body: '{"searches":[]}' })
  );
  await page.goto("/buscar.html", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#finderForm:not(.candado)", { timeout: 10000 });
};

/* Un destino y unas fechas exactas, que es el único caso donde esto se ofrece. */
const concretar = async (page) => {
  await page.selectOption("#fWhere", "one");
  await page.evaluate(() => (document.querySelector("#fDest").value = "Roma"));
  await page.selectOption("#fWhen", "exact");
  await page.click("#dateBtn");
  const dias = page.locator("#cal .dia:not([disabled])");
  await dias.nth(10).click();
  await dias.nth(13).click();
};

const espiar = async (page) => {
  const enviados = [];
  await page.route("**/api.github.com/**", (r) => {
    enviados.push(JSON.parse(r.request().postData() || "{}"));
    return r.fulfill({ status: 204, body: "" });
  });
  return enviados;
};

test.describe("cuándo se ofrece", () => {
  test("con sitio y fechas concretas, sí", async ({ page }) => {
    await abrir(page);
    await concretar(page);
    await expect(page.locator("#camasWrap")).toBeVisible();
  });

  test("con «donde sea» no: no hay ciudad donde dormir", async ({ page }) => {
    await abrir(page);
    await concretar(page);
    await page.selectOption("#fWhere", "any");
    await expect(page.locator("#camasWrap")).toBeHidden();
  });

  test("con fechas flexibles no: todavía no hay fechas", async ({ page }) => {
    await abrir(page);
    await concretar(page);
    await page.selectOption("#fWhen", "mes");
    await expect(page.locator("#camasWrap")).toBeHidden();
  });

  test("y al esconderse se desmarca, no se queda puesto a escondidas", async ({ page }) => {
    // Si no, quedaría activado sin que se vea y saldría en el encargo.
    await abrir(page);
    await concretar(page);
    await page.locator(".switch", { hasText: "dónde dormir" }).click();
    await expect(page.locator("#fCamas")).toBeChecked();
    await page.selectOption("#fWhen", "anytime");
    await expect(page.locator("#fCamas")).not.toBeChecked();
  });
});

test.describe("el encargo", () => {
  test("marcado, lo pide", async ({ page }) => {
    await abrir(page);
    const enviados = await espiar(page);
    await concretar(page);
    await page.locator(".switch", { hasText: "dónde dormir" }).click();
    await page.click('[form="finderForm"]');
    await expect.poll(() => enviados.length, { timeout: 10000 }).toBe(1);
    const p = enviados[0].client_payload;
    expect(p.viaje.camas).toBe("si");
    // Y sigue cabiendo en las diez propiedades que admite GitHub.
    expect(Object.keys(p).length).toBeLessThanOrEqual(10);
  });

  test("sin marcar, no", async ({ page }) => {
    await abrir(page);
    const enviados = await espiar(page);
    await concretar(page);
    await page.click('[form="finderForm"]');
    await expect.poll(() => enviados.length, { timeout: 10000 }).toBe(1);
    expect(enviados[0].client_payload.viaje.camas).toBe("");
  });

  test("y se dice que son dos esperas, no una", async ({ page }) => {
    // Ocho minutos de vuelos más tres de alojamiento. Callarlo es dejar a
    // alguien mirando una pantalla que parece acabada y no lo está.
    await abrir(page);
    await espiar(page);
    await concretar(page);
    await page.locator(".switch", { hasText: "dónde dormir" }).click();
    await page.click('[form="finderForm"]');
    await expect(page.locator("#tfAviso, [role=status], .lanzada-hora").first()).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator("body")).toContainText(/después el alojamiento/i);
  });
});

/* La casilla viaja de la portada a la herramienta. Un `checkbox` tiene `value`
   («on») pase lo que pase, así que leerlo con `.value` la llevaba activada
   SIEMPRE, incluso sin marcarla: te buscaba alojamiento sin pedirlo. */
test.describe("de la portada a la herramienta", () => {
  /* Se intercepta la navegación en vez de dejarla ir: lo que interesa es la
     dirección que se abre, y al llegar `recogerAmpliado` limpia la URL. */
  const direccion = async (page, marcar) => {
    await page.addInitScript((s) => {
      try {
        localStorage.setItem("tf_sesion", JSON.stringify(s));
        localStorage.setItem("tf_token", "ghp_de_mentira");
      } catch (e) { /* nada */ }
    }, SESION);
    let url = "";
    await page.route("**/buscar.html?*", (r) => {
      url = r.request().url();
      return r.fulfill({ contentType: "text/html", body: "<p>ok</p>" });
    });
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#finderForm:not(.candado)", { timeout: 10000 });
    await page.selectOption("#fWhere", "one");
    await page.evaluate(() => (document.querySelector("#fDest").value = "Roma"));
    await page.selectOption("#fWhen", "exact");
    if (marcar) await page.locator(".switch", { hasText: "dónde dormir" }).click();
    await page.click('[form="finderForm"]');
    await expect.poll(() => url, { timeout: 10000 }).not.toBe("");
    return decodeURIComponent(url);
  };

  test("marcada, viaja marcada", async ({ page }) => {
    expect(await direccion(page, true)).toContain("camas=1");
  });

  test("sin marcar, no viaja", async ({ page }) => {
    expect(await direccion(page, false)).not.toContain("camas");
  });
});
