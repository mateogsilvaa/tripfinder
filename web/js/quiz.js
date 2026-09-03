/* quiz.js — El test de destinos: seis preguntas y tres sitios concretos
   (#7, #9, #10, #11, #12).

   Existe porque la web pregunta "¿a dónde quieres ir?" y la mitad de las veces
   la respuesta honesta es "no lo sé". Buscar y seguir exigen destino, tope,
   noches, meses y personas antes de devolver nada; quien no trae un destino en
   la cabeza se queda mirando el tablón. Esta es la puerta que faltaba.

   Nada de esto pide nada a nadie: las preguntas se contestan aquí, el motor
   puntúa aquí y las tarjetas se pintan aquí, con el `offers.json` que la página
   ya tenía cargado. Lo único que sale a la red es "avísame de esto", que es el
   mismo `repository_dispatch` que el formulario de seguir. */

import { $, esc, fetchJSON, fmtDate, on } from "./base.js";
import { OFFERS } from "./ofertas.js";
import { historiaHTML } from "./historia.js";
import { precioHTML, edreamsURL } from "./precios.js";
import { cajaAcceso, comoDueno, dispatch, esFaltaDeAcceso } from "./disparador.js";
import { paraGrupo, ponerPerfiles, porque, recomendar } from "./motor.js";

/* ------------------------------------------------------------- las preguntas
   Seis, más una séptima que solo aparece si la primera deja la puerta abierta.
   Cuatro opciones como mucho por pregunta: con cinco ya hay que leer, y leer
   cinco veces seguidas es lo que hace que la gente abandone un test. */
const PREGUNTAS = [
  {
    id: "apetece",
    titulo: "¿Qué te apetece?",
    pie: "De esto depende casi todo lo demás.",
    opciones: [
      { v: "playa", t: "Playa", d: "sol, agua y poco plan" },
      { v: "ciudad", t: "Ciudad", d: "callejear, museos, cafés" },
      { v: "gastronomia", t: "Comer bien", d: "ir por el estómago" },
      { v: "naturaleza", t: "Naturaleza", d: "montaña, verde, silencio" },
    ],
  },
  {
    id: "noches",
    titulo: "¿Cuánto tiempo?",
    pie: "Escapada, no vacaciones: esto es lo que hay barato.",
    opciones: [
      { v: [2, 2], t: "Dos noches", d: "el finde justo" },
      { v: [3, 3], t: "Tres noches", d: "un puente" },
      { v: [4, 5], t: "Cuatro o cinco", d: "una semana corta" },
      { v: [2, 5], t: "Me da igual", d: "lo que salga mejor" },
    ],
  },
  {
    id: "tope",
    titulo: "¿Cuánto quieres gastarte?",
    pie: "Solo el vuelo, ida y vuelta, por persona.",
    opciones: [
      { v: 60, t: "Menos de 60 €", d: "chollo o nada" },
      { v: 100, t: "Hasta 100 €", d: "lo normal de un finde" },
      { v: 150, t: "Hasta 150 €", d: "con margen" },
      { v: 300, t: "Me da igual", d: "que sea bueno" },
    ],
  },
  {
    id: "personas",
    titulo: "¿Cuántos vais?",
    pie: "El precio del vuelo es por cabeza; el de la cama, del grupo.",
    opciones: [
      { v: 1, t: "Yo solo", d: "" },
      { v: 2, t: "Dos", d: "" },
      { v: 3, t: "Tres", d: "" },
      { v: 4, t: "Cuatro o más", d: "" },
    ],
  },
  {
    id: "madrugar",
    titulo: "¿Te importa llegar de noche?",
    pie: "Un vuelo a las seis de la mañana es más barato y te cuesta un día.",
    opciones: [
      { v: false, t: "Sí me importa", d: "nada antes de las 7 ni después de las 23" },
      { v: true, t: "Me da igual", d: "por ahorrar, madrugo" },
    ],
  },
  {
    id: "meses",
    titulo: "¿Cuándo?",
    pie: "Los chollos de verdad están a cuatro y ocho meses vista.",
    opciones: [
      { v: 2, t: "Pronto", d: "en los dos próximos meses" },
      { v: 6, t: "Este medio año", d: "sin prisa" },
      { v: 10, t: "Cuando sea", d: "lo que esté bien de precio" },
    ],
  },
  {
    id: "lejos",
    // Solo se pregunta si no ha dicho playa: nadie cruza el charco dos noches.
    solo: (r) => r.apetece !== "playa" && r.noches && r.noches[1] >= 4,
    titulo: "¿Cerca o lejos?",
    pie: "Lejos es otro continente, y son más noches y más dinero.",
    opciones: [
      { v: false, t: "Cerca", d: "Europa y el norte de África" },
      { v: null, t: "Me da igual", d: "" },
      { v: true, t: "Lejos", d: "otro continente" },
    ],
  },
];

