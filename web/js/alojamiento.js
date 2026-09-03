/* alojamiento.js — La hoja lateral: pedir cama para unas fechas y ensenar lo que sale. */

import {
  $,
  POLL_EVERY_MS,
  POLL_MAX_MS,
  SEARCH_OFFERS,
  esc,
  escURL,
  existe,
  fetchJSON,
  fmtDate,
  fmtEUR,
  on,
  REPO,
} from "./base.js";
import { GRUPO, pax } from "./precios.js";
import { cajaAcceso, dispatch, esFaltaDeAcceso } from "./disparador.js";
import { OFFERS, render } from "./ofertas.js";

/* ------------------------------------------------------------- alojamiento */
let pollTimer = null;

/* Un solo camino de cierre: se llame desde el boton, desde el velo o desde
   Escape, todo pasa por `tfCerrarDialogo`, que es quien apaga la trampa de
   foco y devuelve el foco a quien abrio. Lo de esconder la hoja va en
   `alCerrar`, que es lo unico propio de este dialogo. */
function abrirPanel() {
  $("#panel").hidden = false;
  $("#backdrop").hidden = false;
  tfAbrirDialogo($("#panel"), {
    etiqueta: "Alojamiento",
    foco: () => $("#panelClose"),
    alCerrar: () => {
      clearInterval(pollTimer);
      $("#panel").hidden = true;
      $("#backdrop").hidden = true;
    },
  });
}
function closePanel() {
  tfCerrarDialogo($("#panel"));
}
on("#panelClose", "click", closePanel);
on("#backdrop", "click", closePanel);

function issueURL(o, adultos) {
  const body = [
    "Busqueda de alojamiento lanzada desde la web. No edites el bloque de abajo.",
    "",
    "```yaml",
    `offer_id: ${o.id}`,
    `city: ${o.destination_name || o.destination}`,
    `iata: ${o.destination}`,
    `country: ${o.destination_country || ""}`,
    `checkin: ${o.depart_date}`,
    `checkout: ${o.return_date || ""}`,
    `adults: ${adultos}`,
    "```",
  ].join("\n");
  return (
    `https://github.com/${REPO}/issues/new` +
    `?title=${encodeURIComponent(`[stay] ${o.id}`)}` +
    `&labels=stay-request&body=${encodeURIComponent(body)}`
  );
}

export async function openStays(id) {
  const offer = OFFERS.find((o) => o.id === id) || SEARCH_OFFERS[id];
  if (!offer) return;

  abrirPanel();
  $("#panelTitle").textContent = offer.destination_name || offer.destination;
  $("#panelDates").textContent =
    `${fmtDate(offer.depart_date, true)}${offer.return_date ? ` → ${fmtDate(offer.return_date, true)}` : ""}` +
    `${offer.nights ? ` · ${offer.nights} noches` : ""}`;
  $("#panelBody").innerHTML = '<p class="status">Comprobando si ya hay resultados…</p>';

  let datos = null;
  try {
    datos = await fetchJSON(`data/stays/${id}.json`);
  } catch {
    askForSearch(offer); // todavia no se ha buscado para estas fechas
    return;
  }
  pintarStays(datos, offer);
}

/* Pintar y fallar al pintar son cosas distintas: si el fichero esta y el
   render peta, hay que decirlo, no ofrecer otra busqueda como si no hubiera
   nada. Ese enredo es lo que hacia que "Buscar alojamiento" no diera nunca
   resultados aunque el scraper hubiera funcionado. */
/* Los viajes de los que ya se sabe el precio real de la cama, en esta sesion.
   En cuanto uno entra aqui, su fila deja de estimar. */
export const ESCAPADAS_REALES = {};

