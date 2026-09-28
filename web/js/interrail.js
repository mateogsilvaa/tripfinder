/* interrail.js — Tu Interrail, entero: la ruta, el pase, los vuelos y la cama.

   LO QUE SE PREGUNTA, en este orden, porque es el orden en que cambia la
   cuenta:

   1. EL PASE. Si ya lo tienes, está pagado: no se suma, y lo único que manda
      son sus días de viaje (la ruta tiene que caber). Si no lo tienes, se
      calcula el viaje de las dos formas —comprando el pase que cubre la ruta,
      o billete a billete— y se dice cuál sale mejor.
   2. EL VIAJE: de dónde sales, cuándo y cuántos vais.
   3. LAS CIUDADES por las que quieres pasar. Con dos o más, la ruta es TUYA: se
      ordenan para gastar el menor tren posible y entre cada dos se va por el
      camino más corto del mapa (`interrail-datos.js`). Sin ninguna, se
      proponen las rutas hechas.

   LA BÚSQUEDA EMPIEZA SOLA. La ruta elegida —la tuya, o la primera que
   cabe— busca en cuanto está clara, sin botón: los dos vuelos, de ida sola, y
   pisos enteros cerca del centro en cada parada. Hace falta sesión, porque
   cada búsqueda es un encargo a GitHub a tu nombre; sin ella se dice y se deja
   entrar ahí mismo. Cambiar de ruta, de fechas o de noches busca lo que falte,
   y lo que ya se buscó no se vuelve a buscar: la cama de una parada depende
   de la ciudad, las fechas, las noches y cuántos vais, no de la ruta.

   UN DÍA DE PASE ES UN DÍA DE VIAJE, NO UN TRAYECTO. Encadenar dos trenes el
   mismo día gasta uno, y como se duerme al menos una noche en cada parada,
   cada tramo cae en un día distinto: días de pase = tramos.

   LOS TIEMPOS Y LOS PRECIOS DEL TREN son orientativos (ver
   `interrail-datos.js`). Los de los vuelos y el alojamiento son de verdad. */

import { POLL_EVERY_MS, esc, escURL, fetchJSON, fmtDate, parseISO } from "./base.js";
import { ORIGENES } from "./busqueda.js";
import { cajaAcceso, dispatch, esFaltaDeAcceso, wireEntrar } from "./disparador.js";
import { CIUDADES, CONEXIONES, ESTACIONES, NOCTURNOS, RUTAS, ZONAS } from "./interrail-datos.js";
import { comoFechaICS, descargar, evento, finDeTramo } from "./compartir.js";
import { edreamsURL } from "./precios.js";

export { CIUDADES, NOCTURNOS, RUTAS };

/* «2 h 21», «50 min». Sin ceros a la izquierda y sin decir «0 h». */
export function enHoras(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

/* Los pases que se venden: días de viaje dentro de un mes, o de dos. */
export const BONOS = [4, 5, 7, 10, 15];

/* LO QUE CUESTA EL PASE, en segunda y por persona: la tarifa del Interrail
   Global Pass de 2025, tal como se recordaba al escribir esto. Sin red hasta
   interrail.eu no se ha podido contrastar, y cambia cada año y con las
   ofertas: por eso sale con «≈» y enlaza a la web oficial. */
export const PASES = {
  4: { adulto: 283, joven: 212, senior: 255 },
  5: { adulto: 323, joven: 242, senior: 291 },
  7: { adulto: 385, joven: 289, senior: 347 },
  10: { adulto: 458, joven: 344, senior: 412 },
  15: { adulto: 562, joven: 422, senior: 506 },
};
export const EDADES = ["joven", "adulto", "senior"];

export const MIN_NOCHES = 1;
export const MAX_NOCHES = 7;
export const MIN_PARADAS = 2;
export const MAX_ELEGIDAS = 8;

/* Un tramo por encima de esto no se hace a gusto en un día. Se dice, y se
   ofrece parar en una de las ciudades por las que pasa. */
export const TRAMO_LARGO_MIN = 7 * 60;

/* Lo lejos del centro que puede quedar una cama. 2,5 km son unos treinta
   minutos andando: más ya es «coger el metro cada mañana», que en una parada
   de dos noches es media visita. */
export const MAX_KM = 2.5;

/* ------------------------------------------------------------- el mapa */

const VECINOS = {};
for (const [a, b, min, reserva, billete] of CONEXIONES) {
  (VECINOS[a] ||= []).push({ a, b, min, reserva, billete });
  (VECINOS[b] ||= []).push({ a: b, b: a, min, reserva, billete });
}

const CAMINOS = new Map();

/* El camino más rápido entre dos ciudades (Dijkstra, por minutos de tren). Un
   tramo que pasa por otras ciudades sin parar suma sus trozos y dice por
   dónde va. `null` si no hay forma de llegar en este mapa. */
export function camino(desde, hasta) {
  const clave = `${desde}>${hasta}`;
  if (CAMINOS.has(clave)) return CAMINOS.get(clave);
  const dist = { [desde]: 0 };
  const previo = {};
  const hechos = new Set();
  for (;;) {
    let u = null;
    for (const c of Object.keys(dist)) {
      if (!hechos.has(c) && (u === null || dist[c] < dist[u])) u = c;
    }
    if (u === null || u === hasta) break;
    hechos.add(u);
    for (const e of VECINOS[u] || []) {
      const d = dist[u] + e.min;
      if (dist[e.b] === undefined || d < dist[e.b]) {
        dist[e.b] = d;
        previo[e.b] = e;
      }
    }
  }
  if (dist[hasta] === undefined) {
    CAMINOS.set(clave, null);
    return null;
  }
  const trozos = [];
  for (let c = hasta; c !== desde; c = previo[c].a) trozos.unshift(previo[c]);
  let reserva = null;
  for (const t of trozos) {
    if (t.reserva) reserva = [(reserva?.[0] || 0) + t.reserva[0], (reserva?.[1] || 0) + t.reserva[1]];
  }
  const tramo = {
    min: dist[hasta],
    reserva,
    billete: trozos.reduce((s, t) => [s[0] + t.billete[0], s[1] + t.billete[1]], [0, 0]),
    pasaCods: trozos.slice(0, -1).map((t) => t.b),
  };
  tramo.pasa = tramo.pasaCods.map((c) => CIUDADES[c].ciudad);
  CAMINOS.set(clave, tramo);
  return tramo;
}

/* El tren nocturno directo entre dos ciudades, en ese sentido, o null. */
export function nocturno(a, b) {
  const n = NOCTURNOS.find(([x, y]) => (x === a && y === b) || (x === b && y === a));
  return n ? { sale: n[2], llega: n[3], litera: n[4] } : null;
}

/* Todas las permutaciones, con la primera fija o no. Con ocho ciudades son
   40.320: se mira todo y en un instante, sin heurísticas que se equivoquen. */
function* permutaciones(lista) {
  if (lista.length <= 1) {
    yield lista;
    return;
  }
  for (let i = 0; i < lista.length; i++) {
    const resto = [...lista.slice(0, i), ...lista.slice(i + 1)];
    for (const p of permutaciones(resto)) yield [lista[i], ...p];
  }
}

/* EL ORDEN QUE MENOS TREN GASTA para pasar por todas. Como se vuela a la
   primera y desde la última, cualquier ciudad puede ser la puerta. Ante un
   empate se queda el orden en que las elegiste. */
export function ordenar(cods) {
  const lista = [...new Set(cods)].filter((c) => CIUDADES[c]);
  if (lista.length <= 2) return lista;
  let mejor = null;
  let mejorMin = Infinity;
  for (const p of permutaciones(lista)) {
    // Los dos sentidos del mismo recorrido cuestan igual: uno basta.
    if (p[0] > p[p.length - 1]) continue;
    let total = 0;
    for (let i = 0; i < p.length - 1 && total < mejorMin; i++) {
      const t = camino(p[i], p[i + 1]);
      total += t ? t.min : 1e6;
    }
    if (total < mejorMin) {
      mejorMin = total;
      mejor = p;
    }
  }
  return mejor || lista;
}

/* ------------------------------------------------------------ guardado */

const CLAVE_ELECCION = tfClave("tf_ir_eleccion");
const CLAVE_PENDIENTES = tfClave("tf_ir_pendientes");
const CLAVE_AJUSTES = tfClave("tf_ir_ajustes");
const CLAVE_CIUDADES = tfClave("tf_ir_ciudades");
const CLAVE_RUTA = tfClave("tf_ir_ruta");
const CLAVE_FORM = tfClave("tf_ir_form");

const leer = (clave, defecto = {}) => {
  try {
    const v = JSON.parse(localStorage.getItem(clave) || "null");
    return v ?? defecto;
  } catch {
    return defecto;
  }
};
const guardar = (clave, valor) => {
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
  } catch {
    /* navegación privada: dura lo que la pestaña */
  }
};

export const elegidas = () => {
  const v = leer(CLAVE_CIUDADES, []);
  return Array.isArray(v) ? v.filter((c) => CIUDADES[c]) : [];
};
export const guardarElegidas = (lista) => guardar(CLAVE_CIUDADES, [...new Set(lista)].slice(0, MAX_ELEGIDAS));

export const ajusteDe = (id) => leer(CLAVE_AJUSTES)[id] || {};

export function ajustar(id, cambio) {
  const todos = leer(CLAVE_AJUSTES);
  const nuevo = cambio({ ...todos[id] });
  if (!nuevo || !Object.keys(nuevo).length) delete todos[id];
  else todos[id] = nuevo;
  guardar(CLAVE_AJUSTES, todos);
}

/* ------------------------------------------------------------ las rutas */

const parada = (cod, noches) => ({ cod, noches, ...CIUDADES[cod] });

