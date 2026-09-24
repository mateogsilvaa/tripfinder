/* interrail.js — Con los días del bono, el viaje entero.

   Le dices cuántos días de viaje tiene tu bono, de dónde sales y cuándo, y te
   da rutas que caben: el vuelo de entrada, los trenes, cuántas noches en cada
   parada, dónde dormir y el vuelo de salida — que no tiene por qué ser desde
   la misma ciudad, y ahí está media gracia de un Interrail. Y el total de
   verdad: bono, reservas, vuelos y alojamiento.

   NO ES UN OPTIMIZADOR, y es a propósito. La issue (#145) lo decía antes de
   escribir una línea: con seis ciudades ya no se puede mirar todo. Son rutas
   pensadas, de las que funcionan —en línea, sin volver sobre tus pasos, con
   trenes directos o casi—, y cada una SE PUEDE AJUSTAR: al revés, más o menos
   noches en cada sitio, o saltarse una parada. Así el punto de partida es
   bueno y el viaje acaba siendo el tuyo.

   UN DÍA DE BONO ES UN DÍA DE VIAJE, NO UN TRAYECTO. Encadenar dos trenes el
   mismo día gasta uno. Como se duerme al menos una noche en cada parada, cada
   tramo cae en un día distinto: días de bono = tramos. Saltarse una parada
   junta sus dos tramos en uno, en el mismo día, y gasta un día de bono menos.

   LAS RESERVAS OBLIGATORIAS se pagan aparte del bono: los trenes rápidos de
   Italia, Francia y España, los nórdicos y los polacos. Un plan que las ignore
   miente en el total, así que cada tramo dice si la lleva y la ficha suma una
   horquilla.

   LOS TIEMPOS Y LOS PRECIOS DEL TREN son orientativos, del directo más rápido
   de cada tramo, redondeados. No están contrastados contra la fuente porque
   desde donde se escribió esto no había salida de red a los operadores. Viven
   aquí y en ningún otro sitio. Los de los vuelos y el alojamiento, en cambio,
   son de verdad: se buscan al pedirlos. */

import { POLL_EVERY_MS, esc, escURL, fetchJSON, fmtDate, parseISO } from "./base.js";
import { ORIGENES } from "./busqueda.js";
import { cajaAcceso, dispatch, esFaltaDeAcceso } from "./disparador.js";
import { edreamsURL } from "./precios.js";
import { enHoras } from "./trenes.js";

/* Los bonos que se venden: días de viaje dentro de un mes, o de dos. */
export const BONOS = [4, 5, 7, 10, 15];

/* LO QUE CUESTA EL BONO, en segunda y por persona. Es la tarifa oficial de
   Interrail Global Pass de 2025, tal como se recordaba al escribir esto: sin
   red a interrail.eu no se ha podido contrastar, y cambia cada año y con las
   ofertas. Por eso la ficha lo da con «≈» y enlaza a la web oficial.

   La edad cambia mucho el precio —el de joven (12-27) sale un cuarto más
   barato—, así que se pregunta. */
export const PASES = {
  4: { adulto: 283, joven: 212, senior: 255 },
  5: { adulto: 323, joven: 242, senior: 291 },
  7: { adulto: 385, joven: 289, senior: 347 },
  10: { adulto: 458, joven: 344, senior: 412 },
  15: { adulto: 562, joven: 422, senior: 506 },
};
export const EDADES = ["joven", "adulto", "senior"];

/* DÓNDE SE ATERRIZA EN CADA CIUDAD. El precio de los vuelos lo da Ryanair, que
   es el único proveedor del proyecto que busca IDA SOLA —un Interrail entra
   por una ciudad y sale por otra—, y Ryanair casi nunca vuela al aeropuerto
   principal: no va a Ámsterdam pero sí a Eindhoven, ni a París-CDG pero sí a
   Beauvais. Sin los de al lado, casi ninguna ruta tendría precio de vuelo. El
   primero de cada lista es el que se usa para el enlace de eDreams.

   Lucerna e Interlaken no tienen aeropuerto: se llega por Zúrich o Basilea. */
export const AEROPUERTOS = {
  AMS: ["AMS", "EIN", "RTM"],
  BER: ["BER"],
  PRG: ["PRG"],
  VIE: ["VIE", "BTS"],
  BUD: ["BUD"],
  MIL: ["MXP", "BGY", "LIN"],
  VCE: ["VCE", "TSF"],
  FLR: ["FLR", "PSA"],
  ROM: ["FCO", "CIA"],
  NAP: ["NAP"],
  BCN: ["BCN", "GRO", "REU"],
  MPL: ["MPL"],
  LYS: ["LYS"],
  PAR: ["CDG", "ORY", "BVA"],
  ZRH: ["ZRH", "BSL"],
  LUC: ["ZRH", "BSL"],
  INT: ["ZRH", "BSL"],
  GVA: ["GVA"],
  CPH: ["CPH"],
  STO: ["ARN", "NYO", "BMA"],
  OSL: ["OSL", "TRF"],
  BGO: ["BGO"],
  BRU: ["BRU", "CRL"],
  BRG: ["BRU", "CRL", "OST"],
  CGN: ["CGN", "DUS", "NRN"],
  FRA: ["FRA", "HHN"],
  MUC: ["MUC", "FMM"],
  SZG: ["SZG"],
  BTS: ["BTS", "VIE"],
  ZAG: ["ZAG"],
  LJU: ["LJU", "TRS"],
  NCE: ["NCE"],
  GOA: ["GOA"],
  SPZ: ["PSA", "GOA"],
  PSA: ["PSA", "FLR"],
  POZ: ["POZ"],
  WAW: ["WAW", "WMI"],
  KRK: ["KRK"],
  HAM: ["HAM", "LBC"],
};

/* Cada parada lleva su país —Airbnb desambigua con él: hay más de una
   Valencia— y un código de tres letras que va en el nombre del fichero de su
   alojamiento y de sus vuelos.

   `tramos[i]` va de `paradas[i]` a `paradas[i + 1]`. `reserva` es la horquilla
   en euros por persona; `null` si el tramo no la exige. `billete` es lo que
   suele costar ese tramo SIN bono: segunda, ida, comprado con unas semanas de
   antelación — el barato y el caro de lo normal. */
const P = (ciudad, pais, cod, noches) => ({ ciudad, pais, cod, noches });
const T = (min, reserva, billete) => ({ min, reserva, billete });

