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

/* `tramos[i]` va de `paradas[i]` a `paradas[i + 1]`. `reserva` es la horquilla
   en euros por persona; `null` si el tramo no la exige. */
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
      { min: 380, reserva: null },
      { min: 255, reserva: null },
      { min: 240, reserva: null },
      { min: 160, reserva: null },
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
      { min: 145, reserva: [10, 15] },
      { min: 125, reserva: [10, 15] },
      { min: 95, reserva: [10, 15] },
      { min: 70, reserva: [10, 15] },
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
      { min: 180, reserva: [20, 35] },
      { min: 100, reserva: [10, 20] },
      { min: 120, reserva: [10, 20] },
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
      { min: 45, reserva: null },
      { min: 110, reserva: null },
      { min: 170, reserva: null },
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
      { min: 310, reserva: [5, 10] },
      { min: 360, reserva: [5, 10] },
      { min: 410, reserva: [5, 10] },
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
      { min: 200, reserva: [15, 30] },
      { min: 380, reserva: null },
      { min: 255, reserva: null },
      { min: 240, reserva: null },
      { min: 450, reserva: null },
      { min: 225, reserva: [10, 15] },
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

/* Las que caben en el bono, de la que más lo aprovecha a la que menos. */
export function caben(dias) {
  return RUTAS.filter((r) => diasDeBono(r) <= dias).sort(
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

/* Las dos fechas de vuelo de una ruta que sale el día `ida`. */
export function fechas(r, ida) {
  if (!parseISO(ida)) return null;
  return { ida, vuelta: sumarDias(ida, noches(r)) };
}

/* Ida sola, de `desde` a `hasta`, el día `dia`. */
export const vueloURL = (desde, hasta, dia) =>
  edreamsURL({ origin: desde, destination: hasta, depart_date: dia });

/* ------------------------------------------------------------ pintarlo */

function reservaTxt(t) {
  return t.reserva
    ? `<span class="ir-reserva">reserva ≈ ${t.reserva[0]}–${t.reserva[1]} €</span>`
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

function tarjeta(r, dias, ida) {
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
      return `${parada}<li class="ir-tramo">≈ ${esc(enHoras(t.min))} en tren · ${reservaTxt(t)}</li>`;
    })
    .join("");
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
        <div><dt>Noches</dt><dd>${noches(r)}</dd></div>
        <div><dt>En tren</dt><dd>≈ ${esc(enHoras(minutosEnTren(r)))}</dd></div>
        <div><dt>Reservas</dt><dd>${
          rmax ? `≈ ${rmin}–${rmax} €` : "ninguna"
        }</dd></div>
      </dl>
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
  const lista = caben(dias);
  const pista = document.querySelector("#irHint");
  if (pista) {
    pista.textContent = lista.length
      ? `${lista.length} ruta${lista.length === 1 ? "" : "s"} caben en ${dias} días de bono.`
      : `Con ${dias} días no cabe ninguna de estas rutas.`;
  }
  caja.innerHTML = lista.map((r) => tarjeta(r, dias, ida)).join("");
}

/* La puesta en marcha. Se llama desde `arranque.js` y se calla sola si esta
   no es la página de los trenes. */
export function montarInterrail() {
  const sel = document.querySelector("#irDias");
  if (!sel || !document.querySelector("#irRutas")) return;
  sel.addEventListener("change", pintar);
  const ida = document.querySelector("#irIda");
  if (ida) {
    // Un mes vista por defecto: da tiempo a sacar el bono y es cuando los
    // vuelos todavía están a precio razonable. Se cambia en un toque.
    if (!ida.value) {
      const hoy = new Date();
      const iso = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(
        hoy.getDate()
      ).padStart(2, "0")}`;
      ida.value = sumarDias(iso, 30);
      ida.min = iso;
    }
    ida.addEventListener("change", pintar);
  }
  pintar();
}
