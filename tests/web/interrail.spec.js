/* El Interrail, en su página: el pase, las ciudades, la búsqueda sola y la cama
   en el centro.

   Lo que se pidió, dicho tal cual:
   · «En tren e Interrail son páginas diferentes».
   · «Tiene que desde el principio buscar vuelos y alojamientos».
   · «Preguntarte si quieres pasar por alguna ciudad en concreto».
   · «Si tienes pase de Interrail y de cuántos días, eso no te lo cuenta en el
     coste; si no lo tienes, te da cómo te saldría comprando uno o comprando
     individualmente».
   · «Los alojamientos no son buenos si están a 7 km del centro, ni a 43 min
     andando».

   Los ficheros de vuelo y de cama son falsos y se sirven con `page.route`: lo
   que se prueba es lo que la página hace con ellos, no los scrapers. */
const { test, expect } = require("@playwright/test");

test.use({ timezoneId: "Europe/Madrid" });

const IDA = "2026-11-06";

const conSesion = (page) =>
  page.addInitScript(() => {
    try {
      localStorage.setItem("tf_sesion", JSON.stringify({ uid: "u-i", user: "i", name: "I" }));
      localStorage.setItem("tf_token", "ghp_de_mentira");
    } catch (e) {
      /* nada */
    }
  });

/* Cuenta los encargos que salen a GitHub y los contesta bien. */
const contarEncargos = async (page) => {
  const enviados = [];
  await page.route("**/api.github.com/repos/**/dispatches", async (r) => {
    enviados.push(JSON.parse(r.request().postData() || "{}"));
    await r.fulfill({ status: 204, body: "" });
  });
  return enviados;
};

/* Sirve camas y vuelos por id. `camas[id]` es la lista de `stays` de esa
   parada; `vuelos[id]`, la de `legs`. */
const servir = async (page, { camas = {}, vuelos = {} } = {}) => {
  await page.route("**/data/stays/index.json*", (r) =>
    r.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ viajes: Object.fromEntries(Object.keys(camas).map((i) => [i, {}])) }),
    })
  );
  await page.route("**/data/interrail/index.json*", (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ vuelos: Object.keys(vuelos) }) })
  );
  await page.route("**/data/stays/ir-*.json*", (r) => {
    const id = r.request().url().split("/").pop().split(".json")[0];
    return camas[id]
      ? r.fulfill({ contentType: "application/json", body: JSON.stringify({ offer_id: id, stays: camas[id] }) })
      : r.fulfill({ status: 404, body: "" });
  });
  await page.route("**/data/interrail/ir-vuelo-*.json*", (r) => {
    const id = r.request().url().split("/").pop().split(".json")[0];
    return vuelos[id]
      ? r.fulfill({ contentType: "application/json", body: JSON.stringify({ id, legs: vuelos[id] }) })
      : r.fulfill({ status: 404, body: "" });
  });
};

const abrir = async (page, { ida = IDA } = {}) => {
  await page.goto("/interrail.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#irRutas .ir-ruta").first()).toBeVisible();
  if (ida !== null) {
    await page.fill("#irIda", ida);
    await page.dispatchEvent("#irIda", "change");
  }
};

/* Se eligen en el mapa, tocando el círculo de cada ciudad. */
const elegir = async (page, ...cods) => {
  for (const c of cods) await page.locator(`#irMapa [data-ir-ciudad="${c}"] .ir-nodo-toque`).click();
};
/* Las otras rutas van plegadas: se abre y se elige. */
const otraRuta = async (page, id) => {
  const mas = page.locator("#irRutas details.ir-mas");
  if (!(await mas.evaluate((d) => d.open))) await mas.locator("summary").click();
  await page.locator(`[data-ir-elegir-ruta="${id}"]`).click();
};
const chip = (page, c) => page.locator(`#irCiudades [data-ir-ciudad="${c}"]`);

const paradas = (page) => page.locator(".ir-ruta.elegida .ir-parada b").allTextContents();