export const RUTAS = [
  {
    id: "centro",
    nombre: "Europa central",
    idea: "Cuatro capitales en línea, sin una sola reserva: el bono sin letra pequeña.",
    paradas: [
      P("Ámsterdam", "Países Bajos", "AMS", 2),
      P("Berlín", "Alemania", "BER", 3),
      P("Praga", "Chequia", "PRG", 2),
      P("Viena", "Austria", "VIE", 2),
      P("Budapest", "Hungría", "BUD", 2),
    ],
    tramos: [T(380, null, [40, 110]), T(255, null, [30, 70]), T(240, null, [20, 50]), T(160, null, [15, 40])],
  },
  {
    id: "italia",
    nombre: "Italia de punta a punta",
    idea: "Tramos cortos y rápidos: más ciudad que tren. Todos llevan reserva.",
    paradas: [
      P("Milán", "Italia", "MIL", 2),
      P("Venecia", "Italia", "VCE", 2),
      P("Florencia", "Italia", "FLR", 2),
      P("Roma", "Italia", "ROM", 3),
      P("Nápoles", "Italia", "NAP", 2),
    ],
    tramos: [
      T(145, [10, 15], [20, 50]),
      T(125, [10, 15], [20, 50]),
      T(95, [10, 15], [20, 55]),
      T(70, [10, 15], [15, 45]),
    ],
  },
  {
    id: "francia",
    nombre: "Del Mediterráneo a París",
    idea: "Sales de casa casi andando: Barcelona, la costa y subir hasta París.",
    paradas: [
      P("Barcelona", "España", "BCN", 1),
      P("Montpellier", "Francia", "MPL", 2),
      P("Lyon", "Francia", "LYS", 2),
      P("París", "Francia", "PAR", 3),
    ],
    tramos: [T(180, [20, 35], [30, 80]), T(100, [10, 20], [25, 70]), T(120, [10, 20], [30, 90])],
  },
  {
    id: "suiza",
    nombre: "Suiza y los lagos",
    idea: "Trayectos de una o dos horas entre montañas. Sin reservas; Suiza no es barata, el tren sí sale a cuenta.",
    paradas: [
      P("Zúrich", "Suiza", "ZRH", 2),
      P("Lucerna", "Suiza", "LUC", 2),
      P("Interlaken", "Suiza", "INT", 2),
      P("Ginebra", "Suiza", "GVA", 2),
    ],
    tramos: [T(45, null, [15, 30]), T(110, null, [20, 35]), T(170, null, [40, 75])],
  },
  {
    id: "norte",
    nombre: "Los nórdicos",
    idea: "Tres capitales y el tren de Bergen, que es el viaje en sí.",
    paradas: [
      P("Copenhague", "Dinamarca", "CPH", 2),
      P("Estocolmo", "Suecia", "STO", 3),
      P("Oslo", "Noruega", "OSL", 2),
      P("Bergen", "Noruega", "BGO", 2),
    ],
    tramos: [T(310, [5, 10], [40, 120]), T(360, [5, 10], [30, 90]), T(410, [5, 10], [30, 100])],
  },
  {
    id: "benelux",
    nombre: "Del Benelux a Berlín",
    idea: "Canales y catedrales, sin una reserva: de Bruselas a Berlín por Brujas, Ámsterdam y Colonia.",
    paradas: [
      P("Bruselas", "Bélgica", "BRU", 2),
      P("Brujas", "Bélgica", "BRG", 1),
      P("Ámsterdam", "Países Bajos", "AMS", 2),
      P("Colonia", "Alemania", "CGN", 1),
      P("Berlín", "Alemania", "BER", 3),
    ],
    tramos: [T(60, null, [15, 20]), T(180, null, [30, 60]), T(160, null, [30, 80]), T(260, null, [30, 100])],
  },
  {
    id: "alpes",
    nombre: "Del Rin a Viena",
    idea: "Alemania de norte a sur y los Alpes austriacos. Trenes rápidos y ninguna reserva obligatoria.",
    paradas: [
      P("Colonia", "Alemania", "CGN", 1),
      P("Fráncfort", "Alemania", "FRA", 1),
      P("Múnich", "Alemania", "MUC", 2),
      P("Salzburgo", "Austria", "SZG", 2),
      P("Viena", "Austria", "VIE", 2),
    ],
    tramos: [T(65, null, [20, 50]), T(195, null, [30, 90]), T(90, null, [20, 40]), T(150, null, [20, 50])],
  },
  {
    id: "danubio",
    nombre: "Del Danubio al Adriático",
    idea: "La más barata de todas: regionales sin reserva y ciudades que cuestan la mitad.",
    paradas: [
      P("Viena", "Austria", "VIE", 2),
      P("Bratislava", "Eslovaquia", "BTS", 1),
      P("Budapest", "Hungría", "BUD", 2),
      P("Zagreb", "Croacia", "ZAG", 2),
      P("Liubliana", "Eslovenia", "LJU", 2),
    ],
    tramos: [T(60, null, [10, 15]), T(150, null, [15, 25]), T(390, null, [25, 45]), T(140, null, [10, 20])],
  },
  {
    id: "riviera",
    nombre: "La Riviera y la Toscana",
    idea: "Costa hasta Cinque Terre y luego tierra adentro. Todo regional salvo el último tramo.",
    paradas: [
      P("Niza", "Francia", "NCE", 2),
      P("Génova", "Italia", "GOA", 1),
      P("La Spezia", "Italia", "SPZ", 2),
      P("Pisa", "Italia", "PSA", 1),
      P("Florencia", "Italia", "FLR", 2),
      P("Roma", "Italia", "ROM", 2),
    ],
    tramos: [
      T(200, null, [20, 45]),
      T(90, null, [10, 20]),
      T(55, null, [8, 12]),
      T(60, null, [8, 12]),
      T(95, [10, 15], [20, 55]),
    ],
  },
  {
    id: "polonia",
    nombre: "Polonia",
    idea: "Barata y con buen tren. Los Intercity polacos piden reserva, pero cuesta poco.",
    paradas: [
      P("Berlín", "Alemania", "BER", 2),
      P("Poznań", "Polonia", "POZ", 1),
      P("Varsovia", "Polonia", "WAW", 2),
      P("Cracovia", "Polonia", "KRK", 3),
    ],
    tramos: [T(160, [2, 5], [20, 40]), T(170, [2, 5], [15, 30]), T(150, [2, 5], [15, 35])],
  },
  {
    id: "hamburgo",
    nombre: "De Hamburgo a Oslo",
    idea: "El norte de Alemania y tres capitales nórdicas, subiendo por la costa.",
    paradas: [
      P("Hamburgo", "Alemania", "HAM", 2),
      P("Copenhague", "Dinamarca", "CPH", 2),
      P("Estocolmo", "Suecia", "STO", 3),
      P("Oslo", "Noruega", "OSL", 2),
    ],
    tramos: [T(290, [5, 15], [40, 100]), T(310, [5, 10], [40, 120]), T(360, [5, 10], [30, 90])],
  },
  {
    id: "vuelta",
    nombre: "La vuelta grande",
    idea: "De París a Roma dando la vuelta por el centro. Para un bono de siete días.",
    paradas: [
      P("París", "Francia", "PAR", 2),
      P("Ámsterdam", "Países Bajos", "AMS", 2),
      P("Berlín", "Alemania", "BER", 2),
      P("Praga", "Chequia", "PRG", 2),
      P("Viena", "Austria", "VIE", 2),
      P("Venecia", "Italia", "VCE", 2),
      P("Roma", "Italia", "ROM", 2),
    ],
    tramos: [
      T(200, [15, 30], [40, 150]),
      T(380, null, [40, 110]),
      T(255, null, [30, 70]),
      T(240, null, [20, 50]),
      T(450, null, [30, 90]),
      T(225, [10, 15], [25, 70]),
    ],
  },
];

