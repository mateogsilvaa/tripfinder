/* Fechas flexibles: «en marzo», «los findes de marzo», «entre estos dos días».

   Hasta ahora una búsqueda era o una fecha exacta o el horizonte entero, y un
   viaje no se decide así: se decide con unas vacaciones de una semana concreta
   o con un mes en el que libras, y dentro de eso da igual el día.

   Lo que se vigila aquí, además de que el formulario haga lo que dice: que el
   encargo QUEPA. `repository_dispatch` admite diez propiedades de primer nivel
   y las fechas sueltas eran doce; el aviso no lo habría dado GitHub con un 422
   delante de quien pulsó, porque ni siquiera se habría salido a la red. */
const { test, expect } = require("@playwright/test");

const SESION = { uid: "u-p", user: "p", name: "P" };

const conSesion = (page) =>
  page.addInitScript((s) => {
    try {
      localStorage.setItem("tf_sesion", JSON.stringify(s));
      localStorage.setItem("tf_token", "ghp_de_mentira");
    } catch (e) { /* nada */ }
  }, SESION);

/* El índice de búsquedas vacío: si no, la web puede encontrar una ya hecha con
   la misma etiqueta y no lanzar nada, que es correcto pero no es lo que se
   prueba aquí. */
const sinIndice = (page) =>
  page.route("**/data/searches/index.json*", (r) =>
    r.fulfill({ contentType: "application/json", body: '{"searches":[]}' })
  );