const piso = (nombre, precio, km, extra = {}) => ({
  provider: "airbnb",
  kind: "stay",
  name: nombre,
  url: `https://x.test/${encodeURIComponent(nombre)}`,
  price_total: precio,
  area: "Apartamento entero",
  km_centro: km,
  ...extra,
});

/* ------------------------------------------------------------ la página */

test.describe("dos páginas", () => {
  test("el Interrail tiene la suya, y está en el menú", async ({ page }) => {
    await page.goto("/interrail.html");
    await expect(page.locator('.zona.activa[data-zona="interrail"]')).toHaveText("Interrail");
    await expect(page.locator("#irForm")).toBeVisible();
    await expect(page.locator("#trenForm")).toHaveCount(0);
  });

  test("y la de los trenes de Madrid ya no existe", async ({ page }) => {
    await page.goto("/interrail.html");
    await expect(page.locator('.zona[href="trenes.html"]')).toHaveCount(0);
  });
});

/* -------------------------------------------------------------- el pase */

test.describe("el pase", () => {
  test("sin pase: el viaje comprando el pase y billete a billete, y cuál sale mejor", async ({ page }) => {
    await abrir(page);
    const precio = page.locator(".ir-ruta.elegida .ir-precio");
    await expect(precio).toHaveAttribute("data-pase", "no");
    await expect(precio).toContainText("Comprando el pase");
    await expect(precio).toContainText("Billete a billete");
    await expect(precio.locator(".ir-veredicto")).not.toBeEmpty();
    await expect(page.locator("#irEdadWrap")).toBeVisible();
    await expect(page.locator("#irDiasWrap")).toBeHidden();
  });

  test("con el pase ya comprado: no se cuenta, y se pregunta de cuántos días", async ({ page }) => {
    await abrir(page);
    await page.locator('input[name="irPase"][value="si"]').check();
    await expect(page.locator("#irDiasWrap")).toBeVisible();
    await expect(page.locator("#irEdadWrap")).toBeHidden();
    const precio = page.locator(".ir-ruta.elegida .ir-precio");
    await expect(precio).toHaveAttribute("data-pase", "si");
    await expect(precio).toContainText("el pase no se cuenta");
    await expect(precio).not.toContainText("Comprando el pase");
  });

  test("con el pase, lo que queda por pagar son solo las reservas (más vuelos y cama)", async ({ page }) => {
    // Suiza no tiene ni una reserva: con el pase, el tren sale a cero.
    await abrir(page);
    await page.locator('input[name="irPase"][value="si"]').check();
    await otraRuta(page, "suiza");
    await expect(page.locator(".ir-ruta.elegida .ir-precio dd")).toHaveText("≈ 0 €");
  });

  test("y las rutas son las que caben en sus días", async ({ page }) => {
    await abrir(page);
    await page.locator('input[name="irPase"][value="si"]').check();
    await page.selectOption("#irDias", "4");
    // La vuelta grande gasta seis días de tren: con un pase de cuatro no sale.
    await expect(page.locator("#ruta-vuelta")).toHaveCount(0);
    await expect(page.locator("#irHint")).toContainText("caben en tu pase de 4 días");
  });

  test("si tu ruta no cabe en tu pase, se dice antes que nada", async ({ page }) => {
    await abrir(page);
    await page.locator('input[name="irPase"][value="si"]').check();
    await page.selectOption("#irDias", "4");
    await elegir(page, "AMS", "BER", "PRG", "VIE", "BUD", "ZAG");
    await expect(page.locator(".ir-ruta.elegida .ir-problema")).toContainText("tu pase tiene 4");
  });

  test("la edad cambia lo que cuesta comprando el pase, no billete a billete", async ({ page }) => {
    await abrir(page);
    const con = page.locator(".ir-ruta.elegida .ir-precio dl > div").nth(0).locator("dd");
    const sin = page.locator(".ir-ruta.elegida .ir-precio dl > div").nth(1).locator("dd");
    const [conA, sinA] = [await con.textContent(), await sin.textContent()];
    await page.selectOption("#irEdad", "joven");
    await expect(con).not.toHaveText(conA);
    await expect(sin).toHaveText(sinA);
  });
});