/* La prioridad no se pregunta: se deduce del tope. Quien pone 60 € quiere que
   sea barato; quien dice "me da igual" quiere que cunda. Una pregunta menos es
   una pregunta menos, y esta se contestaba sola. */
const prioridadDe = (tope) => (tope <= 60 ? "barato" : tope >= 300 ? "cunda" : "equilibrio");

/* ------------------------------------------------------------------ la memoria
   Mismo espacio de nombres por cuenta que los favoritos: lo que hiciste sin
   sesión se adopta al entrar, igual que ellos (#11). */
const MEMORIA = tfClave("tf_quiz");

function recordar(respuestas) {
  try {
    localStorage.setItem(MEMORIA, JSON.stringify({ respuestas, cuando: Date.now() }));
  } catch {
    /* navegación privada: el test funciona igual, solo que no recuerda */
  }
}

export function loRecordado() {
  try {
    const d = JSON.parse(localStorage.getItem(MEMORIA) || "null");
    return d && d.respuestas ? d : null;
  } catch {
    return null;
  }
}

function olvidar() {
  try {
    localStorage.removeItem(MEMORIA);
  } catch {
    /* nada que hacer */
  }
}

/* ------------------------------------------------------------------- el estado */
let RESPUESTAS = {};
let PASO = 0;
let PERFILES_LISTOS = null;

const visibles = () => PREGUNTAS.filter((p) => !p.solo || p.solo(RESPUESTAS));

async function cargarPerfiles() {
  if (PERFILES_LISTOS) return PERFILES_LISTOS;
  PERFILES_LISTOS = fetchJSON("perfiles.json")
    .then(ponerPerfiles)
    .catch(() => ponerPerfiles({})); // sin tabla, todo vale como ciudad
  return PERFILES_LISTOS;
}

/* ---------------------------------------------------------------- la pantalla */
function cajaHTML(cuerpo, progreso = "") {
  return `
    <header class="modal-head quiz-head">
      <h2 id="tfQuizTitulo">Descubrir</h2>
      <button type="button" data-cerrar aria-label="Cerrar">cerrar</button>
    </header>
    ${progreso}
    <div id="tfQuizCuerpo" class="quiz-cuerpo">${cuerpo}</div>`;
}

function progresoHTML(i, total) {
  // El mismo troquel de la cabecera: una casilla por pregunta, rellenas las
  // contestadas. Es el único sitio donde el flap significa algo además de
  // decorar.
  const casillas = Array.from(
    { length: total },
    (_, n) => `<span class="quiz-paso${n < i ? " hecho" : n === i ? " ahora" : ""}"></span>`
  ).join("");
  return `<div class="quiz-progreso" aria-hidden="true">${casillas}</div>`;
}

function preguntaHTML(p, i, total) {
  const opciones = p.opciones
    .map(
      (o, n) => `
      <button type="button" class="quiz-opcion" data-opcion="${n}">
        <span class="quiz-tecla" aria-hidden="true">${n + 1}</span>
        <span class="quiz-texto">
          <b>${esc(o.t)}</b>
          ${o.d ? `<small>${esc(o.d)}</small>` : ""}
        </span>
      </button>`
    )
    .join("");
  return `
    <p class="quiz-cuenta">${i + 1} de ${total}</p>
    <h3 class="quiz-pregunta">${esc(p.titulo)}</h3>
    ${p.pie ? `<p class="quiz-pie">${esc(p.pie)}</p>` : ""}
    <div class="quiz-opciones">${opciones}</div>
    ${i > 0 ? '<button type="button" class="quiz-atras" data-atras>← volver</button>' : ""}`;
}

function pintarPregunta() {
  const lista = visibles();
  const p = lista[PASO];
  const caja = $("#tfQuizCuerpo");
  if (!caja) return;
  caja.innerHTML = preguntaHTML(p, PASO, lista.length);
  const progreso = document.querySelector(".quiz-progreso");
  if (progreso) progreso.outerHTML = progresoHTML(PASO, lista.length);

  // Cada cambio de pregunta se anuncia: quien va con lector de pantalla tiene
  // que enterarse de que la pantalla ha cambiado bajo sus pies (#12).
  if (typeof tfAnunciar === "function") {
    tfOlvidarAnuncio();
    tfAnunciar(`Pregunta ${PASO + 1} de ${lista.length}. ${p.titulo}`);
  }

  caja.querySelectorAll("[data-opcion]").forEach((b) =>
    b.addEventListener("click", () => responder(p, Number(b.dataset.opcion)))
  );
  const atras = caja.querySelector("[data-atras]");
  if (atras) atras.addEventListener("click", volver);
  // El foco a la primera opción: sin esto, quien va con teclado tiene que
  // tabular desde la cabecera en cada pregunta.
  const primera = caja.querySelector(".quiz-opcion");
  if (primera) primera.focus();
}

