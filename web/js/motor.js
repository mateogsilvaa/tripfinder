/* motor.js — De seis respuestas a tres destinos, sin pedirle nada a nadie (#8).

   Todo pasa en el navegador y con datos que ya se publican: `offers.json` (lo
   vivo), `perfiles.json` (a qué se parece cada sitio) y el histórico que ya
   lleva cada oferta. Cero peticiones nuevas a proveedores y cero espera: el
   resultado sale en el mismo gesto en que se contesta la última pregunta.

   Lo que hace bueno a esto no es la fórmula, son dos cosas más aburridas:

     · los FILTROS DUROS son lo que la persona ha dicho que NO, y no se negocian
       salvo el tope, que se relaja avisando;
     · la DIVERSIDAD. Sin ella, "playa y barato" devuelve Bérgamo, Milán y
       Turín, que para quien pregunta es una sola propuesta escrita tres veces. */

import { pax, porPersona } from "./precios.js";

/* --------------------------------------------------------------- los perfiles
   `ciudad` por defecto: es lo que es la mayoría de un mapa de vuelos baratos, y
   equivocarse por ahí devuelve algo razonable en vez de nada. */
export const PERFIL_POR_DEFECTO = ["ciudad"];
let PERFILES = {};

export function ponerPerfiles(tabla) {
  PERFILES = tabla && typeof tabla === "object" ? tabla : {};
  delete PERFILES._; // la nota del fichero, que no es un aeropuerto
  return PERFILES;
}

export function perfilDe(iata) {
  const p = PERFILES[String(iata || "").toUpperCase()];
  return Array.isArray(p) && p.length ? p : PERFIL_POR_DEFECTO;
}

/* ---------------------------------------------------------------- los filtros
   `respuestas` es lo que sale del test:
     apetece  · una de playa|ciudad|naturaleza|noche|gastronomia
     noches   · [min, max]
     tope     · euros POR PERSONA
     personas · cuántos van
     madrugar · false si no quiere llegar de noche
     meses    · horizonte en meses
     lejos    · true (otro continente), false (cerca) o null (le da igual) */
/* Devuelve null cuando no hay hora, y eso importa: `"".split(":")` da `[""]`,
   y `Number("")` es 0, que es finito. Sin el guardia, una oferta SIN horas
   —las hay— contaba como salida a las 00:00 y se caía del listado de quien
   dijo que no quería madrugar. Un dato que falta no es un dato malo. */
const HORA = (t) => {
  const crudo = String(t || "").trim();
  if (!/^\d{1,2}:\d{2}/.test(crudo)) return null;
  const [h, m] = crudo.split(":").map(Number);
  return h + m / 60;
};

/* "Llegar de noche" es llegar después de las 23:00 o salir antes de las 07:00:
   las dos cosas te cuestan una noche de sueño, que es lo que se está diciendo
   cuando alguien contesta que no quiere madrugar. */
export function esDeMadrugada(o) {
  const llega = HORA(o.arrive_time);
  const sale = HORA(o.depart_time);
  return (llega !== null && llega >= 23) || (sale !== null && sale < 7);
}

function dentroDelHorizonte(o, meses) {
  const salida = new Date(`${(o.depart_date || "").slice(0, 10)}T00:00:00`);
  if (Number.isNaN(salida.getTime())) return false;
  const limite = new Date();
  limite.setMonth(limite.getMonth() + Math.max(1, Number(meses) || 6));
  return salida <= limite;
}

/* Lo que la persona ha dicho que no. El tope va aparte porque es el único que
   se puede relajar; el resto son condiciones, no preferencias. */
export function pasaLosFiltros(o, r, tope) {
  if (porPersona(o) > tope) return false;
  const noches = Number(o.nights);
  if (r.noches && Number.isFinite(noches)) {
    if (noches < r.noches[0] || noches > r.noches[1]) return false;
  }
  if (r.finde && !o.weekend) return false;
  if (r.lejos === true && !o.long_haul) return false;
  if (r.lejos === false && o.long_haul) return false;
  if (r.madrugar === false && esDeMadrugada(o)) return false;
  return dentroDelHorizonte(o, r.meses);
}

/* -------------------------------------------------------------- la puntuación
   Cuatro cosas, y la quinta pregunta mueve los pesos: quien dice "que sea
   barato" no quiere el mismo orden que quien dice "que cunda". */
export const PESOS = {
  equilibrio: { tags: 0.45, precio: 0.25, horas: 0.2, score: 0.1 },
  barato: { tags: 0.45, precio: 0.4, horas: 0.05, score: 0.1 },
  cunda: { tags: 0.4, precio: 0.15, horas: 0.35, score: 0.1 },
};

