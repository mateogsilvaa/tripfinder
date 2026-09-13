/* La búsqueda que acaba de terminar, y la hoja de alojamiento mientras busca.

   Los dos estados que faltaban del tercer handoff. El primero es el que más se
   notaba: un barrido «donde sea» son ocho minutos, y el final de esos ocho
   minutos era que una barra de progreso desaparecía y la búsqueda se colaba
   entre las guardadas de hace tres días, sin decir si había salido algo. */
const { test, expect } = require("@playwright/test");

const UID = "u-mateo";
const SESION = { uid: UID, user: "mateo", name: "Mateo" };
const SLUG = "mad-roma-1311-260-2p";
const LABEL = "Roma · 13-15 nov · hasta 260 € · 2 pers.";

const oferta = (iata, ciudad, cia, precio) => ({
  provider: "google", origin: "MAD", destination: iata, destination_name: ciudad,
  depart_date: "2026-11-13", return_date: "2026-11-15", airline: cia,
  price: precio, price_per_person: precio / 2, currency: "EUR", adults: 2,
  nights: 2, id: `g-${iata}-${precio}`, deep_link: "https://example.com",
  weekend: true, useful_hours: 44,
});

const OFERTAS = [
  oferta("FCO", "Roma", "Ryanair", 192),
  oferta("BLQ", "Bolonia", "Vueling", 216),
  oferta("NAP", "Nápoles", "Wizz Air", 248),
  oferta("MXP", "Milán", "Ryanair", 256),
];

const ENTRADA = {
  slug: SLUG, label: LABEL, count: OFERTAS.length, generated_at: "2026-09-13",
  best_price: 192, owner: UID, owner_name: "",
};

/* La búsqueda estaba lanzada y acaba de aparecer en el índice: es justo la
   vuelta en la que termina. */
const recienTerminada = async (page, { enIndice = true, hace = 0 } = {}) => {
  await page.addInitScript(([s, label, uid, desde]) => {
    try {
      localStorage.setItem("tf_sesion", JSON.stringify(s));
      localStorage.setItem(
        `tf_pendientes:${uid}`,
        JSON.stringify([{ label, desde }])
      );
    } catch (e) { /* nada */ }
  }, [SESION, LABEL, UID, Date.now() - 4 * 60000 - hace]);

  await page.route("**/data/searches/index.json*", (r) =>
    r.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ searches: enIndice ? [ENTRADA] : [] }),
    })
  );
  await page.route(`**/data/searches/${SLUG}.json*`, (r) =>
    r.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        slug: SLUG, label: LABEL, count: OFERTAS.length,
        generated_at: "2026-09-13",
        request: { max_price: 260, adults: 2, label: LABEL, slug: SLUG },
        offers: OFERTAS,
      }),
    })
  );
};

