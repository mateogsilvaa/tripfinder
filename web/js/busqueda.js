/* busqueda.js — Trazar un viaje: el formulario, lo pendiente y las busquedas guardadas. */

import {
  $,
  MAX_VUELTAS,
  MONTHS,
  POLL_EVERY_MS,
  cuadrarRejilla,
  SEARCH_OFFERS,
  esc,
  existe,
  fetchJSON,
  fmtDate,
  fmtEUR,
  on,
  pintarStats,
  stat,
  statPie,
} from "./base.js";
import { conGrupo } from "./precios.js";
import { CAMPOS_BUSCAR, ampliar, recogerAmpliado } from "./ampliar.js";
import {
  BORRANDO_KEY,
  sincronizarFavs,
} from "./favoritos.js";
import {
  avisoDeCuenta,
  cajaAcceso,
  dispatch,
  esFaltaDeAcceso,
  esMio,
  wireEntrar,
  comoDueno,
} from "./disparador.js";
import { boardRow, wireRows } from "./ofertas.js";
import { compartirCeldaHTML, wireCompartir } from "./compartir.js";
import {
  MAX_ESPERA_MS,
  anadirPendiente,
  anotarTerminada,
  guardarPendientes,
  olvidarTerminada,
  pendienteHTML,
  pendientes,
  terminadaHTML,
  terminadas,
} from "./destinos.js";
import { cargarWatches } from "./seguimientos.js";
import { desde } from "./alojamiento.js";

/* --------------------------------------------------- buscador personalizado */
/* La busqueda ya no pasa por una issue: la web manda un `repository_dispatch`
   directo desde el navegador con el token de la cuenta. El camino por issue
   existio cuando no habia cuentas —abrir una issue era el unico disparador
   gratuito y autenticado que tenia una web estatica—, pero hoy solo servia
   para abrir una issue que nadie lee y que ademas dispara el workflow por
   partida doble (`opened` y `labeled`). Sin cuenta no se busca, y eso ya lo
   dice `candarFormularios` con el motivo puesto.

   El de alojamiento (`issueURL`) SI se queda: ahi es el ultimo recurso que se
   ofrece cuando el dispatch falla con el panel ya abierto.

/* ------------------------------------------------- no repetir lo ya buscado

   La web es estatica: para buscar hay que levantar un workflow, y un barrido
   "donde sea" tarda del orden de ocho minutos. Lo mas barato que se puede
   hacer es no lanzarlo cuando la respuesta ya esta publicada.

   La identidad de una busqueda es su etiqueta: se construye con los mismos
   campos que rellena el usuario (destino, cuando, tope y cuanta gente), asi
   que dos busquedas iguales dan la misma. Es lo que ya usaba `loadSearches`
   para saber que una pendiente habia llegado. */
async function busquedaYaHecha(label) {
  let indice;
  try {
    indice = await fetchJSON("data/searches/index.json");
  } catch {
    return null; // sin indice no se puede saber: que la lance
  }
  return (indice.searches || []).filter(esMio).find((s) => s.label === label) || null;
}

/* Esa búsqueda ya estaba hecha. Lo primero que hay que decir es que NO se ha
   lanzado nada: si no, se queda uno esperando ocho minutos a que pase algo. */
function yaHechaHTML(s) {
  return `
    <div class="saved ya-hecha lanzada" data-slug="${esc(s.slug)}">
      <b>${esc(s.label)}</b>
      <span class="lanzada-hora deep">no se ha lanzado nada</span>
      <span class="meta">Ya buscado ${esc(desde(s.generated_at))} · ${s.count} viaje${
        s.count === 1 ? "" : "s"
      }${s.best_price ? ` · desde ${fmtEUR(s.best_price)}` : ""}</span>
      <p class="lanzada-nota">Un barrido «donde sea» son ocho minutos, así que se te ofrece el que
        hay en vez de repetirlo. Los precios de hace ${esc(desde(s.generated_at))} no son los de
        hoy: repetirlo es tu decisión.</p>
      <div class="lanzada-acc">
        <button class="btn primary small" type="button" data-abrir-guardada="${esc(s.slug)}">Ver
          ${s.count === 1 ? "el viaje" : `los ${s.count} viajes`}</button>
        <button class="btn ghost small" type="button" data-repetir
          title="Los precios cambian: esto vuelve a barrer y tarda unos minutos">Buscar otra vez</button>
      </div>
    </div>`;
}