export const pesosDe = (prioridad) => PESOS[prioridad] || PESOS.equilibrio;

const acotar = (n) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

/* Cuánto encaja el sitio con lo que pidió. Una etiqueta de dos vale menos que
   una de una: si Nápoles es "ciudad y gastronomía" y pediste gastronomía,
   acierta a medias, no del todo. */
export function afinidad(iata, apetece) {
  if (!apetece) return 0.5;
  const tags = perfilDe(iata);
  if (!tags.includes(apetece)) return 0;
  return tags[0] === apetece ? 1 : 0.7;
}

export function puntuar(o, r, tope, pesos = pesosDe(r.prioridad)) {
  const precio = porPersona(o);
  return (
    pesos.tags * afinidad(o.destination, r.apetece) +
    // Margen que deja bajo el tope: a igualdad de todo lo demás, mejor la que
    // deja dinero para cenar.
    pesos.precio * acotar(tope > 0 ? (tope - precio) / tope : 0) +
    // 48 h es un finde largo bien aprovechado; de ahí para arriba ya no suma.
    pesos.horas * acotar(Number(o.useful_hours) / 48) +
    pesos.score * acotar(Number(o.score) / 100)
  );
}

/* --------------------------------------------------------------- la diversidad
   Tres propuestas del mismo país no son tres propuestas: "playa y barato"
   devolvía Bérgamo, Milán y Turín, que para quien pregunta es una sola escrita
   tres veces. Así que el país no se repite mientras quede alternativa.

   El PERFIL es distinto: variar también de perfil está bien, pero no a costa de
   colar algo mucho peor. Quien pide playa y recibe Palma, Praga y Faro piensa,
   con razón, que no se le ha escuchado. Por eso el perfil solo desempata entre
   candidatas que ya son casi tan buenas como la mejor.

   `candidatas` viene ordenada y con sus puntos: [{ o, puntos }]. */
const paisDe = (o) => (o.destination_country || o.destination || "").toLowerCase();

// Cuánto peor puede ser una propuesta para que valga la pena por variar.
export const MARGEN_DE_VARIEDAD = 0.9;

export function repartirVariado(candidatas, cuantas = 3) {
  const salida = [];
  const paises = new Set();
  const perfiles = new Set();
  const pendientes = [...candidatas];

  while (salida.length < cuantas && pendientes.length) {
    // Otro país mientras quede; si no queda, lo que haya. Nunca se devuelven
    // menos de las que hay por ser tiquismiquis.
    const deOtroPais = pendientes.filter((c) => !paises.has(paisDe(c.o)));
    const donde = deOtroPais.length ? deOtroPais : pendientes;
    const mejor = donde[0];
    const umbral = mejor.puntos * MARGEN_DE_VARIEDAD;
    const variada = donde.find(
      (c) => !perfiles.has(perfilDe(c.o.destination)[0]) && c.puntos >= umbral
    );
    const elegida = variada || mejor;

    pendientes.splice(pendientes.indexOf(elegida), 1);
    salida.push(elegida.o);
    paises.add(paisDe(elegida.o));
    perfiles.add(perfilDe(elegida.o.destination)[0]);
  }
  return salida;
}

/* ------------------------------------------------------------------- el motor
   Devuelve siempre algo o dice por qué no. Una lista vacía sin explicación es
   la peor respuesta posible: quien la ve no sabe si es que no hay vuelos o si
   es que la web está rota. */
/* El tope se afloja de 20 en 20 por ciento. El ultimo paso es `Infinity` a
   proposito: un tope de 20 € no lo cumple ningun vuelo, y devolver una lista
   vacia por respetarlo al pie de la letra seria contestar "no" a alguien que
   pregunto "y entonces, que?". Con el tope fuera se ensena lo mas barato que
   cumple TODO LO DEMAS, diciendo cuanto cuesta de verdad. */
export const PASOS_DE_RELAJO = [1, 1.2, 1.44, 1.73, 2.07, 2.49, 2.99, Infinity];

function avisoDeTope(base, tope, cuantas, hay, masBarato) {
  if (tope === Infinity) {
    return (
      `Por debajo de ${Math.round(base)} € no hay nada que cumpla el resto. ` +
      `Lo más barato que sí lo cumple son ${Math.round(masBarato)} € por persona.`
    );
  }
  if (hay < cuantas) {
    return `Con lo que has pedido solo hay ${hay}. Es lo que vuela ahora mismo desde Madrid, no un recorte nuestro.`;
  }
  if (tope > base) {
    return `Nada justo por debajo de ${Math.round(base)} €: esto es lo más cerca que hay, hasta ${Math.round(tope)} €.`;
  }
  return "";
}