const puerta = (p) => ({
  ciudad: p.ciudad,
  cod: p.cod,
  aeropuertos: p.aeropuertos || [],
  iata: (p.aeropuertos || [])[0] || "",
});

/* Las noches si no has dicho nada: con la vuelta puesta, se reparten las que
   hay (las ciudades pequeñas, una menos); sin ella, dos en cada sitio. */
export function nochesPorDefecto(cods, libres = null) {
  const peso = cods.map((c) => (CIUDADES[c]?.pequena ? 1 : 2));
  if (!Number.isFinite(libres) || libres < cods.length) return peso.map((p) => Math.max(MIN_NOCHES, p));
  const total = peso.reduce((s, p) => s + p, 0);
  const salida = peso.map((p) => Math.max(MIN_NOCHES, Math.floor((libres * p) / total)));
  let sobra = libres - salida.reduce((s, n) => s + n, 0);
  for (let i = 0; sobra > 0; i = (i + 1) % salida.length) {
    if (salida[i] < MAX_NOCHES && !CIUDADES[cods[i]]?.pequena) {
      salida[i] += 1;
      sobra -= 1;
    } else if (salida.every((n, j) => n >= MAX_NOCHES || CIUDADES[cods[j]]?.pequena)) {
      salida[i] = Math.min(MAX_NOCHES, salida[i] + 1);
      sobra -= 1;
    }
  }
  return salida.map((n) => Math.min(MAX_NOCHES, n));
}

/* LA RUTA TAL COMO QUEDA. Parte de una lista de paradas —la de una ruta hecha,
   o las ciudades que elegiste— y le pone encima lo que cambiaste: al revés,
   las noches de cada una y las que te saltas. Saltarse una no deja un hueco:
   el tramo se recalcula por el mapa y pasa por ella (o por otro sitio, si es
   más corto). */
export function construir(base, a = ajusteDe(base.id)) {
  let paradas = base.paradas.map(([cod, n]) => parada(cod, n));
  if (a.rev) paradas.reverse();
  for (const p of paradas) {
    const n = Number(a.noches?.[p.cod]);
    if (n >= MIN_NOCHES && n <= MAX_NOCHES) p.noches = n;
  }
  const fuera = [];
  for (const cod of a.fuera || []) {
    const i = paradas.findIndex((p) => p.cod === cod);
    if (i < 0 || paradas.length <= MIN_PARADAS) continue;
    fuera.push(paradas[i]);
    paradas.splice(i, 1);
  }
  const tramos = [];
  for (let i = 0; i < paradas.length - 1; i++) {
    const [x, y] = [paradas[i].cod, paradas[i + 1].cod];
    const t = camino(x, y);
    const n = nocturno(x, y);
    /* DE NOCHE. Se sale la última noche que tocaba dormir en la ciudad y se
       llega por la mañana: esa noche no hay cama que pagar, pero sí litera. Las
       fechas de lo que viene detrás no se mueven. */
    if (t && n && (a.noche?.[`${x}>${y}`] || a.noche?.[`${y}>${x}`])) {
      tramos.push({ ...t, noche: n, reserva: n.litera, billete: [n.litera[0] + 40, n.litera[1] + 110], pasa: [], pasaCods: [] });
    } else {
      tramos.push(t ? { ...t, nocturnoPosible: n } : t);
    }
  }
  return {
    ...base,
    paradas,
    tramos,
    fuera,
    rev: !!a.rev,
    roto: tramos.some((t) => !t),
    ajustada: !!(
      a.rev ||
      a.fuera?.length ||
      (a.noches && Object.keys(a.noches).length) ||
      (a.noche && Object.keys(a.noche).length)
    ),
    entra: puerta(paradas[0]),
    sale: puerta(paradas[paradas.length - 1]),
  };
}

/* La tuya: las ciudades que elegiste, en el orden que menos tren gasta, con
   lo que le hayas cambiado encima. */
export function rutaPropia(cods, libres = null, ajuste = {}) {
  const orden = ordenar(cods);
  if (orden.length < MIN_PARADAS) return null;
  const noches = nochesPorDefecto(orden, libres);
  const base = {
    id: "tuya",
    propia: true,
    nombre: "",
    idea: "En el orden que menos tren gasta, y por el camino más corto entre cada dos.",
    paradas: orden.map((c, i) => [c, noches[i]]),
  };
  // El nombre, de la ruta ya hecha: si la has dado la vuelta, también él.
  const r = construir(base, ajuste);
  return { ...r, nombre: r.paradas.map((p) => p.ciudad).join(" → ") };
}

export const rutaHecha = (r) => construir(r);

/* ------------------------------------------------------------ las cuentas */

export const diasDeBono = (r) => r.tramos.length;
export const noches = (r) => r.paradas.reduce((s, p) => s + p.noches, 0);
export const minutosEnTren = (r) => r.tramos.reduce((s, t) => s + (t ? t.min : 0), 0);

export function reservas(r) {
  return r.tramos.reduce(
    (acc, t) => (t && t.reserva ? [acc[0] + t.reserva[0], acc[1] + t.reserva[1]] : acc),
    [0, 0]
  );
}

export function billetes(r) {
  return r.tramos.reduce((acc, t) => (t ? [acc[0] + t.billete[0], acc[1] + t.billete[1]] : acc), [0, 0]);
}

/* El pase más barato que cubre la ruta: si gasta 4 días, el de 4. */
export function paseQueCubre(r) {
  const dias = diasDeBono(r);
  return BONOS.find((d) => d >= dias) || null;
}

export function conBono(r, edad = "adulto") {
  const dias = paseQueCubre(r);
  if (!dias) return null;
  const pase = PASES[dias][edad] ?? PASES[dias].adulto;
  const [rmin, rmax] = reservas(r);
  return { dias, pase, total: [pase + rmin, pase + rmax] };
}

/* Cuál sale mejor, comprando el pase o billete a billete. Son horquillas:
   solo se afirma cuando no se pisan. */
export function veredicto(r, edad = "adulto") {
  const sin = billetes(r);
  const con = conBono(r, edad);
  if (!con) return "";
  if (sin[1] < con.total[0]) return "sin";
  if (sin[0] > con.total[1]) return "con";
  return "depende";
}

/* ¿Cabe en el pase que ya tienes? */
export const cabeEnPase = (r, dias) => diasDeBono(r) <= dias;

/* Las rutas hechas que se enseñan. Con ciudades elegidas, las que pasan por
   todas; sin ellas, todas. Con el pase en la mano, solo las que caben. */
export function propuestas(ctx, libres = null) {
  const quiero = ctx.ciudades || [];
  return RUTAS.map(rutaHecha)
    .filter((r) => quiero.every((c) => r.paradas.some((p) => p.cod === c)))
    .filter((r) => !ctx.tengoPase || cabeEnPase(r, ctx.dias))
    .filter((r) => !Number.isFinite(libres) || noches(r) <= libres)
    .sort((a, b) => diasDeBono(b) - diasDeBono(a) || noches(a) - noches(b));
}

/* Compatibilidad: lo que caben en N días de pase. */
export const caben = (dias, maxNoches = Infinity) =>
  propuestas({ tengoPase: true, dias, ciudades: [] }, Number.isFinite(maxNoches) ? maxNoches : null);

/* Fecha ISO + n días, sin que la hora de verano la desplace (nada de
   `toISOString`, que pasa a UTC y en España puede restar un día). */
