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
import { wireCompartir } from "./compartir.js";
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

/* --------------------------------------------- las camas que ya has buscado

   Buscar cama cuesta tres minutos de workflow y el resultado se guarda para
   siempre en `data/stays/<id>.json`. Lo que no habia era forma de VOLVER: el
   unico boton que abria la hoja vivia en el tablon de chollos, y el tablon se
   renueva dos veces al dia. Al dia siguiente el vuelo ya no estaba, el boton
   tampoco, y lo buscado quedaba ahi sin que nadie pudiera verlo.

   Se apunta en el navegador, con el espacio de nombres de la cuenta, como los
   favoritos: es tuyo y no tiene por que salir publicado en el repositorio. */
const CAMAS_KEY = tfClave("tf_camas");
export const MAX_CAMAS = 12;

export const camasBuscadas = () => {
  try {
    return JSON.parse(localStorage.getItem(CAMAS_KEY) || "[]");
  } catch {
    return [];
  }
};

export function recordarCama(id, offer) {
  if (!id || !offer) return;
  try {
    const lista = camasBuscadas().filter((c) => c.id !== id);
    lista.unshift({
      id,
      ciudad: offer.destination_name || offer.destination || "",
      ida: offer.depart_date || "",
      vuelta: offer.return_date || "",
      cuando: Date.now(),
    });
    localStorage.setItem(CAMAS_KEY, JSON.stringify(lista.slice(0, MAX_CAMAS)));
  } catch {
    /* navegacion privada: dura lo que la pestaña */
  }
}

/* Y las que ha buscado CUALQUIERA, que es lo que hay publicado.

   `tf_camas` vive en tu navegador: se borra al limpiar el historial, no llega
   a tu movil y no sabe nada de lo que buscaron los demas. Pero el resultado si
   esta publicado —`data/stays/<id>.json`— y abrirlo es instantaneo. El indice
   es la lista de esos ficheros, que escribe el backend de la misma pasada con
   la que destila `camas.json`, asi que marcar una fila no cuesta una peticion
   por vuelo. */
export const CAMAS_PUBLICAS = {};

export async function cargarCamasHechas() {
  try {
    const { viajes } = await fetchJSON("data/stays/index.json");
    Object.entries(viajes || {}).forEach(([id, v]) => {
      CAMAS_PUBLICAS[id] = v;
      // Si el fichero trae el precio de la escapada entera, la fila ya puede
      // decir el numero REAL sin abrir el panel: hasta ahora solo lo sabia
      // quien lo hubiera abierto en esa misma sesion.
      if (v && v.t > 0 && !ESCAPADAS_REALES[id]) ESCAPADAS_REALES[id] = { total: v.t };
    });
  } catch {
    /* sin indice, solo se marcan las tuyas */
  }
}

/* Si este vuelo ya tiene cama buscada: la tuya o la de cualquiera. */
export const conCama = (id) =>
  Boolean(id) && (Boolean(CAMAS_PUBLICAS[id]) || camasBuscadas().some((c) => c.id === id));

/* Un viaje que ya ha pasado no hay donde dormirlo. */
export const camasVivas = (hoy = new Date().toISOString().slice(0, 10)) =>
  camasBuscadas().filter((c) => !c.ida || c.ida >= hoy);

/* La cabecera dice PARA CUANTOS se ha buscado en cuanto se sabe. Una cama de
   119 € no significa nada sin saber si es para dos o para cuatro, y ese numero
   lo eliges tu al lanzarla: callarlo despues deja el precio a medias. */
let OFERTA_ABIERTA = null;

function ponerFechas(offer, para = 0) {
  if (!offer) return;
  $("#panelDates").textContent =
    `${fmtDate(offer.depart_date, true)}${offer.return_date ? ` → ${fmtDate(offer.return_date, true)}` : ""}` +
    `${offer.nights ? ` · ${offer.nights} noches` : ""}` +
    `${para > 0 ? ` · para ${para}` : ""}`;
}

