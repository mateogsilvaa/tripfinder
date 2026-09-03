/* base.js — Lo comun: atajos del DOM, escapado, y el fetch con cache-buster. */

/* TripFinder — frontend estatico. Lee los JSON que commitea GitHub Actions. */

export const REPO = "mateogsilvaa/tripfinder";
export const POLL_EVERY_MS = 20000;
// 45 vueltas x 20 s = 15 min, de sobra para una busqueda de las largas.
export const MAX_VUELTAS = 45;
export const POLL_MAX_MS = 15 * 60 * 1000;

export const $ = (sel) => document.querySelector(sel);
/* La web esta partida en tres zonas y cada pagina solo tiene su parte, asi que
   engancharse a un elemento que no existe no puede tumbar el resto. */
export const on = (sel, evento, fn) => {
  const el = document.querySelector(sel);
  if (el) el.addEventListener(evento, fn);
};
export const existe = (sel) => !!document.querySelector(sel);
export const fmtEUR = (n) => `${Math.round(n)} €`;
export const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const DAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

export function parseISO(iso) {
  const [y, m, d] = (iso || "").split("-").map(Number);
  return y ? new Date(y, m - 1, d) : null;
}

export function fmtDate(iso, withDay = false) {
  const d = parseISO(iso);
  if (!d) return "";
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return withDay ? `${DAYS[d.getDay()]} ${base}` : base;
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

/* Una URL que viene de los datos, lista para meter en un href o un src.

   `esc()` escapa caracteres, que esta bien y hace falta, pero escapar no
   impide un `javascript:`: sobreviviria intacto dentro del atributo y se
   ejecutaria al hacer clic. Hoy estos campos los generan nuestros propios
   providers, asi que esto es endurecer, no tapar un agujero abierto — pero el
   dia que un scraper se trague HTML de un tercero, esta es la linea que hay
   que tener ya puesta.

   Lo que pasa: http, https y mailto. Lo demas sale como "#" y se apunta en el
   registro, que si un provider empieza a devolver basura interesa saberlo. */
const ESQUEMAS_OK = new Set(["http:", "https:", "mailto:"]);

export function escURL(valor) {
  const crudo = String(valor || "").trim();
  if (!crudo) return "";
  let esquema;
  try {
    // `location.href` como base para que las relativas ("buscar.html") sigan
    // valiendo: sin base, el constructor las rechaza y perderiamos enlaces
    // buenos por el camino.
    esquema = new URL(crudo, location.href).protocol;
  } catch {
    if (typeof tfApuntar === "function") tfApuntar("url", "URL que no se puede leer", crudo.slice(0, 120));
    return "#";
  }
  if (!ESQUEMAS_OK.has(esquema)) {
    if (typeof tfApuntar === "function") {
      tfApuntar("url", `esquema no permitido: ${esquema}`, crudo.slice(0, 120));
    }
    return "#";
  }
  return esc(crudo);
}

/* Cache-buster: Pages sirve los JSON con cache agresiva y aqui siempre queremos lo ultimo. */
export const fetchJSON = (path) =>
  fetch(`${path}${path.includes("?") ? "&" : "?"}t=${Date.now()}`, { cache: "no-store" }).then((r) => {
    if (!r.ok) throw new Error(r.status);
    return r.json();
  });

export let CONTINENTES = {}; // IATA -> continente, para filtrar
export const SEARCH_OFFERS = {}; // ofertas de busquedas guardadas, por id

