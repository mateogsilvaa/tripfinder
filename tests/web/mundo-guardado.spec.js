/* Que el mapa no se pierda, y que se pueda ver el de los demás.

   Antes vivía solo en `localStorage`: cambiabas de navegador o limpiabas el
   historial y se iba un mapa que había costado un rato marcar. Ahora se guarda
   también en la cuenta —o sea, en el repositorio, que es la única base de datos
   que hay aquí— y eso es justo lo que permite mirar el de otro.

   Lo que se vigila: que gane el más reciente y no una mezcla de los dos, que
   marcar veinte países no sean veinte workflows, y que el mapa de otro se mire
   y no se toque. */
const { test, expect } = require("@playwright/test");

const SESION = { uid: "u-guarda1", user: "p", name: "P" };
const NUEVO = Date.now(); // más nuevo que cualquier fecha del fixture
const VIEJO = Date.parse("2026-01-01T00:00:00Z");

/* Con token: sin él, `tfDispatch` corta antes de llegar a la red y no habría
   nada que mirar. */
const conCuenta = (page, local = null) =>
  page.addInitScript(
    ([s, l]) => {
      try {
        localStorage.setItem("tf_sesion", JSON.stringify(s));
        localStorage.setItem("tf_token", "ghp_de_mentira");
        // Se siembra SOLO SI NO HAY NADA: `addInitScript` corre en cada
        // navegación y replantar el fixture borraría lo que se acaba de guardar.
        if (l && !localStorage.getItem(`tf_mundo:${s.uid}`)) {
          localStorage.setItem(`tf_mundo:${s.uid}`, JSON.stringify(l));
        }
      } catch (e) { /* nada */ }
    },
    [SESION, local]
  );

/* Los encargos que salen a GitHub, sin salir de aquí. */
async function espiar(page) {
  const enviados = [];
  await page.route("**/api.github.com/**", (r) => {
    enviados.push(JSON.parse(r.request().postData() || "{}"));
    return r.fulfill({ status: 204, body: "" });
  });
  return enviados;
}

const abierto = async (page) => {
  await page.goto("/mapa.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#mundo svg path[data-iso]").first()).toBeVisible({ timeout: 15000 });
};

const marcados = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("path[data-iso].visitado")].map((p) => p.dataset.iso).sort()
  );

const marcar = (page, iso) => page.click(`.pais-chip[data-ir="${iso}"]`);