async function enBuscar(page) {
  await conSesion(page);
  await sinIndice(page);
  await page.goto("/buscar.html", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#finderForm:not(.candado)", { timeout: 10000 });
}

const lanzar = async (page) => {
  let enviado = null;
  await page.route("**/api.github.com/**", (r) => {
    enviado = JSON.parse(r.request().postData() || "{}");
    return r.fulfill({ status: 204, body: "" });
  });
  return async () => {
    await page.click('[form="finderForm"]');
    await expect
      .poll(() => enviado, { message: "no salió ningún encargo" })
      .not.toBeNull();
    return enviado;
  };
};

test.describe("el formulario", () => {
  test("ofrece las tres maneras de ser flexible", async ({ page }) => {
    await enBuscar(page);
    const opciones = await page.locator("#fWhen option").evaluateAll((os) =>
      os.map((o) => o.value)
    );
    expect(opciones).toEqual(["weekend", "mes", "mes-finde", "tramo", "exact", "anytime"]);
  });

  test("elegir un mes enseña los doce que vienen, con su año", async ({ page }) => {
    await enBuscar(page);
    await expect(page.locator("#mesWrap")).toBeHidden();
    await page.selectOption("#fWhen", "mes");
    await expect(page.locator("#mesWrap")).toBeVisible();
    await expect(page.locator("#fMes option")).toHaveCount(12);
    // El año va puesto: «marzo» a secas es de este año o del siguiente según
    // cuándo lo mires.
    await expect(page.locator("#fMes option").first()).toHaveText(/\d{4}$/);
  });

  test("con un mes elegido sobra el horizonte", async ({ page }) => {
    await enBuscar(page);
    await page.selectOption("#fWhen", "mes");
    // Ya has dicho hasta cuándo: preguntar además «meses vista» es preguntar
    // dos veces lo mismo y que la respuesta pueda contradecirse.
    await expect(page.locator("#monthsWrap")).toBeHidden();
    await page.selectOption("#fWhen", "weekend");
    await expect(page.locator("#monthsWrap")).toBeVisible();
  });

  test("un tramo se marca en el mismo calendario, y lo dice", async ({ page }) => {
    await enBuscar(page);
    await page.selectOption("#fWhen", "tramo");
    await expect(page.locator("#departWrap")).toBeVisible();
    await expect(page.locator("#departRot")).toHaveText("Entre");
    await page.click("#dateBtn");
    await expect(page.locator("#cal")).toBeVisible();
    // Un tramo no tiene vuelta, tiene final: es la ventana en la que puedes
    // viajar, no el billete.
    await page.locator("#cal .dia:not([disabled])").nth(20).click();
    await expect(page.locator("#dateBtn")).toContainText("elige el final");
  });

  test("y en fechas exactas el segundo clic sigue siendo la vuelta", async ({ page }) => {
    await enBuscar(page);
    await page.selectOption("#fWhen", "exact");
    await page.click("#dateBtn");
    await page.locator("#cal .dia:not([disabled])").nth(20).click();
    await expect(page.locator("#dateBtn")).toContainText("elige la vuelta");
  });

  test("un tramo a medias se avisa, no se lanza", async ({ page }) => {
    await enBuscar(page);
    let llamadas = 0;
    await page.route("**/api.github.com/**", (r) => {
      llamadas += 1;
      return r.fulfill({ status: 204, body: "" });
    });
    await page.selectOption("#fWhen", "tramo");
    await page.click("#dateBtn");
    await page.locator("#cal .dia:not([disabled])").nth(20).click();
    await page.click('[form="finderForm"]');
    await expect(page.locator("#finderHint")).toContainText(/los dos extremos/i);
    // Ocho minutos de barrido para descubrir que faltaba una fecha es peor que
    // decirlo ahora.
    expect(llamadas).toBe(0);
  });
});

test.describe("el encargo", () => {
  test("un mes entero manda sus dos extremos y no se limita a findes", async ({ page }) => {
    await enBuscar(page);
    const enviar = await lanzar(page);
    await page.selectOption("#fWhen", "mes");
    const mes = await page.locator("#fMes").inputValue();
    const p = (await enviar()).client_payload;

    expect(p.viaje.desde).toBe(`${mes}-01`);
    // El último día del mes, sea 28, 30 o 31.
    expect(p.viaje.hasta.startsWith(mes)).toBe(true);
    expect(new Date(p.viaje.hasta).getMonth()).toBe(new Date(`${mes}-01`).getMonth());
    expect(p.weekend).toBe("no");
    expect(p.viaje.depart).toBe("");
  });

  test("un mes de findes manda la misma ventana, pero solo findes", async ({ page }) => {
    await enBuscar(page);
    const enviar = await lanzar(page);
    await page.selectOption("#fWhen", "mes-finde");
    const p = (await enviar()).client_payload;
    expect(p.weekend).toBe("si");
    expect(p.viaje.desde).toBeTruthy();
    expect(p.viaje.hasta).toBeTruthy();
  });

  test("un tramo manda los dos días marcados", async ({ page }) => {
    await enBuscar(page);
    const enviar = await lanzar(page);
    await page.selectOption("#fWhen", "tramo");
    await page.click("#dateBtn");
    const dias = page.locator("#cal .dia:not([disabled])");
    await dias.nth(10).click();
    await dias.nth(17).click();
    const p = (await enviar()).client_payload;
    expect(p.viaje.desde).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(p.viaje.hasta > p.viaje.desde).toBe(true);
    // Un tramo NO son fechas exactas: si viajara como `depart`, el backend
    // buscaría ese día y solo ese.
    expect(p.viaje.depart).toBe("");
  });

  test("las fechas exactas siguen yendo como fechas exactas", async ({ page }) => {
    await enBuscar(page);
    const enviar = await lanzar(page);
    await page.selectOption("#fWhen", "exact");
    await page.click("#dateBtn");
    const dias = page.locator("#cal .dia:not([disabled])");
    await dias.nth(10).click();
    await dias.nth(13).click();
    const p = (await enviar()).client_payload;
    expect(p.viaje.depart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(p.viaje.return_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(p.viaje.desde).toBe("");
  });

  test("y un finde cualquiera sigue sin ventana", async ({ page }) => {
    await enBuscar(page);
    const enviar = await lanzar(page);
    const p = (await enviar()).client_payload;
    expect(p.weekend).toBe("si");
    expect(p.viaje.desde).toBe("");
    expect(p.viaje.hasta).toBe("");
  });

  /* GitHub admite diez propiedades de primer nivel. Con `desde` y `hasta`
     sueltas eran doce y el encargo no habría salido nunca. */
  test("cabe en las diez propiedades que admite GitHub", async ({ page }) => {
    await enBuscar(page);
    const enviar = await lanzar(page);
    await page.selectOption("#fWhen", "mes");
    await page.selectOption("#fWhere", "one");
    await page.evaluate(() => (document.querySelector("#fDest").value = "Roma"));
    const p = (await enviar()).client_payload;
    const claves = Object.keys(p);
    expect(claves.length, `mandó ${claves.length}: ${claves.join(", ")}`).toBeLessThanOrEqual(10);
    expect(p.dest).toBe("Roma");
  });

  test("la etiqueta dice el mes, que es como se distingue una búsqueda de otra",
    async ({ page }) => {
      await enBuscar(page);
      const enviar = await lanzar(page);
      await page.selectOption("#fWhen", "mes-finde");
      const nombre = (await page.locator("#fMes").inputValue()).slice(0, 4);
      const p = (await enviar()).client_payload;
      expect(p.label).toContain("findes de");
      expect(p.label).toContain(nombre);
    });
});

/* --------------------------------------------------------- de dónde sales */

test.describe("el origen", () => {
  const abrirBuscar = async (page) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("tf_sesion", JSON.stringify({ uid: "u-p", user: "p", name: "P" }));
        localStorage.setItem("tf_token", "ghp_de_mentira");
      } catch (e) { /* nada */ }
    });
    await page.route("**/data/searches/index.json*", (r) =>
      r.fulfill({ contentType: "application/json", body: '{"searches":[]}' })
    );
    await page.goto("/buscar.html", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#finderForm:not(.candado)", { timeout: 10000 });
  };

  test("se puede elegir, y de casa es Madrid", async ({ page }) => {
    await abrirBuscar(page);
    await expect(page.locator("#fOrigen")).toBeVisible();
    await expect(page.locator("#fOrigen")).toHaveValue("MAD");
    // Y hay de dónde elegir: los aeropuertos españoles, escritos en el módulo
    // para no descargar los 270 KB del listado mundial en la portada.
    expect(await page.locator("#fOrigen option").count()).toBeGreaterThan(20);
  });

  test("y elegir origen NO descarga los 270 KB del listado mundial", async ({ page }) => {
    /* Hay una decisión tomada sobre esto (#19) y una prueba que la defiende en
       `humo.spec.js`: la portada no pide `airports_world.json`. Para elegir
       origen bastan los aeropuertos españoles, que van escritos en el módulo.
       Sin esta prueba, el día que alguien «mejore» la lista cargándola de la
       red, la portada vuelve a pesar medio mega y nadie se entera. */
    const pedidos = [];
    page.on("request", (r) => pedidos.push(new URL(r.url()).pathname));
    await abrirBuscar(page);
    await expect(page.locator("#fOrigen option").nth(5)).toBeAttached();
    expect(pedidos.filter((p) => p.endsWith("airports_world.json"))).toEqual([]);
  });

  test("Madrid va primero, que es de donde sale el barrido", async ({ page }) => {
    await abrirBuscar(page);
    await expect(page.locator("#fOrigen option").first()).toHaveText(/Madrid/);
  });

  test("el encargo lo lleva, agrupado con el viaje", async ({ page }) => {
    // Suelto sería la undécima propiedad de primer nivel y GitHub admite diez.
    await abrirBuscar(page);
    let enviado = null;
    await page.route("**/api.github.com/**", (r) => {
      enviado = JSON.parse(r.request().postData() || "{}");
      return r.fulfill({ status: 204, body: "" });
    });
    await page.selectOption("#fOrigen", "BCN");
    await page.click('[form="finderForm"]');
    await expect.poll(() => enviado, { timeout: 10000 }).not.toBeNull();
    expect(enviado.client_payload.viaje.origin).toBe("BCN");
    expect(Object.keys(enviado.client_payload).length).toBeLessThanOrEqual(10);
  });

  test("y la etiqueta lo dice cuando no es Madrid", async ({ page }) => {
    // Un precio sin origen no se puede leer.
    await abrirBuscar(page);
    let enviado = null;
    await page.route("**/api.github.com/**", (r) => {
      enviado = JSON.parse(r.request().postData() || "{}");
      return r.fulfill({ status: 204, body: "" });
    });
    await page.selectOption("#fOrigen", "AGP");
    await page.click('[form="finderForm"]');
    await expect.poll(() => enviado, { timeout: 10000 }).not.toBeNull();
    expect(enviado.client_payload.label).toContain("desde AGP");
  });

  test("desde Madrid la etiqueta no repite lo de siempre", async ({ page }) => {
    await abrirBuscar(page);
    let enviado = null;
    await page.route("**/api.github.com/**", (r) => {
      enviado = JSON.parse(r.request().postData() || "{}");
      return r.fulfill({ status: 204, body: "" });
    });
    await page.click('[form="finderForm"]');
    await expect.poll(() => enviado, { timeout: 10000 }).not.toBeNull();
    expect(enviado.client_payload.label).not.toContain("desde");
  });
});