export function sumarDias(iso, n) {
  const d = parseISO(iso);
  if (!d) return "";
  d.setDate(d.getDate() + n);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function nochesEntre(ida, vuelta) {
  const a = parseISO(ida);
  const b = parseISO(vuelta);
  if (!a || !b) return null;
  const n = Math.round((b - a) / 86400000);
  return n >= 0 ? n : null;
}

export function fechas(r, ida) {
  if (!parseISO(ida)) return null;
  return { ida, vuelta: sumarDias(ida, noches(r)) };
}

export const vueloURL = (desde, hasta, dia, adultos = 1) =>
  edreamsURL({ origin: desde, destination: hasta, depart_date: dia, adults: adultos });

/* Cada parada con su llegada y su salida. `camaNoches` son las que se duermen
   en cama: una menos si se sale de ella en tren nocturno. */
export function paradasConFechas(r, ida) {
  if (!parseISO(ida)) return [];
  let dia = ida;
  return r.paradas.map((p, i) => {
    const deNoche = !!(r.tramos[i] && r.tramos[i].noche);
    const camaNoches = deNoche ? p.noches - 1 : p.noches;
    const sale = sumarDias(dia, p.noches);
    const out = { ...p, checkin: dia, checkout: sumarDias(dia, camaNoches), sale, camaNoches, deNoche };
    dia = sale;
    return out;
  });
}

/* Las paradas donde hay que buscar cama (una de una noche que se deja en
   tren nocturno no la tiene: se llega por la mañana y se sale por la noche). */
export const conCama = (paradas) => paradas.filter((p) => p.camaNoches > 0);

/* La cama de una parada depende de la ciudad, la llegada, las noches y
   cuántos vais. NO de la ruta: Praga del 3 al 5 es la misma cama venga uno de
   Berlín o de Viena, y así lo que ya se buscó sirve para cualquier ruta. */
export const idParada = (p, adultos) =>
  `ir-${p.cod}-${p.checkin}-${p.camaNoches ?? p.noches}n-${adultos}`;

export const idVuelo = (origen, cod, dia, sentido) => `ir-vuelo-${origen}-${cod}-${dia}-${sentido}`;

export function vuelosDe(r, ida, origen) {
  const f = fechas(r, ida);
  if (!f) return [];
  return [
    { id: idVuelo(origen, r.entra.cod, f.ida, "ida"), origen, aeropuertos: r.entra.aeropuertos, fecha: f.ida, sentido: "ida" },
    { id: idVuelo(origen, r.sale.cod, f.vuelta, "vuelta"), origen, aeropuertos: r.sale.aeropuertos, fecha: f.vuelta, sentido: "vuelta" },
  ].filter((v) => v.aeropuertos.length);
}

export function mejorVuelo(datos) {
  if (datos === undefined) return undefined;
  if (!datos || !Array.isArray(datos.legs) || !datos.legs.length) return null;
  return datos.legs[0];
}

const HABITACION = /^(habitaci[oó]n|room in|private room|shared room|hotel room|cama en|bed in)/i;
/* Y en el nombre, por palabra entera: la primera ruta de verdad trajo «Numa |
   Habitación estándar con balcón» en Berlín con un `area` de apartamento.
   «bedroom» o «rooftop» son de pisos y pasan. Es la misma lista que
   `stays/enteros.py`; aquí también porque los ficheros ya guardados no pasan
   por el servidor otra vez. */
const HABITACION_EN_NOMBRE =
  /\b(room|rooms|habitaci[oó]n|habitaciones|chambre|zimmer|camera|camere|dorm|hostel|hostal|albergue|b&b|bed and breakfast|pensi[oó]n)\b/i;

/* El mismo anuncio con otra consulta en la dirección es el mismo anuncio. */
const claveCama = (s) => {
  try {
    const u = new URL(s.url);
    return `${s.provider}|${u.host}${u.pathname}`.toLowerCase();
  } catch {
    return `${s.provider}|${s.url}`;
  }
};

/* Por debajo de un 30 % de la mediana de la parada no es un piso entero: en
   Ámsterdam, un barco hotel a 50 € dos noches con los pisos entre 300 y 800. */
export function sinImposibles(lista) {
  const precios = lista.map((s) => s.price_total).sort((a, b) => a - b);
  if (precios.length < 4) return lista;
  const mitad = Math.floor(precios.length / 2);
  const mediana = precios.length % 2 ? precios[mitad] : (precios[mitad - 1] + precios[mitad]) / 2;
  return lista.filter((s) => s.price_total >= mediana * 0.3);
}

/* Lo que se puede elegir en una parada: sitios enteros, con precio y cerca
   del centro, sin repetir. Lo que no dice dónde está se queda (no es culpa
   suya), pero va detrás de lo que sí. Si NADA queda cerca, se enseña lo más
   cercano que haya hasta el doble de la distancia, y la tarjeta lo avisa. */
export function opciones(datos) {
  const vistas = new Set();
  const enteras = sinImposibles(
    ((datos && datos.stays) || []).filter((s) => {
      if (s.kind !== "stay" || !s.price_total) return false;
      if (HABITACION.test(String(s.area || "").trim())) return false;
      if (HABITACION_EN_NOMBRE.test(String(s.name || ""))) return false;
      const k = claveCama(s);
      if (vistas.has(k)) return false;
      vistas.add(k);
      return true;
    })
  );
  const km = (s) => (Number.isFinite(s.km_centro) ? s.km_centro : null);
  const cerca = enteras.filter((s) => km(s) === null || km(s) <= MAX_KM);
  if (cerca.some((s) => km(s) !== null)) {
    return [...cerca.filter((s) => km(s) !== null), ...cerca.filter((s) => km(s) === null)];
  }
  const lejos = enteras.filter((s) => km(s) !== null && km(s) <= MAX_KM * 2);
  return lejos.length ? lejos.sort((a, b) => a.km_centro - b.km_centro) : cerca;
}

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

export function alojamiento(r, ida, adultos, camas) {
  let total = 0;
  let faltan = 0;
  for (const p of conCama(paradasConFechas(r, ida))) {
    const id = idParada(p, adultos);
    const s = elegida(id, camas[id]);
    if (s) total += s.price_total;
    else faltan += 1;
  }
  return { total, porPersona: total / adultos, faltan };
}

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

/* EL TOTAL DEL VIAJE, por persona. Con el pase ya comprado: reservas, vuelos
   y cama, y el pase NO se suma. Sin él: las dos formas —comprando el pase o
   billete a billete—, con los vuelos y la cama encima de cada una. */
export function totalViaje(r, { edad, ida, adultos, origen, camas, vuelos, tengoPase = false }) {
  const cama = alojamiento(r, ida, adultos, camas);
  const avion = vuelosPrecio(r, ida, origen, vuelos);
  const resto = avion.total + cama.porPersona;
  const sumar = ([a, b]) => [a + resto, b + resto];
  const con = conBono(r, edad);
  return {
    tengoPase,
    yaPagado: tengoPase ? sumar(reservas(r)) : null,
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

const CAMAS = {};
const VUELOS = {};
let EXISTEN = null;
let EXISTEN_V = null;
let sondeo = null;
let temporizador = null;
const ABIERTOS = new Set();
/* Lo que ya se intentó buscar solo y falló (sin cuenta, sin red): no se
   reintenta en bucle; el botón sigue ahí para hacerlo a mano. */
const AUTO_FALLIDAS = new Set();

const ESPERA_MAX_MS = 40 * 60 * 1000;
const firma = (r) => r.paradas.map((p, i) => `${p.cod}${p.noches}${r.tramos[i]?.noche ? "n" : ""}`).join("");
const claveRuta = (r, ctx) => `${ctx.ida}|${ctx.adultos}|${ctx.origen}|${firma(r)}`;
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

const fechaCorta = (iso) => (iso ? fmtDate(iso, true) : "");

/* ------------------------------------------------ los vuelos, flexibles

   El fichero de cada vuelo trae, además del día exacto, el más barato de cada
   día entre tres antes y tres después (Ryanair y Wizz). Si moverse sale a
   cuenta —diez euros o más por persona, o que ese día no haya vuelo— se
   propone, y un toque lo hace: la ida mueve el viaje entero; la vuelta, las
   noches de la última parada. */
const AHORRO_MINIMO = 10;

export function otrosDias(datos, dia, precioActual) {
  const dias = (datos && datos.dias) || {};
  return Object.entries(dias)
    .filter(([d, v]) => d !== dia && v && Number.isFinite(v.price))
    .filter(([, v]) => !Number.isFinite(precioActual) || v.price <= precioActual - AHORRO_MINIMO)
    .sort((a, b) => a[1].price - b[1].price)
    .slice(0, 3)
    .map(([d, v]) => ({ dia: d, vuelo: v, ahorro: Number.isFinite(precioActual) ? precioActual - v.price : null }));
}

/* Cuántos días se mueve la vuelta, y si la última parada lo aguanta. */
function vueltaPosible(r, delta) {
  const ultima = r.paradas[r.paradas.length - 1];
  const n = ultima.noches + delta;
  return n >= MIN_NOCHES && n <= MAX_NOCHES;
}

function vueloHTML(sentido, r, ctx, v, buscando) {
  const origen = esc(nombreOrigen(ctx.origen));
  const titulo =
    sentido === "ida" ? `${origen} → ${esc(r.entra.ciudad)}` : `${esc(r.sale.ciudad)} → ${origen}`;
  const [desde, hasta] = sentido === "ida" ? [ctx.origen, r.entra.iata] : [r.sale.iata, ctx.origen];
  const dia = v ? v.fecha : "";
  const datos = v ? VUELOS[v.id] : undefined;
  const m = v ? mejorVuelo(datos) : undefined;
  const url = dia ? vueloURL(desde, hasta, dia, ctx.adultos) : "";
  let estado = "";
  if (m) {
    const reservar = m.deep_link
      ? ` · <a href="${escURL(m.deep_link)}" target="_blank" rel="noopener">reservar</a>`
      : "";
    estado = `<p class="ir-ev-meta"><b>${eur(m.price)}</b> por persona · ${esc(m.airline)} ${esc(m.time || "")} ·
      ${esc(m.origin)} → ${esc(m.destination)}${reservar}</p>`;
  } else if (m === null) {
    estado = `<p class="ir-ev-meta sin">Ni Ryanair ni Wizz vuelan ese día: mira otros días abajo o en el enlace.</p>`;
  } else if (buscando) {
    estado = `<p class="ir-ev-meta"><span class="spin"></span>buscando el vuelo…</p>`;
  }
  const otros = otrosDias(datos, dia, m ? m.price : NaN).filter(
    (o) => sentido === "ida" || vueltaPosible(r, nochesEntre(dia, o.dia) ?? -nochesEntre(o.dia, dia))
  );
  const chips = otros.length
    ? `<div class="ir-otros-dias"><span>${m ? "Más barato otro día:" : "Hay vuelo otros días:"}</span>${otros
        .map(
          (o) => `<button type="button" class="ir-dia-chip" data-ir-mover="${sentido}" data-dia="${esc(o.dia)}">
            ${esc(fechaCorta(o.dia))} · <b>${eur(o.vuelo.price)}</b>${
              o.ahorro ? ` <small>−${eur(o.ahorro)}</small>` : ""
            }</button>`
        )
        .join("")}</div>`
    : "";
  return `<li class="ir-ev ir-ev-vuelo">
      <span class="ir-ev-dia">${esc(fechaCorta(dia))}</span>
      <span class="ir-ev-ico" aria-hidden="true">✈</span>
      <div class="ir-ev-cuerpo">
        <p class="ir-ev-titulo">${titulo}</p>
        ${estado}
        ${chips}
      </div>
      ${url ? `<a class="btn ghost small ir-ev-accion" href="${escURL(url)}" target="_blank" rel="noopener">Ver vuelos</a>` : ""}
    </li>`;
}

/* ------------------------------------------------------------- la cama */

const fuente = (s) => esc([s.provider, s.note].filter(Boolean).join(" · "));

/* «a 12 min andando del centro». Pasado lo razonable se dice en kilómetros y
   se marca: no se esconde, pero tampoco se disfraza de paseo. */
export function aPie(km) {
  if (km === null || km === undefined || !Number.isFinite(km)) return "";
  const min = Math.max(1, Math.round((km / 4.8) * 60));
  if (km <= MAX_KM) return ` · a ${min} min andando del centro`;
  return ` · <span class="ir-lejos">a ${km.toFixed(1).replace(".", ",")} km del centro</span>`;
}

const nota = (s) =>
  Number.isFinite(s.rating) ? ` · ★ ${String(s.rating).replace(".", ",")}${s.reviews ? ` (${s.reviews})` : ""}` : "";

function camaHTML(p, ctx, buscando) {
  if (!p.camaNoches) {
    return `<div class="ir-cama vacia">Sin cama: llegas por la mañana y sales esa noche en tren nocturno.</div>`;
  }
  const id = idParada(p, ctx.adultos);
  const datos = CAMAS[id];
  if (datos === undefined || datos === null) {
    if (!buscando) return "";
    return `<div class="ir-cama esperando"><span class="spin"></span>buscando pisos enteros cerca del centro…</div>`;
  }
  const lista = opciones(datos);
  const s = elegida(id, datos);
  if (!s) return `<div class="ir-cama vacia">Sin pisos enteros cerca del centro para esas fechas.</div>`;
  const lejos = Number.isFinite(s.km_centro) && s.km_centro > MAX_KM;
  const otras = lista.filter((x) => x.url !== s.url);
  const foto = s.image
    ? `<img src="${escURL(s.image)}" alt="" loading="lazy" decoding="async" width="88" height="66">`
    : "";
  const porNoche = p.camaNoches ? s.price_total / p.camaNoches : null;
  return `
    <div class="ir-cama" data-parada="${esc(id)}">
      ${lejos ? `<p class="ir-cama-aviso">No quedaba nada libre más cerca del centro para esas fechas.</p>` : ""}
      <div class="ir-cama-sel${foto ? "" : " sin-foto"}">
        ${foto}
        <div>
          <a href="${escURL(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>
          <small>${fuente(s)}${aPie(s.km_centro)}${nota(s)}</small>
        </div>
        <b>${eur(s.price_total)}<small>${porNoche ? `${eur(porNoche)}/noche` : ""}</small></b>
      </div>
      ${
        otras.length
          ? `<details class="ir-otras">
               <summary>Cambiar · ${otras.length} ${otras.length === 1 ? "opción" : "opciones"} más</summary>
               <ul>${otras
                 .map(
                   (o) => `<li>
                     <button type="button" class="ir-elegir" data-parada="${esc(id)}" data-url="${esc(o.url)}">
                       <span>${esc(o.name)}<small>${fuente(o)}${aPie(o.km_centro)}${nota(o)}</small></span>
                       <b>${eur(o.price_total)}</b>
                     </button></li>`
                 )
                 .join("")}</ul>
             </details>`
          : ""
      }
    </div>`;
}

/* ------------------------------------------------------------- el tren */

/* Los horarios de verdad, del día que toca: el planificador de la Deutsche
   Bahn cubre casi toda Europa. De día desde las ocho; de noche, desde la hora
   del nocturno. */
export function horariosURL(a, b, dia, hora = "08:00") {
  const so = encodeURIComponent(ESTACIONES[a] || CIUDADES[a]?.ciudad || a);
  const zo = encodeURIComponent(ESTACIONES[b] || CIUDADES[b]?.ciudad || b);
  return `https://int.bahn.de/en/buchung/fahrplan/suche#sts=true&so=${so}&zo=${zo}&hd=${dia}T${hora}:00&kl=2`;
}

function tramoHTML(r, i, p, siguiente) {
  const t = r.tramos[i];
  const dia = p.checkout && p.deNoche ? p.checkout : p.sale;
  if (!t) {
    return `<li class="ir-ev ir-ev-tren ir-roto"><span class="ir-ev-dia"></span><span class="ir-ev-ico" aria-hidden="true">!</span>
      <div class="ir-ev-cuerpo"><p class="ir-ev-titulo">No hay tren entre ${esc(p.ciudad)} y ${esc(siguiente.ciudad)} en el mapa.</p></div></li>`;
  }
  const clave = `${p.cod}>${siguiente.cod}`;
  const horas = t.noche
    ? `de noche: sales ≈ ${esc(t.noche.sale)}, llegas ≈ ${esc(t.noche.llega)} · ${reservaTxt(t)} (litera)`
    : `≈ ${esc(enHoras(t.min))} · ${reservaTxt(t)}`;
  const pasa = !t.noche && t.pasa.length ? `<p class="ir-ev-meta">Pasas por ${esc(t.pasa.join(", "))} sin parar.</p>` : "";
  const largo =
    !t.noche && t.min > TRAMO_LARGO_MIN && t.pasaCods.length
      ? `<div class="ir-largo"><span>Es un día largo de tren.</span>${t.pasaCods
          .map(
            (c) =>
              `<button type="button" class="btn ghost small" data-ir-parar="${esc(c)}">Parar en ${esc(
                CIUDADES[c].ciudad
              )}</button>`
          )
          .join("")}</div>`
      : "";
  const n = t.noche || t.nocturnoPosible;
  const nocturno = n
    ? t.noche
      ? `<div class="ir-nocturno"><span>🌙 Noche en el tren: una noche menos de piso.</span>
           <button type="button" class="btn ghost small" data-ir-noche="${esc(clave)}">Mejor de día</button></div>`
      : p.noches > 0
        ? `<div class="ir-nocturno"><span>🌙 Hay tren nocturno (sale ≈ ${esc(n.sale)}, llega ≈ ${esc(n.llega)}):
             te ahorras una noche de piso; litera con el pase ≈ ${horquilla(n.litera)}.</span>
           <button type="button" class="btn ghost small" data-ir-noche="${esc(clave)}">Ir de noche</button></div>`
        : ""
    : "";
  return `<li class="ir-ev ir-ev-tren${t.noche ? " de-noche" : ""}">
      <span class="ir-ev-dia">${esc(fechaCorta(p.deNoche ? p.checkout : p.sale))}</span>
      <span class="ir-ev-ico" aria-hidden="true">${t.noche ? "🌙" : "🚆"}</span>
      <div class="ir-ev-cuerpo">
        <p class="ir-ev-titulo">${esc(p.ciudad)} → ${esc(siguiente.ciudad)}</p>
        <p class="ir-ev-meta">${horas} · billete suelto ≈ ${horquilla(t.billete)}</p>
        ${pasa}
        ${largo}
        ${nocturno}
      </div>
      ${
        dia
          ? `<a class="btn ghost small ir-ev-accion" href="${escURL(
              horariosURL(p.cod, siguiente.cod, dia, t.noche ? t.noche.sale : "08:00")
            )}" target="_blank" rel="noopener">Horarios</a>`
          : ""
      }
    </li>`;
}

/* ------------------------------------------------- el viaje, día a día */

function itinerarioHTML(r, ctx, esperando) {
  const paradas = paradasConFechas(r, ctx.ida);
  const [vIda, vVuelta] = vuelosDe(r, ctx.ida, ctx.origen);
  const partes = [vueloHTML("ida", r, ctx, vIda, esperando)];
  r.paradas.forEach((p0, i) => {
    const p = paradas[i] || { ...p0, camaNoches: p0.noches };
    const hasta = p.sale ? ` → ${esc(fechaCorta(p.deNoche ? p.checkout : p.sale))}` : "";
    partes.push(`<li class="ir-ev ir-ev-ciudad">
        <span class="ir-ev-dia">${esc(fechaCorta(p.checkin))}</span>
        <span class="ir-ev-ico" aria-hidden="true">●</span>
        <div class="ir-ev-cuerpo">
          <p class="ir-ev-titulo ir-parada"><b>${esc(p.ciudad)}</b>
            <small>${plural(p.noches, "noche", "noches")}${p.checkin ? ` · ${esc(fechaCorta(p.checkin))}${hasta}` : ""}</small></p>
          ${paradas[i] ? camaHTML(p, ctx, esperando) : ""}
        </div>
      </li>`);
    if (i < r.paradas.length - 1) partes.push(tramoHTML(r, i, p, r.paradas[i + 1]));
  });
  partes.push(vueloHTML("vuelta", r, ctx, vVuelta, esperando));
  return `<ol class="ir-itinerario">${partes.join("")}</ol>`;
}

/* ------------------------------------------------------------- el precio */

const VEREDICTOS = {
  sin: "Billete a billete sale más barato. El pase te da libertad para cambiar de planes, no ahorro.",
  con: "El pase sale a cuenta: comprando cada billete suelto pagarías más.",
  depende:
    "Depende de cuándo compres. Con semanas de antelación, billete a billete suele ganar; a última hora, el pase.",
};

/* El número grande: lo que cuesta el viaje por persona de la mejor forma. */
function mejorTotal(r, ctx, t) {
  if (ctx.tengoPase) return t.yaPagado;
  if (!t.con) return t.sin;
  const v = veredicto(r, ctx.edad);
  if (v === "con") return t.con;
  if (v === "sin") return t.sin;
  return [Math.min(t.sin[0], t.con[0]), Math.min(t.sin[1], t.con[1])];
}

function avisosDe(t) {
  const avisos = [];
  if (t.cama.faltan) avisos.push(`falta el alojamiento de ${plural(t.cama.faltan, "parada", "paradas")}`);
  if (t.avion.sinVuelo) avisos.push(`${plural(t.avion.sinVuelo, "vuelo", "vuelos")} sin precio ese día`);
  if (t.avion.faltan) {
    const cuales = ["ida", "vuelta"].filter((s) => t.avion.tramos[s] === undefined);
    avisos.push(cuales.length === 1 ? `falta el vuelo de ${cuales[0]}` : "faltan los vuelos");
  }
  return avisos;
}

function precioHTML(r, ctx) {
  const t = totalViaje(r, { ...ctx, camas: CAMAS, vuelos: VUELOS });
  const piezas = [];
  if (t.avion.total > 0) {
    const { ida, vuelta } = t.avion.tramos;
    const partes = [ida ? `ida ${eur(ida.price)}` : "", vuelta ? `vuelta ${eur(vuelta.price)}` : ""]
      .filter(Boolean)
      .join(" + ");
    piezas.push(`vuelos ${eur(t.avion.total)} (${partes})`);
  }
  if (t.cama.total > 0) {
    piezas.push(`alojamiento ${eur(t.cama.porPersona)} por persona (${eur(t.cama.total)} para ${ctx.adultos})`);
  }
  const avisos = avisosDe(t);
  const desglose = `<p class="ir-desglose">${ctx.tengoPase ? "Reservas del tren" : "Tren"}${
    piezas.length ? ` + ${piezas.join(" + ")}` : ""
  }${avisos.length ? ` · <b>${esc(avisos.join(" · "))}</b>` : ""}.</p>`;

  if (ctx.tengoPase) {
    const grupo =
      ctx.adultos > 1
        ? `<p class="ir-grupo">Para ${ctx.adultos}: ≈ ${horquilla(t.yaPagado.map((x) => x * ctx.adultos))}</p>`
        : "";
    return `
      <div class="ir-precio" data-pase="si" data-completo="${t.completo ? "si" : "no"}">
        <p class="ir-precio-titulo">Lo que te queda por pagar, por persona</p>
        <dl>
          <div class="gana"><dt>Con tu pase</dt><dd>≈ ${horquilla(t.yaPagado)}</dd>
            <small>el pase no se cuenta: ya lo tienes</small></div>
        </dl>
        ${desglose}
        ${grupo}
      </div>`;
  }
  if (!t.con) return "";
  const v = veredicto(r, ctx.edad);
  const grupo =
    ctx.adultos > 1
      ? `<p class="ir-grupo">Para ${ctx.adultos}: ≈ ${horquilla(t.con.map((x) => x * ctx.adultos))} comprando el pase ·
          ≈ ${horquilla(t.sin.map((x) => x * ctx.adultos))} billete a billete</p>`
      : "";
  return `
    <div class="ir-precio" data-pase="no" data-veredicto="${v}" data-completo="${t.completo ? "si" : "no"}">
      <p class="ir-precio-titulo">¿Pase o billetes sueltos? Por persona</p>
      <dl>
        <div class="${v === "con" ? "gana" : ""}"><dt>Comprando el pase</dt><dd>≈ ${horquilla(t.con)}</dd>
          <small>pase de ${t.pase.dias} días, ${eur(t.pase.pase)}${reservas(r)[1] ? " + reservas" : ""}</small></div>
        <div class="${v === "sin" ? "gana" : ""}"><dt>Billete a billete</dt><dd>≈ ${horquilla(t.sin)}</dd>
          <small>cada tren por separado</small></div>
      </dl>
      ${desglose}
      ${grupo}
      <p class="ir-veredicto">${esc(VEREDICTOS[v])}</p>
    </div>`;
}

/* EL RESUMEN, arriba del todo: qué viaje es, cuánto cuesta y cómo va la
   búsqueda, sin tener que bajar. */
function resumenHTML(r, ctx, libres, esperando) {
  const t = totalViaje(r, { ...ctx, camas: CAMAS, vuelos: VUELOS });
  const total = mejorTotal(r, ctx, t);
  const f = fechas(r, ctx.ida);
  const avisos = avisosDe(t);
  const [rmin, rmax] = reservas(r);
  const sobran = ctx.tengoPase ? ctx.dias - diasDeBono(r) : 0;
  const huecos = Number.isFinite(libres) ? libres - noches(r) : 0;
  const estadoTxt = t.completo
    ? "Con vuelos y alojamiento de verdad."
    : esperando
      ? "Buscando lo que falta…"
      : `Sin contar lo que falta: ${avisos.join(", ")}.`;
  return `
    <header class="ir-resumen">
      <div class="ir-res-cab">
        <p class="ir-etiqueta">${r.propia ? "tu ruta" : "la ruta elegida"}</p>
        <h3>${esc(r.nombre)}</h3>
        <p class="ir-res-idea">${esc(r.idea)}</p>
        <ul class="ir-res-datos">
          ${f ? `<li>${esc(fechaCorta(f.ida))} → ${esc(fechaCorta(f.vuelta))}</li>` : ""}
          <li>${plural(noches(r), "noche", "noches")}${huecos > 0 ? ` <small>(te sobran ${huecos})</small>` : ""}</li>
          <li>${plural(r.paradas.length, "ciudad", "ciudades")}</li>
          <li>≈ ${esc(enHoras(minutosEnTren(r)))} de tren</li>
          <li>${plural(diasDeBono(r), "día", "días")} de pase${sobran > 0 ? ` <small>(te sobra${sobran === 1 ? "" : "n"} ${sobran})</small>` : ""}</li>
          <li>${rmax ? `reservas ≈ ${horquilla([rmin, rmax])}` : "sin reservas"}</li>
        </ul>
      </div>
      <div class="ir-res-total" data-completo="${t.completo ? "si" : "no"}">
        <span>${ctx.tengoPase ? "Te queda por pagar" : "El viaje entero"}, por persona</span>
        <b>≈ ${horquilla(total)}</b>
        ${ctx.adultos > 1 ? `<small>para ${ctx.adultos}: ≈ ${horquilla(total.map((x) => x * ctx.adultos))}</small>` : ""}
        <small class="ir-res-estado">${esc(estadoTxt)}</small>
      </div>
      <div class="ir-res-acciones">
        <button type="button" class="btn ghost small" data-ir-compartir>Compartir el plan</button>
        <button type="button" class="btn ghost small" data-ir-calendario ${f ? "" : "disabled"}>Al calendario</button>
      </div>
    </header>`;
}

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
            data-cod="${esc(p.cod)}" ${quitables ? "" : "disabled"}>${r.propia ? "Quitar" : "Saltármela"}</button>
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

/* Lo que falta por buscar de una ruta. */
function faltanDe(r, ctx) {
  const paradas = conCama(paradasConFechas(r, ctx.ida)).filter((p) => !CAMAS[idParada(p, ctx.adultos)]);
  const vuelos = vuelosDe(r, ctx.ida, ctx.origen).filter((v) => VUELOS[v.id] === undefined);
  return { paradas, vuelos, nada: !paradas.length && !vuelos.length };
}

const haySesion = () => typeof tfUid === "function" && !!tfUid();

function estadoBusquedaHTML(r, ctx, esperando) {
  if (!parseISO(ctx.ida)) {
    return `<p class="ir-buscando">Pon la fecha de ida y se buscan solos los vuelos y el alojamiento.</p>`;
  }
  const f = faltanDe(r, ctx);
  if (f.nada) return "";
  if (esperando) {
    return `<p class="ir-buscando"><span class="spin"></span>Buscando los vuelos y pisos enteros en el centro
      de ${plural(conCama(paradasConFechas(r, ctx.ida)).length, "parada", "paradas")}: un par de minutos por
      parada. Puedes cerrar la página, el resultado se guarda.</p>`;
  }
  if (!haySesion()) {
    const caja = cajaAcceso({ reason: "sin-cuenta" });
    return `<div class="ir-sin-sesion">${caja.html}</div>`;
  }
  return `<div class="ir-pedir">
      <button type="button" class="btn deep" data-ir-camas="${esc(r.id)}">Buscar vuelos y alojamiento</button>
      <small>Los dos vuelos, de ida sola, y pisos y casas enteras —nada de habitaciones— a poca distancia a pie
        del centro. Luego puedes cambiar cada uno.</small>
    </div>`;
}

/* Lo que impide hacer esta ruta tal cual, dicho antes que nada. */
function problemasHTML(r, ctx, libres) {
  const p = [];
  if (r.roto) p.push("Alguna de estas ciudades no tiene tren con la siguiente en el mapa: quita una o cambia el orden.");
  if (ctx.tengoPase && !cabeEnPase(r, ctx.dias)) {
    p.push(
      `Gasta ${diasDeBono(r)} días de tren y tu pase tiene ${ctx.dias}: te ${
        diasDeBono(r) - ctx.dias === 1 ? "sobra una parada" : `sobran ${diasDeBono(r) - ctx.dias} paradas`
      }, o hay que pagar algún tramo aparte.`
    );
  }
  if (Number.isFinite(libres) && noches(r) > libres) {
    p.push(`Son ${noches(r)} noches y entre tus fechas hay ${libres}: quita noches o alguna parada.`);
  }
  return p.length ? `<p class="ir-problema">${p.map(esc).join(" ")}</p>` : "";
}

/* LA RUTA ELEGIDA, entera: el resumen, lo que la impide, el precio,
   personalizar, la búsqueda y el viaje día a día. */
function tarjeta(r, ctx, libres) {
  const esperando = pendiente(r, ctx);
  return `
    <article class="ir-ruta elegida${r.ajustada ? " ajustada" : ""}${r.propia ? " propia" : ""}" id="ruta-${esc(r.id)}">
      ${resumenHTML(r, ctx, libres, esperando)}
      ${problemasHTML(r, ctx, libres)}
      ${precioHTML(r, ctx)}
      ${ajustarHTML(r)}
      ${estadoBusquedaHTML(r, ctx, esperando)}
      <div class="ir-acceso"></div>
      <h4 class="ir-itinerario-titulo">Día a día</h4>
      ${itinerarioHTML(r, ctx, esperando)}
    </article>`;
}

/* Las demás, en corto: con lo justo para decidir si cambiarse. */
function tarjetaCorta(r, ctx) {
  const t = totalViaje(r, { ...ctx, camas: CAMAS, vuelos: VUELOS });
  const tren = ctx.tengoPase
    ? `reservas ≈ ${horquilla(reservas(r))}`
    : t.con
      ? `tren ≈ ${horquilla(veredicto(r, ctx.edad) === "sin" ? billetes(r) : conBono(r, ctx.edad).total)}`
      : "";
  return `
    <article class="ir-ruta corta" id="ruta-${esc(r.id)}">
      <div>
        <h3>${esc(r.nombre)}</h3>
        <p class="ir-corta-paradas">${r.paradas.map((p) => esc(p.ciudad)).join(" → ")}</p>
        <p class="meta">${plural(diasDeBono(r), "día", "días")} de tren · ${plural(noches(r), "noche", "noches")} ·
          ${esc(tren)}</p>
      </div>
      <button type="button" class="btn ghost small" data-ir-elegir-ruta="${esc(r.id)}">Elegir esta</button>
    </article>`;
}

function estado() {
  const q = (s) => document.querySelector(s);
  const tengoPase = document.querySelector('input[name="irPase"]:checked')?.value === "si";
  return {
    tengoPase,
    dias: Number(q("#irDias")?.value || 7),
    ida: q("#irIda")?.value || "",
    vuelta: q("#irVuelta")?.value || "",
    edad: q("#irEdad")?.value || "adulto",
    adultos: Math.min(8, Math.max(1, Number(q("#irPersonas")?.value) || 2)),
    origen: q("#irOrigen")?.value || "MAD",
    ciudades: elegidas(),
  };
}

/* Todas las rutas de la pantalla, la elegida la primera. */
export function rutasDe(ctx, libres = null) {
  const propia =
    ctx.ciudades.length >= MIN_PARADAS ? rutaPropia(ctx.ciudades, libres, ajusteDe("tuya")) : null;
  return propia ? [propia, ...propuestas(ctx, libres)] : propuestas(ctx, libres);
}

function laElegida(lista) {
  const id = leer(CLAVE_RUTA, "");
  return lista.find((r) => r.id === id) || lista[0] || null;
}

/* ------------------------------------------------------------- el mapa

   Las ciudades en su sitio y las líneas de tren entre ellas, y encima la ruta
   elegida. Se toca una ciudad para añadirla o quitarla: elegir por dónde pasar
   mirando Europa se entiende solo, y en una lista de 48 nombres no. La lista
   sigue debajo, para quien prefiera escribir o use lector de pantalla.

   La proyección es la más simple que no engaña a esta escala: longitud por el
   coseno de 50° y latitud tal cual. */
const LON0 = -2;
const LAT1 = 61.2;
const ESCALA = 34;
const COS = Math.cos((50 * Math.PI) / 180);
const px = (lon) => Math.round((lon - LON0) * COS * ESCALA);
const py = (lat) => Math.round((LAT1 - lat) * ESCALA);
const ANCHO_MAPA = px(22.5);
const ALTO_MAPA = py(40.2);

/* Por dónde pasa de verdad la ruta: las paradas y, entre cada dos, las
   ciudades que el tren atraviesa sin parar. */
function trazado(r) {
  if (!r) return [];
  const cods = [];
  r.paradas.forEach((p, i) => {
    cods.push(p.cod);
    const t = r.tramos[i];
    if (t && i < r.paradas.length - 1) cods.push(...t.pasaCods);
  });
  return cods;
}

export function mapaSVG(elegidasSet, ruta) {
  const enRuta = new Set(ruta ? ruta.paradas.map((p) => p.cod) : []);
  const lineas = CONEXIONES.map(([a, b]) => {
    const [ca, cb] = [CIUDADES[a], CIUDADES[b]];
    return `<line x1="${px(ca.lon)}" y1="${py(ca.lat)}" x2="${px(cb.lon)}" y2="${py(cb.lat)}"/>`;
  }).join("");
  const camino = trazado(ruta)
    .map((c) => `${px(CIUDADES[c].lon)},${py(CIUDADES[c].lat)}`)
    .join(" ");
  const nodos = Object.entries(CIUDADES)
    .map(([cod, c]) => {
      const x = px(c.lon);
      const y = py(c.lat);
      const sel = elegidasSet.has(cod);
      const parada = enRuta.has(cod);
      const menor = c.pequena && !sel && !parada;
      return `<g class="ir-nodo${sel ? " sel" : ""}${parada ? " parada" : ""}" data-ir-ciudad="${esc(cod)}"
          role="button" tabindex="0" aria-pressed="${sel}" aria-label="${esc(c.ciudad)}">
        <circle class="ir-nodo-toque" cx="${x}" cy="${y}" r="13"/>
        <circle class="ir-nodo-punto" cx="${x}" cy="${y}" r="${sel || parada ? 6 : 4}"/>
        <text x="${x + 8}" y="${y + 4}"${menor ? ' class="menor"' : ""}>${esc(c.ciudad)}</text>
      </g>`;
    })
    .join("");
  return `<svg class="ir-mapa-svg" viewBox="0 0 ${ANCHO_MAPA} ${ALTO_MAPA}" role="group"
      aria-label="Mapa de ciudades: toca una para añadirla o quitarla">
      <g class="ir-mapa-lineas">${lineas}</g>
      ${camino ? `<polyline class="ir-mapa-ruta" points="${camino}"/>` : ""}
      ${nodos}
    </svg>`;
}

function pintarMapa(ruta) {
  const caja = document.querySelector("#irMapa");
  if (!caja) return;
  caja.innerHTML = mapaSVG(new Set(elegidas()), ruta);
}

function pintarCiudades() {
  const caja = document.querySelector("#irCiudades");
  if (!caja) return;
  const mias = new Set(elegidas());
  caja.innerHTML = ZONAS.map(([zona, paises]) => {
    const suyas = Object.entries(CIUDADES)
      .filter(([, c]) => paises.includes(c.pais))
      .sort((a, b) => paises.indexOf(a[1].pais) - paises.indexOf(b[1].pais) || a[1].ciudad.localeCompare(b[1].ciudad, "es"));
    return `<div class="ir-pais"><span>${esc(zona)}</span>${suyas
      .map(
        ([cod, c]) => `<button type="button" class="ir-chip" data-ir-ciudad="${esc(cod)}"
          aria-pressed="${mias.has(cod)}" title="${esc(c.pais)}">${esc(c.ciudad)}</button>`
      )
      .join("")}</div>`;
  }).join("");
  const n = mias.size;
  const resumen = document.querySelector("#irElegidas");
  if (resumen) {
    resumen.innerHTML = n
      ? `<b>${[...mias].map((c) => esc(CIUDADES[c].ciudad)).join(", ")}</b>${
          n === 1 ? " · elige al menos otra para montar tu ruta" : ""
        } · <button type="button" class="ir-limpiar" data-ir-limpiar>Quitar todas</button>`
      : "Toca las ciudades en el mapa. Si no eliges ninguna, abajo tienes rutas hechas.";
  }
}

function pintar() {
  const caja = document.querySelector("#irRutas");
  if (!caja) return;
  const ctx = estado();
  const libres = nochesEntre(ctx.ida, ctx.vuelta);
  const pista = document.querySelector("#irHint");
  document.querySelector("#irDiasWrap")?.toggleAttribute("hidden", !ctx.tengoPase);
  document.querySelector("#irEdadWrap")?.toggleAttribute("hidden", ctx.tengoPase);

  if (ctx.vuelta && libres === null) {
    if (pista) pista.textContent = "La vuelta es antes que la ida: cámbiala para ver las rutas.";
    caja.innerHTML = "";
    pintarMapa(null);
    return;
  }
  const lista = rutasDe(ctx, libres);
  const elegida = laElegida(lista);
  pintarMapa(elegida);
  if (pista) {
    if (!lista.length) {
      pista.textContent = ctx.ciudades.length
        ? "Ninguna ruta hecha pasa por todas esas ciudades: elige al menos dos y te montamos la tuya."
        : ctx.tengoPase
          ? `Con ${ctx.dias} días de pase no cabe ninguna de las rutas hechas.`
          : "No cabe ninguna ruta hecha entre esas fechas.";
    } else {
      const otras = lista.length - 1;
      pista.textContent = elegida.propia
        ? `Tu ruta, y ${plural(otras, "ruta hecha", "rutas hechas")} que pasa${otras === 1 ? "" : "n"} por lo mismo.`
        : `${plural(lista.length, "ruta", "rutas")}${
            ctx.tengoPase ? ` que caben en tu pase de ${ctx.dias} días` : ""
          }${Number.isFinite(libres) ? ` y en ${libres} noches` : ""}.`;
    }
  }
  if (!elegida) {
    caja.innerHTML = "";
    return;
  }
  const resto = lista.filter((r) => r !== elegida);
  const abierta = document.querySelector("#irRutas .ir-mas")?.open;
  caja.innerHTML =
    tarjeta(elegida, ctx, libres) +
    (resto.length
      ? `<details class="ir-mas"${abierta ? " open" : ""}>
           <summary>${elegida.propia ? "Rutas hechas que pasan por ahí" : "Otras rutas"} · ${resto.length}</summary>
           <div class="ir-cortas">${resto.map((r) => tarjetaCorta(r, ctx)).join("")}</div>
         </details>`
      : "");
  wireEntrar(caja);
  cargar(lista, ctx);
  programarBusqueda(elegida, ctx, libres);
}

async function indice(ruta, campo) {
  try {
    const datos = await fetchJSON(ruta);
    return new Set(Array.isArray(datos?.[campo]) ? datos[campo] : Object.keys(datos?.[campo] || {}));
  } catch {
    return new Set();
  }
}

async function cargar(lista, ctx) {
  if (EXISTEN === null) EXISTEN = await indice("data/stays/index.json", "viajes");
  if (EXISTEN_V === null) EXISTEN_V = await indice("data/interrail/index.json", "vuelos");
  const pedir = [];
  for (const r of lista) {
    const espera = pendiente(r, ctx);
    for (const p of conCama(paradasConFechas(r, ctx.ida))) {
      const id = idParada(p, ctx.adultos);
      if (CAMAS[id] === undefined && (EXISTEN.has(id) || espera)) pedir.push([CAMAS, id, `data/stays/${id}.json`]);
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

function vigilar() {
  clearInterval(sondeo);
  sondeo = setInterval(() => {
    const ctx = estado();
    const libres = nochesEntre(ctx.ida, ctx.vuelta);
    const lista = rutasDe(ctx, libres);
    const quedan = lista.some((r) => pendiente(r, ctx) && !faltanDe(r, ctx).nada);
    if (!quedan) {
      clearInterval(sondeo);
      return;
    }
    cargar(lista, ctx);
  }, POLL_EVERY_MS);
}

/* LA BÚSQUEDA SOLA. Cuando la ruta elegida está clara —fecha de ida, sesión,
   sin problemas que la hagan imposible— y le falta algo, se busca. Con un
   respiro de un par de segundos: quien está cambiando las noches con el «+»
   no quiere diez búsquedas, quiere la última. */
const RESPIRO_MS = 2500;

function programarBusqueda(r, ctx, libres) {
  clearTimeout(temporizador);
  if (!parseISO(ctx.ida) || !haySesion() || r.roto) return;
  if (ctx.tengoPase && !cabeEnPase(r, ctx.dias)) return;
  if (Number.isFinite(libres) && noches(r) > libres) return;
  if (pendiente(r, ctx) || faltanDe(r, ctx).nada || AUTO_FALLIDAS.has(claveRuta(r, ctx))) return;
  temporizador = setTimeout(() => {
    // Lo que se ve puede haber cambiado en el respiro: se vuelve a mirar.
    const ahora = estado();
    const lista = rutasDe(ahora, nochesEntre(ahora.ida, ahora.vuelta));
    const sigue = laElegida(lista);
    if (sigue && claveRuta(sigue, ahora) === claveRuta(r, ctx)) pedir(sigue, null, true);
  }, RESPIRO_MS);
}

async function pedir(r, boton, sola = false) {
  const ctx = estado();
  const { paradas, vuelos } = faltanDe(r, ctx);
  if (!paradas.length && !vuelos.length) return;
  if (boton) boton.disabled = true;
  const res = await dispatch("interrail", {
    ruta: r.id,
    adults: String(ctx.adultos),
    paradas: paradas.map((p) => ({
      offer_id: idParada(p, ctx.adultos),
      city: p.ciudad,
      country: p.pais,
      iata: (p.aeropuertos || [])[0] || "",
      checkin: p.checkin,
      checkout: p.checkout,
      // El centro: Airbnb busca en un recuadro alrededor y lo lejano se tira.
      lat: p.lat,
      lon: p.lon,
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
  if (sola) AUTO_FALLIDAS.add(claveRuta(r, ctx));
  if (boton) boton.disabled = false;
  const hueco = document.querySelector(`#ruta-${r.id} .ir-acceso`);
  if (!hueco) return;
  if (esFaltaDeAcceso(res)) {
    const caja = cajaAcceso(res);
    hueco.innerHTML = caja.html;
    caja.wire();
  } else {
    hueco.innerHTML = `<p class="status wait">No se pudo lanzar la búsqueda: ${esc(res.reason || "")}</p>`;
  }
}

