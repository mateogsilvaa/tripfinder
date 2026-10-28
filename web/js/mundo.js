/* mundo.js — Elegir países en un mapamundi para filtrar el feed.

   «Zona» era una lista de continentes y regiones: para decir «Italia y Grecia»
   había que saber en qué región caían. Ahora se tocan en el mapa. Los países
   con algún chollo hoy salen resaltados (y son los únicos que se recorren con
   el tabulador: 170 paradas de teclado no ayudan a nadie); los demás también
   se pueden elegir, por si mañana aparece algo. Debajo, los mismos países con
   chollo en botones, para quien no quiera apuntar en un mapa.

   Lo elegido se queda en este navegador. La geometría la genera una vez
   `tools/mapas.mjs` (Natural Earth): aquí solo se pintan los trazos. */
import { ALTO, ANCHO, PAISES } from "./mapa-mundo.js";
import { esc } from "./base.js";

const CLAVE = "tf_paises";
const NOMBRE = Object.fromEntries(PAISES.map((p) => [p.iso, p.nombre]));

function leer() {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE) || "[]");
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function guardar(set) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify([...set]));
  } catch {
    /* navegación privada: dura lo que la pestaña */
  }
}

let ELEGIDOS = leer();
export const paisesElegidos = () => ELEGIDOS;
export const nombrePais = (iso) => NOMBRE[iso] || iso;

/* El rótulo del botón: «Todos», «Italia», «Italia +2» o la zona elegida
   («Los Balcanes · Italia»). */
export function rotuloPaises(zona = "") {
  const l = [...ELEGIDOS];
  const paises = !l.length ? "" : l.length === 1 ? nombrePais(l[0]) : `${nombrePais(l[0])} +${l.length - 1}`;
  return [zona, paises].filter(Boolean).join(" · ") || "Todos";
}

/* Abre el mapa. `conChollo` es el conjunto de ISO con algún vuelo hoy;
   `alCambiar` se llama con cada toque, para que el feed se repinte debajo.

   LAS ZONAS VAN AQUÍ TAMBIÉN. «Zona» era un desplegable aparte con los
   continentes y las regiones, y con el mapa al lado eran dos sitios para decir
   lo mismo. Ahora el mapa es el único sitio: arriba, las zonas que hoy tienen
   vuelo (`zonas`: [{valor, nombre}], una sola a la vez, y `alZona(valor)` al
   tocarla); debajo, los países. Se pueden juntar: «Europa» y, dentro, Italia. */
export function abrirMundo(conChollo, alCambiar, { zonas = [], zona = "", alZona = null } = {}) {
  let zonaActual = zona;
  const caja = tfModal(`
    <header class="modal-head">
      <div>
        <p class="kicker-tag">filtrar el feed</p>
        <h2>¿Por dónde?</h2>
      </div>
      <button type="button" data-cerrar aria-label="Cerrar">cerrar</button>
    </header>
    <div class="mundo">
      ${
        zonas.length
          ? `<div class="mundo-zonas" role="group" aria-label="Zonas">
               <span class="mundo-zonas-rot">Zonas</span>
               ${zonas
                 .map(
                   (z) => `<button type="button" class="mundo-chip mundo-zona" data-zona="${esc(z.valor)}"
                     aria-pressed="false">${esc(z.nombre)}</button>`
                 )
                 .join("")}
             </div>`
          : ""
      }
      <svg class="mundo-svg" viewBox="0 0 ${ANCHO} ${ALTO}" role="group" aria-label="Mapamundi: toca un país para elegirlo">
        ${PAISES.map(
          (p) => `<path class="mp${conChollo.has(p.iso) ? " con" : ""}" data-iso="${p.iso}" d="${p.d}"
            ${conChollo.has(p.iso) ? 'tabindex="0" role="button"' : ""} aria-label="${esc(p.nombre)}"><title>${esc(p.nombre)}</title></path>`
        ).join("")}
      </svg>
      <p class="mundo-leyenda"><span class="mundo-muestra con"></span> con chollo hoy
        <span class="mundo-muestra sel"></span> elegido</p>
      <div class="mundo-chips" aria-label="Países con chollo hoy">${[...conChollo]
        .filter((iso) => NOMBRE[iso])
        .sort((a, b) => nombrePais(a).localeCompare(nombrePais(b), "es"))
        .map((iso) => `<button type="button" class="chip mundo-chip" data-iso="${iso}">${esc(nombrePais(iso))}</button>`)
        .join("")}</div>
      <div class="mundo-pie">
        <span class="mundo-cuenta" role="status"></span>
        <button type="button" class="btn ghost small" data-mundo-limpiar>Quitar el filtro</button>
        <button type="button" class="btn primary small" data-cerrar>Ver chollos</button>
      </div>
    </div>`);

  const pintar = () => {
    caja.querySelectorAll("[data-iso]").forEach((el) => {
      const si = ELEGIDOS.has(el.dataset.iso);
      el.classList.toggle("sel", si);
      el.setAttribute("aria-pressed", String(si));
    });
    caja.querySelectorAll("[data-zona]").forEach((el) => {
      const si = el.dataset.zona === zonaActual;
      el.classList.toggle("sel", si);
      el.setAttribute("aria-pressed", String(si));
    });
    const n = ELEGIDOS.size;
    const nombreZona = (zonas.find((z) => z.valor === zonaActual) || {}).nombre || "";
    const paises = n ? `${n} ${n === 1 ? "país" : "países"}: ${[...ELEGIDOS].map(nombrePais).join(", ")}` : "";
    caja.querySelector(".mundo-cuenta").textContent =
      [nombreZona, paises].filter(Boolean).join(" · ") || "Todos los países";
  };
  caja.querySelectorAll("[data-zona]").forEach((el) =>
    el.addEventListener("click", () => {
      zonaActual = zonaActual === el.dataset.zona ? "" : el.dataset.zona;
      pintar();
      if (alZona) alZona(zonaActual);
    })
  );
  const tocar = (iso) => {
    if (ELEGIDOS.has(iso)) ELEGIDOS.delete(iso);
    else ELEGIDOS.add(iso);
    guardar(ELEGIDOS);
    pintar();
    alCambiar();
  };
  caja.querySelectorAll("[data-iso]").forEach((el) => {
    el.addEventListener("click", () => tocar(el.dataset.iso));
    el.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      tocar(el.dataset.iso);
    });
  });
  caja.querySelector("[data-mundo-limpiar]").addEventListener("click", () => {
    ELEGIDOS = new Set();
    guardar(ELEGIDOS);
    if (zonaActual && alZona) {
      zonaActual = "";
      alZona("");
    }
    pintar();
    alCambiar();
  });
  caja.querySelector(".mundo-pie [data-cerrar]").addEventListener("click", tfCerrarModal);
  pintar();
}