function wireRepetir() {
  // «Ver los N viajes» abre la búsqueda que YA está guardada más abajo. Hay dos
  // elementos con el mismo `data-slug` —este aviso y la tarjeta de verdad—, y
  // la buena es la que tiene resultados dentro.
  document.querySelectorAll("[data-abrir-guardada]").forEach((b) =>
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const slug = b.dataset.abrirGuardada;
      const real = [...document.querySelectorAll(`.saved[data-slug="${CSS.escape(slug)}"]`)].find(
        (el) => el.querySelector(".saved-rows")
      );
      if (!real) return;
      real.scrollIntoView({ block: "center", behavior: "smooth" });
      if (real.querySelector(".saved-rows").hidden) real.click();
    })
  );
  document.querySelectorAll("[data-repetir]").forEach((b) =>
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      b.disabled = true;
      // El mismo submit, pero saltandose la comprobacion de arriba.
      const falso = new Event("submit", { cancelable: true });
      falso.__repetir = true;
      $("#finderForm").dispatchEvent(falso);
    })
  );
}

/* El formulario cambia segun lo que el usuario tenga decidido y lo que no:
   sitio concreto o donde sea, fechas exactas, un finde cualquiera o da igual. */
const HINTS = {
  "any|weekend": "Un fin de semana donde sea: se recorren todos los findes del horizonte.",
  "any|exact": "Ese fin de semana concreto, a cualquier destino que haya.",
  "any|anytime": "Cualquier destino y cualquier fecha: lo más barato del horizonte.",
  "any|mes": "Ese mes, donde sea: se mira día a día y sale lo más barato del mes.",
  "any|mes-finde": "Los findes de ese mes, donde sea.",
  "any|tramo": "Dentro de ese tramo, donde sea: se busca el mejor día que haya.",
  "one|weekend": "Ese destino, el finde que salga más barato de aquí a los meses que pongas.",
  "one|exact": "Ese destino en esas fechas exactas.",
  "one|anytime": "Ese destino, cualquier día de la semana.",
  "one|mes": "Ese destino en ese mes: se mira día a día y sale el más barato.",
  "one|mes-finde": "Ese destino, el finde de ese mes que salga más barato.",
  "one|tramo": "Ese destino, el mejor día dentro del tramo que has marcado.",
};

/* Los modos de fecha flexible: un mes, un mes de findes, o un tramo. Los tres
   mandan una VENTANA (`desde`/`hasta`) en vez de una fecha, que es el término
   medio que faltaba entre saber el día exacto y no tener ni idea. */
const CON_MES = new Set(["mes", "mes-finde"]);
const FLEXIBLES = new Set(["mes", "mes-finde", "tramo"]);

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

function llenarOrigenes() {
  const sel = $("#fOrigen");
  if (!sel || sel.options.length) return;
  sel.innerHTML = ORIGENES.map(
    ([code, ciudad]) => `<option value="${code}">${esc(ciudad)} (${code})</option>`
  ).join("");
}

/* Los doce meses que vienen. El valor es `YYYY-MM` y no un nombre suelto:
   «marzo» sin año es de este año o del que viene según cuándo lo mires. */
