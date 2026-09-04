/* El test de destinos, de punta a punta (#7, #9, #10, #11, #12).

   El motor se prueba aparte, en `motor.spec.js`, porque es una función pura.
   Aquí se prueba lo otro: que se abra desde las tres páginas, que se pueda
   hacer entero sin tocar el ratón, que las tarjetas digan por qué, que
   «avísame» mande lo que tiene que mandar y que nada de eso se pierda al
   cerrar la pestaña. */
const { test, expect } = require("@playwright/test");

const SESION = { uid: "u-prueba", user: "p", name: "P" };

/* Un catálogo propio, con fechas RELATIVAS a hoy. El `offers.json` de ejemplo
   del repo lleva fechas fijas de 2026 y 2027: sirve para el tablón, pero aquí
   se filtra por horizonte de meses, y una prueba que caduca sola es una prueba
   que un día falla sin que nadie haya roto nada. */
function dentroDe(dias) {
  return new Date(Date.now() + dias * 864e5).toISOString().slice(0, 10);
}

function oferta(id, iata, ciudad, pais, precio, dias, noches, extra = {}) {
  return {
    id, provider: "prueba", origin: "MAD", destination: iata,
    destination_name: ciudad, destination_country: pais,
    depart_date: dentroDe(dias), return_date: dentroDe(dias + noches),
    price: precio, price_per_person: precio, currency: "EUR", adults: 1,
    nights: noches, score: 88, discount_pct: 45,
    useful_hours: noches * 14, price_per_hour: precio / (noches * 14),
    weekend: true, long_haul: false,
    depart_time: "16:30", arrive_time: "18:40", return_time: "20:15",
    deep_link: "https://example.invalid/vuelo",
    ...extra,
  };
}

/* Playa, ciudad y gastronomía, en países distintos y a precios distintos: lo
   justo para que el motor tenga de dónde elegir sin inventarse nada. */
const CATALOGO = {
  generated_at: new Date().toISOString().slice(0, 10),
  count: 8,
  errors: [],
  offers: [
    oferta("a", "PMI", "Palma", "España", 58, 45, 2),
    oferta("b", "FAO", "Faro", "Portugal", 72, 60, 3),
    oferta("c", "CAG", "Cagliari", "Italia", 88, 75, 3),
    oferta("d", "NAP", "Nápoles", "Italia", 64, 50, 2),
    oferta("e", "PRG", "Praga", "República Checa", 55, 55, 3),
    oferta("f", "EDI", "Edimburgo", "Reino Unido", 79, 90, 3),
    oferta("g", "OPO", "Oporto", "Portugal", 49, 40, 2),
    oferta("h", "VIE", "Viena", "Austria", 95, 120, 4),
  ],
};

async function conCatalogo(page, datos = CATALOGO) {
  await page.route("**/offers.json*", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(datos) })
  );
}

async function conSesion(page) {
  await page.addInitScript((s) => {
    try {
      localStorage.setItem("tf_sesion", JSON.stringify(s));
      localStorage.setItem("tf_token", "ghp_de_mentira");
    } catch (e) { /* nada */ }
  }, SESION);
}

/* Contesta el test entero. Por defecto: playa · con eso vale · dos noches · el
   finde da igual · hasta 100 € · yo solo · término medio · el directo da igual
   · me importa madrugar · cuando sea.

   Las dos "me da igual" y el "cuando sea" son a propósito: el horizonte de
   meses, las escalas y el finde no son lo que se está probando aquí, y
   apretarlos haría que estas pruebas hablasen del catálogo de ejemplo en vez
   del test. `lejos` no sale con playa y dos noches, así que son diez.

   El índice es por posición, así que si se añade o se mueve una pregunta hay
   que tocar esta lista: es el precio de contestar por posición, y el aviso de
   abajo lo hace evidente en vez de dejar que la prueba pase por otro camino. */
const POR_DEFECTO = [0, 4, 0, 1, 1, 0, 2, 1, 0, 2];
const CUANTAS_PREGUNTAS = POR_DEFECTO.length;