/* ------------------------------------------------------------ guardado */

const CLAVE_ELECCION = tfClave("tf_ir_eleccion");
const CLAVE_PENDIENTES = tfClave("tf_ir_pendientes");
const CLAVE_AJUSTES = tfClave("tf_ir_ajustes");

const leer = (clave) => {
  try {
    return JSON.parse(localStorage.getItem(clave) || "{}") || {};
  } catch {
    return {};
  }
};
const guardar = (clave, valor) => {
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
  } catch {
    /* navegación privada: dura lo que la pestaña */
  }
};

/* ------------------------------------------------------ personalizarla

   Cada ruta se puede ajustar sin tocar los datos: se guarda lo que cambiaste
   —al revés, las noches de cada parada, las que te saltas— y la ruta que se
   pinta y se cuenta se DERIVA de la original con eso encima. Deshacer es
   borrar el ajuste. */

export const MIN_NOCHES = 1;
export const MAX_NOCHES = 7;
export const MIN_PARADAS = 2;

export const ajusteDe = (id) => leer(CLAVE_AJUSTES)[id] || {};

export function ajustar(id, cambio) {
  const todos = leer(CLAVE_AJUSTES);
  const nuevo = cambio({ ...todos[id] });
  if (!nuevo || !Object.keys(nuevo).length) delete todos[id];
  else todos[id] = nuevo;
  guardar(CLAVE_AJUSTES, todos);
}

const juntarReservas = (a, b) => (a || b ? [(a?.[0] || 0) + (b?.[0] || 0), (a?.[1] || 0) + (b?.[1] || 0)] : null);

/* La puerta de entrada o de salida: ciudad y aeropuertos. */
const puerta = (p) => ({
  ciudad: p.ciudad,
  cod: p.cod,
  aeropuertos: AEROPUERTOS[p.cod] || [],
  iata: (AEROPUERTOS[p.cod] || [])[0] || "",
});

/* La ruta tal como la has dejado. */
export function ajustada(r, a = ajusteDe(r.id)) {
  let paradas = r.paradas.map((p) => ({ ...p }));
  let tramos = r.tramos.map((t) => ({ ...t }));
  if (a.rev) {
    paradas = paradas.reverse();
    tramos = tramos.reverse();
  }
  for (const p of paradas) {
    const n = Number(a.noches?.[p.cod]);
    if (n >= MIN_NOCHES && n <= MAX_NOCHES) p.noches = n;
  }
  // Saltarse una parada junta sus dos tramos: se pasa por ella sin bajarse,
  // en el mismo día, y se gasta un día de bono menos.
  const fuera = [];
  for (const cod of a.fuera || []) {
    const i = paradas.findIndex((p) => p.cod === cod);
    if (i < 0 || paradas.length <= MIN_PARADAS) continue;
    const quitada = paradas[i];
    if (i === 0) {
      tramos.shift();
    } else if (i === paradas.length - 1) {
      tramos.pop();
    } else {
      const [x, y] = [tramos[i - 1], tramos[i]];
      tramos.splice(i - 1, 2, {
        min: x.min + y.min,
        reserva: juntarReservas(x.reserva, y.reserva),
        billete: [x.billete[0] + y.billete[0], x.billete[1] + y.billete[1]],
        pasa: [...(x.pasa || []), quitada.ciudad, ...(y.pasa || [])],
      });
    }
    paradas.splice(i, 1);
    fuera.push(quitada);
  }
  return {
    ...r,
    paradas,
    tramos,
    fuera,
    rev: !!a.rev,
    ajustada: !!(a.rev || (a.fuera && a.fuera.length) || (a.noches && Object.keys(a.noches).length)),
    entra: puerta(paradas[0]),
    sale: puerta(paradas[paradas.length - 1]),
  };
}

/* ------------------------------------------------------------ las cuentas */

/* Días de bono que gasta: uno por tramo, porque cada tramo va en un día
   distinto (se duerme al menos una noche en cada parada). */
export const diasDeBono = (r) => r.tramos.length;

export const noches = (r) => r.paradas.reduce((s, p) => s + p.noches, 0);

export const minutosEnTren = (r) => r.tramos.reduce((s, t) => s + t.min, 0);

/* La horquilla de reservas, por persona. [0, 0] si no hay ninguna. */
export function reservas(r) {
  return r.tramos.reduce(
    (acc, t) => (t.reserva ? [acc[0] + t.reserva[0], acc[1] + t.reserva[1]] : acc),
    [0, 0]
  );
}

/* Lo que cuesta el tren comprando billete a billete. */
export function billetes(r) {
  return r.tramos.reduce((acc, t) => [acc[0] + t.billete[0], acc[1] + t.billete[1]], [0, 0]);
}

/* El bono más barato que cubre la ruta: si la ruta gasta 4 días, el de 4, aunque
   tengas pensado uno de 5. Es el que se compraría para ESTE viaje. */
export function paseQueCubre(r) {
  const dias = diasDeBono(r);
  return BONOS.find((d) => d >= dias) || null;
}

/* Lo que cuesta el tren con bono: el bono y las reservas, que van aparte. */
export function conBono(r, edad = "adulto") {
  const dias = paseQueCubre(r);
  if (!dias) return null;
  const pase = PASES[dias][edad] ?? PASES[dias].adulto;
  const [rmin, rmax] = reservas(r);
  return { dias, pase, total: [pase + rmin, pase + rmax] };
}

/* Cuál sale mejor. Los vuelos y la cama son los mismos con bono y sin él, así
   que la comparación es solo del tren. Son horquillas: solo se afirma cuando
   no se pisan; si se pisan, depende de cuándo compres. */
