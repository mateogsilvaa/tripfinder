/* trenes.js — De Madrid, en tren.

   POR QUÉ ESTO NO SE SCRAPEA. Renfe publica datos abiertos con horarios, pero
   NO con precios: los precios están en su buscador y en los revendedores, que
   es raspar una web ajena y romperse cada pocas semanas. El proyecto ya tiene
   decidido qué hacer en este caso —mirar `stays/deeplinks.py`, con Booking—:
   cuando no se puede sacar el número, se da el enlace y se dice que no hay
   precio. Mentir con un precio viejo es peor que no ponerlo.

   Y LO QUE SÍ CONTESTA ESTA PÁGINA, que es lo que de verdad se pregunta: si
   sale mejor el tren. Para eso no hace falta ni el precio ni el horario de un
   tren concreto, hace falta el tiempo de viaje —que es estable, cambia cuando
   abren una línea— y la cuenta honesta del avión.

   LA CUENTA DEL AVIÓN. Un vuelo Madrid-Sevilla dura 1 h, pero entre llegar al
   aeropuerto con antelación, el control, la espera, el desembarque, la maleta
   y el trayecto a los dos centros, se van unas tres horas más. El tren sale
   del centro y llega al centro. Por eso 2 h 21 de AVE ganan a 1 h de vuelo.

   LOS TIEMPOS son el trayecto directo más rápido de cada destino, redondeados,
   y por eso van con «≈» delante en la ficha. No son el horario de un tren: son
   lo que se tarda. El horario de verdad está en Renfe, a un clic. */

/* El sobrecoste del avión, puerta a puerta: dos aeropuertos, la antelación, el
   control y la espera. Tirando por lo bajo. */
import { esc } from "./base.js";

export const SUELO_AVION = 180;

/* De dónde sale cada uno. Madrid tiene dos estaciones de largo recorrido y no
   son intercambiables: presentarse en la que no es son cuarenta minutos de
   metro. */
export const ATOCHA = "Atocha";
export const CHAMARTIN = "Chamartín";

/* ciudad · estación de llegada · minutos del directo más rápido · servicio.
   Ordenados por tiempo, que es como se leen. Si abre una línea nueva o cambian
   los tiempos, se tocan aquí y en ningún otro sitio. */
export const TRENES = [
  { ciudad: "Segovia", llega: "Guiomar", min: 27, salida: CHAMARTIN, tipo: "Avant" },
  { ciudad: "Toledo", llega: "Toledo", min: 33, salida: ATOCHA, tipo: "Avant" },
  { ciudad: "Ciudad Real", llega: "Ciudad Real", min: 50, salida: ATOCHA, tipo: "AVE" },
  { ciudad: "Cuenca", llega: "Fernando Zóbel", min: 55, salida: ATOCHA, tipo: "AVE" },
  { ciudad: "Valladolid", llega: "Campo Grande", min: 60, salida: CHAMARTIN, tipo: "AVE" },
  { ciudad: "Zaragoza", llega: "Delicias", min: 75, salida: ATOCHA, tipo: "AVE" },
  { ciudad: "Palencia", llega: "Palencia", min: 85, salida: CHAMARTIN, tipo: "Alvia" },
  { ciudad: "Albacete", llega: "Los Llanos", min: 90, salida: ATOCHA, tipo: "AVE" },
  { ciudad: "Zamora", llega: "Zamora", min: 90, salida: CHAMARTIN, tipo: "Avant" },
  { ciudad: "Salamanca", llega: "Salamanca", min: 100, salida: CHAMARTIN, tipo: "Alvia" },
  { ciudad: "Córdoba", llega: "Central", min: 103, salida: ATOCHA, tipo: "AVE" },
  { ciudad: "Valencia", llega: "Joaquín Sorolla", min: 110, salida: ATOCHA, tipo: "AVE" },
  { ciudad: "Antequera", llega: "Santa Ana", min: 120, salida: ATOCHA, tipo: "AVE" },
  { ciudad: "León", llega: "León", min: 125, salida: CHAMARTIN, tipo: "AVE" },
  { ciudad: "Lleida", llega: "Pirineus", min: 125, salida: ATOCHA, tipo: "AVE" },
  { ciudad: "Huesca", llega: "Huesca", min: 130, salida: ATOCHA, tipo: "AVE" },
  { ciudad: "Ourense", llega: "Empalme", min: 135, salida: CHAMARTIN, tipo: "AVE" },
  { ciudad: "Tarragona", llega: "Camp de Tarragona", min: 135, salida: ATOCHA, tipo: "AVE" },
  { ciudad: "Málaga", llega: "María Zambrano", min: 140, salida: ATOCHA, tipo: "AVE" },
  { ciudad: "Sevilla", llega: "Santa Justa", min: 141, salida: ATOCHA, tipo: "AVE" },
  { ciudad: "Alicante", llega: "Alicante", min: 140, salida: ATOCHA, tipo: "AVE" },
  { ciudad: "Barcelona", llega: "Sants", min: 150, salida: ATOCHA, tipo: "AVE" },
  { ciudad: "Castellón", llega: "Castellón", min: 150, salida: ATOCHA, tipo: "Alvia" },
  { ciudad: "Murcia", llega: "El Carmen", min: 165, salida: ATOCHA, tipo: "AVE" },
  { ciudad: "Pamplona", llega: "Pamplona", min: 180, salida: ATOCHA, tipo: "Alvia" },
  { ciudad: "Granada", llega: "Granada", min: 185, salida: ATOCHA, tipo: "AVE" },
  { ciudad: "Santiago", llega: "Santiago", min: 190, salida: CHAMARTIN, tipo: "AVE" },
  { ciudad: "Girona", llega: "Girona", min: 200, salida: ATOCHA, tipo: "AVE" },
  { ciudad: "Cáceres", llega: "Cáceres", min: 210, salida: ATOCHA, tipo: "Alvia" },
  { ciudad: "Gijón", llega: "Gijón", min: 215, salida: CHAMARTIN, tipo: "Alvia" },
  { ciudad: "Huelva", llega: "Huelva", min: 215, salida: ATOCHA, tipo: "Alvia" },
  { ciudad: "A Coruña", llega: "A Coruña", min: 230, salida: CHAMARTIN, tipo: "AVE" },
  { ciudad: "Cádiz", llega: "Cádiz", min: 230, salida: ATOCHA, tipo: "Alvia" },
  { ciudad: "Jaén", llega: "Jaén", min: 235, salida: ATOCHA, tipo: "Alvia" },
  { ciudad: "Vigo", llega: "Guixar", min: 250, salida: CHAMARTIN, tipo: "AVE" },
  { ciudad: "Santander", llega: "Santander", min: 250, salida: CHAMARTIN, tipo: "Alvia" },
  { ciudad: "Badajoz", llega: "Badajoz", min: 255, salida: ATOCHA, tipo: "Alvia" },
  { ciudad: "Bilbao", llega: "Abando", min: 290, salida: CHAMARTIN, tipo: "Alvia" },
  { ciudad: "San Sebastián", llega: "Donostia", min: 310, salida: CHAMARTIN, tipo: "Alvia" },
];

