/* interrail.js — Con los días del bono, el viaje entero.

   Le dices cuántos días de viaje tiene tu bono y te da rutas que caben: el
   vuelo de entrada, los trenes, cuántas noches en cada parada y el vuelo de
   salida — que no tiene por qué ser desde la misma ciudad, y ahí está media
   gracia de un Interrail.

   NO ES UN OPTIMIZADOR, y es a propósito. La issue (#145) lo decía antes de
   escribir una línea: con seis ciudades ya no se puede mirar todo, y los
   horarios de toda Europa no son gratis. Estas son rutas pensadas, de las que
   funcionan —en línea, sin volver sobre tus pasos, con trenes directos o casi—,
   y se filtran por lo que te cabe en el bono. Crecer hacia un optimizador es
   otra cosa, y esto no lo impide.

   UN DÍA DE BONO ES UN DÍA DE VIAJE, NO UN TRAYECTO. Encadenar dos trenes el
   mismo día gasta uno. Como en estas rutas se duerme al menos una noche en
   cada parada, cada tramo cae en un día distinto: días de bono = tramos.

   LAS RESERVAS OBLIGATORIAS se pagan aparte del bono: los trenes rápidos de
   Italia, Francia y España, y los nórdicos. Un plan que las ignore miente en el
   total, así que cada tramo dice si la lleva y la ficha suma una horquilla.
   Son orientativas —dependen del tren y de cuándo reserves—, y por eso van
   como horquilla y no como una cifra que parezca exacta.

   LOS TIEMPOS son del directo más rápido de cada tramo, redondeados. Igual que
   en los trenes de Madrid: no están contrastados contra la fuente porque desde
   donde se escribió esto no había salida de red a los operadores. Viven aquí y
   en ningún otro sitio. */

import { POLL_EVERY_MS, esc, escURL, fetchJSON, fmtDate, parseISO } from "./base.js";
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

/* Cada parada lleva su país —Airbnb desambigua con él: hay más de una
   Valencia— y un código de tres letras que va en el nombre del fichero de su
   alojamiento. El `iata` puede ir vacío: Lucerna e Interlaken no tienen
   aeropuerto, y solo lo usa el buscador de hoteles, que aquí no se consulta.

   `tramos[i]` va de `paradas[i]` a `paradas[i + 1]`. `reserva` es la horquilla
   en euros por persona; `null` si el tramo no la exige. `billete` es lo que
   suele costar ese tramo SIN bono: segunda, ida, comprado con unas semanas de
   antelación — el barato y el caro de lo normal. Sirve para una sola cosa,
   decir si el bono compensa, y por eso se enseña en pequeño. */
