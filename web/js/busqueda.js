/* busqueda.js — Trazar un viaje: el formulario, lo pendiente y las busquedas guardadas. */

import {
  $,
  MAX_VUELTAS,
  POLL_EVERY_MS,
  SEARCH_OFFERS,
  esc,
  existe,
  fetchJSON,
  fmtDate,
  fmtEUR,
  on,
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
import {
  MAX_ESPERA_MS,
  anadirPendiente,
  guardarPendientes,
  pendienteHTML,
  pendientes,
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

function yaHechaHTML(s) {
  return `
    <div class="saved ya-hecha" data-slug="${esc(s.slug)}">
      <b>${esc(s.label)}</b>
      <span class="meta">ya buscado ${esc(desde(s.generated_at))} · ${s.count} viaje${
        s.count === 1 ? "" : "s"
      }${s.best_price ? ` · desde ${fmtEUR(s.best_price)}` : ""}</span>
      <button class="btn ghost small" type="button" data-repetir
        title="Los precios cambian: esto vuelve a barrer y tarda unos minutos">Buscar otra vez</button>
    </div>`;
}

function wireRepetir() {
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
  "one|weekend": "Ese destino, el finde que salga más barato de aquí a los meses que pongas.",
  "one|exact": "Ese destino en esas fechas exactas.",
  "one|anytime": "Ese destino, cualquier día de la semana.",
};

function syncFinder() {
  if (!existe("#finderForm")) return;
  const donde = $("#fWhere").value;
  const cuando = $("#fWhen").value;
  // Ida y vuelta comparten ya un solo control, asi que #returnWrap no existe.
  $("#destWrap").hidden = donde !== "one";
  $("#departWrap").hidden = cuando !== "exact";
  $("#nightsWrap").hidden = cuando === "exact";
  $("#monthsWrap").hidden = cuando === "exact";
  $("#finderHint").textContent = HINTS[`${donde}|${cuando}`] || "";
  // El calendario solo pinta cuando has dicho "fechas exactas". Esto vivia mas
  // abajo, reasignando `syncFinder` por encima de si misma: el efecto era que
  // el original quedaba enganchado dos veces al `change` y corria dos veces por
  // cada cambio. Aqui dentro se hace una sola vez y se lee de corrido.
  if (existe("#cal") && cuando !== "exact") $("#cal").hidden = true;
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

  const personas = Number($("#fAdults").value) || 1;
  const cuandoTxt =
    cuando === "exact"
      ? `${fmtDate($("#fDepart").value)}${
          $("#fReturn").value ? ` → ${fmtDate($("#fReturn").value)}` : ""
        }`
      : cuando === "weekend"
      ? `findes · ${$("#fMonths").value || 12} meses`
      : `${$("#fMonths").value || 12} meses`;

  const payload = {
    dest,
    label: [
      dest || "Donde sea",
      cuandoTxt,
      `hasta ${$("#fMax").value} €`,
      personas > 1 ? `${personas} pers.` : "1 pers.",
    ].join(" · "),
    owner: tfUid(),
    max_price: $("#fMax").value,
    nights: $("#fNights").value.trim() || "2-3",
    months: $("#fMonths").value || "12",
    adults: $("#fAdults").value || "2",
    weekend: cuando === "weekend" ? "si" : "no",
    depart: cuando === "exact" ? $("#fDepart").value : "",
    return_date: cuando === "exact" ? $("#fReturn").value : "",
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
    tfAnunciar(`Búsqueda lanzada: ${payload.label}. Tarda unos minutos.`);
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

  const cabecera = pend
    .map((p) => pendienteHTML(p, ahora - p.desde > MAX_ESPERA_MS))
    .join("");

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