/* ----------------------------------------------------------- las ciudades */

test.describe("las ciudades por las que quieres pasar", () => {
  test("se ordenan solas para gastar el menor tren posible", async ({ page }) => {
    await abrir(page);
    // Elegidas en el peor orden posible.
    await elegir(page, "ROM", "BER", "PRG");
    await expect(page.locator(".ir-ruta.elegida .ir-etiqueta")).toHaveText("tu ruta");
    // Las tres, con Roma en una punta: con el mapa de ahora, Praga → Berlín
    // → Roma gasta menos que Berlín → Praga → Roma (se baja por Núremberg,
    // Innsbruck y Verona). El orden exacto lo decide el mapa, no la prueba.
    const orden = await paradas(page);
    expect([...orden].sort()).toEqual(["Berlín", "Praga", "Roma"]);
    expect(orden[orden.length - 1]).toBe("Roma");
  });

  test("entre dos lejanas, dice por dónde pasa y deja parar", async ({ page }) => {
    await abrir(page);
    await elegir(page, "PRG", "ROM");
    const tramo = page.locator(".ir-ruta.elegida .ir-ev-tren").first();
    await expect(tramo).toContainText(/pasas por/i);
    await expect(tramo).toContainText("Es un día largo de tren");
    const boton = tramo.locator("[data-ir-parar]").first();
    const cod = await boton.getAttribute("data-ir-parar");
    const ciudad = (await boton.textContent()).replace("Parar en", "").trim();
    await boton.click();
    expect(await paradas(page)).toContain(ciudad);
    await expect(chip(page, cod)).toHaveAttribute("aria-pressed", "true");
  });

  test("quitar una ciudad de tu ruta la desmarca", async ({ page }) => {
    await abrir(page);
    await elegir(page, "AMS", "BER", "PRG");
    await page.locator(".ir-ruta.elegida .ir-ajustar summary").click();
    await page.locator('.ir-ruta.elegida [data-ir-accion="quitar"][data-cod="BER"]').click();
    await expect(chip(page, "BER")).toHaveAttribute("aria-pressed", "false");
    expect(await paradas(page)).toEqual(["Ámsterdam", "Praga"]);
  });

  test("con una sola, pide otra y enseña las rutas hechas que pasan por ella", async ({ page }) => {
    await abrir(page);
    await elegir(page, "LUC");
    await expect(page.locator("#irElegidas")).toContainText("elige al menos otra");
    await expect(page.locator(".ir-ruta.elegida")).toHaveAttribute("id", "ruta-suiza");
  });

  test("lo elegido se queda al volver", async ({ page }) => {
    await abrir(page);
    await elegir(page, "ROM", "FLR");
    await page.reload();
    await expect(chip(page, "FLR")).toHaveAttribute("aria-pressed", "true");
    expect(await paradas(page)).toEqual(["Roma", "Florencia"]);
  });

  test("con la vuelta puesta, las noches se reparten entre tus paradas", async ({ page }) => {
    await abrir(page);
    await page.fill("#irVuelta", "2026-11-16");
    await page.dispatchEvent("#irVuelta", "change");
    await elegir(page, "PAR", "AMS");
    await expect(page.locator(".ir-ruta.elegida .ir-res-datos")).toContainText("10 noches");
  });

  test("el camino más corto sale del mapa, y se sabe cuándo no hay", async ({ page }) => {
    await page.goto("/interrail.html");
    const r = await page.evaluate(async () => {
      const m = await import("./js/interrail.js");
      const total = (o) => o.slice(1).reduce((s, c, i) => s + m.camino(o[i], c).min, 0);
      const orden = m.ordenar(["NAP", "AMS", "BER", "ROM"]);
      // Contra todas las demás: ninguna gasta menos tren.
      const todas = [];
      const perm = (resto, hecho) =>
        resto.length ? resto.forEach((c, i) => perm(resto.filter((_, j) => j !== i), [...hecho, c])) : todas.push(hecho);
      perm(["NAP", "AMS", "BER", "ROM"], []);
      return {
        praRoma: m.camino("PRG", "ROM"),
        directo: m.camino("MIL", "VCE"),
        orden,
        esLaMejor: todas.every((o) => total(orden) <= total(o)),
      };
    });
    expect(r.directo.pasaCods).toEqual([]);
    expect(r.praRoma.pasaCods.length).toBeGreaterThan(0);
    expect(r.esLaMejor).toBe(true);
    // Nápoles, en una punta: no se baja a Nápoles para volver a subir.
    expect([r.orden[0], r.orden[3]]).toContain("NAP");
  });
});