export const RUTAS = [
  {
    id: "centro",
    nombre: "Europa central",
    idea: "Cuatro capitales en línea, sin una sola reserva: el bono sin letra pequeña.",
    entra: { ciudad: "Ámsterdam", iata: "AMS" },
    sale: { ciudad: "Budapest", iata: "BUD" },
    paradas: [
      { ciudad: "Ámsterdam", pais: "Países Bajos", cod: "AMS", iata: "AMS", noches: 2 },
      { ciudad: "Berlín", pais: "Alemania", cod: "BER", iata: "BER", noches: 3 },
      { ciudad: "Praga", pais: "Chequia", cod: "PRG", iata: "PRG", noches: 2 },
      { ciudad: "Viena", pais: "Austria", cod: "VIE", iata: "VIE", noches: 2 },
      { ciudad: "Budapest", pais: "Hungría", cod: "BUD", iata: "BUD", noches: 2 },
    ],
    tramos: [
      { min: 380, reserva: null, billete: [40, 110] },
      { min: 255, reserva: null, billete: [30, 70] },
      { min: 240, reserva: null, billete: [20, 50] },
      { min: 160, reserva: null, billete: [15, 40] },
    ],
  },
  {
    id: "italia",
    nombre: "Italia de punta a punta",
    idea: "Tramos cortos y rápidos: más ciudad que tren. Todos llevan reserva.",
    entra: { ciudad: "Milán", iata: "MXP" },
    sale: { ciudad: "Nápoles", iata: "NAP" },
    paradas: [
      { ciudad: "Milán", pais: "Italia", cod: "MIL", iata: "MIL", noches: 2 },
      { ciudad: "Venecia", pais: "Italia", cod: "VCE", iata: "VCE", noches: 2 },
      { ciudad: "Florencia", pais: "Italia", cod: "FLR", iata: "FLR", noches: 2 },
      { ciudad: "Roma", pais: "Italia", cod: "ROM", iata: "ROM", noches: 3 },
      { ciudad: "Nápoles", pais: "Italia", cod: "NAP", iata: "NAP", noches: 2 },
    ],
    tramos: [
      { min: 145, reserva: [10, 15], billete: [20, 50] },
      { min: 125, reserva: [10, 15], billete: [20, 50] },
      { min: 95, reserva: [10, 15], billete: [20, 55] },
      { min: 70, reserva: [10, 15], billete: [15, 45] },
    ],
  },
  {
    id: "francia",
    nombre: "Del Mediterráneo a París",
    idea: "Sales de casa casi andando: Barcelona, la costa y subir hasta París.",
    entra: { ciudad: "Barcelona", iata: "BCN" },
    sale: { ciudad: "París", iata: "CDG" },
    paradas: [
      { ciudad: "Barcelona", pais: "España", cod: "BCN", iata: "BCN", noches: 1 },
      { ciudad: "Montpellier", pais: "Francia", cod: "MPL", iata: "MPL", noches: 2 },
      { ciudad: "Lyon", pais: "Francia", cod: "LYS", iata: "LYS", noches: 2 },
      { ciudad: "París", pais: "Francia", cod: "PAR", iata: "PAR", noches: 3 },
    ],
    tramos: [
      { min: 180, reserva: [20, 35], billete: [30, 80] },
      { min: 100, reserva: [10, 20], billete: [25, 70] },
      { min: 120, reserva: [10, 20], billete: [30, 90] },
    ],
  },
  {
    id: "suiza",
    nombre: "Suiza y los lagos",
    idea: "Trayectos de una o dos horas entre montañas. Sin reservas; Suiza no es barata, el tren sí sale a cuenta.",
    entra: { ciudad: "Zúrich", iata: "ZRH" },
    sale: { ciudad: "Ginebra", iata: "GVA" },
    paradas: [
      { ciudad: "Zúrich", pais: "Suiza", cod: "ZRH", iata: "ZRH", noches: 2 },
      { ciudad: "Lucerna", pais: "Suiza", cod: "LUC", iata: "", noches: 2 },
      { ciudad: "Interlaken", pais: "Suiza", cod: "INT", iata: "", noches: 2 },
      { ciudad: "Ginebra", pais: "Suiza", cod: "GVA", iata: "GVA", noches: 2 },
    ],
    tramos: [
      { min: 45, reserva: null, billete: [15, 30] },
      { min: 110, reserva: null, billete: [20, 35] },
      { min: 170, reserva: null, billete: [40, 75] },
    ],
  },
  {
    id: "norte",
    nombre: "Los nórdicos",
    idea: "Tres capitales y el tren de Bergen, que es el viaje en sí.",
    entra: { ciudad: "Copenhague", iata: "CPH" },
    sale: { ciudad: "Bergen", iata: "BGO" },
    paradas: [
      { ciudad: "Copenhague", pais: "Dinamarca", cod: "CPH", iata: "CPH", noches: 2 },
      { ciudad: "Estocolmo", pais: "Suecia", cod: "STO", iata: "STO", noches: 3 },
      { ciudad: "Oslo", pais: "Noruega", cod: "OSL", iata: "OSL", noches: 2 },
      { ciudad: "Bergen", pais: "Noruega", cod: "BGO", iata: "BGO", noches: 2 },
    ],
    tramos: [
      { min: 310, reserva: [5, 10], billete: [40, 120] },
      { min: 360, reserva: [5, 10], billete: [30, 90] },
      { min: 410, reserva: [5, 10], billete: [30, 100] },
    ],
  },
  {
    id: "vuelta",
    nombre: "La vuelta grande",
    idea: "De París a Roma dando la vuelta por el centro. Para un bono de siete días.",
    entra: { ciudad: "París", iata: "CDG" },
    sale: { ciudad: "Roma", iata: "FCO" },
    paradas: [
      { ciudad: "París", pais: "Francia", cod: "PAR", iata: "PAR", noches: 2 },
      { ciudad: "Ámsterdam", pais: "Países Bajos", cod: "AMS", iata: "AMS", noches: 2 },
      { ciudad: "Berlín", pais: "Alemania", cod: "BER", iata: "BER", noches: 2 },
      { ciudad: "Praga", pais: "Chequia", cod: "PRG", iata: "PRG", noches: 2 },
      { ciudad: "Viena", pais: "Austria", cod: "VIE", iata: "VIE", noches: 2 },
      { ciudad: "Venecia", pais: "Italia", cod: "VCE", iata: "VCE", noches: 2 },
      { ciudad: "Roma", pais: "Italia", cod: "ROM", iata: "ROM", noches: 2 },
    ],
    tramos: [
      { min: 200, reserva: [15, 30], billete: [40, 150] },
      { min: 380, reserva: null, billete: [40, 110] },
      { min: 255, reserva: null, billete: [30, 70] },
      { min: 240, reserva: null, billete: [20, 50] },
      { min: 450, reserva: null, billete: [30, 90] },
      { min: 225, reserva: [10, 15], billete: [25, 70] },
    ],
  },
];

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
   tengas pensado uno de 5. Es el que se compraría para ESTE viaje, y es con el
   que tiene sentido comparar. */
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