function accion(tipo, rutaId, cod) {
  const ctx = estado();
  const libres = nochesEntre(ctx.ida, ctx.vuelta);
  const actual = rutasDe(ctx, libres).find((x) => x.id === rutaId);
  if (!actual) return;
  if (rutaId === "tuya" && (tipo === "quitar" || tipo === "poner")) {
    // En la tuya, quitar una ciudad es desmarcarla: la ruta se reordena sola.
    const lista = elegidas();
    guardarElegidas(tipo === "quitar" ? lista.filter((c) => c !== cod) : [...lista, cod]);
    pintarCiudades();
    ABIERTOS.add(rutaId);
    pintar();
    return;
  }
  const noches0 = (c) => {
    const p = actual.paradas.find((x) => x.cod === c);
    return p ? p.noches : 2;
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
    if (tipo === "noche") {
      // `cod` aquí es el tramo, «VIE>VCE». De noche o de día, por tramo.
      const [x, y] = cod.split(">");
      const puesta = a.noche?.[cod] || a.noche?.[`${y}>${x}`];
      const resto = { ...a.noche };
      delete resto[cod];
      delete resto[`${y}>${x}`];
      a.noche = puesta ? resto : { ...resto, [cod]: true };
      if (!Object.keys(a.noche).length) delete a.noche;
    }
    if (a.fuera && !a.fuera.length) delete a.fuera;
    if (!a.rev) delete a.rev;
    return a;
  });
  ABIERTOS.add(rutaId);
  pintar();
}

