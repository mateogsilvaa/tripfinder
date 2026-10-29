/* El modo HOP contra los emuladores: crear (premium), invitar, unirse (cualquier
   cuenta), proponer, votar y hablar. Y el tope: un HOP activo en premium, los
   que quieras en Max. */
const { test, expect } = require("@playwright/test");
const E = require("./emulador.js");

const clave = "una-clave-larga-1";

async function persona(browser, nombre) {
  const ctx = await browser.newContext({ baseURL: "http://localhost:4173", timezoneId: "Europe/Madrid" });
  await ctx.addInitScript((c) => {
    window.TF_NUBE = c;
  }, E.CONFIG);
  const page = await ctx.newPage();
  await page.goto("/index.html");
  await page.locator("#tfCuenta").click();
  await page.locator("#nubeCorreo").fill(E.correoNuevo());
  await page.locator("#nubePass").fill(clave);
  await page.locator("#nubeForm button[type=submit]").click();
  await expect(page.locator("#nubeBienvenida")).toBeVisible();
  await page.locator("#nubeNombre").fill(nombre);
  await Promise.all([page.waitForEvent("load"), page.locator("#nubeListo").click()]);
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem("tf_sesion")));
  return { ctx, page, uid: s.uid };
}

const dentroDeUnMes = () => {
  const d = new Date(Date.now() + 30 * 864e5);
  return d.toISOString().slice(0, 10);
};

async function crear(page, nombre) {
  await page.goto("/hop.html");
  await page.locator("#hopCrear [name=nombre]").fill(nombre);
  await page.locator("#hopCrear [name=fin]").fill(dentroDeUnMes());
  await page.locator("#hopCrear button[type=submit]").click();
  await expect(page.locator(".hop-top h2")).toHaveText(nombre);
  return new URL(page.url()).searchParams.get("j");
}

test("gratis no crea un HOP; premium sí, y lo comparte con un enlace", async ({ browser }) => {
  const gus = await persona(browser, "Gus");
  await gus.page.goto("/hop.html");
  await expect(gus.page.locator(".hop-crear")).toContainText("Crear un HOP es de premium");
  await expect(gus.page.locator("#hopCrear")).toHaveCount(0);

  const ana = await persona(browser, "Ana");
  await E.hacerPremium(ana.uid);
  const id = await crear(ana.page, "Roma en primavera");
  await expect(ana.page.locator("#hopEnlace")).toContainText(`?j=${id}`);
  await gus.ctx.close();
  await ana.ctx.close();
});

test("con el enlace se une cualquiera, y se propone, se vota y se habla", async ({ browser }) => {
  test.setTimeout(60000);
  const ana = await persona(browser, "Ana");
  await E.hacerPremium(ana.uid);
  const id = await crear(ana.page, "Escapada");

  const gus = await persona(browser, "Gus");
  await gus.page.goto(`/hop.html?j=${id}`);
  await expect(gus.page.locator(".hop-unirse")).toContainText("Lo organiza Ana");
  await gus.page.locator("#hopUnirme").click();
  await expect(gus.page.locator(".hop-top h2")).toHaveText("Escapada");

  // Gus propone un viaje.
  await gus.page.locator("#hopOtras summary").click();
  await gus.page.locator('[data-nueva="viaje"]').click();
  await gus.page.locator("#hopPropForm [name=titulo]").fill("Lisboa barata");
  await gus.page.locator("#hopPropForm [name=destino]").fill("Lisboa");
  await gus.page.locator("#hopPropForm [name=precio]").fill("79");
  await gus.page.locator("#hopPropForm button[type=submit]").click();
  const prop = gus.page.locator(".hop-prop", { hasText: "Lisboa barata" });
  await expect(prop).toContainText("79 €");
  await prop.locator('[data-voto="si"]').click();
  await expect(prop.locator('[data-voto="si"]')).toHaveAttribute("aria-pressed", "true");

  // Y escribe en el chat.
  await gus.page.locator("#hopEscribir textarea").fill("¿Lisboa en mayo?");
  await gus.page.locator("#hopEscribir button").click();
  await expect(gus.page.locator(".hop-msj.mio")).toContainText("¿Lisboa en mayo?");

  // Ana lo ve todo, vota y contesta.
  await ana.page.goto(`/hop.html?j=${id}`);
  await ana.page.locator("#hopOtras summary").click();
  const suya = ana.page.locator(".hop-prop", { hasText: "Lisboa barata" });
  await expect(suya.locator('[data-voto="si"] b')).toHaveText("1");
  await expect(suya).toContainText("Falta: Ana");
  await suya.locator('[data-voto="quiza"]').click();
  await expect(suya).toContainText("Ya han votado todos");
  await expect(ana.page.locator(".hop-msj").first()).toContainText("¿Lisboa en mayo?");
  await ana.page.locator("#hopEscribir textarea").fill("Me vale");
  await ana.page.keyboard.press("Enter");

  // Y a Gus le llega solo, sin recargar.
  await expect(gus.page.locator(".hop-msj:not(.mio)")).toContainText("Me vale", { timeout: 10000 });
  await gus.ctx.close();
  await ana.ctx.close();
});

