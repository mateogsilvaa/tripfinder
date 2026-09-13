/* destinos.js — La lamina de destinos: cargar el listado, filtrar y elegir. */

import { $, esc, fetchJSON, on } from "./base.js";

let destinoPara = "fDest";

/* --------------------------------------------------- selector de destino
   El mapa de puntos quedaba precioso y era inutil: sin costas ni fronteras no
   se sabe que es cada punto. Para ELEGIR funciona mejor una lista que se
   busca escribiendo, agrupada por pais y con el pais entero seleccionable. */
let DESTINOS = null;

/* Las busquedas lanzadas se guardan en el navegador hasta que aparecen en el
   indice. Antes el "buscando..." lo borraba el siguiente refresco de la lista
   y parecia que la busqueda se hubiera esfumado. */
const PEND_KEY = tfClave("tf_pendientes");
export const MAX_ESPERA_MS = 18 * 60 * 1000;  // cuando una busqueda pendiente se marca como colgada

export const pendientes = () => {
  try {
    return JSON.parse(localStorage.getItem(PEND_KEY) || "[]");
  } catch {
    return [];
  }
};
export const guardarPendientes = (lista) => {
  try {
    localStorage.setItem(PEND_KEY, JSON.stringify(lista));
  } catch {
    /* navegacion privada: lo pendiente dura lo que la pestaña */
  }
};

export function anadirPendiente(label) {
  const lista = pendientes().filter((p) => p.label !== label);
  lista.unshift({ label, desde: Date.now() });
  guardarPendientes(lista);
}

/* Lo que se ve mientras una búsqueda corre fuera.

   LA BARRA ES DE TIEMPO, NO DE DESTINOS. Sería mejor decir «40 de 105
   destinos», pero el workflow no cuenta por dónde va: publica el resultado al
   final y no antes. Poner un número de destinos calculado con el reloj sería
   inventarse un dato, así que se dice lo que de verdad se sabe —cuánto lleva y
   cuánto suele tardar— y la barra avanza con eso. Una rueda girando ocho
   minutos no dice nada; esto dice si vas por la mitad o por el final. */
const ESPERA_TIPICA_MS = 8 * 60 * 1000;

function minutos(ms) {
  return Math.max(1, Math.round(ms / 60000));
}

export function pendienteHTML(p, caducada) {
  if (caducada) {
    return `
      <div class="saved lanzada">
        <b>${esc(p.label)}</b>
        <span class="meta aviso">No llegó a terminar. Pasaron ${minutos(
          Date.now() - p.desde
        )} minutos sin que se publicara nada.</span>
        <div class="lanzada-acc">
          <button class="btn ghost small" type="button" data-repetir>Volver a lanzarla</button>
          <button class="quitar" type="button" data-olvidar="${esc(p.label)}"
            aria-label="Olvidar esta búsqueda">olvidar</button>
        </div>
      </div>`;
  }
  const llevo = Date.now() - p.desde;
  // Se queda en el 95 %: llegar al 100 y seguir esperando es peor que ir lento.
  const pct = Math.min(95, Math.round((llevo / ESPERA_TIPICA_MS) * 100));
  const quedan = Math.max(0, ESPERA_TIPICA_MS - llevo);
  return `
    <div class="saved lanzada">
      <b>${esc(p.label)}</b>
      <span class="lanzada-hora">lanzada ${esc(hora(p.desde))}</span>
      <span class="meta"><span class="spin"></span>preguntando destino a destino…</span>
      <div class="lanzada-barra" role="progressbar" aria-valuemin="0" aria-valuemax="100"
        aria-valuenow="${pct}" aria-label="Progreso de la búsqueda"><i style="width:${pct}%"></i></div>
      <span class="lanzada-pie">
        <span>lleva ${minutos(llevo)} min</span>
        <span>${quedan ? `quedan unos ${minutos(quedan)} min` : "está al caer"}</span>
      </span>
      <p class="lanzada-nota">Puedes cerrar la pestaña: la búsqueda corre fuera y el resultado se
        queda guardado aquí.</p>
      <div class="lanzada-acc">
        <button class="quitar" type="button" data-olvidar="${esc(p.label)}"
          aria-label="Dejar de esperar esta búsqueda"
          title="La búsqueda sigue corriendo fuera; esto solo deja de esperarla aquí">dejar de esperar</button>
      </div>
    </div>`;
}

function hora(ms) {
  const d = new Date(ms);
  return Number.isFinite(d.getTime())
    ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
    : "";
}

async function cargarDestinos() {
  if (DESTINOS) return DESTINOS;
  let lista = [];
  try {
    lista = await fetchJSON("data/airports_world.json");
  } catch {
    return (DESTINOS = []);
  }
  const porPais = {};
  lista.forEach((a) => {
    (porPais[a.pais || "Otros"] ||= []).push({ code: a.code, ciudad: a.ciudad });
  });
  DESTINOS = Object.entries(porPais)
    .map(([pais, aeropuertos]) => ({
      pais,
      aeropuertos: aeropuertos.sort((x, y) => x.ciudad.localeCompare(y.ciudad)),
    }))
    .sort((a, b) => a.pais.localeCompare(b.pais));
  return DESTINOS;
}

function pintarDestinos(filtro = "") {
  const q = filtro.trim().toLowerCase();
  const html = (DESTINOS || [])
    .map((p) => {
      const coincidePais = p.pais.toLowerCase().includes(q);
      const aeropuertos = coincidePais
        ? p.aeropuertos
        : p.aeropuertos.filter(
            (a) => a.ciudad.toLowerCase().includes(q) || a.code.toLowerCase() === q
          );
      if (!aeropuertos.length) return "";
      return `
        <div class="pais">
          <button type="button" class="pais-todo" data-valor="${esc(p.pais)}">
            <span>${esc(p.pais)}</span>
            <em>todo el país · ${p.aeropuertos.length} aeropuertos</em>
          </button>
          <div class="ciudades">
            ${aeropuertos
              .map(
                (a) =>
                  `<button type="button" class="ciudad" data-valor="${esc(a.ciudad)}">
                     ${esc(a.ciudad)} <i>${esc(a.code)}</i></button>`
              )
              .join("")}
          </div>
        </div>`;
    })
    .join("");
  $("#destList").innerHTML = html || '<p class="meta">Nada con ese nombre.</p>';
  $("#destList")
    .querySelectorAll("[data-valor]")
    .forEach((b) => b.addEventListener("click", () => elegirDestino(b.dataset.valor)));
}

function elegirDestino(valor) {
  if (destinoPara === "wDest") {
    $("#wDest").value = valor;
    $("#wDestBtn").textContent = valor;
  } else {
    $("#fDest").value = valor;
    $("#destBtn").textContent = valor;
  }
  cerrarDestinos();
}

/* `para` dice a que campo vuelve lo elegido. Antes era una variable suelta
   que tocaba cada llamador; ahora viaja con la llamada. */
export function abrirDestinos(para = "fDest") {
  destinoPara = para;
  $("#destModal").hidden = false;
  tfAbrirDialogo($("#destModal"), {
    foco: () => $("#destSearch"),
    alCerrar: () => ($("#destModal").hidden = true),
  });
  cargarDestinos().then(() => pintarDestinos($("#destSearch").value));
}

function cerrarDestinos() {
  tfCerrarDialogo($("#destModal"));
}

on("#destBtn", "click", () => abrirDestinos("fDest"));
on("#destClose", "click", cerrarDestinos);
on("#destModal", "click", (e) => {
  if (e.target.id === "destModal") cerrarDestinos();
});
on("#destSearch", "input", (e) => pintarDestinos(e.target.value));