/* Cuál sale mejor. Son horquillas, así que solo se afirma cuando no se pisan;
   si se pisan, depende de cuándo compres los billetes, y se dice eso. */
export function veredicto(r, edad = "adulto") {
  const sin = billetes(r);
  const con = conBono(r, edad);
  if (!con) return "";
  if (sin[1] < con.total[0]) return "sin";
  if (sin[0] > con.total[1]) return "con";
  return "depende";
}

/* Las que caben en el bono, de la que más lo aprovecha a la que menos. */
export function caben(dias, maxNoches = Infinity) {
  return RUTAS.filter((r) => diasDeBono(r) <= dias && noches(r) <= maxNoches).sort(
    (a, b) => diasDeBono(b) - diasDeBono(a) || noches(a) - noches(b)
  );
}

/* LOS VUELOS NO VAN AL BUSCADOR DE LA CASA, y fue lo primero que se probó. El
   buscador hace ida y vuelta desde un aeropuerto español, y un Interrail entra
   por una ciudad y sale por otra: «Vuelo de Budapest a Madrid» acababa abriendo
   una búsqueda Madrid → Budapest de ida y vuelta. Justo lo contrario.

   Van a eDreams de IDA SOLA, que admite cualquier origen y es el mismo enlace
   que el feed ya usa para «Comparar». Y como se sabe cuántas noches dura la
   ruta, la fecha del vuelo de vuelta se CALCULA: es la de salida más las noches.
   Eso es lo que hace que esto sea un plan y no una lista de ciudades. */

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

/* Ida sola, de `desde` a `hasta`, el día `dia`. */
export const vueloURL = (desde, hasta, dia, adultos = 1) =>
  edreamsURL({ origin: desde, destination: hasta, depart_date: dia, adults: adultos });

/* ------------------------------------------------------- dónde dormir

   CADA PARADA, SU CAMA, y en un solo encargo para toda la ruta (ver
   `interrail.yml`: uno por parada perdería los del medio). Cada parada deja su
   fichero en `data/stays/`, con un nombre que dice ruta, ciudad, día de
   llegada y cuántos vais: cambiar cualquiera de las cuatro cosas es otro
   alojamiento y otro precio.

   SOLO SITIOS ENTEROS. Se pide así a Airbnb y el servidor tira además lo que
   se cuele; aquí se mira otra vez, que es gratis y es la última puerta.

   LA OPCIÓN QUE SALE es la primera de la lista, que ya viene ordenada por
   precio Y cercanía al centro —un estudio barato a doce kilómetros no es más
   barato, es otro viaje—. Si eliges otra, se guarda en este navegador y el
   total se recalcula con la tuya. */

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

export const idParada = (r, p, adultos) => `ir-${r.id}-${p.cod}-${p.checkin}-${adultos}`;