export function recomendar(ofertas, respuestas, cuantas = 3) {
  const r = respuestas || {};
  const base = Math.max(1, Number(r.tope) || 0);
  const pesos = pesosDe(r.prioridad);

  for (const paso of PASOS_DE_RELAJO) {
    const tope = base * paso;
    const cabe = (ofertas || []).filter((o) => pasaLosFiltros(o, r, tope));
    if (!cabe.length) continue;
    // Con el tope fuera, el margen bajo el tope deja de significar nada: se
    // puntua contra lo mas caro que ha entrado, para que siga ordenando.
    const techo = Number.isFinite(tope) ? tope : Math.max(...cabe.map(porPersona));
    const ordenadas = cabe
      .map((o) => ({ o, puntos: puntuar(o, r, techo, pesos) }))
      .sort((a, b) => b.puntos - a.puntos || porPersona(a.o) - porPersona(b.o));
    const elegidas = repartirVariado(ordenadas, cuantas);
    if (elegidas.length >= cuantas || paso === PASOS_DE_RELAJO.at(-1)) {
      const masBarato = Math.min(...cabe.map(porPersona));
      return {
        destinos: elegidas,
        tope: Number.isFinite(tope) ? tope : masBarato,
        relajado: paso > 1,
        // Lo que hay que decirle a quien preguntó, no lo que pasó por dentro.
        aviso: avisoDeTope(base, tope, cuantas, elegidas.length, masBarato),
      };
    }
  }
  return {
    destinos: [],
    tope: base,
    relajado: false,
    aviso:
      "No hay nada que cuadre con eso ahora mismo. Prueba con más meses por delante, " +
      "más noches, o sin exigir que sea finde.",
  };
}

/* ---------------------------------------------------------------- el porqué
   Una recomendación sin motivo se lee como aleatoria y no se acepta. La frase
   sale de lo que de verdad pesó, no de una plantilla fija: si el sitio no
   encaja con lo que pidió y aun así sale, es que sale por precio, y eso hay
   que decirlo en vez de disimularlo. */
const COMO_SE_LLAMA = {
  playa: "playa",
  ciudad: "ciudad",
  naturaleza: "naturaleza",
  noche: "noche",
  gastronomia: "comer bien",
};

export function porque(o, r, tope) {
  const precio = porPersona(o);
  const encaja = afinidad(o.destination, r.apetece) >= 0.7;
  const pedido = COMO_SE_LLAMA[r.apetece] || "";

  const motivos = [];
  if (encaja && pedido) motivos.push(`dijiste ${pedido}`);
  if (tope > 0 && precio <= tope * 0.75) {
    motivos.push(
      `se queda en ${Math.round(precio)} € de los ${Math.round(Number(r.tope) || tope)} que dabas`
    );
  }
  const noches = Number(o.nights);
  if (Number.isFinite(noches) && noches > 0) {
    motivos.push(`son ${noches} noche${noches === 1 ? "" : "s"}`);
  }
  if (r.madrugar === false && !esDeMadrugada(o)) motivos.push("no hay que madrugar");
  if (r.finde && o.weekend) motivos.push("cae en finde");

  // "a, b y c": la coma de antes de la y sobra en castellano.
  const enumerar = (xs) =>
    xs.length > 1 ? `${xs.slice(0, -1).join(", ")} y ${xs.at(-1)}` : xs[0] || "";

  // No es lo que pidió y aun así sale. Decirlo cuesta cuatro palabras y evita
  // que quien pidió playa y ve Praga piense que no se le ha escuchado.
  if (!encaja && pedido) {
    const resto = motivos.length
      ? `, pero te sale por precio: ${enumerar(motivos)}`
      : `, pero es de lo mejor que vuela ahora: ${Math.round(precio)} € por persona`;
    return `No es ${pedido}${resto}.`;
  }
  if (!motivos.length) {
    return `Te sale por precio: ${Math.round(precio)} € por persona es de lo mejor que vuela ahora.`;
  }
  return `Te sale porque ${enumerar(motivos)}.`;
}

/* Cuántas personas cubre el precio que se enseña. El test pregunta cuántos van
   y las ofertas del scan son de una persona: sin esto, "menos de 100 €" para
   cuatro compararía peras con manzanas. */
export function paraGrupo(ofertas, personas) {
  const n = Math.max(1, Number(personas) || 1);
  return (ofertas || []).map((o) => (pax(o) === n ? o : { ...o, adults: n, price: porPersona(o) * n }));
}