/* ---------------------------------------------------- la búsqueda, sola */

test.describe("la búsqueda empieza sola", () => {
  test("con sesión, al montar la ruta se buscan vuelos y alojamiento sin tocar nada", async ({ page }) => {
    await conSesion(page);
    const enviados = await contarEncargos(page);
    await servir(page);
    await abrir(page);
    await elegir(page, "VIE", "BUD");
    await expect.poll(() => enviados.length, { timeout: 8000 }).toBe(1);

    const p = enviados[0].client_payload;
    expect(enviados[0].event_type).toBe("interrail");
    expect(Object.keys(p).length).toBeLessThanOrEqual(10);
    // La cama ya no depende de la ruta, y lleva el centro para buscar cerca.
    expect(p.paradas.map((x) => x.offer_id)).toEqual(["ir-VIE-2026-11-06-2n-2", "ir-BUD-2026-11-08-2n-2"]);
    expect(p.paradas[0]).toMatchObject({ city: "Viena", country: "Austria", lat: 48.2085, lon: 16.3721 });
    expect(p.vuelos.map((v) => v.id)).toEqual([
      "ir-vuelo-MAD-VIE-2026-11-06-ida",
      "ir-vuelo-MAD-BUD-2026-11-10-vuelta",
    ]);
    await expect(page.locator(".ir-ruta.elegida .ir-buscando")).toBeVisible();
  });

  test("y no dispara una búsqueda por cada «+»: espera a que termines", async ({ page }) => {
    await conSesion(page);
    const enviados = await contarEncargos(page);
    await servir(page);
    await abrir(page);
    await elegir(page, "VIE", "BUD");
    await page.locator(".ir-ruta.elegida .ir-ajustar summary").click();
    for (let i = 0; i < 3; i++) {
      await page.locator('.ir-ruta.elegida [data-ir-accion="mas"][data-cod="VIE"]').click();
    }
    await expect.poll(() => enviados.length, { timeout: 8000 }).toBe(1);
    await page.waitForTimeout(3000);
    expect(enviados.length).toBe(1);
    expect(enviados[0].client_payload.paradas[0].offer_id).toBe("ir-VIE-2026-11-06-5n-2");
  });

  test("lo que ya se buscó no se vuelve a buscar", async ({ page }) => {
    await conSesion(page);
    const enviados = await contarEncargos(page);
    await servir(page, {
      camas: {
        "ir-VIE-2026-11-06-2n-2": [piso("Piso Viena", 200, 0.8)],
        "ir-BUD-2026-11-08-2n-2": [piso("Piso Budapest", 150, 0.6)],
      },
      vuelos: {
        "ir-vuelo-MAD-VIE-2026-11-06-ida": [{ price: 40, airline: "Ryanair", origin: "MAD", destination: "VIE" }],
        "ir-vuelo-MAD-BUD-2026-11-10-vuelta": [{ price: 35, airline: "Ryanair", origin: "BUD", destination: "MAD" }],
      },
    });
    await abrir(page);
    await elegir(page, "VIE", "BUD");
    await expect(page.locator(".ir-ruta.elegida .ir-cama-sel")).toHaveCount(2);
    await page.waitForTimeout(3500);
    expect(enviados).toEqual([]);
  });

  test("sin sesión no se busca: se dice y se puede entrar o pedir cuenta ahí mismo", async ({ page }) => {
    const enviados = await contarEncargos(page);
    await abrir(page);
    await elegir(page, "VIE", "BUD");
    const aviso = page.locator(".ir-ruta.elegida .ir-sin-sesion");
    await expect(aviso).toContainText("Hace falta una cuenta");
    await page.waitForTimeout(3500);
    expect(enviados).toEqual([]);
    await aviso.locator("[data-pedir-cuenta]").click();
    await expect(page.locator("#pedirCuenta")).toBeVisible();
  });
});