/* Mover el vuelo a otro día que sale más barato. La ida mueve el viaje entero;
   la vuelta, las noches de la última parada. */
function moverVuelo(sentido, dia) {
  const ctx = estado();
  const libres = nochesEntre(ctx.ida, ctx.vuelta);
  const r = laElegida(rutasDe(ctx, libres));
  if (!r) return;
  if (sentido === "ida") {
    const ida = document.querySelector("#irIda");
    if (!ida) return;
    ida.value = dia;
    // La vuelta que hubiera puesta se mueve con ella: si no, las noches libres
    // cambian y la ruta podría dejar de caber por un día.
    const vuelta = document.querySelector("#irVuelta");
    if (vuelta && vuelta.value && libres !== null) vuelta.value = sumarDias(dia, libres);
    ida.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  const f = fechas(r, ctx.ida);
  if (!f) return;
  const delta = nochesEntre(f.vuelta, dia) ?? -nochesEntre(dia, f.vuelta);
  const ultima = r.paradas[r.paradas.length - 1];
  const n = ultima.noches + delta;
  if (n < MIN_NOCHES || n > MAX_NOCHES) return;
  ajustar(r.id, (a) => ({ ...a, noches: { ...a.noches, [ultima.cod]: n } }));
  pintar();
}

/* ------------------------------------------------ compartir y calendario */

/* El plan en la dirección: las ciudades (o la ruta hecha), las fechas, el pase
   y lo que le hayas cambiado. Quien lo abre ve el mismo viaje. */
export function enlacePlan(ctx, r) {
  const q = new URLSearchParams();
  if (r.propia) q.set("c", ctx.ciudades.join(","));
  else q.set("r", r.id);
  if (ctx.ida) q.set("ida", ctx.ida);
  if (ctx.vuelta) q.set("v", ctx.vuelta);
  q.set("p", String(ctx.adultos));
  q.set("o", ctx.origen);
  if (ctx.tengoPase) {
    q.set("pase", "si");
    q.set("d", String(ctx.dias));
  } else {
    q.set("e", ctx.edad);
  }
  const a = ajusteDe(r.id);
  if (Object.keys(a).length) q.set("aj", JSON.stringify(a));
  return `${location.origin}${location.pathname}?${q.toString()}`;
}

/* Y al revés: lo que trae la dirección manda sobre lo guardado. */
function leerPlanDeLaDireccion() {
  const q = new URLSearchParams(location.search);
  if (!q.has("c") && !q.has("r")) return;
  const poner = (sel, v) => {
    const el = document.querySelector(sel);
    if (el && v) el.value = v;
  };
  if (q.get("ida") && q.get("ida") >= hoyISO()) poner("#irIda", q.get("ida"));
  if (q.get("v")) poner("#irVuelta", q.get("v"));
  poner("#irPersonas", q.get("p"));
  poner("#irOrigen", q.get("o"));
  poner("#irEdad", q.get("e"));
  poner("#irDias", q.get("d"));
  const radio = document.querySelector(`input[name="irPase"][value="${q.get("pase") === "si" ? "si" : "no"}"]`);
  if (radio) radio.checked = true;
  const id = q.has("c") ? "tuya" : q.get("r");
  if (q.has("c")) guardarElegidas(q.get("c").split(",").filter((c) => CIUDADES[c]));
  guardar(CLAVE_RUTA, id);
  try {
    const aj = JSON.parse(q.get("aj") || "{}");
    ajustar(id, () => (aj && typeof aj === "object" ? aj : {}));
  } catch {
    ajustar(id, () => ({}));
  }
  recordarFormulario();
}

async function compartirPlan(boton) {
  const ctx = estado();
  const r = laElegida(rutasDe(ctx, nochesEntre(ctx.ida, ctx.vuelta)));
  if (!r) return;
  const url = enlacePlan(ctx, r);
  const texto = `Mi Interrail: ${r.paradas.map((p) => p.ciudad).join(" → ")}`;
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: "Interrail", text: texto, url });
      return;
    } catch {
      /* cancelado: se copia */
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    boton.textContent = "Enlace copiado";
  } catch {
    boton.textContent = "No se pudo copiar";
  }
  setTimeout(() => (boton.textContent = "Compartir el plan"), 2500);
}