function responder(p, n) {
  const elegida = p.opciones[n];
  if (!elegida) return;
  RESPUESTAS[p.id] = elegida.v;
  // El finde sale de las noches: dos o tres noches es un finde, cuatro o cinco
  // ya no. Preguntarlo aparte sería una pregunta de relleno.
  if (p.id === "noches") RESPUESTAS.finde = elegida.v[1] <= 3;
  if (p.id === "tope") RESPUESTAS.prioridad = prioridadDe(elegida.v);
  avanzar();
}

function avanzar() {
  // Se avanza solo al elegir: un botón "siguiente" en un test de seis
  // preguntas son seis pulsaciones de más para no decir nada.
  if (PASO + 1 < visibles().length) {
    PASO += 1;
    pintarPregunta();
    return;
  }
  recordar(RESPUESTAS);
  pintarResultados();
}

function volver() {
  if (PASO === 0) return;
  PASO -= 1;
  pintarPregunta();
}

/* ---------------------------------------------------------------- los billetes */
function tarjetaHTML(o, r, tope, i) {
  const ida = fmtDate(o.depart_date, true);
  const vuelta = o.return_date ? fmtDate(o.return_date, true) : "";
  const horas = Number(o.useful_hours);
  const cuando = [
    ida && o.depart_time ? `${ida} ${o.depart_time}` : ida,
    vuelta && o.return_time ? `${vuelta} ${o.return_time}` : vuelta,
  ]
    .filter(Boolean)
    .join(" → ");
  return `
    <article class="quiz-billete" data-destino="${esc(o.id)}" data-i="${i}">
      <div class="quiz-billete-top">
        <span class="iata">${esc(o.destination)}</span>
        <span class="dest-cell">
          <span class="city">${esc(o.destination_name || o.destination)}</span>
          <span class="country">${esc(o.destination_country || "")}</span>
        </span>
        <span class="quiz-precio">${precioHTML(o)}</span>
      </div>
      <p class="quiz-cuando">${esc(cuando)}${
        Number.isFinite(horas) && horas > 0 ? ` · ${horas.toFixed(1)} h allí` : ""
      }</p>
      ${historiaHTML(o)}
      <p class="quiz-porque">${esc(porque(o, r, tope))}</p>
      <div class="quiz-acciones">
        <a class="btn ghost small" href="${esc(o.deep_link || edreamsURL(o))}"
           target="_blank" rel="noopener">Ver el vuelo</a>
        <button type="button" class="btn small" data-avisar="${i}">Avísame de esto</button>
      </div>
      <p class="quiz-estado" data-estado="${i}" role="status"></p>
    </article>`;
}

let ULTIMOS = [];

async function pintarResultados() {
  const caja = $("#tfQuizCuerpo");
  if (!caja) return;
  caja.innerHTML = '<p class="meta">Mirando lo que hay…</p>';
  await cargarPerfiles();

  const r = { ...RESPUESTAS };
  // Las ofertas del scan son de una persona: se pasan al grupo antes de
  // comparar con el tope, o "menos de 100 €" para cuatro compararía cosas
  // distintas.
  const catalogo = paraGrupo(OFFERS, r.personas);
  const salida = recomendar(catalogo, r, 3);
  ULTIMOS = salida.destinos;

  const progreso = document.querySelector(".quiz-progreso");
  if (progreso) progreso.remove();

  if (!salida.destinos.length) {
    caja.innerHTML = `
      <h3 class="quiz-pregunta">Nada, de momento</h3>
      <p class="quiz-pie">${esc(salida.aviso)}</p>
      <button type="button" class="btn ghost small" data-otra>Volver a hacerlo</button>`;
    caja.querySelector("[data-otra]").addEventListener("click", reiniciar);
    if (typeof tfAnunciar === "function") tfAnunciar(salida.aviso);
    return;
  }

  caja.innerHTML = `
    <h3 class="quiz-pregunta">Tres sitios para ti</h3>
    ${salida.aviso ? `<p class="quiz-aviso">${esc(salida.aviso)}</p>` : ""}
    <div class="quiz-billetes">
      ${salida.destinos.map((o, i) => tarjetaHTML(o, r, salida.tope, i)).join("")}
    </div>
    <button type="button" class="btn ghost small" data-otra>Volver a hacerlo</button>`;

  caja.querySelector("[data-otra]").addEventListener("click", reiniciar);
  caja.querySelectorAll("[data-avisar]").forEach((b) =>
    b.addEventListener("click", () => avisarme(Number(b.dataset.avisar), b))
  );
  if (typeof tfAnunciar === "function") {
    tfAnunciar(`Tres destinos para ti: ${salida.destinos.map((o) => o.destination_name || o.destination).join(", ")}.`);
  }
  marcarFlap();
}