const HABITACION = /^(habitaci[oó]n|room in|private room|shared room|hotel room|cama en|bed in)/i;

/* Lo que se puede elegir en una parada: sitios enteros con precio, en el
   orden en que llegan (precio y centro). */
export function opciones(datos) {
  return ((datos && datos.stays) || []).filter(
    (s) => s.kind === "stay" && s.price_total && !HABITACION.test(String(s.area || "").trim())
  );
}

const CLAVE_ELECCION = tfClave("tf_ir_eleccion");
const CLAVE_PENDIENTES = tfClave("tf_ir_pendientes");

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
    /* navegación privada: la elección dura lo que la pestaña */
  }
};

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
    const s = elegida(idParada(r, p, adultos), camas[idParada(r, p, adultos)]);
    if (s) total += s.price_total;
    else faltan += 1;
  }
  return { total, porPersona: total / adultos, faltan };
}

/* ------------------------------------------------------------ pintarlo */

const eur = (n) => `${Math.round(n)} €`;
const horquilla = ([a, b]) => (Math.round(a) === Math.round(b) ? eur(a) : `${Math.round(a)}–${eur(b)}`);
const sumar = ([a, b], x) => [a + x, b + x];

/* Lo que ya se sabe de cada parada: id -> fichero de alojamiento, o null si se
   ha mirado y no está. Se llena poco a poco y cada vez que llega algo se
   repinta. */
const CAMAS = {};
let EXISTEN = null; // ids que dice `data/stays/index.json` que hay
let sondeo = null;

/* Una ruta, si se le buscó cama y todavía no ha llegado toda. Quince minutos
   no bastan con siete paradas: el workflow tiene cuarenta de tope. */
const ESPERA_MAX_MS = 40 * 60 * 1000;
const claveRuta = (r, ida, adultos) => `${r.id}|${ida}|${adultos}`;
const pendiente = (r, ida, adultos) => {
  const desde = leer(CLAVE_PENDIENTES)[claveRuta(r, ida, adultos)];
  return desde && Date.now() - desde < ESPERA_MAX_MS ? desde : 0;
};

function reservaTxt(t) {
  return t.reserva
    ? `<span class="ir-reserva">reserva ≈ ${horquilla(t.reserva)}</span>`
    : `<span class="ir-libre">sin reserva</span>`;
}

