/* quiz.js — El test de destinos: diez preguntas y tres sitios concretos
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
   Diez, más una que solo aparece si las anteriores dejan la puerta abierta, y
   repartidas en tres capítulos: qué viaje quieres, cuánto te lo quieres
   gastar y qué vuelo aguantas. El capítulo se ve en la barra de arriba, que
   es lo que hace que diez preguntas se lean como tres tramos cortos y no como
   una cuesta.

   La regla al añadir una: **si la respuesta no cambia lo que sale, no se
   pregunta**. Cada una de estas mueve un filtro duro, un peso o la afinidad;
   `prioridad` se preguntaba antes sola (se deducía del tope) y `finde` se
   adivinaba a partir de las noches, que es otra forma de no preguntar.

   Cinco opciones como mucho por pregunta, y las de una línea sin descripción:
   leer cinco frases seguidas es lo que hace que la gente abandone un test. */

const CAPITULOS = [
  { id: "viaje", t: "El viaje" },
  { id: "dinero", t: "El dinero" },
  { id: "vuelo", t: "El vuelo" },
];

/* Las cinco etiquetas de `perfiles.json`, con su nombre de cara. `noche` no se
   podía elegir por ningún sitio: 31 destinos la llevan y el test no la
   preguntaba, así que esa mitad de la tabla no servía para nada. */
const SABORES = [
  { v: "playa", t: "Playa", d: "sol, agua y poco plan" },
  { v: "ciudad", t: "Ciudad", d: "callejear, museos, cafés" },
  { v: "gastronomia", t: "Comer bien", d: "ir por el estómago" },
  { v: "naturaleza", t: "Naturaleza", d: "montaña, verde, silencio" },
  { v: "noche", t: "Salir de noche", d: "que la ciudad no cierre" },
];