/* El viaje en el calendario: los dos vuelos con su hora, cada ciudad como los
   días que estás en ella, y cada tren el día que toca. */
export function calendarioPlan(r, ctx) {
  const paradas = paradasConFechas(r, ctx.ida);
  const f = fechas(r, ctx.ida);
  if (!f) return "";
  const sello = `${new Date().toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
  const base = `ir-${r.id}-${ctx.ida}`;
  const lineas = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//TripFinder//ES", "CALSCALE:GREGORIAN"];
  const [vIda, vVuelta] = vuelosDe(r, ctx.ida, ctx.origen);
  const vuelo = (v, titulo, n) => {
    const m = v ? mejorVuelo(VUELOS[v.id]) : null;
    const inicio = comoFechaICS(v ? v.fecha : "", m ? m.time : "");
    if (!inicio) return;
    lineas.push(
      ...evento({
        uid: `${base}-vuelo${n}@tripfinder`,
        sello,
        inicio,
        fin: finDeTramo(v.fecha, m ? m.time : "", "") || inicio,
        titulo,
        detalle: m ? `${m.airline} · ${m.origin} → ${m.destination} · ${Math.round(m.price)} €\n${m.deep_link || ""}` : "",
      })
    );
  };
  vuelo(vIda, `Vuelo ${nombreOrigen(ctx.origen)} → ${r.entra.ciudad}`, 1);
  paradas.forEach((p, i) => {
    const s = p.camaNoches ? elegida(idParada(p, ctx.adultos), CAMAS[idParada(p, ctx.adultos)]) : null;
    const inicio = comoFechaICS(p.checkin, "");
    const fin = comoFechaICS(p.sale, "");
    if (inicio && fin) {
      lineas.push(
        ...evento({
          uid: `${base}-${p.cod}@tripfinder`,
          sello,
          inicio,
          fin,
          titulo: `${p.ciudad} · ${plural(p.noches, "noche", "noches")}`,
          detalle: s ? `${s.name}\n${s.url}` : "",
          sitio: p.ciudad,
        })
      );
    }
    const t = r.tramos[i];
    const siguiente = r.paradas[i + 1];
    if (t && siguiente) {
      const dia = p.deNoche ? p.checkout : p.sale;
      const ini = comoFechaICS(dia, t.noche ? t.noche.sale : "");
      if (ini) {
        lineas.push(
          ...evento({
            uid: `${base}-tren${i}@tripfinder`,
            sello,
            inicio: ini,
            fin: t.noche ? finDeTramo(dia, t.noche.sale, t.noche.llega) : finDeTramo(dia, "", ""),
            titulo: `${t.noche ? "Tren nocturno" : "Tren"} ${p.ciudad} → ${siguiente.ciudad}`,
            detalle: `≈ ${enHoras(t.min)}${t.reserva ? ` · reserva ≈ ${horquilla(t.reserva)}` : ""}\n${horariosURL(
              p.cod,
              siguiente.cod,
              dia
            )}`,
          })
        );
      }
    }
  });
  vuelo(vVuelta, `Vuelo ${r.sale.ciudad} → ${nombreOrigen(ctx.origen)}`, 2);
  lineas.push("END:VCALENDAR");
  return lineas.join("\r\n");
}

function alCalendarioPlan() {
  const ctx = estado();
  const r = laElegida(rutasDe(ctx, nochesEntre(ctx.ida, ctx.vuelta)));
  if (!r || !parseISO(ctx.ida)) return;
  descargar(`interrail-${ctx.ida}.ics`, calendarioPlan(r, ctx));
  if (typeof tfAnunciar === "function") tfAnunciar("Viaje descargado para tu calendario.");
}

const hoyISO = () => {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(
    2,
    "0"
  )}`;
};