function reiniciar() {
  RESPUESTAS = {};
  PASO = 0;
  ULTIMOS = [];
  olvidar();
  marcarFlap();
  const caja = document.getElementById("tfModal");
  if (caja) {
    caja.querySelector(".modal-caja").innerHTML = cajaHTML("", progresoHTML(0, visibles().length));
    caja.querySelector("[data-cerrar]").addEventListener("click", tfCerrarModal);
    pintarPregunta();
  }
}

/* --------------------------------------------------------------- avísame (#10)
   El remate: sin esto son tres billetes bonitos que no hacen nada. Y es barato,
   porque el ciclo seguimiento → cron → correo ya existe y funciona: esto manda
   el mismo `repository_dispatch` que el formulario de seguir. */
async function avisarme(i, boton) {
  const o = ULTIMOS[i];
  const estado = document.querySelector(`[data-estado="${i}"]`);
  if (!o || !estado) return;

  const r = RESPUESTAS;
  const ciudad = o.destination_name || o.destination;
  const etiqueta = [
    `Test · ${ciudad}`,
    `hasta ${Math.round(Number(r.tope) || 0)} €`,
    `${r.personas || 1} pers.`,
  ].join(" · ");

  boton.disabled = true;
  estado.textContent = "Apuntando…";
  const res = await dispatch("watch", {
    ...comoDueno(),
    dest: o.destination,
    label: etiqueta,
    max_price: String(Math.round(Number(r.tope) || 0)),
    months: String(r.meses || 6),
    adults: String(r.personas || 1),
    weekend: r.finde ? "si" : "no",
    // De dónde viene (#13): es justo la pregunta que el campo existe para
    // contestar, si el test trae gente o si todos acaban en el formulario.
    source: "test",
  });

  if (res.ok) {
    estado.innerHTML =
      'apuntado · se revisa cada día · <a href="seguimientos.html">verlo en observación</a>';
    if (typeof tfAnunciar === "function") tfAnunciar(`${ciudad} apuntado. Se revisa cada día.`);
    return;
  }
  boton.disabled = false;
  if (esFaltaDeAcceso(res)) {
    // Sin sesión no se puede apuntar, pero el test NO se pierde: las respuestas
    // están guardadas y al volver de entrar los resultados se recalculan. Sin
    // eso habría que rehacerlo, y nadie rehace un test.
    const acceso = cajaAcceso(res);
    estado.innerHTML = acceso.html;
    acceso.wire();
    return;
  }
  estado.textContent = `No se pudo apuntar: ${res.error || "vuelve a intentarlo"}`;
}

/* ------------------------------------------------------------------ la puerta */
export function marcarFlap() {
  const flap = document.getElementById("tfDescubrir");
  if (!flap) return;
  const hay = !!loRecordado();
  flap.classList.toggle("con-memoria", hay);
  flap.setAttribute(
    "aria-label",
    hay ? "Ver tus destinos, o volver a hacer el test" : "Descubrir tu destino ideal"
  );
}

export async function abrirQuiz() {
  const guardado = loRecordado();
  RESPUESTAS = guardado ? { ...guardado.respuestas } : {};
  PASO = 0;
  ULTIMOS = [];

  const total = visibles().length;
  const caja = tfModal(cajaHTML("", progresoHTML(0, total)));
  caja.querySelector(".modal-caja").classList.add("quiz-caja");
  caja.querySelector(".modal-caja").setAttribute("aria-labelledby", "tfQuizTitulo");

  // Con respuestas guardadas se salta directo a los resultados, pero se
  // RECALCULAN contra el offers.json de hoy: las respuestas son de hace dos
  // semanas y las propuestas son de esta mañana (#11).
  if (guardado) {
    await pintarResultados();
  } else {
    pintarPregunta();
  }
  atajos(caja);
}

/* Teclado: los números eligen, la flecha izquierda vuelve. El Escape y la
   trampa de foco los pone `tfAbrirDialogo`, igual que en los otros diálogos. */
function atajos(caja) {
  caja.addEventListener("keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "ArrowLeft") {
      volver();
      return;
    }
    const n = Number(e.key);
    if (!Number.isInteger(n) || n < 1 || n > 4) return;
    const boton = caja.querySelector(`[data-opcion="${n - 1}"]`);
    if (boton) {
      e.preventDefault();
      boton.click();
    }
  });
}

on("#tfDescubrir", "click", abrirQuiz);
