/* destinos.js — La lamina de destinos: cargar el listado, filtrar y elegir. */

import { $, esc, fetchJSON, fmtEUR, on } from "./base.js";
import { banderaDe } from "./paises.js";

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

/* Las regiones van ARRIBA del todo y no mezcladas entre los paises: son lo mas
   ancho que se puede elegir sin irse a un continente entero, y quien abre esto
   sin un sitio en la cabeza es justo a quien le sirven. Se leen del mismo
   fichero que el filtro del tablon, que lo escribe el backend desde su unica
   definicion: si se escribieran aqui a mano, el dia que se añada una region la
   web ofreceria una que la busqueda no entiende. */
let REGIONES_LISTA = null;

async function cargarRegiones() {
  if (REGIONES_LISTA) return REGIONES_LISTA;
  try {
    const mapa = await fetchJSON("data/regiones.json");
    REGIONES_LISTA = Object.entries(mapa)
      .map(([clave, { n, c }]) => ({ clave, nombre: n, cuantos: Math.floor(c.length / 3) }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  } catch {
    REGIONES_LISTA = [];
  }
  return REGIONES_LISTA;
}

function regionesHTML(q) {
  const lista = (REGIONES_LISTA || []).filter(
    (r) => !q || r.nombre.toLowerCase().includes(q) || r.clave.includes(q)
  );
  if (!lista.length) return "";
  return `
    <div class="pais regiones">
      <p class="regiones-rotulo">Regiones</p>
      <div class="ciudades">
        ${lista
          .map(
            (r) =>
              `<button type="button" class="ciudad region" data-valor="${esc(r.nombre)}">
                 ${esc(r.nombre)} <i>${r.cuantos}</i></button>`
          )
          .join("")}
      </div>
    </div>`;
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
            <span>${
              banderaDe(p.pais)
                ? `<i class="bandera" aria-hidden="true">${banderaDe(p.pais)}</i>`
                : ""
            }${esc(p.pais)}</span>
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
  const todo = regionesHTML(q) + html;
  $("#destList").innerHTML = todo || '<p class="meta">Nada con ese nombre.</p>';
  $("#destList")
    .querySelectorAll("[data-valor]")
    .forEach((b) => b.addEventListener("click", () => elegirDestino(b.dataset.valor)));
}

function elegirDestino(valor) {
  const campo = destinoPara === "wDest" ? $("#wDest") : $("#fDest");
  if (!campo) return;
  campo.value = valor;
  // El rotulo lo pone el oyente de abajo, no esta funcion: asi hay UN solo
  // camino entre "el campo vale X" y "el boton dice X".
  campo.dispatchEvent(new Event("change", { bubbles: true }));
  cerrarDestinos();
}

/* EL ROTULO SIGUE AL CAMPO, VENGA DE DONDE VENGA LO ELEGIDO.

   El destino no siempre se elige en el dialogo: tambien llega en la URL, que
   es como viaja de la portada a la herramienta entera (`ampliar.js`) y como lo
   ponen los enlaces que traen un viaje ya pensado. Ese camino rellena el campo
   escondido y dispara `change`, pero nadie tocaba el boton — asi que la pagina
   se abria diciendo "Elegir destino" encima de un formulario que iba a buscar
   Budapest. Parecia vacio y no lo estaba.

   Con el rotulo colgado del `change` los dos caminos acaban igual. */
const ROTULO_VACIO = "Elegir destino";

function rotular(campo, boton) {
  const el = $(campo);
  const btn = $(boton);
  if (el && btn) btn.textContent = el.value || ROTULO_VACIO;
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
  Promise.all([cargarRegiones(), cargarDestinos()]).then(() =>
    pintarDestinos($("#destSearch").value)
  );
}

function cerrarDestinos() {
  tfCerrarDialogo($("#destModal"));
}

on("#fDest", "change", () => rotular("#fDest", "#destBtn"));
on("#wDest", "change", () => rotular("#wDest", "#wDestBtn"));

on("#destBtn", "click", () => abrirDestinos("fDest"));
on("#destClose", "click", cerrarDestinos);
on("#destModal", "click", (e) => {
  if (e.target.id === "destModal") cerrarDestinos();
});
on("#destSearch", "input", (e) => pintarDestinos(e.target.value));


/* --------------------------------------------- la búsqueda que acaba de salir

   El estado 3 del diseño, y el que faltaba. Hasta ahora, cuando un barrido
   terminaba, su tarjeta de "preguntando destino a destino…" desaparecía y la
   búsqueda se colaba en la lista de guardadas como una más, entre las de hace
   tres días. Ocho minutos esperando para que el final sea que algo deja de
   parpadear.

   Lo que hace falta saber justo ahí es si ha MERECIDO LA PENA: cuántos viajes
   salieron, por cuánto el más barato y cuántos caben en el tope que pusiste
   —que es la pregunta de verdad: "hasta 120 €" y siete resultados no dice si
   hay tres a 110 o siete a 400—. */
const TERM_KEY = tfClave("tf_terminadas");
export const VIDA_TERMINADA_MS = 60 * 60 * 1000;

export const terminadas = () => {
  try {
    const lista = JSON.parse(localStorage.getItem(TERM_KEY) || "[]");
    const ahora = Date.now();
    return lista.filter((t) => ahora - t.cuando < VIDA_TERMINADA_MS);
  } catch {
    return [];
  }
};

export const guardarTerminadas = (lista) => {
  try {
    localStorage.setItem(TERM_KEY, JSON.stringify(lista));
  } catch {
    /* navegacion privada: dura lo que la pestaña */
  }
};

export function anotarTerminada(label, slug) {
  const lista = terminadas().filter((t) => t.slug !== slug);
  lista.unshift({ label, slug, cuando: Date.now() });
  guardarTerminadas(lista);
}

export function olvidarTerminada(slug) {
  guardarTerminadas(terminadas().filter((t) => t.slug !== slug));
}

/* La ficha sale con el titular ya puesto y las filas de dentro llegan después:
   el resumen lo da el índice, que ya está en memoria, y los tres vuelos hay que
   ir a buscarlos al fichero de la búsqueda. Enseñar el titular al momento y
   rellenar debajo es mejor que tener la ficha entera esperando a un fetch. */
export function terminadaHTML(t, resumen) {
  const desde = resumen && resumen.best_price
    ? `<span class="term-desde">desde ${fmtEUR(resumen.best_price)}</span>`
    : "";
  const n = (resumen && resumen.count) || 0;
  return `
    <div class="saved terminada" data-terminada="${esc(t.slug)}">
      <div class="term-head">
        <b>${esc(t.label)}</b>
        ${desde}
      </div>
      <span class="term-meta">${n} viaje${n === 1 ? "" : "s"} · terminada ${esc(
        haceCuanto(t.cuando)
      )}<span data-term-tope></span></span>
      <div class="term-filas" data-term-filas></div>
      <div class="term-acc">
        <button class="btn primary" type="button" data-term-abrir="${esc(t.slug)}">Abrir la búsqueda</button>
        <a class="btn ghost small" href="seguimientos.html#watchBox">Seguir estas fechas a diario</a>
      </div>
    </div>`;
}

function haceCuanto(ms) {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return "ahora mismo";
  if (min < 60) return `hace ${min} minuto${min === 1 ? "" : "s"}`;
  const h = Math.round(min / 60);
  return `hace ${h} hora${h === 1 ? "" : "s"}`;
}