async function hacerloEntero(page, elecciones = POR_DEFECTO) {
  await page.click("#tfDescubrir");
  await expect(page.locator(".quiz-pregunta")).toBeVisible();
  // El total lo dice la propia pantalla: si el test crece y esta lista no, la
  // prueba lo dice aquí en vez de fallar tres asertos más abajo.
  const rotulo = await page.locator(".quiz-cuenta").textContent();
  const total = Number((rotulo || "").match(/de (\d+)/)?.[1] || 0);
  expect(total, "el test tiene otro número de preguntas que POR_DEFECTO").toBe(
    CUANTAS_PREGUNTAS
  );
  for (let i = 0; i < CUANTAS_PREGUNTAS + 2; i++) {
    const opciones = page.locator(".quiz-opcion");
    const cuantas = await opciones.count();
    if (!cuantas) break;
    await opciones.nth(Math.min(elecciones[i] ?? 0, cuantas - 1)).click();
  }
  await expect(page.locator("#tfQuizCuerpo")).toBeVisible();
}

test.describe("el test de destinos", () => {
  // Cada prueba estrena contexto, así que el almacenamiento ya viene limpio:
  // borrarlo en un initScript lo borraría también al recargar, y eso es justo
  // lo que las pruebas de memoria (#11) necesitan que NO pase.
  test.beforeEach(async ({ page }) => {
    await conCatalogo(page);
  });

  // ------------------------------------------------------------- la puerta (#7)
  test("el flap está en las tres páginas públicas y no en el panel", async ({ page }) => {
    for (const p of ["/index.html", "/buscar.html", "/seguimientos.html"]) {
      await page.goto(p, { waitUntil: "domcontentloaded" });
      await expect(page.locator("#tfDescubrir")).toBeVisible();
    }
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    expect(await page.locator("#tfDescubrir").count()).toBe(0);
    await page.goto("/404.html", { waitUntil: "domcontentloaded" });
    expect(await page.locator("#tfDescubrir").count()).toBe(0);
  });

  test("es un botón de verdad, no un adorno", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    const flap = page.locator("#tfDescubrir");
    await expect(flap).toHaveAttribute("aria-label", /descubrir/i);
    // Dentro del troquel pero FUERA de su aria-hidden: si no, un lector de
    // pantalla no lo encuentra por mucho aria-label que lleve.
    expect(await flap.evaluate((el) => !!el.closest('[aria-hidden="true"]'))).toBe(false);
    expect(await flap.evaluate((el) => el.tagName)).toBe("BUTTON");
  });

  test("se alcanza con el tabulador", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.locator("#tfDescubrir").focus();
    expect(await page.evaluate(() => document.activeElement.id)).toBe("tfDescubrir");
  });

  test("el área táctil llega a 44 px sin agrandar lo que se ve", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    const alto = await page.locator("#tfDescubrir").evaluate((el) => {
      const marca = getComputedStyle(el, "::after");
      return { h: marca.height, w: marca.width };
    });
    expect(parseFloat(alto.h)).toBeGreaterThanOrEqual(44);
    expect(parseFloat(alto.w)).toBeGreaterThanOrEqual(44);
  });

  // ----------------------------------------------------------- el recorrido (#7)
  test("se hace entero y sale en tres billetes", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await hacerloEntero(page);
    await expect(page.locator(".quiz-billete")).toHaveCount(3);
  });

  test("avanza solo al elegir: no hay botón de siguiente", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.click("#tfDescubrir");
    await expect(page.locator(".quiz-cuenta")).toHaveText(/^1 de/);
    await page.locator(".quiz-opcion").first().click();
    await expect(page.locator(".quiz-cuenta")).toHaveText(/^2 de/);
    expect(await page.locator("button:has-text('siguiente')").count()).toBe(0);
  });

  test("se puede volver atrás y lo elegido sigue ahí", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.click("#tfDescubrir");
    await page.locator(".quiz-opcion").nth(1).click(); // ciudad
    await page.locator(".quiz-opcion").first().click();
    await expect(page.locator(".quiz-cuenta")).toHaveText(/^3 de/);
    await page.click("[data-atras]");
    await expect(page.locator(".quiz-cuenta")).toHaveText(/^2 de/);
    await page.click("[data-atras]");
    await expect(page.locator(".quiz-cuenta")).toHaveText(/^1 de/);
    expect(await page.locator("[data-atras]").count()).toBe(0);
  });

  test("se hace entero solo con el teclado", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.locator("#tfDescubrir").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".quiz-pregunta")).toBeVisible();
    for (let i = 0; i < CUANTAS_PREGUNTAS + 2; i++) {
      if (!(await page.locator(".quiz-opcion").count())) break;
      await page.keyboard.press("1");
    }
    await expect(page.locator(".quiz-billete").first()).toBeVisible();
  });

  test("la flecha izquierda vuelve", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.click("#tfDescubrir");
    await page.keyboard.press("1");
    await expect(page.locator(".quiz-cuenta")).toHaveText(/^2 de/);
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator(".quiz-cuenta")).toHaveText(/^1 de/);
  });

  test("en 320 px no se sale nada por el lado", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await hacerloEntero(page);
    const desborde = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1
    );
    expect(desborde).toBe(false);
  });

  // --------------------------------------------------------- accesibilidad (#12)
  test("Escape cierra y el foco vuelve al flap", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.locator("#tfDescubrir").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".quiz-pregunta")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#tfModal")).toBeHidden();
    expect(await page.evaluate(() => document.activeElement.id)).toBe("tfDescubrir");
  });

  test("el diálogo es un diálogo y el fondo queda fuera", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.click("#tfDescubrir");
    const caja = page.locator("#tfModal .modal-caja");
    await expect(caja).toHaveAttribute("role", "dialog");
    await expect(caja).toHaveAttribute("aria-modal", "true");
    // El resto de la página, inerte: sin esto el lector de pantalla se pasea
    // por el tablón de detrás como si el diálogo no existiera.
    expect(await page.evaluate(() => document.querySelector("main")?.hasAttribute("inert"))).toBe(true);
  });

  test("cada pregunta se anuncia", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.click("#tfDescubrir");
    await expect(page.locator("#tfAnuncios")).toContainText(/pregunta 1 de/i);
    await page.locator(".quiz-opcion").first().click();
    await expect(page.locator("#tfAnuncios")).toContainText(/pregunta 2 de/i);
  });

  // ------------------------------------------------- que se note que es tuyo
  /* Diez preguntas y un titular genérico hacen que el resultado parezca sacado
     de una chistera. Lo que lo vuelve personal es doble: que se pregunte lo
     que de verdad cambia el resultado, y que al final se te devuelva lo que
     pediste con tus palabras. */
  test("la barra dice en qué capítulo vas, no solo cuánto queda", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.click("#tfDescubrir");
    await expect(page.locator(".quiz-capitulo")).toHaveText(/el viaje/i);
    // Cuánto queda lo dicen las casillas y el "1 de 10", no el capítulo.
    await expect(page.locator(".quiz-cuenta")).toHaveText(/^1 de 10$/);
    // Hasta el final del test se pasa por los tres capítulos.
    const vistos = new Set();
    for (let i = 0; i < CUANTAS_PREGUNTAS; i++) {
      const t = await page.locator(".quiz-capitulo").textContent();
      vistos.add((t || "").trim().toLowerCase());
      const opciones = page.locator(".quiz-opcion");
      if (!(await opciones.count())) break;
      await opciones.nth(POR_DEFECTO[i] ?? 0).click();
    }
    expect([...vistos]).toEqual(
      expect.arrayContaining(["el viaje", "el dinero", "el vuelo"])
    );
  });

  test("«¿y algo más?» no vuelve a ofrecer lo que ya elegiste", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.click("#tfDescubrir");
    const primeras = await page.locator(".quiz-opcion .quiz-texto b").allTextContents();
    expect(primeras).toContain("Salir de noche"); // la etiqueta que no se podía pedir
    await page.locator(".quiz-opcion").first().click(); // playa
    await expect(page.locator(".quiz-pregunta")).toContainText(/algo más/i);
    const segundas = await page.locator(".quiz-opcion .quiz-texto b").allTextContents();
    expect(segundas).not.toContain("Playa");
    expect(segundas).toContain("Con eso vale");
  });

  test("el resultado te devuelve lo que pediste, con tus palabras", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    // playa · y comer bien · dos noches · en finde · hasta 100 € · yo solo ·
    // que sea barato · directo · me importa madrugar · cuando sea
    await hacerloEntero(page, [0, 1, 0, 0, 1, 0, 0, 0, 0, 2]);
    const tuyo = page.locator(".quiz-tuyo");
    await expect(tuyo).toBeVisible();
    await expect(tuyo).toContainText(/playa con algo de comer bien/i);
    await expect(tuyo).toContainText(/2 noches/);
    await expect(tuyo).toContainText(/en finde/i);
    await expect(tuyo).toContainText(/directo/i);
    await expect(tuyo).toContainText(/sin madrugar/i);
    await expect(tuyo).toContainText(/hasta 100/);
    await expect(tuyo).toContainText(/lo barato manda/i);
  });

  /* Un test contestado antes de que existieran estas preguntas sigue guardado
     tal cual: al volver tiene que recalcular, no romperse ni cambiarle a nadie
     la prioridad por su cuenta. */
  test("un test guardado de antes sigue valiendo", async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem(
          "tf_quiz",
          JSON.stringify({
            respuestas: {
              apetece: "playa", noches: [2, 2], tope: 60,
              personas: 1, madrugar: false, meses: 10,
            },
            cuando: Date.now(),
          })
        );
      } catch (e) { /* nada */ }
    });
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.click("#tfDescubrir");
    await expect(page.locator(".quiz-billete").first()).toBeVisible();
    // 60 € se deducía como "barato": esa es la prioridad que esa persona vio.
    await expect(page.locator(".quiz-tuyo")).toContainText(/lo barato manda/i);
  });

  // ------------------------------------------------------------ las tarjetas (#9)
  test("cada billete dice por qué sale, y no todos lo mismo", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await hacerloEntero(page);
    const frases = await page.locator(".quiz-porque").allTextContents();
    expect(frases).toHaveLength(3);
    frases.forEach((f) => expect(f.trim().length).toBeGreaterThan(10));
    expect(new Set(frases).size).toBeGreaterThan(1);
  });

  test("el billete lleva ciudad, IATA, precio, fechas y los dos botones", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await hacerloEntero(page);
    const b = page.locator(".quiz-billete").first();
    await expect(b.locator(".iata")).toHaveText(/^[A-Z]{3}$/);
    await expect(b.locator(".city")).not.toBeEmpty();
    await expect(b.locator(".quiz-precio")).toContainText("€");
    await expect(b.locator(".quiz-cuando")).toContainText(/→/);
    await expect(b.locator("a:has-text('Ver el vuelo')")).toBeVisible();
    await expect(b.locator("button:has-text('Avísame')")).toBeVisible();
  });

  test("no se repite país entre los tres", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await hacerloEntero(page, [1, 3, 3, 0, 1, 2, 1]); // lo más abierto posible
    const paises = (await page.locator(".quiz-billete .country").allTextContents())
      .map((s) => s.trim())
      .filter(Boolean);
    if (paises.length === 3) expect(new Set(paises).size).toBe(3);
  });

  // ------------------------------------------------------------- avísame (#10)
  test("«avísame» manda el seguimiento con su origen puesto", async ({ page }) => {
    await conSesion(page);
    let enviado = null;
    await page.route("**/api.github.com/**", (r) => {
      enviado = JSON.parse(r.request().postData() || "{}");
      return r.fulfill({ status: 204, body: "" });
    });
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await hacerloEntero(page);
    await page.locator("button:has-text('Avísame')").first().click();
    await expect(page.locator(".quiz-estado").first()).toContainText(/apuntado/i);

    expect(enviado.event_type).toBe("watch");
    // Lo que el campo `source` existe para contestar (#13).
    expect(enviado.client_payload.source).toBe("test");
    expect(enviado.client_payload.label).toMatch(/^Test · /);
    expect(enviado.client_payload.owner).toBe(SESION.uid);
    expect(Number(enviado.client_payload.max_price)).toBeGreaterThan(0);
  });

  test("los tres se pueden apuntar y cada uno es distinto", async ({ page }) => {
    await conSesion(page);
    const enviados = [];
    await page.route("**/api.github.com/**", (r) => {
      enviados.push(JSON.parse(r.request().postData() || "{}").client_payload);
      return r.fulfill({ status: 204, body: "" });
    });
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await hacerloEntero(page);
    const botones = page.locator("button:has-text('Avísame')");
    const n = await botones.count();
    for (let i = 0; i < n; i++) await botones.nth(i).click();
    await expect(page.locator(".quiz-estado", { hasText: /apuntado/i })).toHaveCount(n);
    expect(new Set(enviados.map((p) => p.dest)).size).toBe(n);
  });

  test("sin sesión sale la caja de entrar y el test NO se pierde", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await hacerloEntero(page);
    await page.locator("button:has-text('Avísame')").first().click();
    // La caja de acceso de siempre, no un error suelto.
    await expect(page.locator(".quiz-estado").first()).toContainText(/entrar|cuenta/i);
    // Y lo contestado sigue guardado: al volver de entrar no hay que rehacerlo.
    const memoria = await page.evaluate(() => localStorage.getItem("tf_quiz"));
    expect(memoria).toBeTruthy();
    expect(JSON.parse(memoria).respuestas.tope).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------- memoria (#11)
  test("al volver enseña los destinos sin repetir el test", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await hacerloEntero(page);
    await page.keyboard.press("Escape");

    await page.goto(page.url(), { waitUntil: "domcontentloaded" });
    await expect(page.locator("#tfDescubrir")).toHaveClass(/con-memoria/);
    await page.click("#tfDescubrir");
    // Directo a los billetes: ni una pregunta.
    await expect(page.locator(".quiz-billete").first()).toBeVisible();
    expect(await page.locator(".quiz-cuenta").count()).toBe(0);
  });

  test("«volver a hacerlo» olvida y empieza de cero", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await hacerloEntero(page);
    await page.click("[data-otra]");
    await expect(page.locator(".quiz-cuenta")).toHaveText(/^1 de/);
    expect(await page.evaluate(() => localStorage.getItem("tf_quiz"))).toBeNull();
    await expect(page.locator("#tfDescubrir")).not.toHaveClass(/con-memoria/);
  });

  test("los precios son los de hoy, no los del día en que se contestó", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await hacerloEntero(page);
    await page.keyboard.press("Escape");

    // Otra tanda, con un precio que no estaba antes.
    await page.route("**/offers.json*", (r) =>
      r.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({
          generated_at: new Date().toISOString().slice(0, 10), count: 1, errors: [],
          offers: [{
            id: "nuevo", provider: "p", origin: "MAD", destination: "OPO",
            destination_name: "Oporto", destination_country: "Portugal",
            depart_date: new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10),
            return_date: new Date(Date.now() + 62 * 864e5).toISOString().slice(0, 10),
            price: 37, price_per_person: 37, currency: "EUR", adults: 1, nights: 2,
            score: 95, discount_pct: 60, useful_hours: 30, price_per_hour: 1.2,
            weekend: true, depart_time: "09:00", arrive_time: "11:00", return_time: "20:00",
          }],
        }),
      })
    );
    await page.goto(page.url(), { waitUntil: "domcontentloaded" });
    await page.click("#tfDescubrir");
    await expect(page.locator(".quiz-billete .city").first()).toHaveText(/Oporto/);
    await expect(page.locator(".quiz-precio").first()).toContainText("37");
  });

  test("en navegación privada el test funciona igual, solo que no recuerda", async ({ page }) => {
    await page.addInitScript(() => {
      // Un localStorage que se niega, que es lo que ve el navegador cuando el
      // usuario bloquea el almacenamiento de sitio.
      const romper = () => { throw new Error("sin sitio"); };
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: { getItem: romper, setItem: romper, removeItem: romper, key: romper, length: 0 },
      });
    });
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await hacerloEntero(page);
    await expect(page.locator(".quiz-billete").first()).toBeVisible();
  });
});