export function veredicto(r, edad = "adulto") {
  const sin = billetes(r);
  const con = conBono(r, edad);
  if (!con) return "";
  if (sin[1] < con.total[0]) return "sin";
  if (sin[0] > con.total[1]) return "con";
  return "depende";
}

/* Las que caben en el bono —ya ajustadas—, de la que más lo aprovecha a la
   que menos. */
export function caben(dias, maxNoches = Infinity) {
  return RUTAS.map((r) => ajustada(r))
    .filter((r) => diasDeBono(r) <= dias && noches(r) <= maxNoches)
    .sort((a, b) => diasDeBono(b) - diasDeBono(a) || noches(a) - noches(b));
}

/* Fecha ISO + n días, sin que la hora de verano la desplace: se trabaja en la
   fecha local de `parseISO` y se escribe a mano, sin `toISOString` (que pasa a
   UTC y en España puede restar un día). */
export function sumarDias(iso, n) {
  const d = parseISO(iso);
  if (!d) return "";
  d.setDate(d.getDate() + n);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/* Noches que hay entre dos fechas ISO. null si falta alguna o van al revés. */
export function nochesEntre(ida, vuelta) {
  const a = parseISO(ida);
  const b = parseISO(vuelta);
  if (!a || !b) return null;
  // Redondeo: el cambio de hora hace que un día dure 23 o 25 horas.
  const n = Math.round((b - a) / 86400000);
  return n >= 0 ? n : null;
}

/* Las dos fechas de vuelo de una ruta que sale el día `ida`. */
export function fechas(r, ida) {
  if (!parseISO(ida)) return null;
  return { ida, vuelta: sumarDias(ida, noches(r)) };
}

/* LOS ENLACES DE VUELO van a eDreams de IDA SOLA: el buscador de la casa hace
   ida y vuelta desde España, y un Interrail entra por una ciudad y sale por
   otra. */
export const vueloURL = (desde, hasta, dia, adultos = 1) =>
  edreamsURL({ origin: desde, destination: hasta, depart_date: dia, adults: adultos });

/* Las paradas con sus fechas: la llegada a cada una es la salida de la
   anterior. */
export function paradasConFechas(r, ida) {
  if (!parseISO(ida)) return [];
  let dia = ida;
  return r.paradas.map((p) => {
    const sale = sumarDias(dia, p.noches);
    const out = { ...p, checkin: dia, checkout: sale };
    dia = sale;
    return out;
  });
}

/* Ruta, ciudad, día de llegada, noches y cuántos vais: cambiar cualquiera de
   las cinco es otra cama y otro precio. Las noches van porque la ruta se
   puede ajustar: llegar el mismo día y quedarse una más es otra reserva. */
export const idParada = (r, p, adultos) =>
  `ir-${r.id}-${p.cod}-${p.checkin}-${p.noches}n-${adultos}`;

/* Origen, ciudad, día y sentido. Sin personas: la tarifa es por persona. */
export const idVuelo = (origen, cod, dia, sentido) => `ir-vuelo-${origen}-${cod}-${dia}-${sentido}`;

/* Los dos vuelos de una ruta, con lo que el servidor necesita para buscarlos. */
export function vuelosDe(r, ida, origen) {
  const f = fechas(r, ida);
  if (!f) return [];
  return [
    { id: idVuelo(origen, r.entra.cod, f.ida, "ida"), origen, aeropuertos: r.entra.aeropuertos, fecha: f.ida, sentido: "ida" },
    { id: idVuelo(origen, r.sale.cod, f.vuelta, "vuelta"), origen, aeropuertos: r.sale.aeropuertos, fecha: f.vuelta, sentido: "vuelta" },
  ].filter((v) => v.aeropuertos.length);
}

/* El más barato de un fichero de vuelo: `undefined` si no se ha buscado,
   `null` si se buscó y no hay. */
export function mejorVuelo(datos) {
  if (datos === undefined) return undefined;
  if (!datos || !Array.isArray(datos.legs) || !datos.legs.length) return null;
  return datos.legs[0];
}

const HABITACION = /^(habitaci[oó]n|room in|private room|shared room|hotel room|cama en|bed in)/i;

/* Lo que se puede elegir en una parada: sitios enteros con precio, en el
   orden en que llegan (precio y centro). */
export function opciones(datos) {
  return ((datos && datos.stays) || []).filter(
    (s) => s.kind === "stay" && s.price_total && !HABITACION.test(String(s.area || "").trim())
  );
}

/* La elegida de una parada: la que escogiste, si sigue en la lista; si no,
   la primera. */
export function elegida(id, datos) {
  const lista = opciones(datos);
  if (!lista.length) return null;
  const url = leer(CLAVE_ELECCION)[id];
  return lista.find((s) => s.url === url) || lista[0];
}

export function elegir(id, url) {
  const todas = leer(CLAVE_ELECCION);
  todas[id] = url;
  guardar(CLAVE_ELECCION, todas);
}

/* Lo que cuesta dormir en toda la ruta, para el grupo. `faltan` son las
   paradas sin alojamiento todavía: con alguna, el total no es el total. */
export function alojamiento(r, ida, adultos, camas) {
  let total = 0;
  let faltan = 0;
  for (const p of paradasConFechas(r, ida)) {
    const id = idParada(r, p, adultos);
    const s = elegida(id, camas[id]);
    if (s) total += s.price_total;
    else faltan += 1;
  }
  return { total, porPersona: total / adultos, faltan };
}

/* Los dos vuelos, por persona. `faltan` son los que no se han buscado;
   `sinVuelo`, los que se buscaron y no hay ninguno ese día. */
export function vuelosPrecio(r, ida, origen, cache) {
  let total = 0;
  let faltan = 0;
  let sinVuelo = 0;
  const tramos = {};
  for (const v of vuelosDe(r, ida, origen)) {
    const m = mejorVuelo(cache[v.id]);
    tramos[v.sentido] = m;
    if (m === undefined) faltan += 1;
    else if (m === null) sinVuelo += 1;
    else total += m.price;
  }
  return { total, faltan, sinVuelo, tramos };
}

/* EL TOTAL DEL VIAJE, por persona, con bono y sin él: el tren de cada forma,
   más los vuelos y la cama, que son iguales en las dos. */
export function totalViaje(r, { edad, ida, adultos, origen, camas, vuelos }) {
  const con = conBono(r, edad);
  const cama = alojamiento(r, ida, adultos, camas);
  const avion = vuelosPrecio(r, ida, origen, vuelos);
  const resto = avion.total + cama.porPersona;
  const sumar = ([a, b]) => [a + resto, b + resto];
  return {
    sin: sumar(billetes(r)),
    con: con ? sumar(con.total) : null,
    pase: con,
    cama,
    avion,
    completo: !cama.faltan && !avion.faltan && !avion.sinVuelo,
  };
}

/* ------------------------------------------------------------ pintarlo */

const eur = (n) => `${Math.round(n)} €`;
const horquilla = ([a, b]) => (Math.round(a) === Math.round(b) ? eur(a) : `${Math.round(a)}–${eur(b)}`);
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

/* Lo que ya se sabe: id -> fichero. Se llena poco a poco y cada vez que llega
   algo se repinta. */
const CAMAS = {};
const VUELOS = {};
let EXISTEN = null; // ids de alojamiento que dice `data/stays/index.json`
let EXISTEN_V = null; // ids de vuelo que dice `data/interrail/index.json`
let sondeo = null;
/* Qué rutas tienen abierto el panel de personalizar: se repinta todo en cada
   cambio, y sin esto el panel se cerraría en la cara de quien lo está usando. */
const ABIERTOS = new Set();

/* Una ruta, si se le buscó y todavía no ha llegado todo. El workflow tiene
   cuarenta minutos de tope. */
const ESPERA_MAX_MS = 40 * 60 * 1000;
const firma = (r) => r.paradas.map((p) => `${p.cod}${p.noches}`).join("");
const claveRuta = (r, ctx) => `${r.id}|${ctx.ida}|${ctx.adultos}|${ctx.origen}|${firma(r)}`;
const pendiente = (r, ctx) => {
  const desde = leer(CLAVE_PENDIENTES)[claveRuta(r, ctx)];
  return desde && Date.now() - desde < ESPERA_MAX_MS ? desde : 0;
};

const nombreOrigen = (iata) => (ORIGENES.find(([c]) => c === iata) || [iata, iata])[1];

function reservaTxt(t) {
  return t.reserva
    ? `<span class="ir-reserva">reserva ≈ ${horquilla(t.reserva)}</span>`
    : `<span class="ir-libre">sin reserva</span>`;
}

/* Un vuelo de la ruta: el enlace para buscar, y el precio si ya se buscó. */
function vueloHTML(texto, desde, hasta, dia, ctx, m) {
  const url = dia ? vueloURL(desde, hasta, dia, ctx.adultos) : "";
  let precio = "";
  if (m) {
    const reservar = m.deep_link
      ? ` · <a href="${escURL(m.deep_link)}" target="_blank" rel="noopener">reservar</a>`
      : "";
    precio = `<small class="ir-vuelo-precio"><b>${eur(m.price)}</b> por persona · ${esc(m.airline)} ${esc(
      m.time || ""
    )} · ${esc(m.origin)} → ${esc(m.destination)}${reservar}</small>`;
  } else if (m === null) {
    precio = `<small class="ir-vuelo-precio sin">Ryanair no vuela ese día: mira otras compañías en el enlace.</small>`;
  }
  return `<li class="ir-vuelo"><span>✈ ${texto}${
    dia ? ` <b>${esc(fmtDate(dia, true))}</b>` : ""
  }${precio}</span>${
    url
      ? `<a class="btn ghost small" href="${escURL(url)}" target="_blank" rel="noopener">Ver vuelos</a>`
      : ""
  }</li>`;
}

/* De quién es: «airbnb», o «holidu · vía Expedia» cuando llega por el
   comparador y el piso es de otra web. */
const fuente = (s) => esc([s.provider, s.note].filter(Boolean).join(" · "));

const aPie = (km) => {
  if (km === null || km === undefined) return "";
  const min = Math.round((km / 4.5) * 60);
  return min <= 45 ? ` · ${min} min a pie del centro` : ` · ${km.toFixed(1)} km del centro`;
};

/* La cama de una parada, dentro de la ruta. */
function camaHTML(r, p, ctx, esperando) {
  const id = idParada(r, p, ctx.adultos);
  const datos = CAMAS[id];
  if (datos === undefined || datos === null) {
    if (!esperando) return "";
    return `<li class="ir-cama esperando"><span class="spin"></span>buscando alojamiento entero…</li>`;
  }
  const lista = opciones(datos);
  const s = elegida(id, datos);
  if (!s) {
    return `<li class="ir-cama vacia">Sin alojamientos enteros para esas fechas.</li>`;
  }
  const otras = lista.filter((x) => x.url !== s.url);
  const foto = s.image
    ? `<img src="${escURL(s.image)}" alt="" loading="lazy" decoding="async" width="56" height="56">`
    : "";
  return `
    <li class="ir-cama" data-parada="${esc(id)}">
      <div class="ir-cama-sel${foto ? "" : " sin-foto"}">
        ${foto}
        <div>
          <a href="${escURL(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>
          <small>${fuente(s)}${aPie(s.km_centro)}</small>
        </div>
        <b>${eur(s.price_total)}</b>
      </div>
      ${
        otras.length
          ? `<details class="ir-otras">
               <summary>Cambiar · ${otras.length} ${otras.length === 1 ? "opción" : "opciones"} más</summary>
               <ul>${otras
                 .map(
                   (o) => `<li>
                     <button type="button" class="ir-elegir" data-parada="${esc(id)}"
                       data-url="${esc(o.url)}">
                       <span>${esc(o.name)}<small>${fuente(o)}${aPie(o.km_centro)}</small></span>
                       <b>${eur(o.price_total)}</b>
                     </button></li>`
                 )
                 .join("")}</ul>
             </details>`
          : ""
      }
    </li>`;
}

const VEREDICTOS = {
  sin: "Billete a billete sale más barato. El bono te da libertad para cambiar de planes, no ahorro.",
  con: "El bono sale a cuenta: comprando cada billete suelto pagarías más.",
  depende:
    "Depende de cuándo compres. Con semanas de antelación, billete a billete suele ganar; a última hora, el bono.",
};

/* EL PRECIO. Tren con bono y sin él, y encima los vuelos y la cama cuando se
   saben. Lo que falta se dice: un total al que le faltan cosas y no lo avisa
   es peor que ningún total. */
function precioHTML(r, ctx) {
  const t = totalViaje(r, { ...ctx, camas: CAMAS, vuelos: VUELOS });
  if (!t.con) return "";
  const v = veredicto(r, ctx.edad);
  const hayCama = t.cama.total > 0;
  const hayVuelo = t.avion.total > 0;
  const titulo = hayCama || hayVuelo ? "El viaje, por persona" : "El tren, por persona";

  const piezas = [];
  if (hayVuelo) {
    const { ida, vuelta } = t.avion.tramos;
    const partes = [ida ? `ida ${eur(ida.price)}` : "", vuelta ? `vuelta ${eur(vuelta.price)}` : ""]
      .filter(Boolean)
      .join(" + ");
    piezas.push(`vuelos ${eur(t.avion.total)} (${partes})`);
  }
  if (hayCama) {
    piezas.push(`alojamiento ${eur(t.cama.porPersona)} por persona (${eur(t.cama.total)} para ${ctx.adultos})`);
  }
  const avisos = [];
  if (t.cama.faltan && hayCama) avisos.push(`faltan ${plural(t.cama.faltan, "parada", "paradas")}`);
  if (t.avion.sinVuelo) avisos.push(`${plural(t.avion.sinVuelo, "vuelo", "vuelos")} sin precio: Ryanair no vuela ese día`);
  if (t.avion.faltan && (hayCama || hayVuelo)) {
    // Cuál: si has cambiado las noches, el de ida sigue valiendo y solo se ha
    // movido la vuelta. «Faltan los vuelos» ahí sería mentir por exceso.
    const cuales = ["ida", "vuelta"].filter((s) => t.avion.tramos[s] === undefined);
    avisos.push(
      cuales.length === 1
        ? `falta el vuelo de ${cuales[0]}: se busca con el alojamiento`
        : "faltan los vuelos: se buscan con el alojamiento"
    );
  }

  const desglose = piezas.length
    ? `<p class="ir-desglose">Tren + ${piezas.join(" + ")}${
        avisos.length ? ` · <b>${esc(avisos.join(" · "))}</b>` : ""
      }.</p>`
    : `<p class="ir-desglose">Vuelos y alojamiento aparte: búscalos abajo y se suman aquí.</p>`;
  const grupo =
    ctx.adultos > 1 && (hayCama || hayVuelo)
      ? `<p class="ir-grupo">Para ${ctx.adultos}: ≈ ${horquilla(t.sin.map((x) => x * ctx.adultos))} sin bono ·
          ≈ ${horquilla(t.con.map((x) => x * ctx.adultos))} con bono</p>`
      : "";
  return `
      <div class="ir-precio" data-veredicto="${v}" data-completo="${t.completo ? "si" : "no"}">
        <p class="ir-precio-titulo">${titulo}</p>
        <dl>
          <div class="${v === "sin" ? "gana" : ""}"><dt>Sin bono</dt><dd>≈ ${horquilla(t.sin)}</dd>
            <small>comprando cada billete</small></div>
          <div class="${v === "con" ? "gana" : ""}"><dt>Con bono</dt><dd>≈ ${horquilla(t.con)}</dd>
            <small>pase de ${t.pase.dias} días, ${eur(t.pase.pase)}${
              reservas(r)[1] ? " + reservas" : ""
            }</small></div>
        </dl>
        ${desglose}
        ${grupo}
        <p class="ir-veredicto">${esc(VEREDICTOS[v])}</p>
      </div>`;
}

/* PERSONALIZAR. Al revés, las noches de cada parada, y saltarse las que no
   quieras. Todo se guarda en este navegador y todo se puede deshacer. */
function ajustarHTML(r) {
  const ultima = r.paradas[r.paradas.length - 1].ciudad;
  const quitables = r.paradas.length > MIN_PARADAS;
  const filas = r.paradas
    .map(
      (p) => `
        <li>
          <span class="ir-aj-ciudad">${esc(p.ciudad)}</span>
          <span class="ir-aj-noches">
            <button type="button" data-ir-accion="menos" data-ruta="${esc(r.id)}" data-cod="${esc(p.cod)}"
              aria-label="Una noche menos en ${esc(p.ciudad)}" ${p.noches <= MIN_NOCHES ? "disabled" : ""}>−</button>
            <b>${plural(p.noches, "noche", "noches")}</b>
            <button type="button" data-ir-accion="mas" data-ruta="${esc(r.id)}" data-cod="${esc(p.cod)}"
              aria-label="Una noche más en ${esc(p.ciudad)}" ${p.noches >= MAX_NOCHES ? "disabled" : ""}>+</button>
          </span>
          <button type="button" class="ir-aj-quitar" data-ir-accion="quitar" data-ruta="${esc(r.id)}"
            data-cod="${esc(p.cod)}" ${quitables ? "" : "disabled"}>Saltármela</button>
        </li>`
    )
    .join("");
  const fuera = r.fuera
    .map(
      (p) => `
        <li class="fuera">
          <span class="ir-aj-ciudad"><s>${esc(p.ciudad)}</s></span>
          <button type="button" class="ir-aj-quitar" data-ir-accion="poner" data-ruta="${esc(r.id)}"
            data-cod="${esc(p.cod)}">Volver a ponerla</button>
        </li>`
    )
    .join("");
  return `
      <details class="ir-ajustar" data-ruta="${esc(r.id)}"${ABIERTOS.has(r.id) ? " open" : ""}>
        <summary>Personalizar la ruta${r.ajustada ? " · <b>cambiada</b>" : ""}</summary>
        <div class="ir-ajustar-cuerpo">
          <button type="button" class="btn ghost small" data-ir-accion="rev" data-ruta="${esc(r.id)}">
            ⇄ Al revés: empezar en ${esc(ultima)}</button>
          <ul>${filas}${fuera}</ul>
          ${
            r.ajustada
              ? `<button type="button" class="btn ghost small" data-ir-accion="reset" data-ruta="${esc(
                  r.id
                )}">Deshacer los cambios</button>`
              : ""
          }
        </div>
      </details>`;
}

function botonBuscarHTML(r, ctx, paradas, esperando) {
  if (!paradas.length) return "";
  const faltanCamas = paradas.filter((p) => !CAMAS[idParada(r, p, ctx.adultos)]).length;
  const faltanVuelos = vuelosDe(r, ctx.ida, ctx.origen).filter((v) => VUELOS[v.id] === undefined).length;
  if (!faltanCamas && !faltanVuelos) return "";
  if (esperando) {
    return `<p class="ir-buscando"><span class="spin"></span>Buscando los vuelos y alojamiento entero
      en ${plural(paradas.length, "parada", "paradas")}: unos dos minutos por parada. Puedes cerrar
      la página, el resultado se guarda.</p>`;
  }
  const nada = faltanCamas === paradas.length && faltanVuelos === 2;
  return `<div class="ir-pedir">
      <button type="button" class="btn deep" data-ir-camas="${esc(r.id)}">
        ${nada ? `Buscar vuelos y alojamiento de las ${paradas.length} paradas` : "Buscar lo que falta"}</button>
      <small>Los dos vuelos, de ida sola, y pisos y casas enteras —nada de habitaciones—: los mejores
        por precio y cercanía al centro. Luego puedes cambiar cada uno.</small>
    </div>`;
}

function tarjeta(r, ctx, libres) {
  const [rmin, rmax] = reservas(r);
  const f = fechas(r, ctx.ida);
  const sobran = ctx.dias - diasDeBono(r);
  const paradas = paradasConFechas(r, ctx.ida);
  const esperando = pendiente(r, ctx);
  const [vIda, vVuelta] = vuelosDe(r, ctx.ida, ctx.origen);
  const pasos = r.paradas
    .map((p, i) => {
      const conFecha = paradas[i];
      const parada = `<li class="ir-parada"><b>${esc(p.ciudad)}</b><small>${plural(p.noches, "noche", "noches")}${
        conFecha ? ` · desde el ${esc(fmtDate(conFecha.checkin, true))}` : ""
      }</small></li>`;
      const cama = conFecha ? camaHTML(r, conFecha, ctx, esperando) : "";
      const t = r.tramos[i];
      if (!t) return parada + cama;
      const pasa = t.pasa && t.pasa.length ? ` · pasas por ${esc(t.pasa.join(" y "))} sin parar` : "";
      return `${parada}${cama}<li class="ir-tramo">≈ ${esc(enHoras(t.min))} en tren · ${reservaTxt(
        t
      )}${pasa}<small class="ir-billete">billete suelto ≈ ${horquilla(t.billete)}</small></li>`;
    })
    .join("");
  const huecos = Number.isFinite(libres) ? libres - noches(r) : null;
  const origen = esc(nombreOrigen(ctx.origen));
  return `
    <article class="ir-ruta${r.ajustada ? " ajustada" : ""}" id="ruta-${esc(r.id)}">
      <header>
        <h3>${esc(r.nombre)}</h3>
        <p>${esc(r.idea)}</p>
      </header>
      <dl class="ir-cifras">
        <div><dt>Días de bono</dt><dd>${diasDeBono(r)}${
          sobran > 0 ? ` <small>te sobra${sobran === 1 ? "" : "n"} ${sobran}</small>` : ""
        }</dd></div>
        <div><dt>Noches</dt><dd>${noches(r)}${
          huecos > 0 ? ` <small>y ${huecos} libre${huecos === 1 ? "" : "s"}</small>` : ""
        }</dd></div>
        <div><dt>En tren</dt><dd>≈ ${esc(enHoras(minutosEnTren(r)))}</dd></div>
        <div><dt>Reservas</dt><dd>${rmax ? `≈ ${horquilla([rmin, rmax])}` : "ninguna"}</dd></div>
      </dl>
      ${precioHTML(r, ctx)}
      ${ajustarHTML(r)}
      ${botonBuscarHTML(r, ctx, paradas, esperando)}
      <div class="ir-acceso"></div>
      <ol class="ir-pasos">
        ${vueloHTML(`${origen} → ${esc(r.entra.ciudad)}`, ctx.origen, r.entra.iata, f && f.ida, ctx,
          vIda ? mejorVuelo(VUELOS[vIda.id]) : undefined)}
        ${pasos}
        ${vueloHTML(`${esc(r.sale.ciudad)} → ${origen}`, r.sale.iata, ctx.origen, f && f.vuelta, ctx,
          vVuelta ? mejorVuelo(VUELOS[vVuelta.id]) : undefined)}
      </ol>
    </article>`;
}

/* Lo que se lee del formulario, en un sitio. */
function estado() {
  const q = (s) => document.querySelector(s);
  return {
    dias: Number(q("#irDias")?.value || 0),
    ida: q("#irIda")?.value || "",
    vuelta: q("#irVuelta")?.value || "",
    edad: q("#irEdad")?.value || "adulto",
    adultos: Math.min(8, Math.max(1, Number(q("#irPersonas")?.value) || 2)),
    origen: q("#irOrigen")?.value || "MAD",
  };
}

function pintar() {
  const caja = document.querySelector("#irRutas");
  if (!caja) return;
  const ctx = estado();
  const libres = nochesEntre(ctx.ida, ctx.vuelta);
  const lista = caben(ctx.dias, libres ?? Infinity);
  const pista = document.querySelector("#irHint");
  if (pista) {
    const donde = libres !== null ? ` y en ${libres} noches` : "";
    if (ctx.vuelta && libres === null) {
      pista.textContent = "La vuelta es antes que la ida: cámbiala para ver las rutas.";
    } else {
      pista.textContent = lista.length
        ? `${lista.length} ruta${lista.length === 1 ? "" : "s"} caben en ${ctx.dias} días de bono${donde}.`
        : `Con ${ctx.dias} días de bono${donde} no cabe ninguna de estas rutas.`;
    }
  }
  caja.innerHTML = lista.map((r) => tarjeta(r, ctx, libres ?? undefined)).join("");
  cargar(lista, ctx);
}

async function indice(ruta, campo) {
  try {
    const datos = await fetchJSON(ruta);
    return new Set(Array.isArray(datos?.[campo]) ? datos[campo] : Object.keys(datos?.[campo] || {}));
  } catch {
    return new Set();
  }
}

/* Trae lo que existe de las rutas a la vista. Solo lo que dicen los índices, o
   lo que se está esperando: pedir a ciegas serían decenas de 404 por cambio. */
async function cargar(lista, ctx) {
  if (EXISTEN === null) EXISTEN = await indice("data/stays/index.json", "viajes");
  if (EXISTEN_V === null) EXISTEN_V = await indice("data/interrail/index.json", "vuelos");
  const pedir = [];
  for (const r of lista) {
    const espera = pendiente(r, ctx);
    for (const p of paradasConFechas(r, ctx.ida)) {
      const id = idParada(r, p, ctx.adultos);
      if (CAMAS[id] === undefined && (EXISTEN.has(id) || espera)) {
        pedir.push([CAMAS, id, `data/stays/${id}.json`]);
      }
    }
    for (const v of vuelosDe(r, ctx.ida, ctx.origen)) {
      if (VUELOS[v.id] === undefined && (EXISTEN_V.has(v.id) || espera)) {
        pedir.push([VUELOS, v.id, `data/interrail/${v.id}.json`]);
      }
    }
  }
  if (!pedir.length) return;
  let alguno = false;
  await Promise.all(
    pedir.map(async ([cache, id, ruta]) => {
      try {
        cache[id] = await fetchJSON(ruta);
        alguno = true;
      } catch {
        /* todavía no está: se reintenta en el siguiente sondeo */
      }
    })
  );
  if (alguno) pintar();
}

/* Mientras haya una ruta esperando, se mira cada poco si ha llegado algo. */
function vigilar() {
  clearInterval(sondeo);
  sondeo = setInterval(() => {
    const ctx = estado();
    const libres = nochesEntre(ctx.ida, ctx.vuelta);
    const lista = caben(ctx.dias, libres ?? Infinity);
    const quedan = lista.some(
      (r) =>
        pendiente(r, ctx) &&
        (paradasConFechas(r, ctx.ida).some((p) => !CAMAS[idParada(r, p, ctx.adultos)]) ||
          vuelosDe(r, ctx.ida, ctx.origen).some((v) => VUELOS[v.id] === undefined))
    );
    // Nada esperando: se para. Lo que llega ya repinta solo en `cargar`.
    if (!quedan) {
      clearInterval(sondeo);
      return;
    }
    cargar(lista, ctx);
  }, POLL_EVERY_MS);
}

async function pedir(r, boton) {
  const ctx = estado();
  const paradas = paradasConFechas(r, ctx.ida).filter((p) => !CAMAS[idParada(r, p, ctx.adultos)]);
  const vuelos = vuelosDe(r, ctx.ida, ctx.origen).filter((v) => VUELOS[v.id] === undefined);
  if (!paradas.length && !vuelos.length) return;
  boton.disabled = true;
  // Cuatro propiedades: las listas van anidadas, que GitHub solo admite diez.
  const res = await dispatch("interrail", {
    ruta: r.id,
    adults: String(ctx.adultos),
    paradas: paradas.map((p) => ({
      offer_id: idParada(r, p, ctx.adultos),
      city: p.ciudad,
      country: p.pais,
      iata: (AEROPUERTOS[p.cod] || [])[0] || "",
      checkin: p.checkin,
      checkout: p.checkout,
    })),
    vuelos,
  });
  if (res.ok) {
    const todas = leer(CLAVE_PENDIENTES);
    todas[claveRuta(r, ctx)] = Date.now();
    guardar(CLAVE_PENDIENTES, todas);
    if (typeof tfAnunciar === "function") {
      tfAnunciar("Buscando los vuelos y el alojamiento de la ruta. Tarda unos minutos.");
    }
    pintar();
    vigilar();
    return;
  }
  boton.disabled = false;
  const hueco = document.querySelector(`#ruta-${r.id} .ir-acceso`);
  if (!hueco) return;
  if (esFaltaDeAcceso(res)) {
    const caja = cajaAcceso(res);
    hueco.innerHTML = caja.html;
    caja.wire();
  } else {
    hueco.innerHTML = `<p class="status wait">No se pudo lanzar: ${esc(res.reason || "")}</p>`;
  }
}