function vuelo(texto, desde, hasta, dia, adultos) {
  const url = dia ? vueloURL(desde, hasta, dia, adultos) : "";
  return `<li class="ir-vuelo"><span>✈ ${texto}${
    dia ? ` <b>${esc(fmtDate(dia, true))}</b>` : ""
  }</span>${
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
function camaHTML(r, p, adultos, esperando) {
  const id = idParada(r, p, adultos);
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

/* SIN BONO Y CON BONO, y con la cama cuando la hay. Es la pregunta de verdad
   —¿me compensa el bono?— y la respuesta depende de la ruta: en tramos cortos
   y baratos, billete a billete suele salir mejor. Solo se marca un ganador
   cuando las horquillas no se pisan. */
const VEREDICTOS = {
  sin: "Billete a billete sale más barato. El bono te da libertad para cambiar de planes, no ahorro.",
  con: "El bono sale a cuenta: comprando cada billete suelto pagarías más.",
  depende:
    "Depende de cuándo compres. Con semanas de antelación, billete a billete suele ganar; a última hora, el bono.",
};

function precioHTML(r, edad, ida, adultos) {
  const con = conBono(r, edad);
  if (!con) return "";
  const v = veredicto(r, edad);
  const cama = alojamiento(r, ida, adultos, CAMAS);
  const conCama = cama.total > 0;
  const sin = conCama ? sumar(billetes(r), cama.porPersona) : billetes(r);
  const conTotal = conCama ? sumar(con.total, cama.porPersona) : con.total;
  const titulo = conCama ? "El viaje, por persona" : "El tren, por persona";
  const desglose = conCama
    ? `<p class="ir-desglose">Tren + alojamiento ${eur(cama.porPersona)} por persona (${eur(
        cama.total
      )} para ${adultos})${
        cama.faltan ? ` · <b>faltan ${cama.faltan} parada${cama.faltan === 1 ? "" : "s"}</b>` : ""
      }. Vuelos aparte.</p>`
    : "";
  return `
      <div class="ir-precio" data-veredicto="${v}">
        <p class="ir-precio-titulo">${titulo}</p>
        <dl>
          <div class="${v === "sin" ? "gana" : ""}"><dt>Sin bono</dt><dd>≈ ${horquilla(sin)}</dd>
            <small>comprando cada billete</small></div>
          <div class="${v === "con" ? "gana" : ""}"><dt>Con bono</dt><dd>≈ ${horquilla(conTotal)}</dd>
            <small>pase de ${con.dias} días, ${eur(con.pase)}${
              reservas(r)[1] ? " + reservas" : ""
            }</small></div>
        </dl>
        ${desglose}
        <p class="ir-veredicto">${esc(VEREDICTOS[v])}</p>
      </div>`;
}

function botonCamaHTML(r, paradas, adultos, esperando) {
  if (!paradas.length) return "";
  const hechas = paradas.filter((p) => CAMAS[idParada(r, p, adultos)]).length;
  if (hechas === paradas.length) return "";
  if (esperando) {
    return `<p class="ir-buscando"><span class="spin"></span>Buscando alojamiento entero en
      ${paradas.length} paradas: unos dos minutos por parada. Puedes cerrar la página, el
      resultado se guarda.</p>`;
  }
  return `<div class="ir-pedir">
      <button type="button" class="btn deep" data-ir-camas="${esc(r.id)}">
        Buscar alojamiento en ${hechas ? "las que faltan" : `las ${paradas.length} paradas`}</button>
      <small>Pisos y casas enteras, nada de habitaciones: las mejores por precio y cercanía
        al centro. Luego puedes cambiar cada una.</small>
    </div>`;
}

function tarjeta(r, dias, ida, edad, libres, adultos) {
  const [rmin, rmax] = reservas(r);
  const f = fechas(r, ida);
  const sobran = dias - diasDeBono(r);
  const paradas = paradasConFechas(r, ida);
  const esperando = pendiente(r, ida, adultos);
  const pasos = r.paradas
    .map((p, i) => {
      const conFecha = paradas[i];
      const parada = `<li class="ir-parada"><b>${esc(p.ciudad)}</b><small>${p.noches} noche${
        p.noches === 1 ? "" : "s"
      }${conFecha ? ` · desde el ${esc(fmtDate(conFecha.checkin, true))}` : ""}</small></li>`;
      const cama = conFecha ? camaHTML(r, conFecha, adultos, esperando) : "";
      const t = r.tramos[i];
      if (!t) return parada + cama;
      return `${parada}${cama}<li class="ir-tramo">≈ ${esc(enHoras(t.min))} en tren · ${reservaTxt(
        t
      )}<small class="ir-billete">billete suelto ≈ ${horquilla(t.billete)}</small></li>`;
    })
    .join("");
  const huecos = Number.isFinite(libres) ? libres - noches(r) : null;
  return `
    <article class="ir-ruta" id="ruta-${esc(r.id)}">
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
      ${precioHTML(r, edad, ida, adultos)}
      ${botonCamaHTML(r, paradas, adultos, esperando)}
      <div class="ir-acceso"></div>
      <ol class="ir-pasos">
        ${vuelo(`Madrid → ${esc(r.entra.ciudad)}`, "MAD", r.entra.iata, f && f.ida, adultos)}
        ${pasos}
        ${vuelo(`${esc(r.sale.ciudad)} → Madrid`, r.sale.iata, "MAD", f && f.vuelta, adultos)}
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
  };
}

function pintar() {
  const caja = document.querySelector("#irRutas");
  if (!caja) return;
  const { dias, ida, vuelta, edad, adultos } = estado();
  // Con las dos fechas, solo las rutas que caben entre medias.
  const libres = nochesEntre(ida, vuelta);
  const lista = caben(dias, libres ?? Infinity);
  const pista = document.querySelector("#irHint");
  if (pista) {
    const donde = libres !== null ? ` y en ${libres} noches` : "";
    if (vuelta && libres === null) {
      pista.textContent = "La vuelta es antes que la ida: cámbiala para ver las rutas.";
    } else {
      pista.textContent = lista.length
        ? `${lista.length} ruta${lista.length === 1 ? "" : "s"} caben en ${dias} días de bono${donde}.`
        : `Con ${dias} días de bono${donde} no cabe ninguna de estas rutas.`;
    }
  }
  caja.innerHTML = lista
    .map((r) => tarjeta(r, dias, ida, edad, libres ?? undefined, adultos))
    .join("");
  cargarCamas(lista, ida, adultos);
}