/* Lo que pusiste en el formulario, para que volver a la página no sea empezar
   de cero. */
function recordarFormulario() {
  const ctx = estado();
  guardar(CLAVE_FORM, {
    pase: ctx.tengoPase ? "si" : "no",
    dias: ctx.dias,
    ida: ctx.ida,
    vuelta: ctx.vuelta,
    edad: ctx.edad,
    adultos: ctx.adultos,
    origen: ctx.origen,
  });
}

function restaurarFormulario() {
  const f = leer(CLAVE_FORM, null);
  if (!f) return;
  const poner = (sel, v) => {
    const el = document.querySelector(sel);
    if (el && v !== undefined && v !== null && v !== "") el.value = String(v);
  };
  const radio = document.querySelector(`input[name="irPase"][value="${f.pase === "si" ? "si" : "no"}"]`);
  if (radio) radio.checked = true;
  poner("#irDias", f.dias);
  poner("#irEdad", f.edad);
  poner("#irPersonas", f.adultos);
  poner("#irOrigen", f.origen);
  // Una fecha que ya pasó no se restaura: se queda la de por defecto.
  if (f.ida && f.ida >= hoyISO()) poner("#irIda", f.ida);
  if (f.vuelta && f.ida && f.vuelta >= f.ida && f.ida >= hoyISO()) poner("#irVuelta", f.vuelta);
}