/* Lo que hace cada botón de «Personalizar». */
function accion(tipo, rutaId, cod) {
  const base = RUTAS.find((x) => x.id === rutaId);
  if (!base) return;
  const noches0 = (c) => {
    const actual = ajustada(base).paradas.find((p) => p.cod === c);
    return actual ? actual.noches : 2;
  };
  ajustar(rutaId, (a) => {
    if (tipo === "reset") return {};
    if (tipo === "rev") a.rev = !a.rev;
    if (tipo === "mas" || tipo === "menos") {
      const n = noches0(cod) + (tipo === "mas" ? 1 : -1);
      a.noches = { ...a.noches, [cod]: Math.min(MAX_NOCHES, Math.max(MIN_NOCHES, n)) };
    }
    if (tipo === "quitar") a.fuera = [...new Set([...(a.fuera || []), cod])];
    if (tipo === "poner") a.fuera = (a.fuera || []).filter((c) => c !== cod);
    if (a.fuera && !a.fuera.length) delete a.fuera;
    if (!a.rev) delete a.rev;
    return a;
  });
  ABIERTOS.add(rutaId);
  pintar();
}

const hoyISO = () => {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(
    hoy.getDate()
  ).padStart(2, "0")}`;
};

/* La puesta en marcha. Se llama desde `arranque.js` y se calla sola si esta
   no es la página de los trenes. */
export function montarInterrail() {
  const sel = document.querySelector("#irDias");
  const caja = document.querySelector("#irRutas");
  if (!sel || !caja) return;
  const origen = document.querySelector("#irOrigen");
  if (origen && !origen.options.length) {
    origen.innerHTML = ORIGENES.map(
      ([c, n]) => `<option value="${esc(c)}"${c === "MAD" ? " selected" : ""}>${esc(n)} (${esc(c)})</option>`
    ).join("");
  }
  const ida = document.querySelector("#irIda");
  const vuelta = document.querySelector("#irVuelta");
  if (ida && !ida.value) {
    // Un mes vista por defecto: da tiempo a sacar el bono y es cuando los
    // vuelos todavía están a precio razonable. Se cambia en un toque.
    ida.value = sumarDias(hoyISO(), 30);
    ida.min = hoyISO();
  }
  // La vuelta se queda vacía: es opcional, y sin ella no se filtra por noches.
  if (vuelta && ida) vuelta.min = ida.value;
  if (ida && vuelta) {
    ida.addEventListener("change", () => {
      vuelta.min = ida.value;
    });
  }
  ["#irDias", "#irIda", "#irVuelta", "#irEdad", "#irPersonas", "#irOrigen"].forEach((s) => {
    const el = document.querySelector(s);
    if (el) el.addEventListener("change", pintar);
  });
  // Un solo oyente para toda la caja: las tarjetas se repintan enteras y los
  // botones de dentro nacen y mueren con cada cambio.
  caja.addEventListener("click", (e) => {
    const buscar = e.target.closest("[data-ir-camas]");
    if (buscar) {
      const r = caben(Infinity).find((x) => x.id === buscar.dataset.irCamas);
      if (r) pedir(r, buscar);
      return;
    }
    const otra = e.target.closest(".ir-elegir");
    if (otra) {
      elegir(otra.dataset.parada, otra.dataset.url);
      pintar();
      return;
    }
    const boton = e.target.closest("[data-ir-accion]");
    if (boton) accion(boton.dataset.irAccion, boton.dataset.ruta, boton.dataset.cod);
  });
  // Recordar qué paneles de personalizar están abiertos.
  caja.addEventListener(
    "toggle",
    (e) => {
      const d = e.target;
      if (!d.classList || !d.classList.contains("ir-ajustar")) return;
      if (d.open) ABIERTOS.add(d.dataset.ruta);
      else ABIERTOS.delete(d.dataset.ruta);
    },
    true
  );
  pintar();
  vigilar();
}