/* --------------------------------------------------- la cama, en el centro */

test.describe("la cama, en el centro", () => {
  const ID = "ir-VIE-2026-11-06-2n-2";

  test("nada de habitaciones ni de pisos lejos, y la distancia en minutos a pie", async ({ page }) => {
    await servir(page, {
      camas: {
        [ID]: [
          piso("Habitación barata", 40, 0.3, { area: "Habitación privada en el centro" }),
          piso("Piso a 7 km", 60, 7.0),
          piso("Piso a 43 min", 80, 3.4),
          piso("Piso en el centro", 200, 0.6),
          piso("Piso a un paseo", 170, 1.8),
        ],
      },
    });
    await abrir(page);
    await elegir(page, "VIE", "BUD");
    const cama = page.locator(`.ir-cama[data-parada="${ID}"]`);
    await expect(cama.locator(".ir-cama-sel a")).toHaveText(/Piso (en el centro|a un paseo)/);
    await expect(cama.locator(".ir-cama-sel > div small")).toContainText("min andando del centro");
    await expect(cama).not.toContainText("Habitación barata");
    await expect(cama).not.toContainText("Piso a 7 km");
    await expect(cama).not.toContainText("Piso a 43 min");
  });

  test("si no queda nada cerca, enseña lo más cercano y lo avisa", async ({ page }) => {
    await servir(page, { camas: { [ID]: [piso("Lejos", 90, 3.2), piso("Más lejos", 70, 4.8), piso("Otra ciudad", 30, 12)] } });
    await abrir(page);
    await elegir(page, "VIE", "BUD");
    const cama = page.locator(`.ir-cama[data-parada="${ID}"]`);
    await expect(cama.locator(".ir-cama-aviso")).toBeVisible();
    await expect(cama.locator(".ir-cama-sel a")).toHaveText("Lejos");
    await expect(cama).not.toContainText("Otra ciudad");
  });

  test("cambiar de piso cambia el total", async ({ page }) => {
    await servir(page, { camas: { [ID]: [piso("A", 200, 0.5), piso("B", 300, 0.9)] } });
    await abrir(page);
    await elegir(page, "VIE", "BUD");
    const desglose = page.locator(".ir-ruta.elegida .ir-desglose");
    await expect(desglose).toContainText("alojamiento 100 €");
    await page.locator(`.ir-cama[data-parada="${ID}"] summary`).click();
    await page.locator(`.ir-elegir[data-parada="${ID}"]`).click();
    await expect(desglose).toContainText("alojamiento 150 €");
  });
});

/* ------------------------------------------------------------ el total */

