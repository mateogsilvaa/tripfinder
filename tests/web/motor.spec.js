/* El motor de recomendación (#8), probado como lo que es: una función pura.

   Se carga en la página porque los módulos dependen de `tfClave`, que vive en
   `log.js` y necesita un navegador. A partir de ahí, todo son entradas y
   salidas: no se pulsa nada. */
const { test, expect } = require("@playwright/test");

/* Un catálogo de mentira pero verosímil: mismos campos que `offers.json`. */
const OFERTAS = [
  // Playa, barato, en tres países distintos.
  o({ id: "1", destination: "PMI", pais: "España", price: 60, nights: 3, score: 88, useful: 40 }),
  o({ id: "2", destination: "FAO", pais: "Portugal", price: 75, nights: 3, score: 84, useful: 38 }),
  o({ id: "3", destination: "CAG", pais: "Italia", price: 90, nights: 2, score: 80, useful: 30 }),
  // Más playa española: la diversidad tiene que dejarlas fuera del podio.
  o({ id: "4", destination: "IBZ", pais: "España", price: 65, nights: 3, score: 90, useful: 41 }),
  o({ id: "5", destination: "LPA", pais: "España", price: 70, nights: 3, score: 86, useful: 39 }),
  // Ciudad: no encaja con "playa" pero existe.
  o({ id: "6", destination: "PRG", pais: "República Checa", price: 55, nights: 3, score: 92, useful: 42 }),
  // Cara: por encima de cualquier tope razonable.
  o({ id: "7", destination: "NAP", pais: "Italia", price: 240, nights: 3, score: 70, useful: 40 }),
  // De madrugada: llega a las 23:40.
  o({ id: "8", destination: "BRI", pais: "Italia", price: 62, nights: 3, score: 85, useful: 20, llega: "23:40" }),
  // Una noche: fuera de un rango 2-4.
  o({ id: "9", destination: "AGP", pais: "España", price: 40, nights: 1, score: 95, useful: 14 }),
  // Otro continente.
  o({ id: "10", destination: "CUN", pais: "México", price: 420, nights: 8, score: 89, useful: 120, lejos: true }),
  // Con escala: barata y bien puntuada a propósito, para que solo la deje
  // fuera el filtro de "directo" y no el orden.
  o({ id: "11", destination: "ALC", pais: "España", price: 35, nights: 3, score: 96, useful: 44, escalas: 1 }),
];

function o({ id, destination, pais, price, nights, score, useful, llega = "12:30", lejos = false, escalas = 0 }) {
  const salida = new Date();
  salida.setDate(salida.getDate() + 60);
  const ida = salida.toISOString().slice(0, 10);
  const vuelta = new Date(salida);
  vuelta.setDate(vuelta.getDate() + nights);
  return {
    id, provider: "prueba", origin: "MAD", destination,
    destination_name: destination, destination_country: pais,
    depart_date: ida, return_date: vuelta.toISOString().slice(0, 10),
    price, price_per_person: price, currency: "EUR", adults: 1,
    nights, score, discount_pct: 40, useful_hours: useful, price_per_hour: price / useful,
    weekend: true, long_haul: lejos, stops: escalas,
    depart_time: "09:00", arrive_time: llega, return_time: "18:00",
  };
}

/* Corre `fn` dentro de la página, con el motor y los perfiles ya cargados. */
async function enElMotor(page, fn, ...args) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  return page.evaluate(
    async ({ cuerpo, args: a }) => {
      const motor = await import("./js/motor.js");
      const perfiles = await (await fetch("perfiles.json")).json();
      motor.ponerPerfiles(perfiles);
      // eslint-disable-next-line no-new-func
      return new Function("motor", "args", `return (${cuerpo})(motor, ...args);`)(motor, a);
    },
    { cuerpo: fn.toString(), args }
  );
}

const PERFIL_PLAYA = {
  apetece: "playa", noches: [2, 4], tope: 100, personas: 2,
  madrugar: false, meses: 6, finde: true, lejos: false, prioridad: "equilibrio",
};