function llenarMeses() {
  const sel = $("#fMes");
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
function mesEnTramo(valor) {
  const [a, m] = (valor || "").split("-").map(Number);
  if (!a || !m) return { desde: "", hasta: "" };
  const ultimo = new Date(a, m, 0).getDate();
  const mm = String(m).padStart(2, "0");
  return { desde: `${a}-${mm}-01`, hasta: `${a}-${mm}-${ultimo}` };
}

function syncFinder() {
  if (!existe("#finderForm")) return;
  const donde = $("#fWhere").value;
  const cuando = $("#fWhen").value;
  // Ida y vuelta comparten ya un solo control, asi que #returnWrap no existe.
  $("#destWrap").hidden = donde !== "one";
  llenarOrigenes();
  if (existe("#mesWrap")) {
    llenarMeses();
    $("#mesWrap").hidden = !CON_MES.has(cuando);
  }
  // El calendario vale para las dos cosas: con fechas exactas marca la ida y la
  // vuelta, y con un tramo marca los dos extremos de la ventana. Lo que cambia
  // es lo que significan, y eso lo dice el rótulo.
  $("#departWrap").hidden = cuando !== "exact" && cuando !== "tramo";
  if (existe("#departRot")) {
    $("#departRot").textContent = cuando === "tramo" ? "Entre" : "Fechas";
    // El calendario pinta lo mismo, pero lo que pide el segundo clic no es lo
    // mismo: en fechas exactas es la vuelta y en un tramo es el final de la
    // ventana. Decir «elige la vuelta» ahí es mentir.
    $("#dateBtn").dataset.modo = cuando === "tramo" ? "tramo" : "fechas";
  }
  /* ORGANIZAR EL FINDE: y ademas dónde dormir. Solo se ofrece con un destino
     concreto Y fechas exactas, porque el alojamiento se busca para unas fechas
     y una ciudad: con «donde sea» no hay ciudad, y con fechas flexibles todavía
     no hay fechas. Ofrecerlo y que no hiciera nada sería peor que no ofrecerlo.

     Se esconde en vez de desactivarse: una casilla apagada invita a pulsarla
     para averiguar por qué. */
  const puedeCamas = donde === "one" && cuando === "exact";
  if (existe("#camasWrap")) {
    $("#camasWrap").hidden = !puedeCamas;
    if (!puedeCamas) $("#fCamas").checked = false;
  }
  $("#nightsWrap").hidden = cuando === "exact";
  // Con ventana, el horizonte sobra: ya has dicho hasta cuándo.
  $("#monthsWrap").hidden = cuando === "exact" || FLEXIBLES.has(cuando);
  $("#finderHint").textContent = HINTS[`${donde}|${cuando}`] || "";
  // El calendario solo pinta cuando has dicho "fechas exactas". Esto vivia mas
  // abajo, reasignando `syncFinder` por encima de si misma: el efecto era que
  // el original quedaba enganchado dos veces al `change` y corria dos veces por
  // cada cambio. Aqui dentro se hace una sola vez y se lee de corrido.
  if (existe("#cal") && cuando !== "exact" && cuando !== "tramo") $("#cal").hidden = true;
  cuadrarRejilla($("#finderForm"));
}
["#fWhere", "#fWhen"].forEach((s) => on(s, "change", syncFinder));
if (existe("#finderForm")) syncFinder();

/* Y al revés: si se llega desde la portada, se rellena y se lanza. Va después
   de `syncFinder` para que los campos condicionales ya estén enganchados. */
export function recogerBusqueda() {
  if (!existe("#finderForm") || $("#finderForm").dataset.ampliar) return;
  recogerAmpliado(CAMPOS_BUSCAR, $("#finderForm"));
}

on("#finderForm", "submit", async (e) => {
  e.preventDefault();
  // En la portada este formulario es el compacto: se lleva lo escrito a
  // `buscar.html` y allí se lanza. En `buscar.html` no hay `data-ampliar` y
  // esto no hace nada.
  if (ampliar(e.currentTarget, CAMPOS_BUSCAR)) return;
  const donde = $("#fWhere").value;
  const cuando = $("#fWhen").value;
  const dest = donde === "one" ? $("#fDest").value.trim() : "";
  if (donde === "one" && !dest) {
    $("#fDest").focus();
    return;
  }
  if (cuando === "exact" && !$("#fDepart").value) {
    $("#fDepart").focus();
    return;
  }
  // Un tramo con un solo extremo no es un tramo. Se dice y no se lanza: ocho
  // minutos de barrido para descubrir que faltaba una fecha es peor que un
  // aviso ahora.
  if (cuando === "tramo" && !($("#fDepart").value && $("#fReturn").value)) {
    $("#finderHint").textContent = "Marca los dos extremos del tramo en el calendario.";
    $("#cal").hidden = false;
    $("#dateBtn").focus();
    return;
  }

  /* La ventana en que se puede viajar. Un mes se convierte aquí en sus dos
     extremos —el backend solo entiende fechas— y un tramo son los dos días que
     se han marcado en el calendario. */
  const ventana = CON_MES.has(cuando)
    ? mesEnTramo($("#fMes").value)
    : cuando === "tramo"
    ? { desde: $("#fDepart").value, hasta: $("#fReturn").value }
    : { desde: "", hasta: "" };
  const mesTxt = CON_MES.has(cuando)
    ? $("#fMes").selectedOptions[0]?.textContent.trim() || $("#fMes").value
    : "";

  const personas = Number($("#fAdults").value) || 1;
  const cuandoTxt =
    cuando === "exact"
      ? `${fmtDate($("#fDepart").value)}${
          $("#fReturn").value ? ` → ${fmtDate($("#fReturn").value)}` : ""
        }`
      : cuando === "mes"
      ? mesTxt
      : cuando === "mes-finde"
      ? `findes de ${mesTxt}`
      : cuando === "tramo"
      ? `${fmtDate(ventana.desde)} → ${fmtDate(ventana.hasta)}`
      : cuando === "weekend"
      ? `findes · ${$("#fMonths").value || 12} meses`
      : `${$("#fMonths").value || 12} meses`;

  const origen = $("#fOrigen") ? $("#fOrigen").value.trim().toUpperCase() : "";
  const payload = {
    dest,
    label: [
      // De dónde sale solo se dice cuando NO es Madrid: ponerlo siempre
      // alargaría todas las etiquetas para repetir lo de siempre.
      origen && origen !== "MAD" ? `${dest || "Donde sea"} (desde ${origen})` : dest || "Donde sea",
      cuandoTxt,
      `hasta ${$("#fMax").value} €`,
      personas > 1 ? `${personas} pers.` : "1 pers.",
    ].join(" · "),
    owner: tfUid(),
    max_price: $("#fMax").value,
    nights: $("#fNights").value.trim() || "2-3",
    months: $("#fMonths").value || "12",
    adults: $("#fAdults").value || "2",
    weekend: cuando === "weekend" || cuando === "mes-finde" ? "si" : "no",
    /* EL VIAJE, EN UNA SOLA PROPIEDAD: de dónde sales y cuándo.
       `repository_dispatch` admite diez de primer nivel y sueltas eran doce —el
       encargo no habría salido nunca, lo para `dispatch` antes de la red— así
       que van agrupadas, como ya hace el seguimiento con su `viaje`.

       Las fechas van juntas porque son lo mismo contado con distinto grado de
       certeza: `depart` es «salgo el 12»; `desde` es «puedo salir entre el 3 y
       el 19, dime cuál sale mejor». Y el origen va aquí y no suelto porque una
       propiedad más de primer nivel volvería a rozar el tope. */
    viaje: {
      origin: $("#fOrigen") ? $("#fOrigen").value.trim().toUpperCase() : "",
      depart: cuando === "exact" ? $("#fDepart").value : "",
      return_date: cuando === "exact" ? $("#fReturn").value : "",
      desde: ventana.desde,
      hasta: ventana.hasta,
      camas: $("#fCamas") && $("#fCamas").checked ? "si" : "",
    },
  };

  const aviso = (html) => ($("#searches").innerHTML = html + $("#searches").innerHTML);

  // Antes de levantar nada: si esta misma busqueda ya esta hecha, no hay que
  // volver a lanzarla. Un barrido "donde sea" son ~8 minutos de scraping y una
  // pasada entera por 105 destinos; repetirla porque si es tirar el rato de
  // otro. Se ofrece la que hay y se deja repetir a mano, porque los precios de
  // hace dias ya no son los de hoy: la decision es del que busca, no nuestra.
  if (!e.__repetir) {
    const hecha = await busquedaYaHecha(payload.label);
    if (hecha) {
      $("#searches").innerHTML = yaHechaHTML(hecha) + $("#searches").innerHTML;
      wireRepetir();
      tfOlvidarAnuncio();
      tfAnunciar(
        `Esa búsqueda ya estaba hecha, de ${desde(hecha.generated_at)}: ` +
          `${hecha.count} viaje${hecha.count === 1 ? "" : "s"}. Puedes repetirla si quieres precios de hoy.`
      );
      return;
    }
  }

  const r = await dispatch("search", payload);
  if (r.ok) {
    anadirPendiente(payload.label);
    tfOlvidarAnuncio();
    tfAnunciar(
      `Búsqueda lanzada: ${payload.label}. ` +
        (payload.viaje.camas
          ? "Tarda unos minutos: primero los vuelos y después el alojamiento del mejor."
          : "Tarda unos minutos.")
    );
    loadSearches();
    return;
  }
  if (esFaltaDeAcceso(r)) {
    const caja = cajaAcceso(r);
    $("#searches").innerHTML = caja.html + $("#searches").innerHTML;
    caja.wire();
    return;
  }
  aviso(`<div class="saved"><span class="meta">No se pudo lanzar: ${esc(r.reason)}</span></div>`);
});

/* Cuanto se espera a que el workflow termine y publique su fichero.
   Antes se daba por perdido a los 6-7 minutos, que valia cuando una busqueda
   preguntaba a Ryanair y poco mas. Ahora se barren ~105 destinos con una
   consulta a Google cada uno, asi que una busqueda "donde sea" tarda del orden
   de 8 minutos y se rendia justo antes de que llegara el resultado. */
export function esperarCambios() {
  if (window.__esperando) return;
  let vueltas = 0;
  window.__esperando = setInterval(async () => {
    vueltas += 1;
    const quedan =
      pendientes().length || JSON.parse(localStorage.getItem(BORRANDO_KEY) || "[]").length;
    if (!quedan || vueltas > MAX_VUELTAS) {
      clearInterval(window.__esperando);
      window.__esperando = null;
      if (!quedan) return;
    }
    // Las dos, pase lo que pase con la otra: cada una se protege sola, pero si
    // una tirara la callback la siguiente no llegaria a correr nunca.
    await Promise.allSettled([loadSearches(), cargarWatches()]);
  }, POLL_EVERY_MS);
}

/* ------------------------------------------------------- borrar de una tacada

   Cada borrado era su propio `repository_dispatch`, y cada dispatch un
   workflow entero: checkout, Python, dependencias y un push, para quitar UN
   fichero. Quitando cinco busquedas seguidas salian cinco runs peleandose por
   el mismo commit —de ahi los reintentos con rebase del workflow— y cinco
   despliegues de los que GitHub cancelaba cuatro.

   Ahora los clics se juntan durante un momento y sale UNA sola llamada con la
   lista entera. El workflow los aplica en un bucle dentro de su reintento, asi
   que el commit tambien es uno. */
const BORRADO_ESPERA_MS = 900;
let borradoPendiente = [];
let borradoTimer = null;

function encolarBorrado(slug, boton) {
  if (!borradoPendiente.includes(slug)) borradoPendiente.push(slug);
  clearTimeout(borradoTimer);
  borradoTimer = setTimeout(() => enviarBorrados(boton), BORRADO_ESPERA_MS);
}

async function enviarBorrados(boton) {
  const ids = borradoPendiente;
  borradoPendiente = [];
  if (!ids.length) return;

  const r = await dispatch("delete_search", {
    // `id` se manda igual para no romper nada que solo mire ese campo.
    id: ids[0],
    ids,
    ...comoDueno(),
  });
  if (r.ok) {
    const cola = JSON.parse(localStorage.getItem(BORRANDO_KEY) || "[]");
    localStorage.setItem(BORRANDO_KEY, JSON.stringify(cola.concat(ids)));
    loadSearches();
    return;
  }
  // Si falla, vuelven a estar borrables: nada se ha ido.
  if (boton) boton.disabled = false;
  document.querySelectorAll("[data-borrar]").forEach((b) => {
    if (ids.includes(b.dataset.borrar)) b.disabled = false;
  });
  alert("No se pudo borrar: " + r.reason);
}

/* Las cifras de esta pagina, no las del feed. Cuantas busquedas tienes
   guardadas y cuantos viajes han sacado entre todas; y abajo, lo que de verdad
   quiere saber quien va a darle a Buscar: cuanto tarda. */
function pintarCifras(guardadas) {
  const viajes = guardadas.reduce((n, s) => n + (Number(s.count) || 0), 0);
  pintarStats(
    stat("búsquedas guardadas", guardadas.length) +
      stat("viajes dentro", viajes) +
      statPie("una búsqueda «donde sea»", "unos 8 minutos")
  );
}

export async function loadSearches() {
  // Esta caja solo existe en buscar.html, pero el mismo modulo carga en las cuatro
  // paginas. Sin esta linea, en el indice y en seguimientos petaba con
  // "Cannot set properties of null" y, lo importante, se llevaba por delante el
  // resto: en seguimientos.html el refresco automatico hace
  // `await loadSearches(); await cargarWatches();`, asi que al reventar la
  // primera la segunda no llegaba a correr y lo que sigues no se actualizaba.
  if (!$("#searches")) return;
  let indice;
  try {
    indice = await fetchJSON("data/searches/index.json");
  } catch {
    return;
  }
  const guardadas = (indice.searches || []).filter(esMio);
  pintarCifras(guardadas);

  // Lo que ya esta en el indice deja de estar pendiente.
  const etiquetas = new Set(guardadas.map((s) => s.label));
  const antes = pendientes();
  let pend = antes.filter((p) => !etiquetas.has(p.label));
  guardarPendientes(pend);

  // Las que acaban de salir de la lista de pendientes son justo las que han
  // TERMINADO en esta vuelta. Es el momento de decirlo: sin esto se anuncia
  // que algo empieza y nunca que ha acabado.
  antes
    .filter((p) => etiquetas.has(p.label))
    .forEach((p) => {
      const hecha = guardadas.find((g) => g.label === p.label);
      const n = hecha ? hecha.count : 0;
      // Y se queda anotada para que la ficha de "terminada" salga donde estaba
      // la barra de progreso, en vez de que la busqueda desaparezca sin mas.
      if (hecha) anotarTerminada(p.label, hecha.slug);
      tfOlvidarAnuncio();
      tfAnunciar(
        n
          ? `Búsqueda terminada: ${p.label}. ${n} viaje${n === 1 ? "" : "s"}.`
          : `Búsqueda terminada: ${p.label}. Sin resultados.`
      );
    });

  const ahora = Date.now();
  // Y las que se han quedado por el camino, una sola vez cada una.
  pend
    .filter((p) => ahora - p.desde > MAX_ESPERA_MS && !p.avisada)
    .forEach((p) => {
      p.avisada = true;
      tfAnunciar(`La búsqueda "${p.label}" no llegó a terminar. Puedes volver a lanzarla.`);
    });
  guardarPendientes(pend);

  // Las recien terminadas van donde estaba su barra de progreso: encima de las
  // guardadas, que es donde estabas mirando. Solo las que siguen en el indice:
  // una borrada no puede seguir anunciando su final.
  const porSlug = new Map(guardadas.map((s) => [s.slug, s]));
  const recien = terminadas().filter((t) => porSlug.has(t.slug));
  const cabecera =
    recien.map((t) => terminadaHTML(t, porSlug.get(t.slug))).join("") +
    pend.map((p) => pendienteHTML(p, ahora - p.desde > MAX_ESPERA_MS)).join("");

  if (!guardadas.length && !cabecera) {
    $("#searches").innerHTML = avisoDeCuenta(
      "búsquedas guardadas",
      "Aún no has guardado ninguna búsqueda. Rellena el formulario de arriba y en unos minutos aparece aquí."
    );
    wireEntrar($("#searches"));
    return;
  }

  $("#searches").setAttribute("aria-busy", "true");
  $("#searches").innerHTML = cabecera + guardadas
    .map(
      (s) => `
      <div class="saved" data-slug="${esc(s.slug)}">
        <b>${esc(s.label)}</b>
        <span class="meta">${s.count} viajes · buscado ${esc(desde(s.generated_at))}</span>
        ${s.best_price ? `<span class="best">desde ${fmtEUR(s.best_price)}</span>` : ""}
        <button class="quitar" type="button" data-borrar="${esc(s.slug)}"
          aria-label="Quitar esta búsqueda">quitar</button>
        <div class="saved-rows" hidden></div>
      </div>`
    )
    .join("");

  // Lo que se ha mandado borrar sigue marcado hasta que desaparece de verdad.
  const borrando = JSON.parse(localStorage.getItem(BORRANDO_KEY) || "[]");
  borrando.forEach((slug) => {
    const fila = $("#searches").querySelector(`[data-slug="${slug}"]`);
    if (fila) {
      fila.style.opacity = 0.45;
      const m = fila.querySelector(".meta");
      if (m) m.innerHTML = '<span class="spin"></span>borrando…';
    }
  });
  const vivas = new Set(guardadas.map((s) => s.slug));
  const siguen = borrando.filter((s) => vivas.has(s));
  localStorage.setItem(BORRANDO_KEY, JSON.stringify(siguen));
  if (siguen.length) esperarCambios();

  $("#searches")
    .querySelectorAll("[data-olvidar]")
    .forEach((b) =>
      b.addEventListener("click", () => {
        guardarPendientes(pendientes().filter((p) => p.label !== b.dataset.olvidar));
        loadSearches();
      })
    );

  recien.forEach((t) => rellenarTerminada(t.slug));

  $("#searches")
    .querySelectorAll("[data-term-abrir]")
    .forEach((b) =>
      b.addEventListener("click", () => {
        // Abrirla es justo lo que la ficha venia a ofrecer, asi que en cuanto lo
        // haces la ficha ya sobra: la busqueda es una guardada mas. Se abre la
        // tarjeta de verdad, que es la que tiene los resultados dentro.
        const slug = b.dataset.termAbrir;
        olvidarTerminada(slug);
        const real = [...document.querySelectorAll(`.saved[data-slug="${CSS.escape(slug)}"]`)].find(
          (el) => el.querySelector(".saved-rows")
        );
        if (real) {
          real.scrollIntoView({ block: "center", behavior: "smooth" });
          if (real.querySelector(".saved-rows").hidden) real.click();
        }
        b.closest(".terminada")?.remove();
      })
    );

  if (pend.length) esperarCambios();

  document.querySelectorAll("[data-borrar]").forEach((b) =>
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      b.disabled = true;
      encolarBorrado(b.dataset.borrar, b);
    })
  );

  wireEntrar($("#searches"));
  $("#searches").setAttribute("aria-busy", "false");

  document.querySelectorAll(".saved[data-slug]").forEach((el) =>
    el.addEventListener("click", (ev) => {
      // Sin esto, abrir un viaje de dentro cerraba la busqueda que lo contiene.
      if (ev.target.closest(".saved-rows") || ev.target.closest("[data-borrar]")) return;
      toggleSearch(el);
    })
  );

  const pedida = new URLSearchParams(location.search).get("search");
  if (pedida) {
    const el = document.querySelector(`.saved[data-slug="${pedida}"]`);
    if (el) {
      toggleSearch(el);
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }
}