test.describe("el total", () => {
  const camas = {
    "ir-VIE-2026-11-06-2n-2": [piso("Piso Viena", 200, 0.8)],
    "ir-BUD-2026-11-08-2n-2": [piso("Piso Budapest", 160, 0.6)],
  };
  const vuelos = {
    "ir-vuelo-MAD-VIE-2026-11-06-ida": [{ price: 40, airline: "Ryanair", time: "07:10", origin: "MAD", destination: "BTS", deep_link: "https://www.ryanair.com/x" }],
    "ir-vuelo-MAD-BUD-2026-11-10-vuelta": [{ price: 35, airline: "Ryanair", time: "18:40", origin: "BUD", destination: "MAD" }],
  };

  test("suma el tren, los vuelos y el alojamiento, y lo da para el grupo", async ({ page }) => {
    await servir(page, { camas, vuelos });
    await abrir(page);
    await elegir(page, "VIE", "BUD");
    const precio = page.locator(".ir-ruta.elegida .ir-precio");
    await expect(precio).toHaveAttribute("data-completo", "si");
    await expect(precio.locator(".ir-desglose")).toContainText("vuelos 75 € (ida 40 € + vuelta 35 €)");
    await expect(precio.locator(".ir-desglose")).toContainText("alojamiento 180 € por persona (360 € para 2)");
    await expect(precio.locator(".ir-grupo")).toContainText("Para 2");
    // Viena–Budapest billete a billete: 15–40 € + 75 + 180.
    await expect(precio.locator("dl > div").nth(1).locator("dd")).toHaveText("≈ 270–295 €");
  });

  test("con el pase ya comprado, lo mismo sin el pase", async ({ page }) => {
    await servir(page, { camas, vuelos });
    await abrir(page);
    await page.locator('input[name="irPase"][value="si"]').check();
    await elegir(page, "VIE", "BUD");
    await expect(page.locator(".ir-ruta.elegida .ir-precio dd")).toHaveText("≈ 255 €");
  });

  test("cada vuelo dice precio, compañía y aeropuerto; el que no hay no se suma", async ({ page }) => {
    await servir(page, { camas, vuelos: { ...vuelos, "ir-vuelo-MAD-BUD-2026-11-10-vuelta": [] } });
    await abrir(page);
    await elegir(page, "VIE", "BUD");
    const ida = page.locator(".ir-ruta.elegida .ir-ev-vuelo").first();
    await expect(ida).toContainText("40 €");
    await expect(ida).toContainText("MAD → BTS");
    await expect(page.locator(".ir-ruta.elegida .ir-ev-vuelo").last()).toContainText("Ni Ryanair ni Wizz vuelan ese día");
    await expect(page.locator(".ir-ruta.elegida .ir-precio")).toHaveAttribute("data-completo", "no");
  });
});

/* ---------------------------------------------- las fechas y los vuelos */

test.describe("las fechas", () => {
  test("el vuelo de vuelta es la ida más las noches, cruzando el cambio de hora", async ({ page }) => {
    // El 25 de octubre de 2026 se atrasa la hora en España.
    await abrir(page, { ida: "2026-10-23" });
    await elegir(page, "VIE", "BUD");
    const vuelta = page.locator(".ir-ruta.elegida .ir-ev-vuelo").last().locator("a.btn");
    await expect(vuelta).toHaveAttribute("href", /dep=2026-10-27/);
    await expect(vuelta).toHaveAttribute("href", /from=BUD/);
    await expect(vuelta).toHaveAttribute("href", /to=MAD/);
  });

  test("una vuelta anterior a la ida no deja la página en blanco sin decir nada", async ({ page }) => {
    await abrir(page);
    await page.fill("#irVuelta", "2026-11-01");
    await page.dispatchEvent("#irVuelta", "change");
    await expect(page.locator("#irHint")).toContainText("La vuelta es antes que la ida");
  });

  test("sale con una fecha puesta, para que se vea entero sin tocar nada", async ({ page }) => {
    await page.goto("/interrail.html");
    await expect(page.locator("#irIda")).not.toHaveValue("");
    await expect(page.locator(".ir-ruta.elegida .ir-ev-vuelo a.btn").first()).toBeVisible();
  });
});

/* ------------------------------------------------------ las rutas hechas */

test.describe("las rutas hechas", () => {
  test("hay doce, y se puede elegir otra", async ({ page }) => {
    await abrir(page);
    await expect(page.locator("#irRutas .ir-ruta")).toHaveCount(12);
    await otraRuta(page, "italia");
    await expect(page.locator(".ir-ruta.elegida")).toHaveAttribute("id", "ruta-italia");
    expect((await paradas(page))[0]).toBe("Milán");
  });

  test("al revés, más noches, saltarse una y deshacer", async ({ page }) => {
    await abrir(page);
    await otraRuta(page, "centro");
    const r = page.locator("#ruta-centro");
    await r.locator(".ir-ajustar summary").click();
    await r.locator('[data-ir-accion="rev"]').click();
    expect((await paradas(page))[0]).toBe("Budapest");
    await r.locator('[data-ir-accion="quitar"][data-cod="PRG"]').click();
    expect(await paradas(page)).not.toContain("Praga");
    await expect(r.locator(".ir-ev-tren").filter({ hasText: "Pasas por Praga" })).toHaveCount(1);
    await r.locator('[data-ir-accion="reset"]').click();
    expect(await paradas(page)).toEqual(["Ámsterdam", "Berlín", "Praga", "Viena", "Budapest"]);
  });

  test("las reservas obligatorias se dicen", async ({ page }) => {
    await abrir(page);
    await otraRuta(page, "italia");
    await expect(page.locator("#ruta-italia .ir-reserva").first()).toContainText("reserva ≈");
  });
});