test.describe("el motor de recomendación", () => {
  test("«playa, 2 noches, menos de 100 €» da tres países distintos", async ({ page }) => {
    const r = await enElMotor(page, (m, ofertas, perfil) => {
      const res = m.recomendar(ofertas, perfil);
      return {
        n: res.destinos.length,
        iatas: res.destinos.map((x) => x.destination),
        paises: res.destinos.map((x) => x.destination_country),
        precios: res.destinos.map((x) => x.price_per_person),
        relajado: res.relajado,
      };
    }, OFERTAS, PERFIL_PLAYA);

    expect(r.n).toBe(3);
    expect(new Set(r.paises).size).toBe(3);
    expect(Math.max(...r.precios)).toBeLessThanOrEqual(100);
    expect(r.relajado).toBe(false);
    // Y las tres son de playa, no la ciudad barata que puntúa alto por lo demás.
    expect(r.iatas).not.toContain("PRG");
  });

  test("no repite país aunque las mejores sean todas del mismo", async ({ page }) => {
    const paises = await enElMotor(page, (m, ofertas, perfil) =>
      m.recomendar(ofertas, perfil).destinos.map((x) => x.destination_country),
      OFERTAS, PERFIL_PLAYA);
    expect(new Set(paises).size).toBe(paises.length);
  });

  test("con un tope imposible relaja y lo dice, nunca devuelve vacío mudo", async ({ page }) => {
    const r = await enElMotor(page, (m, ofertas, perfil) => {
      const res = m.recomendar(ofertas, { ...perfil, tope: 20 });
      return { n: res.destinos.length, relajado: res.relajado, aviso: res.aviso, tope: res.tope };
    }, OFERTAS, PERFIL_PLAYA);

    expect(r.relajado).toBe(true);
    expect(r.tope).toBeGreaterThan(20);
    expect(r.aviso).toMatch(/lo más cerca que hay|solo hay|lo más barato/i);
    expect(r.n).toBeGreaterThan(0);
  });

  test("y si de verdad no hay nada, dice qué aflojar", async ({ page }) => {
    const r = await enElMotor(page, (m, _ofertas, perfil) => {
      const res = m.recomendar([], perfil);
      return { n: res.destinos.length, aviso: res.aviso };
    }, OFERTAS, PERFIL_PLAYA);
    expect(r.n).toBe(0);
    expect(r.aviso).toMatch(/más meses|más noches|sin exigir/i);
  });

  // ------------------------------------------------------------- filtros duros
  test("lo que se dijo que no, no sale", async ({ page }) => {
    const r = await enElMotor(page, (m, ofertas, perfil) => {
      const con = (extra) =>
        ofertas.filter((x) => m.pasaLosFiltros(x, { ...perfil, ...extra }, 500)).map((x) => x.id);
      return {
        noches: con({}),
        madrugada: con({ madrugar: false }),
        conMadrugada: con({ madrugar: true }),
        cerca: con({ lejos: false }),
        // Ocho noches: un largo radio no cabe en un rango de finde, y eso es
        // correcto. Se afloja el rango para ver el filtro de continente solo.
        lejos: con({ lejos: true, noches: [2, 12] }),
      };
    }, OFERTAS, PERFIL_PLAYA);

    expect(r.noches).not.toContain("9");   // una noche, fuera del rango 2-4
    expect(r.madrugada).not.toContain("8"); // llega a las 23:40
    expect(r.conMadrugada).toContain("8");
    expect(r.cerca).not.toContain("10");   // otro continente
    expect(r.lejos).toEqual(["10"]);
  });

  test("«llegar de noche» es llegar tarde o salir de madrugada", async ({ page }) => {
    const r = await enElMotor(page, (m) => ({
      tarde: m.esDeMadrugada({ arrive_time: "23:40", depart_time: "18:00" }),
      pronto: m.esDeMadrugada({ arrive_time: "12:00", depart_time: "06:15" }),
      normal: m.esDeMadrugada({ arrive_time: "17:00", depart_time: "09:00" }),
      sinHoras: m.esDeMadrugada({}),
    }));
    expect(r).toEqual({ tarde: true, pronto: true, normal: false, sinHoras: false });
  });

  // -------------------------------------------------------------- la puntuación
  test("la afinidad distingue lo que es del todo de lo que es a medias", async ({ page }) => {
    const r = await enElMotor(page, (m) => ({
      // PMI es ["playa","noche"]: playa es lo primero.
      deLleno: m.afinidad("PMI", "playa"),
      // NAP es ["ciudad","gastronomia"]: acierta, pero de segundas.
      aMedias: m.afinidad("NAP", "gastronomia"),
      nada: m.afinidad("NAP", "playa"),
      sinPedirNada: m.afinidad("NAP", null),
      // Un destino que no está en la tabla vale como ciudad.
      desconocido: m.afinidad("ZZZ", "ciudad"),
    }));
    expect(r.deLleno).toBe(1);
    expect(r.aMedias).toBeCloseTo(0.7);
    expect(r.nada).toBe(0);
    expect(r.sinPedirNada).toBe(0.5);
    expect(r.desconocido).toBe(1);
  });

  /* El segundo gusto: la mitad de la tabla de perfiles (`noche`, 31 destinos)
     no se podía pedir por ningún sitio, y pedir dos cosas a la vez no existía.
     Suma, nunca descarta: si descartara, pedir dos cosas devolvería casi nada. */
  test("el segundo gusto suma sin descartar, y no pasa de uno", async ({ page }) => {
    const r = await enElMotor(page, (m) => ({
      // PMI es ["playa","noche"]: acierta con las dos.
      lasDos: m.afinidadCon("PMI", { apetece: "playa", ademas: "noche" }),
      // Solo con la principal: el segundo no resta.
      soloLaPrimera: m.afinidadCon("PMI", { apetece: "playa", ademas: "gastronomia" }),
      // Solo con el segundo: suma desde cero, no se queda en nada.
      soloElSegundo: m.afinidadCon("NAP", { apetece: "playa", ademas: "gastronomia" }),
      sinSegundo: m.afinidadCon("PMI", { apetece: "playa", ademas: null }),
      // Repetido no cuenta dos veces.
      repetido: m.afinidadCon("PMI", { apetece: "playa", ademas: "playa" }),
    }));
    expect(r.lasDos).toBe(1); // acotado a 1: los pesos suman uno
    expect(r.soloLaPrimera).toBe(1);
    expect(r.soloElSegundo).toBeCloseTo(0.7 * 0.35);
    expect(r.sinSegundo).toBe(1);
    expect(r.repetido).toBe(1);
  });

  test("pedir «y algo más» reordena, pero no deja a nadie fuera", async ({ page }) => {
    const r = await enElMotor(page, (m, ofertas, perfil) => {
      const cuantos = (ademas) =>
        m.recomendar(ofertas, { ...perfil, ademas }, 3).destinos.length;
      return { sin: cuantos(null), con: cuantos("noche") };
    }, OFERTAS, PERFIL_PLAYA);
    expect(r.sin).toBe(3);
    expect(r.con).toBe(3);
  });

  test("«directo» deja fuera las escalas, y «me da igual» no", async ({ page }) => {
    const r = await enElMotor(page, (m, ofertas, perfil) => {
      const ids = (directo) =>
        m.recomendar(ofertas, { ...perfil, apetece: null, tope: 200, directo }, 5)
          .destinos.map((o) => o.id);
      return { exigiendo: ids(true), dandoIgual: ids(false) };
    }, OFERTAS, PERFIL_PLAYA);
    // La 11 va con escala: solo sale cuando no se exige directo.
    expect(r.exigiendo).not.toContain("11");
    expect(r.dandoIgual).toContain("11");
  });

  /* Una oferta sin `stops` no es una oferta con escala: las que se guardaron
     antes de que ese campo existiera no pueden caerse por no tenerlo. */
  test("sin el dato de escalas, «directo» no descarta", async ({ page }) => {
    const r = await enElMotor(page, (m, ofertas, perfil) => {
      const vieja = { ...ofertas[0], id: "vieja" };
      delete vieja.stops;
      return m.pasaLosFiltros(vieja, { ...perfil, apetece: null, directo: true }, 200);
    }, OFERTAS, PERFIL_PLAYA);
    expect(r).toBe(true);
  });

  test("«que sea barato» y «que cunda» ordenan distinto", async ({ page }) => {
    const r = await enElMotor(page, (m, ofertas, perfil) => {
      const cabeza = (prioridad) =>
        m.recomendar(ofertas, { ...perfil, apetece: null, prioridad }).destinos[0];
      return { barato: cabeza("barato").price_per_person, cunda: cabeza("cunda").useful_hours };
    }, OFERTAS, PERFIL_PLAYA);
    // Con "barato" manda el precio; con "cunda", las horas útiles.
    expect(r.barato).toBeLessThanOrEqual(60);
    expect(r.cunda).toBeGreaterThanOrEqual(40);
  });

  test("los pesos suman uno en las tres prioridades", async ({ page }) => {
    const sumas = await enElMotor(page, (m) =>
      Object.values(m.PESOS).map((p) => Number(Object.values(p).reduce((a, b) => a + b, 0).toFixed(4)))
    );
    sumas.forEach((s) => expect(s).toBe(1));
  });

  // ------------------------------------------------------------------ el porqué
  test("el porqué nombra lo que de verdad pesó", async ({ page }) => {
    const r = await enElMotor(page, (m, ofertas, perfil) => {
      const pmi = ofertas.find((x) => x.destination === "PMI");
      const prg = ofertas.find((x) => x.destination === "PRG");
      return {
        encaja: m.porque(pmi, perfil, 100),
        noEncaja: m.porque(prg, { ...perfil, apetece: "playa" }, 100),
      };
    }, OFERTAS, PERFIL_PLAYA);

    expect(r.encaja).toMatch(/dijiste playa/);
    expect(r.encaja).toMatch(/3 noches/);
    expect(r.encaja).toMatch(/no hay que madrugar/);
    // Praga no es playa: en vez de disimularlo, lo dice de frente.
    expect(r.noEncaja).toMatch(/^No es playa, pero/);
    expect(r.noEncaja).toMatch(/por precio/i);
    expect(r.noEncaja).not.toMatch(/dijiste/);
    // Y la frase se lee: sin comas antes de la "y" ni "pero," sueltos.
    expect(r.encaja).not.toMatch(/, y /);
    expect(r.noEncaja).not.toMatch(/pero,/);
  });

  test("cada destino tiene su propio porqué", async ({ page }) => {
    const frases = await enElMotor(page, (m, ofertas, perfil) => {
      const res = m.recomendar(ofertas, perfil);
      return res.destinos.map((d) => m.porque(d, perfil, res.tope));
    }, OFERTAS, PERFIL_PLAYA);
    expect(new Set(frases).size).toBeGreaterThan(1);
  });

  // ------------------------------------------------------------------ perfiles
  test("todo IATA de offers.json resuelve a algo, sin lanzar", async ({ page }) => {
    const r = await enElMotor(page, async (m) => {
      const datos = await (await fetch(`data/offers.json?t=${Date.now()}`)).json();
      const iatas = [...new Set((datos.offers || []).map((x) => x.destination))];
      return iatas.map((c) => ({ c, tags: m.perfilDe(c) }));
    });
    expect(r.length).toBeGreaterThan(0);
    r.forEach(({ tags }) => {
      expect(Array.isArray(tags)).toBe(true);
      expect(tags.length).toBeGreaterThan(0);
    });
  });
});
