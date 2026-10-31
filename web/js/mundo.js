/* mundo.js — Elegir zona y países para filtrar el feed (era un mapamundi:
   ver `abrirMundo`).

   «Zona» era una lista de continentes y regiones: para decir «Italia y Grecia»
   había que saber en qué región caían. Ahora se tocan en el mapa. Los países
   con algún chollo hoy salen resaltados (y son los únicos que se recorren con
   el tabulador: 170 paradas de teclado no ayudan a nadie); los demás también
   se pueden elegir, por si mañana aparece algo. Debajo, los mismos países con
   chollo en botones, para quien no quiera apuntar en un mapa.

   Lo elegido se queda en este navegador. La geometría la genera una vez
   `tools/mapas.mjs` (Natural Earth): aquí solo se pintan los trazos. */
import { PAISES } from "./mapa-mundo.js";
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

/* EL SELECTOR DE ZONA: una lista, no un mapa. En el mapa no había forma de
   acertar a un país pequeño, y menos con el dedo; los chips redondeados
   apretados uno contra otro tampoco se leían. Ahora es como los ajustes del
   móvil: un buscador arriba y filas anchas, con su bandera, cuántos vuelos hay
   hoy y una marca a la derecha si está elegida.

   · Zonas (`zonas`: [{valor, nombre}]): una sola a la vez; `alZona(valor)`.
   · Países con chollo hoy, primero; el resto, plegados en «Todos los países».
   · `conChollo`: un Map de ISO → nº de vuelos (o un Set, sin cuenta).
   `alCambiar` se llama con cada toque, para que el feed se repinte debajo. */
const bandera = (iso) =>
  /^[A-Z]{2}$/.test(iso) ? String.fromCodePoint(...[...iso].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : "";
const pelar = (t) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export function abrirMundo(conChollo, alCambiar, { zonas = [], zona = "", alZona = null } = {}) {
  let zonaActual = zona;
  const cuenta = conChollo instanceof Map ? conChollo : new Map([...conChollo].map((iso) => [iso, 0]));
  const fila = (iso, n) => `<li><button type="button" class="mundo-fila" data-iso="${iso}" data-buscar="${esc(pelar(nombrePais(iso)))}"
      aria-pressed="false"><span class="mundo-bandera bandera" aria-hidden="true">${bandera(iso)}</span>
      <span class="mundo-nombre">${esc(nombrePais(iso))}</span>${
        n ? `<span class="mundo-n">${n} vuelo${n === 1 ? "" : "s"}</span>` : ""
      }<span class="mundo-marca" aria-hidden="true"></span></button></li>`;
  const conVuelo = [...cuenta.keys()].filter((iso) => NOMBRE[iso]).sort((a, b) => nombrePais(a).localeCompare(nombrePais(b), "es"));
  const resto = PAISES.map((p) => p.iso)
    .filter((iso) => !cuenta.has(iso) && NOMBRE[iso])
    .sort((a, b) => nombrePais(a).localeCompare(nombrePais(b), "es"));
  const caja = tfModal(`
    <header class="modal-head">
      <div>
        <p class="kicker-tag">filtrar el feed</p>
        <h2>¿Por dónde?</h2>
      </div>
      <button type="button" data-cerrar aria-label="Cerrar">cerrar</button>
    </header>
    <div class="mundo">
      <input type="search" class="mundo-buscar" placeholder="Busca un país o una zona" aria-label="Buscar un país o una zona"
        autocomplete="off" enterkeyhint="search">
      ${
        zonas.length
          ? `<section class="mundo-grupo mundo-zonas" role="group" aria-label="Zonas">
               <h3 class="mundo-rot">Zonas</h3>
               <ul class="mundo-lista">${zonas
                 .map(
                   (z) => `<li><button type="button" class="mundo-fila mundo-zona" data-zona="${esc(z.valor)}"
                     data-buscar="${esc(pelar(z.nombre))}" aria-pressed="false"><span class="mundo-nombre">${esc(z.nombre)}</span>
                     <span class="mundo-marca" aria-hidden="true"></span></button></li>`
                 )
                 .join("")}</ul>
             </section>`
          : ""
      }
      ${
        conVuelo.length
          ? `<section class="mundo-grupo" aria-label="Países con chollo hoy">
               <h3 class="mundo-rot">Con chollo hoy</h3>
               <ul class="mundo-lista">${conVuelo.map((iso) => fila(iso, cuenta.get(iso))).join("")}</ul>
             </section>`
          : ""
      }
      <details class="mundo-grupo mundo-todos">
        <summary class="mundo-rot">Todos los países <span>${resto.length}</span></summary>
        <ul class="mundo-lista">${resto.map((iso) => fila(iso, 0)).join("")}</ul>
      </details>
      <p class="mundo-nada" hidden>Nada con ese nombre.</p>
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
  caja.querySelectorAll("[data-iso]").forEach((el) =>
    el.addEventListener("click", () => {
      const iso = el.dataset.iso;
      if (ELEGIDOS.has(iso)) ELEGIDOS.delete(iso);
      else ELEGIDOS.add(iso);
      guardar(ELEGIDOS);
      pintar();
      alCambiar();
    })
  );
  // Buscar: filtra las filas de todos los grupos y abre «Todos los países».
  const todos = caja.querySelector(".mundo-todos");
  caja.querySelector(".mundo-buscar").addEventListener("input", (e) => {
    const q = pelar(e.target.value.trim());
    let alguna = false;
    caja.querySelectorAll(".mundo-lista li").forEach((li) => {
      const si = !q || li.firstElementChild.dataset.buscar.includes(q);
      li.hidden = !si;
      alguna = alguna || si;
    });
    caja.querySelectorAll(".mundo-grupo").forEach((g) => {
      g.hidden = !!q && !g.querySelector(".mundo-lista li:not([hidden])");
    });
    if (q) todos.open = true;
    caja.querySelector(".mundo-nada").hidden = alguna;
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