/* ------------------------------------------------------- lo de esta ronda */

test.describe("el mapa", () => {
  test("se eligen las ciudades tocándolas, y la ruta se dibuja encima", async ({ page }) => {
    await abrir(page);
    await elegir(page, "VIE", "BUD");
    await expect(page.locator('#irMapa [data-ir-ciudad="VIE"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#irMapa .ir-mapa-ruta")).toHaveCount(1);
    await expect(page.locator("#irElegidas")).toContainText("Viena");
    // Y otra vez la quita.
    await elegir(page, "BUD");
    await expect(page.locator('#irMapa [data-ir-ciudad="BUD"]')).toHaveAttribute("aria-pressed", "false");
  });

  test("con el teclado también", async ({ page }) => {
    await abrir(page);
    await page.locator('#irMapa [data-ir-ciudad="PRG"]').focus();
    await page.keyboard.press("Enter");
    await expect(page.locator('#irMapa [data-ir-ciudad="PRG"]')).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("el tren nocturno", () => {
  test("ir de noche ahorra una noche de piso sin mover las fechas de después", async ({ page }) => {
    await conSesion(page);
    const enviados = await contarEncargos(page);
    await servir(page);
    await abrir(page);
    await elegir(page, "VCE", "VIE");
    const tren = page.locator(".ir-ruta.elegida .ir-ev-tren").first();
    await expect(tren.locator(".ir-nocturno")).toContainText("Hay tren nocturno");
    await tren.locator("[data-ir-noche]").click();
    await expect(page.locator(".ir-ruta.elegida .ir-ev-tren.de-noche")).toHaveCount(1);
    await expect.poll(() => enviados.length, { timeout: 8000 }).toBe(1);
    const ids = enviados[0].client_payload.paradas.map((p) => p.offer_id);
    // Venecia: dos noches de viaje, una en cama. Viena llega el mismo día.
    expect(ids).toEqual(["ir-VCE-2026-11-06-1n-2", "ir-VIE-2026-11-08-2n-2"]);
    // La litera se suma como reserva.
    await expect(tren).toContainText("litera");
  });

  test("y se deshace", async ({ page }) => {
    await abrir(page);
    await elegir(page, "VCE", "VIE");
    await page.locator(".ir-ruta.elegida [data-ir-noche]").click();
    await page.locator(".ir-ruta.elegida .ir-ev-tren.de-noche [data-ir-noche]").click();
    await expect(page.locator(".ir-ruta.elegida .ir-ev-tren.de-noche")).toHaveCount(0);
  });
});

test.describe("los vuelos, otros días", () => {
  const dias = (extra) => ({
    "2026-11-06": { price: 60, airline: "Ryanair" },
    "2026-11-04": { price: 23, airline: "Wizz Air", origin: "MAD", destination: "VIE" },
    ...extra,
  });

  test("si otro día sale más barato, se propone y un toque mueve el viaje", async ({ page }) => {
    await page.route("**/data/interrail/ir-vuelo-MAD-VIE-2026-11-06-ida.json*", (r) =>
      r.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ legs: [{ price: 60, airline: "Ryanair", origin: "MAD", destination: "VIE" }], dias: dias() }),
      })
    );
    await page.route("**/data/interrail/index.json*", (r) =>
      r.fulfill({ contentType: "application/json", body: JSON.stringify({ vuelos: ["ir-vuelo-MAD-VIE-2026-11-06-ida"] }) })
    );
    await abrir(page);
    await elegir(page, "VIE", "BUD");
    const chip = page.locator('.ir-ruta.elegida [data-ir-mover="ida"]');
    await expect(chip).toHaveCount(1);
    await expect(chip).toContainText("23 €");
    await chip.click();
    await expect(page.locator("#irIda")).toHaveValue("2026-11-04");
  });

  test("la vuelta se mueve con las noches de la última parada", async ({ page }) => {
    await page.route("**/data/interrail/ir-vuelo-MAD-BUD-2026-11-10-vuelta.json*", (r) =>
      r.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          legs: [{ price: 90, airline: "Ryanair", origin: "BUD", destination: "MAD" }],
          dias: { "2026-11-11": { price: 40, airline: "Wizz Air", origin: "BUD", destination: "MAD" } },
        }),
      })
    );
    await page.route("**/data/interrail/index.json*", (r) =>
      r.fulfill({ contentType: "application/json", body: JSON.stringify({ vuelos: ["ir-vuelo-MAD-BUD-2026-11-10-vuelta"] }) })
    );
    await abrir(page);
    await elegir(page, "VIE", "BUD");
    await page.locator('.ir-ruta.elegida [data-ir-mover="vuelta"]').click();
    // Budapest pasa de dos noches a tres, y la vuelta al 11.
    await expect(page.locator(".ir-ruta.elegida .ir-ev-ciudad").last()).toContainText("3 noches");
    await expect(page.locator(".ir-ruta.elegida .ir-res-datos")).toContainText("mié 11 nov");
  });
});