/* «2 h 21», «50 min». Sin ceros a la izquierda y sin decir «0 h». */
export function enHoras(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

/* Lo que tardaría el mismo viaje en avión, puerta a puerta. Devuelve null si
   no hay dato del vuelo: preferimos no decir nada a inventarnos la comparación,
   que es justo lo que hace que un numero deje de creerse. */
export function puertaAPuerta(minutosDeVuelo) {
  if (!Number.isFinite(minutosDeVuelo) || minutosDeVuelo <= 0) return null;
  return minutosDeVuelo + SUELO_AVION;
}

/* El buscador de Renfe. NO va con las fechas puestas a propósito: el formato
   de su enlace de resultados no es público ni estable, y un enlace prellenado
   que un día deja de funcionar es peor que uno que siempre abre donde tiene
   que abrir. El buscador está en la propia portada. */
export const RENFE = "https://www.renfe.com/es/es";

/* Los que caben en el tiempo que estés dispuesto a viajar. `tope` en minutos;
   sin tope, todos. */
export function hasta(tope) {
  const lista = [...TRENES].sort((a, b) => a.min - b.min);
  if (!Number.isFinite(tope) || tope <= 0) return lista;
  return lista.filter((t) => t.min <= tope);
}

/* Cuántos hay por debajo de cada umbral, para los rótulos de la cabecera. */
export function cuentas() {
  return {
    total: TRENES.length,
    dos: TRENES.filter((t) => t.min <= 120).length,
    tres: TRENES.filter((t) => t.min <= 180).length,
  };
}

/* ------------------------------------------------------------------ pintarlo */

function fila(t) {
  return `
    <div class="brow tren-row">
      <span class="tren-tiempo"><b>${esc(enHoras(t.min))}</b></span>
      <span class="dest-cell"><span class="city">${esc(t.ciudad)}</span></span>
      <span class="tren-estacion">${esc(t.llega)}<small>desde ${esc(t.salida)}</small></span>
      <span class="tren-tipo">${esc(t.tipo)}</span>
    </div>`;
}

/* El rótulo de arriba. Se recalcula con los filtros porque «13 destinos» a
   secas no dice nada si acabas de pedir solo los de Atocha. */
function pintarCabecera(lista) {
  const caja = document.querySelector("#trenStats");
  if (!caja) return;
  const c = cuentas();
  const rapido = lista.length ? lista[0] : null;
  // Cuatro y no tres: `.stats` es una rejilla de dos columnas y con tres queda
  // una celda vacía enseñando el fondo, que parece una cifra que no cargó.
  caja.innerHTML = `
    <div><dt>A tiro de tren</dt><dd>${c.total}</dd></div>
    <div><dt>En menos de 2 h</dt><dd>${c.dos}</dd></div>
    <div><dt>En menos de 3 h</dt><dd>${c.tres}</dd></div>
    <div><dt>El más cerca</dt><dd>${
      rapido ? `${esc(rapido.ciudad)} <small>${esc(enHoras(rapido.min))}</small>` : "—"
    }</dd></div>`;
}

function pintar() {
  const caja = document.querySelector("#trenRows");
  if (!caja) return;
  const tope = Number(document.querySelector("#trenTope")?.value || 0);
  const salida = document.querySelector("#trenSalida")?.value || "";
  const lista = hasta(tope).filter((t) => !salida || t.salida === salida);

  pintarCabecera(lista);
  const pista = document.querySelector("#trenHint");
  if (pista) {
    pista.textContent = lista.length
      ? `${lista.length} destino${lista.length === 1 ? "" : "s"}, del más cerca al más lejos.`
      : "Con ese tope no llega el tren a ninguna parte. Prueba a darle más tiempo.";
  }
  caja.innerHTML = lista.map(fila).join("");
}

/* La puesta en marcha. Se llama desde `arranque.js` como todo lo demás, y se
   calla sola si esta no es la página de los trenes. */
export function montarTrenes() {
  if (!document.querySelector("#trenRows")) return;
  ["#trenTope", "#trenSalida"].forEach((s) => {
    const el = document.querySelector(s);
    if (el) el.addEventListener("change", pintar);
  });
  // El formulario no manda nada a ningún sitio: todo el dato está aquí.
  const form = document.querySelector("#trenForm");
  if (form) form.addEventListener("submit", (e) => e.preventDefault());
  pintar();
}