export async function openStays(id, conocida = null) {
  /* EL VUELO PUEDE HABERSE IDO DEL TABLON y la cama seguir buscada. El barrido
     publica una tanda nueva dos veces al dia, asi que el vuelo para el que
     esperaste tres minutos a que se buscara cama deja de estar en `OFFERS` al
     dia siguiente. Antes esto era `if (!offer) return;`: la hoja no se abria,
     sin decir nada, y lo ya buscado quedaba inalcanzable.

     El fichero de la busqueda lleva dentro el vuelo entero (`data.offer`), asi
     que con el id basta para volver a abrirla. */
  let offer = OFFERS.find((o) => o.id === id) || SEARCH_OFFERS[id] || conocida || null;

  abrirPanel();
  $("#panelTitle").textContent = offer
    ? offer.destination_name || offer.destination
    : "Alojamiento";
  if (offer) ponerFechas(offer);
  $("#panelBody").innerHTML = '<p class="status">Comprobando si ya hay resultados…</p>';

  let datos = null;
  try {
    datos = await fetchJSON(`data/stays/${id}.json`);
  } catch {
    if (!offer) {
      // Ni vuelo ni fichero: no hay nada que enseñar, y callarse es lo que
      // hacia que el boton pareciera roto.
      $("#panelBody").innerHTML = `
        <div class="status wait">
          <p>Este vuelo ya no está en la tanda de hoy y no hay ninguna búsqueda de
          alojamiento guardada para él.</p>
          <p class="meta">Los precios de los vuelos cambian cada doce horas; búscalo otra
          vez desde Buscar y podrás pedir cama para las fechas nuevas.</p>
        </div>`;
      return;
    }
    askForSearch(offer); // todavia no se ha buscado para estas fechas
    return;
  }

  // El fichero manda: lleva el vuelo tal y como estaba cuando se busco la cama,
  // que es con el que cuadra el resumen de precios que se va a pintar debajo.
  if (datos && datos.offer) offer = { ...offer, ...datos.offer };
  OFERTA_ABIERTA = offer;
  $("#panelTitle").textContent = offer.destination_name || offer.destination;
  ponerFechas(offer);
  recordarCama(id, offer);
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
      <p class="party-nota">El vuelo es por persona y la cama es para el grupo: el número
        cambia el precio, así que viaja en la petición.</p>
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
      ponerFechas(offer, adultos);
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

/* Tres huecos barriendo mientras se busca. No es adorno: dicen QUE VAN A SALIR
   FILAS y cuantas caben, asi que al llegar el resultado la hoja no da un salto
   de vacia a llena. Con una sola linea de texto quedaba un palmo de nada debajo
   y parecia que se habia colgado.

   Se exporta para poder comprobar lo que se pinta DE VERDAD: el camino que
   lleva aqui pasa por un dispatch autenticado, que en una prueba no se puede
   recorrer sin inventarse media sesion. */
export function buscandoHTML() {
  return `
    <div class="buscando">
      <p class="buscando-linea"><span class="spin"></span>buscando cama… 2-3 minutos</p>
      <div class="esqueleto" aria-hidden="true"><i></i><i></i><i></i></div>
      <p class="buscando-nota">Puedes cerrar esta hoja y volver luego: el resultado se guarda y la
        próxima vez sale al momento. Si tarda más de quince minutos se te dice, no se queda
        girando.</p>
    </div>`;
}

function startPolling(id) {
  clearInterval(pollTimer);
  const started = Date.now();
  $("#panelBody").innerHTML = buscandoHTML();
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

/* La ficha de una cama va SIN FOTO a propósito. Lo que decide dónde duermes en
   una escapada de dos noches es el precio total, de quién es y a qué distancia
   del centro cae; una foto de 300 px de un salón no ayuda a elegir y empuja el
   resto fuera de la pantalla. */
function stayRow(s) {
  const meta = [
    s.provider,
    s.rating ? `valoración ${s.rating}` : "",
    // Lo que antes no se decía: un estudio a doce kilómetros del centro no es
    // más barato que uno normal y céntrico, es otro viaje.
    aPie(s.km_centro),
    s.note,
  ]
    .filter(Boolean)
    .join(" · ");
  return `
    <a class="stay" href="${escURL(s.url)}" target="_blank" rel="noopener">
      <div>
        <div class="name">${esc(s.name)}</div>
        <div class="meta">${esc(meta)}</div>
        ${s.sello ? `<span class="sello${s.sello.startsWith("el más") ? " bueno" : ""}">${esc(s.sello)}</span>` : ""}
      </div>
      <div class="amount-s">${fmtEUR(s.price_total)}<small>${
        s.price_per_night ? `${fmtEUR(s.price_per_night)} la noche` : ""
      }</small></div>
    </a>`;
}

/* «a 12 min andando», «a 4,2 km». Lo mismo que dice el backend en el log, para
   que la web y el barrido cuenten la distancia igual. */
function aPie(km) {
  if (km === null || km === undefined || !Number.isFinite(Number(km))) return "";
  const n = Number(km);
  if (n <= 3.5) return `a ${Math.max(1, Math.round((n / 4.8) * 60))} min andando del centro`;
  return `a ${n.toFixed(1).replace(".", ",")} km del centro`;
}

/* Los comparadores no dan precio: son enlaces con las fechas ya puestas, así
   que son pastillas y no fichas. Como fichas ocupaban lo mismo que un hotel
   real y prometían un precio que no traían. */
function enlacesHTML(links) {
  if (!links.length) return "";
  return `
    <div class="seguir-buscando">
      <h3>Seguir buscando</h3>
      <p class="vacio">De estos no se saca precio: se abren con las fechas ya puestas.</p>
      <div class="seguir-pills">
        ${links
          .map(
            (s) =>
              `<a class="btn ghost" href="${escURL(s.url)}" target="_blank" rel="noopener">${esc(
                s.name.replace(/^Buscar en\s*/i, "")
              )}</a>`
          )
          .join("")}
      </div>
    </div>`;
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
  ponerFechas(OFERTA_ABIERTA, Number(data.summary && data.summary.party) || 0);
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
    ${enlacesHTML(links)}
    ${
      offer
        ? `<div class="escapada-compartir">
             <button class="btn primary" data-share="${esc(offer.id)}">Compartir la escapada</button>
             <span>El enlace lleva el viaje y el número real, ya sin el ≈.</span>
           </div>`
        : ""
    }`;

  // Los resultados se quedan guardados hasta que pasa la fecha del viaje;
  // este boton es la unica forma de forzar un scrapeo nuevo.
  if (offer) {
    wireCompartir($("#panelBody"), () => offer);
    $("#rescan").addEventListener("click", () =>
      askForSearch(
        offer,
        `<p>Se volverá a buscar y los resultados actuales se reemplazarán.</p>`
      )
    );
  }
}

