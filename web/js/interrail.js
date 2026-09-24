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

import { esc, escURL, fmtDate, parseISO } from "./base.js";
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

/* `tramos[i]` va de `paradas[i]` a `paradas[i + 1]`. `reserva` es la horquilla
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
      { ciudad: "Ámsterdam", noches: 2 },
      { ciudad: "Berlín", noches: 3 },
      { ciudad: "Praga", noches: 2 },
      { ciudad: "Viena", noches: 2 },
      { ciudad: "Budapest", noches: 2 },
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
      { ciudad: "Milán", noches: 2 },
      { ciudad: "Venecia", noches: 2 },
      { ciudad: "Florencia", noches: 2 },
      { ciudad: "Roma", noches: 3 },
      { ciudad: "Nápoles", noches: 2 },
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
      { ciudad: "Barcelona", noches: 1 },
      { ciudad: "Montpellier", noches: 2 },
      { ciudad: "Lyon", noches: 2 },
      { ciudad: "París", noches: 3 },
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
      { ciudad: "Zúrich", noches: 2 },
      { ciudad: "Lucerna", noches: 2 },
      { ciudad: "Interlaken", noches: 2 },
      { ciudad: "Ginebra", noches: 2 },
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
      { ciudad: "Copenhague", noches: 2 },
      { ciudad: "Estocolmo", noches: 3 },
      { ciudad: "Oslo", noches: 2 },
      { ciudad: "Bergen", noches: 2 },
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
      { ciudad: "París", noches: 2 },
      { ciudad: "Ámsterdam", noches: 2 },
      { ciudad: "Berlín", noches: 2 },
      { ciudad: "Praga", noches: 2 },
      { ciudad: "Viena", noches: 2 },
      { ciudad: "Venecia", noches: 2 },
      { ciudad: "Roma", noches: 2 },
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
export const vueloURL = (desde, hasta, dia) =>
  edreamsURL({ origin: desde, destination: hasta, depart_date: dia });

/* ------------------------------------------------------------ pintarlo */

const eur = (n) => `${n} €`;
const horquilla = ([a, b]) => (a === b ? eur(a) : `${a}–${b} €`);

function reservaTxt(t) {
  return t.reserva
    ? `<span class="ir-reserva">reserva ≈ ${horquilla(t.reserva)}</span>`
    : `<span class="ir-libre">sin reserva</span>`;
}

function vuelo(texto, desde, hasta, dia) {
  const url = dia ? vueloURL(desde, hasta, dia) : "";
  return `<li class="ir-vuelo"><span>✈ ${texto}${
    dia ? ` <b>${esc(fmtDate(dia, true))}</b>` : ""
  }</span>${
    url
      ? `<a class="btn ghost small" href="${escURL(url)}" target="_blank" rel="noopener">Ver vuelos</a>`
      : ""
  }</li>`;
}

/* SIN BONO Y CON BONO. Es la pregunta de verdad de un Interrail —¿me compensa
   el bono?— y la respuesta depende mucho de la ruta: en tramos cortos y
   baratos, comprando billete a billete con antelación suele salir mejor. Se
   dice cuál gana solo cuando las horquillas no se pisan. */
const VEREDICTOS = {
  sin: "Billete a billete sale más barato. El bono te da libertad para cambiar de planes, no ahorro.",
  con: "El bono sale a cuenta: comprando cada billete suelto pagarías más.",
  depende:
    "Depende de cuándo compres. Con semanas de antelación, billete a billete suele ganar; a última hora, el bono.",
};

function precioHTML(r, edad) {
  const sin = billetes(r);
  const con = conBono(r, edad);
  if (!con) return "";
  const v = veredicto(r, edad);
  return `
      <div class="ir-precio" data-veredicto="${v}">
        <p class="ir-precio-titulo">El tren, por persona</p>
        <dl>
          <div class="${v === "sin" ? "gana" : ""}"><dt>Sin bono</dt><dd>≈ ${horquilla(sin)}</dd>
            <small>comprando cada billete</small></div>
          <div class="${v === "con" ? "gana" : ""}"><dt>Con bono</dt><dd>≈ ${horquilla(con.total)}</dd>
            <small>pase de ${con.dias} días, ${eur(con.pase)}${
              reservas(r)[1] ? " + reservas" : ""
            }</small></div>
        </dl>
        <p class="ir-veredicto">${esc(VEREDICTOS[v])}</p>
      </div>`;
}

function tarjeta(r, dias, ida, edad, libres) {
  const [rmin, rmax] = reservas(r);
  const f = fechas(r, ida);
  const sobran = dias - diasDeBono(r);
  const pasos = r.paradas
    .map((p, i) => {
      const parada = `<li class="ir-parada"><b>${esc(p.ciudad)}</b><small>${p.noches} noche${
        p.noches === 1 ? "" : "s"
      }</small></li>`;
      const t = r.tramos[i];
      if (!t) return parada;
      return `${parada}<li class="ir-tramo">≈ ${esc(enHoras(t.min))} en tren · ${reservaTxt(
        t
      )}<small class="ir-billete">billete suelto ≈ ${horquilla(t.billete)}</small></li>`;
    })
    .join("");
  // Si pusiste fecha de vuelta, las noches que te quedan libres.
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
      ${precioHTML(r, edad)}
      <ol class="ir-pasos">
        ${vuelo(`Madrid → ${esc(r.entra.ciudad)}`, "MAD", r.entra.iata, f && f.ida)}
        ${pasos}
        ${vuelo(`${esc(r.sale.ciudad)} → Madrid`, r.sale.iata, "MAD", f && f.vuelta)}
      </ol>
    </article>`;
}

function pintar() {
  const caja = document.querySelector("#irRutas");
  if (!caja) return;
  const dias = Number(document.querySelector("#irDias")?.value || 0);
  const ida = document.querySelector("#irIda")?.value || "";
  const vuelta = document.querySelector("#irVuelta")?.value || "";
  const edad = document.querySelector("#irEdad")?.value || "adulto";
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
    .map((r) => tarjeta(r, dias, ida, edad, libres ?? undefined))
    .join("");
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
  if (!sel || !document.querySelector("#irRutas")) return;
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
  ["#irDias", "#irIda", "#irVuelta", "#irEdad"].forEach((s) => {
    const el = document.querySelector(s);
    if (el) el.addEventListener("change", pintar);
  });
  pintar();
}