function pintarStays(datos, offer) {
  const id = (datos && datos.offer_id) || (offer && offer.id);
  if (id && datos && datos.summary && datos.summary.total) {
    ESCAPADAS_REALES[id] = datos.summary;
    // La fila y la plancha dejan de decir "≈": ya no es una cuenta nuestra.
    if (existe("#offers")) render();
  }
  try {
    renderStays(datos);
  } catch (err) {
    if (typeof tfApuntar === "function") {
      tfApuntar("stays", "no se pudo pintar el alojamiento", (err && err.stack) || String(err));
    }
    const n = (datos && datos.stays ? datos.stays.length : 0);
    $("#panelBody").innerHTML = `
      <div class="status wait">
        <p>Hay ${n} alojamiento${n === 1 ? "" : "s"} guardados para estas fechas, pero algo
        ha fallado al mostrarlos.</p>
        <a class="btn ghost small" href="data/stays/${esc(offer ? offer.id : "")}.json"
           target="_blank" rel="noopener">Ver los datos en crudo</a>
      </div>`;
  }
}

function askForSearch(offer, aviso = "") {
  $("#panelBody").innerHTML = `
    <div class="status wait">
      ${
        aviso ||
        `<p>Todavía no hemos buscado cama para estas fechas. Se lanza un scraper
         (Airbnb, hoteles y comparadores) para <strong>estas fechas exactas</strong>;
         tarda 2–3 minutos y esta página se actualiza sola.</p>`
      }
      <label class="party">
        <span>¿Cuántos viajáis?</span>
        <input type="number" id="party" min="1" max="8" value="${Math.min(
          8,
          Math.max(1, pax(offer) > 1 ? pax(offer) : GRUPO)
        )}" inputmode="numeric">
      </label>
      <button class="btn primary" id="launch">Buscar alojamiento</button>
    </div>`;

  $("#launch").addEventListener("click", async () => {
    // El precio del alojamiento depende de cuántos vais, así que el número
    // viaja en la petición: buscar para 2 y reservar para 4 no vale de nada.
    const adultos = Math.min(8, Math.max(1, Number($("#party").value) || 2));
    const r = await dispatch("stay", {
      offer_id: offer.id,
      city: offer.destination_name || offer.destination,
      country: offer.destination_country || "",
      iata: offer.destination,
      checkin: offer.depart_date,
      checkout: offer.return_date || "",
      adults: String(adultos),
    });
    if (r.ok) {
      startPolling(offer.id);
      return;
    }
    if (esFaltaDeAcceso(r)) {
      const caja = cajaAcceso(r);
      $("#panelBody").insertAdjacentHTML("beforeend", caja.html);
      caja.wire();
      return;
    }
    // Se muestra el motivo y se deja la issue como ultimo recurso.
    $("#panelBody").insertAdjacentHTML(
      "beforeend",
      `<div class="status wait"><p>No se pudo lanzar: ${esc(r.reason)}</p>
       <a class="btn ghost small" href="${issueURL(offer, adultos)}" target="_blank"
          rel="noopener">Lanzarlo por issue</a></div>`
    );
  });
}

function startPolling(id) {
  clearInterval(pollTimer);
  const started = Date.now();
  $("#panelBody").innerHTML =
    '<div class="status wait"><span class="spin"></span>Buscando… puedes cerrar esta ventana y volver luego.</div>';
  // Quince minutos de espera sin que nadie te diga que hay algo en marcha son
  // quince minutos de no saber si le has dado al boton.
  tfOlvidarAnuncio();
  tfAnunciar("Buscando alojamiento. Tarda unos minutos; puedes cerrar esta ventana.");
  pollTimer = setInterval(async () => {
    if (Date.now() - started > POLL_MAX_MS) {
      clearInterval(pollTimer);
      $("#panelBody").innerHTML =
        '<div class="status wait">Está tardando más de lo normal. Revisa la issue en GitHub.</div>';
      tfAnunciar("La búsqueda de alojamiento está tardando más de lo normal.");
      return;
    }
    let data = null;
    try {
      data = await fetchJSON(`data/stays/${id}.json`);
    } catch {
      return; // todavia no esta publicado: se reintenta en la siguiente vuelta
    }
    clearInterval(pollTimer);
    pintarStays(data, OFFERS.find((o) => o.id === id) || SEARCH_OFFERS[id]);
    const cuantos = (data && data.stays ? data.stays.length : 0);
    // Y sobre todo: decir que ha TERMINADO. Es la mitad que siempre se olvida.
    tfAnunciar(
      cuantos
        ? `Búsqueda de alojamiento terminada: ${cuantos} alojamiento${cuantos === 1 ? "" : "s"}.`
        : "Búsqueda de alojamiento terminada: no se encontró nada para esas fechas."
    );
  }, POLL_EVERY_MS);
}