const PREGUNTAS = [
  {
    id: "apetece",
    cap: "viaje",
    titulo: "¿Qué te apetece?",
    pie: "De esto depende casi todo lo demás.",
    opciones: SABORES,
  },
  {
    id: "ademas",
    cap: "viaje",
    titulo: "¿Y algo más?",
    pie: "Un sitio que tenga las dos cosas gana; ninguno se descarta por esto.",
    // Lo ya elegido no se repite: ofrecerlo sería una opción que no hace nada.
    opciones: (r) => [
      ...SABORES.filter((o) => o.v !== r.apetece),
      { v: null, t: "Con eso vale", d: "" },
    ],
  },
  {
    id: "noches",
    cap: "viaje",
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
    id: "finde",
    cap: "viaje",
    titulo: "¿Tiene que caer en finde?",
    // Antes esto se deducía de las noches —dos o tres noches se daba por
    // finde—, y eso es adivinar: hay quien libra entre semana y quien no
    // puede faltar un viernes. Se pregunta.
    pie: "Salir viernes o sábado y volver domingo. Entre semana suele ser más barato.",
    opciones: [
      { v: true, t: "Sí, en finde", d: "no puedo faltar al trabajo" },
      { v: false, t: "Me da igual", d: "puedo salir cualquier día" },
    ],
  },
  {
    id: "tope",
    cap: "dinero",
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
    cap: "dinero",
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
    id: "prioridad",
    cap: "dinero",
    // Esto se deducía del tope: quien ponía 60 € quería barato y punto. Pero
    // se puede tener poco presupuesto y aun así querer que cunda, y son dos
    // ordenaciones distintas de la misma lista.
    titulo: "Puestos a elegir, ¿qué prefieres?",
    pie: "Cambia el orden de lo que sale, no lo que entra.",
    opciones: [
      { v: "barato", t: "Que sea barato", d: "aunque el vuelo sea peor" },
      { v: "cunda", t: "Que cunda", d: "llegar pronto, volver tarde" },
      { v: "equilibrio", t: "Un término medio", d: "" },
    ],
  },
  {
    id: "directo",
    cap: "vuelo",
    titulo: "¿Directo?",
    pie: "Con escala sale más barato y te come media mañana.",
    opciones: [
      { v: true, t: "Directo", d: "sin escalas" },
      { v: false, t: "Me da igual", d: "si ahorro, hago escala" },
    ],
  },
  {
    id: "madrugar",
    cap: "vuelo",
    titulo: "¿Te importa llegar de noche?",
    pie: "Un vuelo a las seis de la mañana es más barato y te cuesta un día.",
    opciones: [
      { v: false, t: "Sí me importa", d: "nada antes de las 7 ni después de las 23" },
      { v: true, t: "Me da igual", d: "por ahorrar, madrugo" },
    ],
  },
  {
    id: "meses",
    cap: "vuelo",
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
    cap: "vuelo",
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

/* Las opciones de una pregunta pueden depender de lo contestado antes (la de
   "¿y algo más?" quita lo que ya se eligió). */
const opcionesDe = (p, r = RESPUESTAS) =>
  typeof p.opciones === "function" ? p.opciones(r) : p.opciones;

/* Antes la prioridad se deducía del tope y no se preguntaba. Ahora se
   pregunta, pero esto se queda: un test contestado antes de este cambio sigue
   en `localStorage` sin ese campo, y sin la red de abajo se quedaría sin
   pesos y ordenaría por lo que tocara. */
const prioridadDe = (tope) => (tope <= 60 ? "barato" : tope >= 300 ? "cunda" : "equilibrio");

/* Un test contestado antes de que existieran `prioridad`, `finde` y `directo`
   sigue guardado tal cual en `localStorage`. Sin esto se recalcularía con
   `prioridad` a `undefined` —los pesos caerían a los de equilibrio sin que
   nadie lo hubiera pedido— y `finde` con lo que se dedujo aquel día. Se
   rellena con lo que se deducía entonces, que es lo que esa persona vio. */
function alDia(r) {
  if (!r.prioridad) r.prioridad = prioridadDe(Number(r.tope) || 0);
  if (r.finde === undefined) r.finde = !!(r.noches && r.noches[1] <= 3);
  if (r.directo === undefined) r.directo = false;
  if (r.ademas === undefined) r.ademas = null;
  return r;
}

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

function progresoHTML(i, total, lista = visibles()) {
  // El mismo troquel de la cabecera: una casilla por pregunta, rellenas las
  // contestadas. Es el único sitio donde el flap significa algo además de
  // decorar.
  //
  // Con diez preguntas la barra sola no basta: diez casillas son diez y se
  // leen como una cuesta. El capítulo delante ("El viaje · 2 de 4") las parte
  // en tres tramos cortos, que es lo que de verdad se está recorriendo.
  const casillas = Array.from(
    { length: total },
    (_, n) => `<span class="quiz-paso${n < i ? " hecho" : n === i ? " ahora" : ""}"></span>`
  ).join("");
  // Solo el NOMBRE del capítulo: cuánto queda ya lo dicen las casillas y el
  // "4 de 10" de debajo, y tres cuentas para lo mismo es ruido.
  const cap = CAPITULOS.find((c) => c.id === (lista[i] || {}).cap);
  return `<div class="quiz-progreso">
      <span class="quiz-capitulo">${cap ? esc(cap.t) : ""}</span>
      <span class="quiz-casillas" aria-hidden="true">${casillas}</span>
    </div>`;
}

function preguntaHTML(p, i, total) {
  const opciones = opcionesDe(p)
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
  if (progreso) progreso.outerHTML = progresoHTML(PASO, lista.length, lista);

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
  const elegida = opcionesDe(p)[n];
  if (!elegida) return;
  RESPUESTAS[p.id] = elegida.v;
  // Cambiar el sabor principal al volver atrás puede dejar el segundo repetido
  // (elegiste "ciudad" y luego cambiaste el primero a "ciudad" también): un
  // sitio no puede acertar dos veces con lo mismo.
  if (p.id === "apetece" && RESPUESTAS.ademas === elegida.v) RESPUESTAS.ademas = null;
  avanzar();
}

function avanzar() {
  // Se avanza solo al elegir: un botón "siguiente" en un test de diez
  // preguntas son diez pulsaciones de más para no decir nada.
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

/* ------------------------------------------------------ lo que has contestado
   Diez preguntas y un titular genérico ("Tres sitios para ti") hacen que el
   resultado parezca sacado de una chistera. Esto reconstruye la petición con
   las palabras de la propia persona: se lee y se ve que se la ha escuchado, y
   —más importante— se ve DÓNDE cambiarla si algo no era lo que quería.

   Sale de `RESPUESTAS`, no de lo que devolvió el motor: es lo que pediste, no
   lo que salió. */
const EN_PALABRAS = {
  playa: "playa",
  ciudad: "ciudad",
  gastronomia: "comer bien",
  naturaleza: "naturaleza",
  noche: "salir de noche",
};

export function tuPeticion(r) {
  const trozos = [];
  const gusto = EN_PALABRAS[r.apetece];
  const otro = EN_PALABRAS[r.ademas];
  if (gusto) trozos.push(otro ? `${gusto} con algo de ${otro}` : gusto);

  if (Array.isArray(r.noches)) {
    const [a, b] = r.noches;
    trozos.push(a === b ? `${a} noches` : `de ${a} a ${b} noches`);
  }
  if (r.finde) trozos.push("en finde");
  if (r.directo === true) trozos.push("directo");
  if (r.madrugar === false) trozos.push("sin madrugar");
  if (r.lejos === true) trozos.push("lejos");
  if (r.lejos === false) trozos.push("cerca");

  const gente = Number(r.personas) || 1;
  const tope = Number(r.tope) || 0;
  if (tope) {
    trozos.push(
      gente > 1 ? `hasta ${Math.round(tope)} € por cabeza, ${gente} personas` : `hasta ${Math.round(tope)} €`
    );
  } else if (gente > 1) {
    trozos.push(`${gente} personas`);
  }

  const cola = { barato: "Lo barato manda.", cunda: "Que cunda manda." }[r.prioridad] || "";
  if (!trozos.length) return cola;
  // Primera en mayúscula y el resto separado por comas: es una lista de
  // condiciones, no una frase, y leerla de un vistazo es lo que importa.
  const frase = trozos.join(" · ");
  return `${frase.charAt(0).toUpperCase()}${frase.slice(1)}.${cola ? ` ${cola}` : ""}`;
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
      ${tuPeticion(r) ? `<p class="quiz-tuyo">${esc(tuPeticion(r))}</p>` : ""}
      <p class="quiz-pie">${esc(salida.aviso)}</p>
      <button type="button" class="btn ghost small" data-otra>Volver a hacerlo</button>`;
    caja.querySelector("[data-otra]").addEventListener("click", reiniciar);
    if (typeof tfAnunciar === "function") tfAnunciar(salida.aviso);
    return;
  }

  const peticion = tuPeticion(r);
  caja.innerHTML = `
    <h3 class="quiz-pregunta">Tres sitios para ti</h3>
    ${peticion ? `<p class="quiz-tuyo">${esc(peticion)}</p>` : ""}
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
    label: etiqueta,
    // De dónde viene (#13): es justo la pregunta que el campo existe para
    // contestar, si el test trae gente o si todos acaban en el formulario.
    source: "test",
    // Mismo sobre que el del formulario: un solo objeto con el encargo.
    viaje: {
      dest: o.destination,
      max_price: String(Math.round(Number(r.tope) || 0)),
      months: String(r.meses || 6),
      adults: String(r.personas || 1),
      weekend: r.finde ? "si" : "no",
    },
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
  RESPUESTAS = guardado ? alDia({ ...guardado.respuestas }) : {};
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