/* Trae los ficheros de las paradas que existen. Solo los que dice el índice:
   pedir a ciegas los de las seis rutas serían treinta 404 en cada cambio. */
async function cargarCamas(lista, ida, adultos) {
  if (EXISTEN === null) {
    try {
      const indice = await fetchJSON("data/stays/index.json");
      EXISTEN = new Set(Object.keys((indice && indice.viajes) || {}));
    } catch {
      EXISTEN = new Set();
    }
  }
  const faltan = [];
  for (const r of lista) {
    for (const p of paradasConFechas(r, ida)) {
      const id = idParada(r, p, adultos);
      if (CAMAS[id] === undefined && (EXISTEN.has(id) || pendiente(r, ida, adultos))) {
        faltan.push(id);
      }
    }
  }
  if (!faltan.length) return;
  let alguna = false;
  await Promise.all(
    faltan.map(async (id) => {
      try {
        CAMAS[id] = await fetchJSON(`data/stays/${id}.json`);
        alguna = true;
      } catch {
        /* todavía no está: se reintenta en el siguiente sondeo */
      }
    })
  );
  if (alguna) pintar();
}

/* Mientras haya una ruta esperando, se mira cada poco si han llegado camas. */
function vigilar() {
  clearInterval(sondeo);
  sondeo = setInterval(() => {
    const { dias, ida, vuelta, adultos } = estado();
    const libres = nochesEntre(ida, vuelta);
    const lista = caben(dias, libres ?? Infinity);
    const quedan = lista.some(
      (r) =>
        pendiente(r, ida, adultos) &&
        paradasConFechas(r, ida).some((p) => !CAMAS[idParada(r, p, adultos)])
    );
    // Nada esperando: se para. Lo que llega ya repinta solo en `cargarCamas`.
    if (!quedan) {
      clearInterval(sondeo);
      return;
    }
    cargarCamas(lista, ida, adultos);
  }, POLL_EVERY_MS);
}

async function pedirCamas(r, boton) {
  const { ida, adultos } = estado();
  const paradas = paradasConFechas(r, ida).filter((p) => !CAMAS[idParada(r, p, adultos)]);
  if (!paradas.length) return;
  boton.disabled = true;
  // Tres propiedades: la lista va anidada en UNA, que GitHub solo admite diez.
  const res = await dispatch("interrail", {
    ruta: r.id,
    adults: String(adultos),
    paradas: paradas.map((p) => ({
      offer_id: idParada(r, p, adultos),
      city: p.ciudad,
      country: p.pais,
      iata: p.iata,
      checkin: p.checkin,
      checkout: p.checkout,
    })),
  });
  if (res.ok) {
    const todas = leer(CLAVE_PENDIENTES);
    todas[claveRuta(r, ida, adultos)] = Date.now();
    guardar(CLAVE_PENDIENTES, todas);
    if (typeof tfAnunciar === "function") {
      tfAnunciar("Buscando alojamiento para la ruta. Tarda unos minutos por parada.");
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
  ["#irDias", "#irIda", "#irVuelta", "#irEdad", "#irPersonas"].forEach((s) => {
    const el = document.querySelector(s);
    if (el) el.addEventListener("change", pintar);
  });
  // Un solo oyente para toda la caja: las tarjetas se repintan enteras y los
  // botones de dentro nacen y mueren con cada cambio.
  caja.addEventListener("click", (e) => {
    const pedir = e.target.closest("[data-ir-camas]");
    if (pedir) {
      const r = RUTAS.find((x) => x.id === pedir.dataset.irCamas);
      if (r) pedirCamas(r, pedir);
      return;
    }
    const otra = e.target.closest(".ir-elegir");
    if (otra) {
      elegir(otra.dataset.parada, otra.dataset.url);
      pintar();
    }
  });
  pintar();
  vigilar();
}