test("premium tiene un HOP activo; Max, los que quiera", async ({ browser }) => {
  const ana = await persona(browser, "Ana");
  await E.hacerPremium(ana.uid);
  await crear(ana.page, "La primera");
  await ana.page.goto("/hop.html");
  await expect(ana.page.locator(".hop-crear")).toContainText("Ya tienes un HOP activo");
  // Ni saltándose la página.
  const r = await ana.page.evaluate((f) => nubeHopCrear({ nombre: "Otra", fin: f }), dentroDeUnMes());
  expect(r.ok).toBe(false);

  const max = await persona(browser, "Max");
  await E.poner(max.uid, { estado: "aprobado", plan: "max" });
  await crear(max.page, "Una");
  await crear(max.page, "Dos");
  await max.page.goto("/hop.html");
  await expect(max.page.locator(".hop-tarjeta")).toHaveCount(2);
  await expect(max.page.locator(".hop-cupo")).toContainText("sin límite");
  await ana.ctx.close();
  await max.ctx.close();
});

test("quien lo crea lo borra, y entonces puede crear otro", async ({ browser }) => {
  const ana = await persona(browser, "Ana");
  await E.hacerPremium(ana.uid);
  await crear(ana.page, "Para borrar");
  ana.page.on("dialog", (d) => d.accept());
  await ana.page.locator("#hopBorrar").click();
  await ana.page.waitForURL(/hop$/);
  await expect(ana.page.locator("#hopCrear")).toBeVisible();
  await ana.ctx.close();
});

/* El corazón del HOP: se busca desde el grupo, los resultados entran como
   tarjetas, se votan (también en «votar rápido») y el más votado sale en el
   resumen; con él se busca dónde dormir, que se vota igual. El workflow se
   hace a mano: se publica en `resultados/` lo que dejaría al acabar. */