/* Las tres filas de dentro de la ficha de "terminada", y la unica cifra que
   contesta si ha merecido la pena: cuantos de los que salieron caben en el tope
   que pusiste. Siete viajes con un tope de 120 € no dicen nada si todos estan a
   400; tres dentro del tope, si. El tope sale del propio fichero de la busqueda
   (`request.max_price`), no de leerlo de la etiqueta. */
async function rellenarTerminada(slug) {
  const caja = $("#searches").querySelector(`[data-terminada="${CSS.escape(slug)}"]`);
  if (!caja) return;
  const filas = caja.querySelector("[data-term-filas]");
  let data = null;
  try {
    data = await fetchJSON(`data/searches/${slug}.json`);
  } catch {
    if (filas) filas.remove(); // el resumen de arriba ya dice lo esencial
    return;
  }
  const ofertas = conGrupo(data.offers || [], (data.request || {}).adults);
  ofertas.forEach((o) => (SEARCH_OFFERS[o.id] = o));

  // El diseño pide aquí «3 dentro de tu tope», y NO se puede decir: el barrido
  // filtra por el tope antes de guardar (`search.py`, `o.price <= max_price`),
  // así que dentro del fichero están todos dentro siempre. «7 viajes · 7 dentro
  // de tu tope» es ruido. Lo que sí se sabe, y es lo mismo que se quería saber,
  // es cuánto aire ha quedado: por debajo de qué has entrado.
  const tope = Number((data.request || {}).max_price) || 0;
  const barato = Math.min(...ofertas.map((o) => Number(o.price) || Infinity));
  const hueco = caja.querySelector("[data-term-tope]");
  if (hueco && tope && Number.isFinite(barato) && barato <= tope) {
    const aire = Math.round(tope - barato);
    hueco.textContent = aire
      ? ` · el más barato entra ${fmtEUR(aire)} por debajo de tu tope`
      : " · el más barato entra justo en tu tope";
  }

  if (!filas) return;
  filas.innerHTML = ofertas
    .slice(0, 3)
    .map(
      (o) => `
      <div class="term-fila">
        <span class="term-que">
          <span class="term-iata">${esc(o.destination)}</span>
          <span class="term-ciudad">${esc(o.destination_name || o.destination)}</span>
          <span class="term-cia">${esc(o.airline || "")}</span>
        </span>
        <span class="term-precio">${fmtEUR(o.price)}</span>
        ${compartirCeldaHTML(o)}
      </div>`
    )
    .join("");
  wireCompartir(filas, (id) => SEARCH_OFFERS[id] || null);
}

async function toggleSearch(el) {
  const caja = el.querySelector(".saved-rows");
  if (!caja.hidden) {
    caja.hidden = true;
    return;
  }
  caja.hidden = false;
  if (caja.dataset.cargado) return;
  caja.innerHTML = '<p class="meta">Cargando…</p>';
  try {
    const data = await fetchJSON(`data/searches/${el.dataset.slug}.json`);
    const ofertas = conGrupo(data.offers || [], (data.request || {}).adults);
    ofertas.forEach((o) => (SEARCH_OFFERS[o.id] = o));
    sincronizarFavs(ofertas);
    caja.innerHTML = ofertas.length
      ? ofertas.map((o, i) => boardRow(o, i)).join("")
      : '<p class="meta">Nada dentro de ese presupuesto. Sube el tope o amplía los meses.</p>';
    caja.dataset.cargado = "1";
    wireRows(caja);
  } catch {
    caja.innerHTML = '<p class="meta">No se pudo cargar.</p>';
  }
}