function stayRow(s) {
  const meta = [s.provider, s.rating ? `valoración ${s.rating}` : "", s.note]
    .filter(Boolean)
    .join(" · ");
  const precio = s.price_total
    ? `<div class="amount-s">${fmtEUR(s.price_total)}<small>${
        s.price_per_night ? `${fmtEUR(s.price_per_night)} la noche` : ""
      }</small></div>`
    : `<div class="amount-s link-tag">abrir</div>`;
  return `
    <a class="stay" href="${escURL(s.url)}" target="_blank" rel="noopener">
      ${(() => {
        // Una imagen con un esquema raro no se pinta: `src="#"` haria que el
        // navegador se pidiera la propia pagina como si fuera un JPEG.
        const img = escURL(s.image);
        return img && img !== "#" ? `<img src="${img}" alt="" loading="lazy">` : "";
      })()}
      <div>
        <div class="name">${esc(s.name)}</div>
        <div class="meta">${esc(meta)}</div>
      </div>
      ${precio}
    </a>`;
}

export function desde(iso) {
  const dias = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
  if (!Number.isFinite(dias)) return "";
  return dias <= 0 ? "hoy" : dias === 1 ? "ayer" : `hace ${dias} días`;
}

/* El numero que nadie te da: lo que sale la escapada entera, por cabeza.
   Lo calcula scan-stays (vuelos x personas + una cama para todos) y viaja en
   `summary`. Esta funcion se llamaba desde renderStays y no existia, asi que
   en cuanto llegaban resultados de alojamiento el panel reventaba entero con
   "tripTotal is not defined" y no se veia ni un hotel. */
function tripTotal(resumen) {
  if (!resumen || !resumen.total) return "";
  const filas = [
    resumen.flights ? `vuelos ${fmtEUR(resumen.flights)}` : "",
    resumen.stay ? `alojamiento ${fmtEUR(resumen.stay)}` : "",
  ].filter(Boolean);
  return `
    <div class="total">
      <p class="total-head">El viaje completo${
        resumen.party ? ` para ${resumen.party} persona${resumen.party > 1 ? "s" : ""}` : ""
      }</p>
      <p class="total-figure">${fmtEUR(resumen.per_person)}<span>por persona</span></p>
      <p class="total-break">${fmtEUR(resumen.total)} en total${
        filas.length ? ` · ${filas.join(" + ")}` : ""
      }${
        resumen.per_person_night ? ` · ${fmtEUR(resumen.per_person_night)} por persona y noche` : ""
      }${
        resumen.cost_per_useful_hour
          ? ` · ${fmtEUR(resumen.cost_per_useful_hour)} por hora útil en destino`
          : ""
      }</p>
    </div>`;
}

function renderStays(data) {
  const stays = data.stays || [];
  const priced = stays.filter((s) => s.price_total);
  const links = stays.filter((s) => !s.price_total);
  const offer =
    OFFERS.find((o) => o.id === data.offer_id) ||
    SEARCH_OFFERS[data.offer_id] ||
    (data.offer && data.offer.id ? data.offer : null);

  $("#panelBody").innerHTML = `
    ${tripTotal(data.summary)}
    <div class="rescan">
      <span>${priced.length} alojamientos · buscado ${esc(desde(data.generated_at))}${
        data.summary?.party ? ` para ${data.summary.party}` : ""
      }</span>
      <button class="btn ghost small" id="rescan">Volver a buscar</button>
    </div>
    ${priced.map(stayRow).join("")}
    ${links.length ? "<h3>Seguir buscando</h3>" : ""}
    ${links.map(stayRow).join("")}`;

  // Los resultados se quedan guardados hasta que pasa la fecha del viaje;
  // este boton es la unica forma de forzar un scrapeo nuevo.
  if (offer) {
    $("#rescan").addEventListener("click", () =>
      askForSearch(
        offer,
        `<p>Se volverá a buscar y los resultados actuales se reemplazarán.</p>`
      )
    );
  }
}