/* Tocar una ciudad, en el mapa o en la lista. */
function alternarCiudad(cod) {
  if (!CIUDADES[cod]) return;
  const lista = elegidas();
  if (lista.includes(cod)) guardarElegidas(lista.filter((c) => c !== cod));
  else if (lista.length < MAX_ELEGIDAS) guardarElegidas([...lista, cod]);
  // Con ciudades nuevas, la tuya pasa a ser la elegida y sus ajustes (de otras
  // ciudades) ya no valen.
  ajustar("tuya", () => ({}));
  guardar(CLAVE_RUTA, "tuya");
  pintarCiudades();
  pintar();
}

/* La puesta en marcha. Se llama desde `arranque.js` y se calla sola si esta
   no es la página del Interrail. */
export function montarInterrail() {
  const form = document.querySelector("#irForm");
  const caja = document.querySelector("#irRutas");
  if (!form || !caja) return;
  const origen = document.querySelector("#irOrigen");
  if (origen && !origen.options.length) {
    origen.innerHTML = ORIGENES.map(
      ([c, n]) => `<option value="${esc(c)}"${c === "MAD" ? " selected" : ""}>${esc(n)} (${esc(c)})</option>`
    ).join("");
  }
  const ida = document.querySelector("#irIda");
  const vuelta = document.querySelector("#irVuelta");
  if (ida && !ida.value) {
    // Un mes vista por defecto: da tiempo a sacar el pase y los vuelos
    // todavía están a precio razonable.
    ida.value = sumarDias(hoyISO(), 30);
    ida.min = hoyISO();
  }
  restaurarFormulario();
  leerPlanDeLaDireccion();
  if (vuelta && ida) vuelta.min = ida.value;
  if (ida && vuelta) {
    ida.addEventListener("change", () => {
      vuelta.min = ida.value;
    });
  }
  form.addEventListener("change", () => {
    recordarFormulario();
    pintar();
  });
  form.addEventListener("submit", (e) => e.preventDefault());

  const alTocar = (e) => {
    const nodo = e.target.closest("[data-ir-ciudad]");
    if (nodo) {
      alternarCiudad(nodo.dataset.irCiudad);
      return true;
    }
    if (e.target.closest("[data-ir-limpiar]")) {
      guardarElegidas([]);
      ajustar("tuya", () => ({}));
      pintarCiudades();
      pintar();
      return true;
    }
    return false;
  };
  for (const sel of ["#irCiudades", "#irMapa", "#irElegidas"]) {
    const el = document.querySelector(sel);
    if (el) el.addEventListener("click", alTocar);
  }
  // En el mapa las ciudades son botones de verdad también con el teclado.
  document.querySelector("#irMapa")?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const nodo = e.target.closest("[data-ir-ciudad]");
    if (!nodo) return;
    e.preventDefault();
    const cod = nodo.dataset.irCiudad;
    alternarCiudad(cod);
    document.querySelector(`#irMapa [data-ir-ciudad="${cod}"]`)?.focus();
  });

  caja.addEventListener("click", (e) => {
    const buscar = e.target.closest("[data-ir-camas]");
    if (buscar) {
      const ctx = estado();
      const r = rutasDe(ctx, nochesEntre(ctx.ida, ctx.vuelta)).find((x) => x.id === buscar.dataset.irCamas);
      if (r) pedir(r, buscar);
      return;
    }
    const otraRuta = e.target.closest("[data-ir-elegir-ruta]");
    if (otraRuta) {
      guardar(CLAVE_RUTA, otraRuta.dataset.irElegirRuta);
      pintar();
      document.querySelector("#irRutas")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const parar = e.target.closest("[data-ir-parar]");
    if (parar) {
      // Parar en una ciudad por la que se pasa: entra en tu selección. Si la
      // ruta era una hecha, sus paradas pasan a ser las tuyas, más esa.
      const ctx = estado();
      const r = rutasDe(ctx, nochesEntre(ctx.ida, ctx.vuelta)).find((x) =>
        x.tramos.some((t) => t && t.pasaCods.includes(parar.dataset.irParar))
      );
      const base = r ? r.paradas.map((p) => p.cod) : elegidas();
      guardarElegidas([...base, parar.dataset.irParar]);
      ajustar("tuya", () => ({}));
      guardar(CLAVE_RUTA, "tuya");
      pintarCiudades();
      pintar();
      return;
    }
    const mover = e.target.closest("[data-ir-mover]");
    if (mover) {
      moverVuelo(mover.dataset.irMover, mover.dataset.dia);
      return;
    }
    const noche = e.target.closest("[data-ir-noche]");
    if (noche) {
      const ctx = estado();
      const r = laElegida(rutasDe(ctx, nochesEntre(ctx.ida, ctx.vuelta)));
      if (r) accion("noche", r.id, noche.dataset.irNoche);
      return;
    }
    const comp = e.target.closest("[data-ir-compartir]");
    if (comp) {
      compartirPlan(comp);
      return;
    }
    if (e.target.closest("[data-ir-calendario]")) {
      alCalendarioPlan();
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
  pintarCiudades();
  pintar();
  vigilar();
}