test("buscar en grupo: los vuelos llegan como tarjetas, se votan y arman el viaje", async ({ browser }) => {
  test.setTimeout(90000);
  const ana = await persona(browser, "Ana");
  await E.hacerPremium(ana.uid);
  await crear(ana.page, "Finde");
  const id = new URL(ana.page.url()).searchParams.get("j");
  const gus = await persona(browser, "Gus");
  await gus.page.goto(`/hop.html?j=${id}`);
  await gus.page.locator("#hopUnirme").click();
  await expect(gus.page.locator(".hop-top h2")).toHaveText("Finde");

  // Ana busca: donde sea, un finde, 2 personas (los del grupo).
  await ana.page.reload();
  await expect(ana.page.locator("#hopBuscarForm [name=personasVer]")).toHaveText("2");
  await ana.page.locator('#hopBuscarForm [data-seg="donde"] [data-v="any"]').click();
  await ana.page.locator("#hopBuscarForm button[type=submit]").click();
  await expect(ana.page.locator(".hop-buscando")).toContainText("Buscando vuelos");
  const [encargo] = await E.encargosDe(ana.uid);
  expect(encargo).toMatchObject({ tipo: "search" });
  expect(encargo.payload.adults).toBe("2");
  const clave = encargo.payload.viaje.clave;
  expect(clave).toMatch(/^[a-z0-9-]+$/);

  // Gus lo ve en marcha sin tocar nada.
  await gus.page.reload();
  await expect(gus.page.locator(".hop-buscando")).toContainText("lo lanzó Ana");

  const oferta = (id, ciudad, pais, precio) => ({
    id, provider: "ryanair", origin: "MAD", destination: id.slice(0, 3), destination_name: ciudad,
    destination_country: pais, depart_date: "2026-12-11", return_date: "2026-12-13", depart_time: "07:10",
    arrive_time: "09:00", nights: 2, price: precio, airline: "Ryanair", deep_link: "https://www.ryanair.com/x", adults: 2,
  });
  await E.publicarResultado(`busqueda-${clave}`, {
    label: "x",
    offers: [oferta("OPO-1", "Oporto", "Portugal", 80), oferta("BCN-1", "Barcelona", "España", 60), oferta("ROM-1", "Roma", "Italia", 140)],
  });
  // Entran solos, en la siguiente vuelta del sondeo.
  await expect(gus.page.locator("#hopVuelos .hop-vuelo")).toHaveCount(3, { timeout: 20000 });
  await expect(gus.page.locator("#hopVuelos")).toContainText("Oporto");
  await expect(gus.page.locator("#hopVuelos")).toContainText("40 €"); // por persona

  // Gus vota rápido: Oporto sí, el resto no.
  await gus.page.locator('[data-rapido="vuelo"]').click();
  const capa = gus.page.locator(".hop-rapido");
  for (let i = 0; i < 3; i++) {
    await expect(capa.locator(".hop-rapido-cab")).toContainText(`${i + 1} de 3`);
    const txt = await capa.locator(".hop-rapido-tarjeta").textContent();
    await capa.locator(txt.includes("Oporto") ? '[data-rv="si"]' : '[data-rv="no"]').click();
  }
  await expect(capa).toContainText("¡Ya está!");
  await capa.locator("[data-cerrar-rapido]").click();
  await expect(gus.page.locator("#hopResumen")).toContainText("Oporto");
  await expect(gus.page.locator("#hopResumen")).toContainText("1 de 2");

  // Ana lo ve y vota también; luego busca dónde dormir.
  await ana.page.reload();
  const opo = ana.page.locator("#hopVuelos .hop-vuelo", { hasText: "Oporto" });
  await opo.locator('[data-voto="si"]').click();
  await expect(ana.page.locator("#hopResumen")).toContainText("2 de 2");
  await ana.page.locator("[data-hop-cama]").click();
  await expect(ana.page.locator("#hopCamas .hop-buscando")).toBeVisible();
  const stay = (await E.encargosDe(ana.uid)).find((e) => e.tipo === "stay");
  expect(stay.payload).toMatchObject({ offer_id: "OPO-1", checkin: "2026-12-11", adults: "2" });
  await E.publicarResultado("stay-OPO-1", {
    stays: [
      { provider: "booking", name: "Casa do Rio", url: "https://www.booking.com/a", price_total: 180, rating: 9.1, km_centro: 0.6 },
      { provider: "booking", name: "Hostal Ribeira", url: "https://www.booking.com/b", price_total: 90, rating: 8.2 },
    ],
  });
  await expect(ana.page.locator("#hopCamas .hop-cama")).toHaveCount(2, { timeout: 20000 });
  await ana.page.locator("#hopCamas .hop-cama", { hasText: "Casa do Rio" }).locator('[data-voto="si"]').click();
  // El resumen: vuelo + cama, por persona: 40 + 90.
  await expect(ana.page.locator("#hopResumen")).toContainText("Casa do Rio");
  await expect(ana.page.locator(".hop-pase-total")).toContainText("130 €");
  await gus.ctx.close();
  await ana.ctx.close();
});