test.describe("la búsqueda que acaba de terminar", () => {
  test("sale una ficha con lo que ha salido, no solo una fila más", async ({ page }) => {
    await recienTerminada(page);
    await page.goto("/buscar.html", { waitUntil: "domcontentloaded" });
    const ficha = page.locator(".terminada");
    await expect(ficha).toBeVisible();
    await expect(ficha).toContainText(LABEL);
    await expect(ficha).toContainText("4 viajes");
    await expect(ficha).toContainText("desde 192 €");
  });

  test("enseña los tres más baratos, con su compartir", async ({ page }) => {
    await recienTerminada(page);
    await page.goto("/buscar.html", { waitUntil: "domcontentloaded" });
    const filas = page.locator(".term-fila");
    // Tres, no cuatro: la ficha es un resumen, la lista entera está debajo.
    await expect(filas).toHaveCount(3);
    await expect(filas.first()).toContainText("Roma");
    await expect(filas.first()).toContainText("FCO");
    await expect(filas.first()).toContainText("192 €");
    await expect(filas.first().locator("[data-share]")).toBeVisible();
  });

  /* El diseño pide «3 dentro de tu tope» y no se puede decir: el barrido filtra
     por el tope ANTES de guardar, así que dentro del fichero están todos dentro
     siempre y la cifra sería igual al total. Se dice el aire que ha quedado. */
  test("dice cuánto aire ha quedado bajo el tope, no cuántos caben", async ({ page }) => {
    await recienTerminada(page);
    await page.goto("/buscar.html", { waitUntil: "domcontentloaded" });
    const ficha = page.locator(".terminada");
    await expect(ficha).toContainText("68 € por debajo de tu tope");
    await expect(ficha).not.toContainText("dentro de tu tope");
  });

  test("abrirla la retira y despliega la búsqueda guardada", async ({ page }) => {
    await recienTerminada(page);
    await page.goto("/buscar.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".terminada")).toBeVisible();
    await page.locator("[data-term-abrir]").click();
    await expect(page.locator(".terminada")).toHaveCount(0);
    await expect(
      page.locator(`.saved[data-slug="${SLUG}"] .saved-rows`)
    ).toBeVisible();
  });

  /* Una búsqueda borrada no puede seguir anunciando su final: la ficha se
     apoya en el índice, no en lo que quedó apuntado en el navegador. */
  test("si ya no está en el índice, no hay ficha", async ({ page }) => {
    await page.addInitScript(([s, slug, label, uid]) => {
      try {
        localStorage.setItem("tf_sesion", JSON.stringify(s));
        localStorage.setItem(
          `tf_terminadas:${uid}`,
          JSON.stringify([{ label, slug, cuando: Date.now() }])
        );
      } catch (e) { /* nada */ }
    }, [SESION, SLUG, LABEL, UID]);
    await page.route("**/data/searches/index.json*", (r) =>
      r.fulfill({ contentType: "application/json", body: '{"searches":[]}' })
    );
    await page.goto("/buscar.html", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    await expect(page.locator(".terminada")).toHaveCount(0);
  });

  test("y caduca: a la hora ya no sale", async ({ page }) => {
    await page.addInitScript(([s, slug, label, uid]) => {
      try {
        localStorage.setItem("tf_sesion", JSON.stringify(s));
        localStorage.setItem(
          `tf_terminadas:${uid}`,
          JSON.stringify([{ label, slug, cuando: Date.now() - 61 * 60 * 1000 }])
        );
      } catch (e) { /* nada */ }
    }, [SESION, SLUG, LABEL, UID]);
    await page.route("**/data/searches/index.json*", (r) =>
      r.fulfill({ contentType: "application/json", body: JSON.stringify({ searches: [ENTRADA] }) })
    );
    await page.goto("/buscar.html", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    await expect(page.locator(".terminada")).toHaveCount(0);
  });
});

/* -------------------------------------------- la hoja mientras busca la cama */

const SESION_CON_TOKEN = { ...SESION, tok: "x" };

const abrirHoja = async (page) => {
  await page.addInitScript((s) => {
    try {
      localStorage.setItem("tf_sesion", JSON.stringify(s));
    } catch (e) { /* nada */ }
  }, SESION_CON_TOKEN);
  await page.route("**/data/stays/*.json*", (r) => r.fulfill({ status: 404, body: "no" }));
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  // El botón vive dentro del chollo del día, así que hay que esperar a que el
  // feed esté pintado. Con la suite entera en paralelo eso tarda, y una espera
  // de milisegundos fijos fallaba una de cada tres.
  const boton = page.locator(".hero [data-stay]").first();
  await boton.waitFor({ state: "attached", timeout: 30000 });
  await boton.evaluate((b) => b.click());
  await expect(page.locator("#panel")).toBeVisible();
};

test.describe("la hoja de alojamiento", () => {
  test("al pedirla, explica por qué pregunta cuántos sois", async ({ page }) => {
    await abrirHoja(page);
    await expect(page.locator("#panelBody")).toContainText("¿Cuántos viajáis?");
    await expect(page.locator(".party-nota")).toContainText(
      "El vuelo es por persona y la cama es para el grupo"
    );
  });

  /* Con una sola línea de texto la hoja quedaba con un palmo de nada debajo y
     parecía colgada. Los huecos dicen que van a salir filas y cuántas caben. */
  test("mientras busca, tres huecos y lo que tarda", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    // Lo que pinta el módulo de verdad, no un HTML escrito en la prueba: el
    // camino que lleva a este estado pasa por un dispatch autenticado, que no
    // se puede recorrer sin inventarse media sesión. Y sin pasar por el chollo
    // del día, que no hace falta para esto.
    await page.evaluate(async () => {
      const m = await import("/js/alojamiento.js");
      document.querySelector("#panelBody").innerHTML = m.buscandoHTML();
      document.querySelector("#panel").hidden = false;
    });
    await expect(page.locator(".buscando-linea")).toContainText("2-3 minutos");
    await expect(page.locator(".esqueleto i")).toHaveCount(3);
    await expect(page.locator(".buscando-nota")).toContainText("Puedes cerrar esta hoja");
    // Y que los huecos OCUPAN: tres cajas de cero de alto no dicen nada.
    const alto = await page.locator(".esqueleto i").first().evaluate((e) => e.clientHeight);
    expect(alto).toBeGreaterThan(40);
  });

  /* Una cama de 119 € no dice nada sin saber si es para dos o para cuatro, y
     ese número lo eliges tú al lanzarla. */
  /* Una cama de 119 € no dice nada sin saber si es para dos o para cuatro, y
     ese número lo eliges tú al lanzarla: callarlo después deja el precio a
     medias. En cuanto el resultado dice para cuántos se buscó, la cabecera lo
     lleva. */
  test("la cabecera dice para cuántos se buscó", async ({ page }) => {
    await page.addInitScript((s) => {
      try {
        localStorage.setItem("tf_sesion", JSON.stringify(s));
      } catch (e) { /* nada */ }
    }, SESION_CON_TOKEN);
    await page.route("**/data/stays/*.json*", (r) =>
      r.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          offer_id: "x",
          generated_at: "2026-09-13",
          summary: { total: 264, per_person: 132, party: 3, flights: 145, stay: 119 },
          stays: [
            { name: "Casa del Centro", provider: "airbnb", price_total: 119,
              price_per_night: 59, url: "https://example.com", km_centro: 0.8 },
          ],
        }),
      })
    );
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);
    await page.evaluate(() => document.querySelector(".hero [data-stay]")?.click());
    await expect(page.locator("#panel")).toBeVisible();
    await expect(page.locator("#panelDates")).toContainText("para 3");
  });
});
