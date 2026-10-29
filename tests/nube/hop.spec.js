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

const enDias = (n) => {
  const d = new Date(Date.now() + n * 864e5);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const dentroDeUnMes = () => {
  const d = new Date(Date.now() + 30 * 864e5);
  return d.toISOString().slice(0, 10);
};

async function crear(page, nombre) {
  await page.goto("/hop.html");
  // Con algún HOP ya hecho, crear otro va plegado.
  const caja = page.locator("#hopCrearCaja");
  if (!(await caja.evaluate((d) => d.open))) await caja.locator("summary").click();
  await page.locator("#hopCrear [name=nombre]").fill(nombre);
  await page.locator("#hopCrear [name=fin]").fill(dentroDeUnMes());
  await page.locator("#hopCrear button[type=submit]").click();
  await expect(page.locator(".hopx-portada h2")).toHaveText(nombre);
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

test("con el enlace se une cualquiera, se proponen fechas, se votan y se habla", async ({ browser }) => {
  test.setTimeout(60000);
  const ana = await persona(browser, "Ana");
  await E.hacerPremium(ana.uid);
  const id = await crear(ana.page, "Escapada");

  const gus = await persona(browser, "Gus");
  await gus.page.goto(`/hop.html?j=${id}`);
  await expect(gus.page.locator(".hop-unirse")).toContainText("Lo organiza Ana");
  await gus.page.locator("#hopUnirme").click();
  await expect(gus.page.locator(".hopx-portada h2")).toHaveText("Escapada");

  // Fase 1: Gus propone unas fechas y les da su voto.
  await expect(gus.page.locator(".hopx-fase-cab h3")).toHaveText("Cuándo");
  await gus.page.locator("#f1Form [name=ida]").fill(enDias(8));
  await gus.page.locator("#f1Form [name=vuelta]").fill(enDias(10));
  await gus.page.locator("#f1Form [name=titulo]").fill("Puente");
  await gus.page.locator("#f1Form button[type=submit]").click();
  const prop = gus.page.locator(".hopx-fechas-carta", { hasText: "Puente" });
  await prop.locator('[data-voto="si"]').click();
  await expect(prop.locator('[data-voto="si"]')).toHaveAttribute("aria-pressed", "true");

  // El chat va plegado: se abre con su botón.
  await expect(gus.page.locator("#hopChat")).toBeHidden();
  await gus.page.locator("#hopChatBoton").click();
  await gus.page.locator("#hopEscribir textarea").fill("¿Os vale el puente?");
  await gus.page.locator("#hopEscribir button").click();
  await expect(gus.page.locator(".hop-msj.mio")).toContainText("¿Os vale el puente?");

  // Ana lo ve todo, vota y contesta.
  await ana.page.goto(`/hop.html?j=${id}`);
  const suya = ana.page.locator(".hopx-fechas-carta", { hasText: "Puente" });
  // Como en Reddit: uno a favor, un punto; uno en contra lo deja en cero.
  await expect(suya.locator(".hopx-puntos")).toHaveText("1");
  await expect(suya).toContainText("Falta: Ana");
  await suya.locator('[data-voto="no"]').click();
  await expect(suya.locator(".hopx-puntos")).toHaveText("0");
  await expect(suya).toContainText("Ya han votado todos");
  await ana.page.locator("#hopChatBoton").click();
  await expect(ana.page.locator(".hop-msj").first()).toContainText("¿Os vale el puente?");
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

/* El HOP entero, por fases: se fijan las fechas, se tacha una ciudad, se
   busca, se guarda lo que convence (un vuelo, y otro con su alojamiento), se
   vota lo guardado y el ganador es el plan, que se retoca. El workflow se hace
   a mano: se publica en `resultados/` lo que dejaría al acabar. */
test("por fases: fechas, vetos, buscar y guardar, votar y el plan", async ({ browser }) => {
  test.setTimeout(120000);
  const ana = await persona(browser, "Ana");
  await E.hacerPremium(ana.uid);
  const id = await crear(ana.page, "Finde");
  const gus = await persona(browser, "Gus");
  await gus.page.goto(`/hop.html?j=${id}`);
  await gus.page.locator("#hopUnirme").click();
  await expect(gus.page.locator(".hopx-portada h2")).toHaveText("Finde");

  // 1. Ana propone fechas, las vota y las fija.
  await ana.page.reload();
  await ana.page.locator("#f1Form [name=ida]").fill(enDias(10));
  await ana.page.locator("#f1Form [name=vuelta]").fill(enDias(12));
  await ana.page.locator("#f1Form button[type=submit]").click();
  await ana.page.locator('.hopx-fechas-carta [data-voto="si"]').click();
  await ana.page.locator("[data-fijar]").click();
  await expect(ana.page.locator(".hopx-fase-cab h3")).toHaveText("Dónde no");

  // 2. Gus llega a la fase en la que está el grupo y tacha Roma. Siendo uno de
  // dos, es más de un tercio: Roma queda fuera.
  await gus.page.reload();
  await expect(gus.page.locator(".hopx-fase-cab h3")).toHaveText("Dónde no");
  await gus.page.locator("#f2Buscar").fill("Rom");
  await gus.page.locator("[data-tachar]").first().click();
  await expect(gus.page.locator("#f2Todas")).toContainText("fuera de la búsqueda");
  // Y sale en el mapa, en naranja.
  await expect(gus.page.locator("#f2Puntos .hopx-punto.fuera")).toHaveCount(1);
  await expect(gus.page.locator("#f2Cuenta")).toContainText("1 de 3");

  // 3. Buscar: con las fechas fijadas y sin Roma. Lo lanza Gus, que es gratis.
  await gus.page.locator('[data-ir-fase="3"]').click();
  await expect(gus.page.locator("#hopBuscarForm .hopx-fijo")).toBeVisible();
  await expect(gus.page.locator(".hopx-tachadas")).toContainText("Roma");
  await gus.page.locator("#hopBuscarForm button[type=submit]").click();
  await expect(gus.page.locator(".hop-buscando")).toContainText("Buscando vuelos");
  const [encargo] = await E.encargosDe(gus.uid);
  expect(encargo.payload.viaje).toMatchObject({ hop: id, depart: enDias(10), return_date: enDias(12) });
  expect(encargo.payload.viaje.sin).toContain("FCO");
  const clave = encargo.payload.viaje.clave;

  // Ids nuevos en cada pasada: el emulador guarda los resultados de la anterior.
  const tanda = Date.now().toString(36);
  const oferta = (ofid, iata, ciudad, pais, precio) => ({
    id: ofid, provider: "ryanair", origin: "MAD", destination: iata, destination_name: ciudad, destination_country: pais,
    depart_date: enDias(10), return_date: enDias(12), depart_time: "07:10", arrive_time: "09:00", nights: 2,
    price: precio, airline: "Ryanair", deep_link: "https://www.ryanair.com/x", adults: 2,
  });
  await E.publicarResultado(`busqueda-${clave}`, {
    offers: [oferta(`OPO-${tanda}`, "OPO", "Oporto", "Portugal", 80), oferta(`LIS-${tanda}`, "LIS", "Lisboa", "Portugal", 100),
      oferta(`BER-${tanda}`, "BER", "Berlín", "Alemania", 140)],
  });
  await expect(gus.page.locator(".hopx-res")).toHaveCount(3, { timeout: 20000 });
  // Los resultados no se votan: se guardan.
  const opo = gus.page.locator(".hopx-res", { hasText: "Oporto" });
  await expect(opo).toContainText("40 €");
  await opo.locator("[data-guardar]").click();
  await expect(opo.locator("[data-guardar]")).toContainText("Guardada");

  // Lisboa, con alojamiento: se busca, llega y se guarda junto al vuelo.
  const lis = gus.page.locator(".hopx-res", { hasText: "Lisboa" });
  await lis.locator("[data-camas]").click();
  await expect(lis.locator(".hop-buscando")).toBeVisible();
  const stay = (await E.encargosDe(gus.uid)).find((e) => e.tipo === "stay");
  expect(stay.payload).toMatchObject({ offer_id: `LIS-${tanda}`, hop: id, adults: "2" });
  await E.publicarResultado(`stay-LIS-${tanda}`, {
    stays: [{ provider: "booking", name: "Casa do Fado", url: "https://www.booking.com/a", price_total: 120, rating: 9 }],
  });
  await expect(lis.locator(".hopx-camas li")).toHaveCount(1, { timeout: 20000 });
  await lis.locator(".hopx-camas [data-guardar]").click();
  await expect(lis.locator(".hopx-camas [data-guardar]")).toContainText("Guardada");

  // 4. Votar entre las dos guardadas, deslizando: Oporto sí, Lisboa no.
  await gus.page.locator('[data-ir-fase="4"]').click();
  await expect(gus.page.locator(".hopx-carta")).toHaveCount(2);
  await expect(gus.page.locator(".hopx-carta", { hasText: "Lisboa" })).toContainText("Casa do Fado");
  await gus.page.locator('[data-rapido="guardada"]').click();
  const capa = gus.page.locator(".hopx-desliza");
  for (let i = 0; i < 2; i++) {
    await expect(capa.locator(".hopx-progreso")).toContainText(`${i + 1} de 2`);
    const txt = await capa.locator(".hopx-dcarta:not(.atras)").textContent();
    await capa.locator(txt.includes("Oporto") ? '[data-rv="si"]' : '[data-rv="no"]').click();
  }
  await expect(capa).toContainText("Votado");
  await capa.locator("[data-cerrar]").click();

  // Ana, que sigue al grupo, vota y elige: el plan.
  await ana.page.reload();
  await expect(ana.page.locator(".hopx-fase-cab h3")).toHaveText("Votar");
  await ana.page.locator(".hopx-carta", { hasText: "Oporto" }).locator('[data-voto="si"]').click();
  await ana.page.locator("[data-elegir]").click();
  await expect(ana.page.locator(".hopx-fase-cab h3")).toHaveText("El plan");
  await expect(ana.page.locator(".hopx-plan")).toContainText("Oporto");
  await expect(ana.page.locator(".hopx-plan-total b")).toHaveText("40 €");

  // 5. Se retoca: dónde dormir, lo que cuesta y una nota.
  await ana.page.locator("[data-editar-plan]").click();
  await ana.page.locator("#hopPlanForm [name=cama]").fill("Piso en la Ribeira");
  await ana.page.locator("#hopPlanForm [name=cama_precio]").fill("30");
  await ana.page.locator("#hopPlanForm [name=nota]").fill("T1 a las 6");
  await ana.page.locator("#hopPlanForm button[type=submit]").click();
  await expect(ana.page.locator(".hopx-plan-total b")).toHaveText("70 €");
  await expect(ana.page.locator(".hopx-plan")).toContainText("T1 a las 6");
  // Y Gus lo ve.
  await gus.page.reload();
  await expect(gus.page.locator(".hopx-plan")).toContainText("Piso en la Ribeira");
  await gus.ctx.close();
  await ana.ctx.close();
});

/* Con el enlace se mira sin cuenta; para hacer algo se pide la cuenta, y lo
   empezado no se pierde: al crearla se entra en el HOP y se sube solo. */
test("sin cuenta se mira el HOP; al proponer se pide la cuenta y luego se sube solo", async ({ browser }) => {
  test.setTimeout(90000);
  const ana = await persona(browser, "Ana");
  await E.hacerPremium(ana.uid);
  const id = await crear(ana.page, "Escapada");
  await ana.page.locator("#f1Form [name=ida]").fill(enDias(8));
  await ana.page.locator("#f1Form [name=vuelta]").fill(enDias(10));
  await ana.page.locator("#f1Form [name=titulo]").fill("Puente");
  await ana.page.locator("#f1Form button[type=submit]").click();
  await expect(ana.page.locator(".hopx-fechas-carta")).toHaveCount(1);

  const ctx = await browser.newContext({ baseURL: "http://localhost:4173", timezoneId: "Europe/Madrid" });
  await ctx.addInitScript((c) => {
    window.TF_NUBE = c;
  }, E.CONFIG);
  const page = await ctx.newPage();
  await page.goto(`/hop.html?j=${id}`);
  await expect(page.locator(".hopx-portada h2")).toHaveText("Escapada");
  await expect(page.locator(".hopx-invitado")).toContainText("Estás mirando el HOP de Ana");
  // Se ve lo propuesto, en el calendario y en su carta.
  await expect(page.locator(".hopx-fechas-carta")).toContainText("Puente");
  await expect(page.locator(".hopx-cal-rayas i").first()).toBeVisible();
  // Votar pide la cuenta.
  await page.locator('.hopx-fechas-carta [data-voto="si"]').click();
  await expect(page.locator("#tfModal")).toContainText("Crea tu cuenta para votar");
  await page.locator("#tfModal [data-cerrar]").first().click();
  // Proponer, también, pero se queda guardado.
  await page.locator(`[data-dia-cal="${enDias(15)}"]`).click();
  await page.locator(`[data-dia-cal="${enDias(17)}"]`).click();
  await expect(page.locator("#f1Form [name=vuelta]")).toHaveValue(enDias(17));
  await page.locator("#f1Form [name=titulo]").fill("El otro finde");
  await page.locator("#f1Form button[type=submit]").click();
  await expect(page.locator("#tfModal")).toContainText("Crea tu cuenta para proponer estas fechas");
  await page.locator("#tfModal [data-hop-entrar]").click();
  // Se registra desde aquí mismo.
  await page.locator("#nubeCorreo").fill(E.correoNuevo());
  await page.locator("#nubePass").fill(clave);
  await page.locator("#nubeForm button[type=submit]").click();
  await expect(page.locator("#nubeBienvenida")).toBeVisible();
  await page.locator("#nubeNombre").fill("Lía");
  await Promise.all([page.waitForEvent("load"), page.locator("#nubeListo").click()]);
  // Dentro, sin pasar por «unirme», y con su propuesta subida.
  await expect(page.locator(".hopx-invitado")).toHaveCount(0);
  await expect(page.locator(".hopx-fechas-carta", { hasText: "El otro finde" })).toBeVisible({ timeout: 15000 });
  await expect(ana.page.locator(".hopx-portada")).toContainText("Escapada");
  await ctx.close();
  await ana.ctx.close();
});

/* Tus HOP, grandes: en qué fase va cada uno, si te toca y qué te has perdido. */
test("la lista dice en qué va cada HOP, si te toca votar y lo nuevo desde la última vez", async ({ browser }) => {
  test.setTimeout(90000);
  const ana = await persona(browser, "Ana");
  await E.hacerPremium(ana.uid);
  const id = await crear(ana.page, "Escapada");
  const gus = await persona(browser, "Gus");
  await gus.page.goto(`/hop.html?j=${id}`);
  await gus.page.locator("#hopUnirme").click();
  await expect(gus.page.locator(".hopx-portada h2")).toHaveText("Escapada");
  // Ana propone unas fechas y escribe; Gus no está mirando.
  await gus.page.goto("/hop.html");
  await ana.page.locator("#f1Form [name=ida]").fill(enDias(8));
  await ana.page.locator("#f1Form [name=vuelta]").fill(enDias(10));
  await ana.page.locator("#f1Form button[type=submit]").click();
  await expect(ana.page.locator(".hopx-fechas-carta")).toHaveCount(1);
  await ana.page.locator("#hopChatBoton").click();
  await ana.page.locator("#hopEscribir textarea").fill("¿Os vale?");
  await ana.page.locator("#hopEscribir button").click();
  await expect(ana.page.locator(".hop-msj.mio")).toBeVisible();

  await gus.page.reload();
  const tarjeta = gus.page.locator(".hopv", { hasText: "Escapada" });
  await expect(tarjeta).toContainText("1 fecha propuesta");
  await expect(tarjeta.locator(".hopv-toca")).toContainText("Te toca votar 1 fecha");
  await expect(tarjeta.locator(".hopv-nuevo")).toContainText("1 mensaje y 1 propuesta nuevos");
  await expect(tarjeta.locator(".hopv-badge")).toHaveText("2");
  // Crear otro va plegado, sin protagonismo.
  await expect(gus.page.locator("#hopCrearCaja")).not.toHaveAttribute("open", "");
  // Al entrar y volver, ya no hay nada nuevo.
  await tarjeta.click();
  await expect(gus.page.locator(".hopx-portada h2")).toHaveText("Escapada");
  await gus.page.goto("/hop.html");
  await expect(gus.page.locator(".hopv-badge")).toHaveCount(0);
  await gus.ctx.close();
  await ana.ctx.close();
});