test.describe("los horarios, compartir y el calendario", () => {
  test("cada tren enlaza a los horarios de ese día", async ({ page }) => {
    await abrir(page);
    await elegir(page, "VIE", "BUD");
    const enlace = page.locator(".ir-ruta.elegida .ir-ev-tren a.ir-ev-accion");
    await expect(enlace).toHaveAttribute("href", /int\.bahn\.de/);
    await expect(enlace).toHaveAttribute("href", /hd=2026-11-08T08:00/);
    await expect(enlace).toHaveAttribute("href", /Wien%20Hbf/);
  });

  test("el enlace del plan abre el mismo viaje en otro navegador", async ({ page, browser }) => {
    await abrir(page);
    await elegir(page, "PRG", "VIE");
    await page.locator('input[name="irPase"][value="si"]').check();
    const url = await page.evaluate(async () => {
      const m = await import("./js/interrail.js");
      return m.enlacePlan(
        { ciudades: ["PRG", "VIE"], ida: "2026-11-06", vuelta: "", adultos: 3, origen: "BCN", tengoPase: true, dias: 5, edad: "adulto" },
        { propia: true, id: "tuya" }
      );
    });
    const otro = await (await browser.newContext({ timezoneId: "Europe/Madrid" })).newPage();
    await otro.goto(url.replace(/^https?:\/\/[^/]+/, "http://localhost:4173"));
    await expect(otro.locator(".ir-ruta.elegida .ir-etiqueta")).toHaveText("tu ruta");
    expect(await paradas(otro)).toEqual(["Praga", "Viena"]);
    await expect(otro.locator("#irPersonas")).toHaveValue("3");
    await expect(otro.locator("#irOrigen")).toHaveValue("BCN");
    await expect(otro.locator('input[name="irPase"][value="si"]')).toBeChecked();
  });

  test("el calendario lleva los vuelos, cada ciudad y cada tren", async ({ page }) => {
    await abrir(page);
    await elegir(page, "VIE", "BUD");
    const ics = await page.evaluate(async () => {
      const m = await import("./js/interrail.js");
      const r = m.rutaPropia(["VIE", "BUD"]);
      return m.calendarioPlan(r, { ida: "2026-11-06", adultos: 2, origen: "MAD", ciudades: ["VIE", "BUD"] });
    });
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("SUMMARY:Viena · 2 noches");
    expect(ics).toContain("SUMMARY:Tren Viena → Budapest");
    expect(ics).toContain("SUMMARY:Vuelo Madrid → Viena");
    expect(ics).toContain("SUMMARY:Vuelo Budapest → Madrid");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261106");
  });
});
