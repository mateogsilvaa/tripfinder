/* opciones.js — Las preguntas que comparten buscar y seguir: de dónde sales,
   qué mes, y los modos de fecha. Aparte de `busqueda.js` porque
   `seguimientos.js` las usa al cargar, y entre los dos hay un import circular:
   leer una constante de un módulo que todavía no ha terminado de cargar es un
   error que tumba la página entera. */
import { $, MONTHS, esc } from "./base.js";

export const DIAS_CORTOS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

/* Los modos de fecha flexible: un mes, un mes de findes, o un tramo. Los tres
   mandan una VENTANA (`desde`/`hasta`) en vez de una fecha, que es el término
   medio que faltaba entre saber el día exacto y no tener ni idea. */
export const CON_MES = new Set(["mes", "mes-finde"]);
export const FLEXIBLES = new Set(["mes", "mes-finde", "tramo"]);

/* DE DÓNDE SALES. Todo el proyecto daba Madrid por hecho: quien vive en
   Barcelona o vuela desde Sevilla no podía usar la web.

   LA LISTA VA AQUÍ ESCRITA Y NO SE DESCARGA, a propósito. El listado mundial
   de aeropuertos son 270 KB y hay una decisión tomada —y una prueba que la
   defiende— de que la portada NO lo pida: se carga solo al abrir el selector
   de destino, que es donde de verdad hacen falta las 5.000 ciudades del mundo.
   Para elegir origen bastan los cuarenta y un aeropuertos españoles, que
   caben en dos kilobytes, no cambian de un año para otro y así siguen estando
   sin cobertura, como el resto de la web.

   Madrid va primero y por defecto: es de donde sale el barrido diario y lo que
   espera casi todo el mundo. El resto, por ciudad. */
export const ORIGENES = [
  ["MAD", "Madrid"],
  ["ALC", "Alicante"],
  ["LEI", "Almería"],
  ["BJZ", "Badajoz"],
  ["BCN", "Barcelona"],
  ["BIO", "Bilbao"],
  ["CDT", "Castellon"],
  ["LCG", "Culleredo"],
  ["ODB", "Córdoba"],
  ["VDE", "El Hierro Island"],
  ["FUE", "Fuerteventura"],
  ["GRO", "Girona"],
  ["LPA", "Gran Canaria"],
  ["GRX", "Granada"],
  ["EAS", "Hondarribia"],
  ["IBZ", "Ibiza"],
  ["XRY", "Jerez de la Frontera"],
  ["LEU", "La Seu d'Urgell Pyrenees and Andorra"],
  ["LEN", "La Virgen del Camino"],
  ["ACE", "Lanzarote"],
  ["ILD", "Lleida"],
  ["MLN", "Melilla"],
  ["MAH", "Menorca"],
  ["RMU", "Murcia"],
  ["AGP", "Málaga"],
  ["PMI", "Palma"],
  ["PNA", "Pamplona"],
  ["OVD", "Ranón"],
  ["REU", "Reus"],
  ["SLM", "Salamanca"],
  ["SDR", "Santander"],
  ["SCQ", "Santiago"],
  ["SVQ", "Sevilla"],
  ["SPC", "Sta Cruz de la Palma, La Palma Island"],
  ["TFS", "Tenerife"],
  ["TFN", "Tenerife"],
  ["VLC", "Valencia"],
  ["VLL", "Valladolid"],
  ["VGO", "Vigo"],
  ["VIT", "Vitoria-Gasteiz"],
  ["ZAZ", "Zaragoza"],
];

export function llenarOrigenes(sel = $("#fOrigen")) {
  if (!sel || sel.options.length) return;
  sel.innerHTML = ORIGENES.map(
    ([code, ciudad]) => `<option value="${code}">${esc(ciudad)} (${code})</option>`
  ).join("");
}

/* Los doce meses que vienen. El valor es `YYYY-MM` y no un nombre suelto:
   «marzo» sin año es de este año o del que viene según cuándo lo mires. */
export function llenarMeses(sel = $("#fMes")) {
  if (!sel || sel.options.length) return;
  const hoy = new Date();
  const meses = [];
  for (let m = 0; m < 12; m++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() + m, 1);
    const valor = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    meses.push(`<option value="${valor}">${MONTHS[d.getMonth()]} ${d.getFullYear()}</option>`);
  }
  sel.innerHTML = meses.join("");
  // El mes en curso ya va medio ido: de casa se ofrece el que viene.
  sel.selectedIndex = Math.min(1, sel.options.length - 1);
}

/* De `2027-03` al primer y último día del mes. El día 0 del mes SIGUIENTE es el
   último del que se pide, y así no hay que saberse cuántos tiene febrero. */
export function mesEnTramo(valor) {
  const [a, m] = (valor || "").split("-").map(Number);
  if (!a || !m) return { desde: "", hasta: "" };
  const ultimo = new Date(a, m, 0).getDate();
  const mm = String(m).padStart(2, "0");
  return { desde: `${a}-${mm}-01`, hasta: `${a}-${mm}-${ultimo}` };
}