test.describe("el mapa se guarda en la cuenta", () => {
  test("al abrir en un navegador nuevo, vuelve el mapa guardado", async ({ page }) => {
    // Esto es el caso que no funcionaba: aquí no hay nada en `localStorage` y
    // el mapa estaba solo ahí.
    await conCuenta(page);
    await abierto(page);
    await expect.poll(() => marcados(page)).toEqual(["ES", "PT"]);
    await expect(page.locator("#mundoNota")).toContainText(/recuperado de tu cuenta/i);
  });

  test("si lo de este navegador es más nuevo, manda lo de aquí", async ({ page }) => {
    // Y no una mezcla: la unión resucitaría el país que acabas de desmarcar en
    // el otro dispositivo, y volvería solo sin que nadie lo pidiera.
    await conCuenta(page, { p: ["FR"], t: NUEVO });
    const enviados = await espiar(page);
    await abierto(page);
    await expect.poll(() => marcados(page)).toEqual(["FR"]);
    await expect.poll(() => enviados.length, { timeout: 10000 }).toBe(1);
    expect(enviados[0].client_payload.paises).toBe("FR");
  });

  test("si lo guardado es más nuevo, manda lo guardado", async ({ page }) => {
    await conCuenta(page, { p: ["FR"], t: VIEJO });
    await abierto(page);
    await expect.poll(() => marcados(page)).toEqual(["ES", "PT"]);
  });

  test("el mapa de siempre, sin fecha, no pisa lo guardado", async ({ page }) => {
    // El formato viejo era la lista a secas. No se sabe de cuándo es, así que
    // pierde contra algo fechado — pero se sigue leyendo: si no, el primero que
    // abriera esto tras el cambio se encontraría el mapa en blanco.
    await conCuenta(page, ["FR", "DE"]);
    await abierto(page);
    await expect.poll(() => marcados(page)).toEqual(["ES", "PT"]);
  });

  test("marcar varios países es UN solo encargo, con el mapa entero", async ({ page }) => {
    // Cada encargo es un workflow y un commit: veinte clics no pueden ser
    // veinte despliegues.
    await conCuenta(page, { p: [], t: NUEVO });
    const enviados = await espiar(page);
    await abierto(page);
    await marcar(page, "FR");
    await marcar(page, "IT");
    await marcar(page, "JP");
    await expect.poll(() => enviados.length, { timeout: 10000 }).toBe(1);
    const p = enviados[0].client_payload;
    expect(p.accion).toBe("set");
    expect(p.owner).toBe(SESION.uid);
    expect(p.paises).toBe("FR,IT,JP");
  });

  test("y lo marcado se queda aquí aunque el encargo falle", async ({ page }) => {
    await conCuenta(page, { p: [], t: NUEVO });
    await page.route("**/api.github.com/**", (r) => r.fulfill({ status: 403, body: "{}" }));
    await abierto(page);
    await marcar(page, "FR");
    await expect(page.locator("#mundoNota")).toContainText(/sigue en este navegador/i, {
      timeout: 10000,
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect.poll(() => marcados(page)).toContain("FR");
  });

  test("apagar el interruptor borra lo publicado", async ({ page }) => {
    await conCuenta(page, { p: ["FR"], t: NUEVO });
    const enviados = await espiar(page);
    await abierto(page);
    await page.locator(".switch", { hasText: "Guardarlo en mi cuenta" }).click();
    await expect.poll(() => enviados.some((e) => e.client_payload.accion === "clear"), {
      timeout: 10000,
    }).toBe(true);
    // Y lo dice con las palabras que son, sin prometer lo que no hay.
    await expect(page.locator("#mundoNota")).toContainText(/solo en este navegador/i);
  });

  test("con el interruptor apagado no sale ningún encargo", async ({ page }) => {
    await conCuenta(page, { p: ["FR"], t: NUEVO });
    await page.addInitScript(() => {
      try {
        localStorage.setItem("tf_mundo_local:u-guarda1", "si");
      } catch (e) { /* nada */ }
    });
    const enviados = await espiar(page);
    await abierto(page);
    await marcar(page, "IT");
    await page.waitForTimeout(4000);
    expect(enviados).toEqual([]);
    // Pero el mapa sigue funcionando entero.
    await expect.poll(() => marcados(page)).toEqual(["FR", "IT"]);
  });

  test("y dice que guardarlo es publicarlo, no otra cosa", async ({ page }) => {
    await conCuenta(page);
    await abierto(page);
    await expect(page.locator("#mundoNota")).toContainText(/repositorio/i);
    await expect(page.locator("#mundoNota")).toContainText(/los demás pueden verlo/i);
  });
});

test.describe("el mapa de los demás", () => {
  test("el selector ofrece a los otros, no a ti", async ({ page }) => {
    await conCuenta(page);
    await abierto(page);
    const opciones = await page.locator("#mundoQuien option").allTextContents();
    expect(opciones[0]).toBe("El mío");
    expect(opciones.join(" ")).toContain("Marta");
    expect(opciones).toHaveLength(2);
  });

  test("elegir a alguien pinta SU mapa", async ({ page }) => {
    await conCuenta(page, { p: ["FR"], t: NUEVO });
    await abierto(page);
    await page.selectOption("#mundoQuien", "u-marta2");
    await expect.poll(() => marcados(page)).toEqual(["ES", "IT", "JP", "MA"]);
    await expect(page.locator("#mundo")).toHaveClass(/ajeno/);
  });

  test("y dice cuántos tiene que a ti te faltan", async ({ page }) => {
    // Lo que de verdad se quiere saber al mirar el mapa de otro no es cuántos
    // lleva, es en cuántos ha estado que tú no.
    await conCuenta(page, { p: ["ES"], t: NUEVO });
    await abierto(page);
    await page.selectOption("#mundoQuien", "u-marta2");
    const txt = page.locator("#mundoComparar");
    await expect(txt).toBeVisible();
    await expect(txt).toContainText("Marta");
    await expect(txt).toContainText("4 países");
    await expect(txt).toContainText("3 no los tienes");
  });

  test("el mapa de otro se mira y no se marca", async ({ page }) => {
    await conCuenta(page, { p: ["FR"], t: NUEVO });
    const enviados = await espiar(page);
    await abierto(page);
    await page.selectOption("#mundoQuien", "u-marta2");
    await expect.poll(() => marcados(page)).toEqual(["ES", "IT", "JP", "MA"]);
    // Al abrir sale UN encargo: lo de este navegador era más nuevo que lo
    // guardado, así que se sube. Ese es el único que puede haber.
    await expect.poll(() => enviados.length, { timeout: 10000 }).toBe(1);
    await marcar(page, "DE");
    await expect(page.locator("#mundoNota")).toContainText(/vuelve al tuyo/i);
    await page.waitForTimeout(4000);
    // Lo importante no es el aviso: es que el mapa de Marta no acabe en TU
    // fichero. Ni un encargo más, y el que hubo llevaba lo tuyo.
    expect(enviados).toHaveLength(1);
    expect(enviados[0].client_payload.paises).toBe("FR");
    await expect.poll(() => marcados(page)).toEqual(["ES", "IT", "JP", "MA"]);
  });

  test("los botones que escriben en tu mapa se apagan", async ({ page }) => {
    await conCuenta(page, { p: ["FR"], t: NUEVO });
    await abierto(page);
    await page.selectOption("#mundoQuien", "u-marta2");
    await expect(page.locator("#mundoGuardar")).toBeDisabled();
    await expect(page.locator("#mundoBorrar")).toBeDisabled();
  });

  test("volver al mío devuelve el mío", async ({ page }) => {
    await conCuenta(page, { p: ["FR"], t: NUEVO });
    await abierto(page);
    await page.selectOption("#mundoQuien", "u-marta2");
    await expect.poll(() => marcados(page)).toEqual(["ES", "IT", "JP", "MA"]);
    await page.selectOption("#mundoQuien", "");
    await expect.poll(() => marcados(page)).toEqual(["FR"]);
    await expect(page.locator("#mundoGuardar")).toBeEnabled();
    await expect(page.locator("#mundoComparar")).toBeHidden();
  });

  test("un mapa que ya no está se dice, y no deja la pantalla a medias", async ({ page }) => {
    await conCuenta(page, { p: ["FR"], t: NUEVO });
    await page.route("**/data/mundos/u-marta2.json*", (r) => r.fulfill({ status: 404, body: "" }));
    await abierto(page);
    await page.selectOption("#mundoQuien", "u-marta2");
    await expect(page.locator("#mundoNota")).toContainText(/ya no está guardado/i);
    await expect(page.locator("#mundoQuien")).toHaveValue("");
    await expect.poll(() => marcados(page)).toEqual(["FR"]);
  });

  test("si nadie más ha guardado el suyo, el selector no sale", async ({ page }) => {
    // Un desplegable con una sola opción es una pregunta que no se puede
    // contestar.
    await page.route("**/data/mundos/index.json*", (r) =>
      r.fulfill({ contentType: "application/json", body: '{"mundos":[]}' })
    );
    await conCuenta(page);
    await abierto(page);
    await expect(page.locator(".mundo-quien")).toBeHidden();
  });
});
