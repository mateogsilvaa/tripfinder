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

export function pendienteHTML(p, caducada) {
  return caducada
    ? `<div class="saved"><b>${esc(p.label)}</b>
         <span class="meta">no llegó a terminar · vuelve a lanzarla</span>
         <button class="quitar" type="button" data-olvidar="${esc(p.label)}"
           aria-label="Olvidar esta búsqueda">olvidar</button></div>`
    : `<div class="saved"><b>${esc(p.label)}</b>
         <span class="meta"><span class="spin"></span>buscando… tarda 2–3 min</span></div>`;
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

