/* ofertas.js — La hoja del dia: cargar el scan, filtrar, y pintar la plancha y el indice. */

import {
  $,
  CONTINENTES,
  DAYS,
  SEARCH_OFFERS,
  esc,
  escURL,
  existe,
  fetchJSON,
  fmtDate,
  fmtEUR,
  parseISO,
} from "./base.js";
import {
  edreamsURL,
  escapadaHTML,
  grupo,
  pax,
  ponerCamas,
  ponerGrupo,
  precioCorto,
  precioHTML,
} from "./precios.js";
import { deltaHTML, favBtn, sincronizarFavs, wireFavs } from "./favoritos.js";
import { HISTORIA, cargarHistoria, historiaHTML } from "./historia.js";
import { openStays } from "./alojamiento.js";

export let OFFERS = [];

/* ------------------------------------------------------------------ ofertas */

/* El esqueleto de carga se quita pase lo que pase: si se queda puesto porque
   los datos fallaron, la pagina se pasa la vida diciendo que esta trabajando. */
function dejarDeCargar(motivo = "") {
  const caja = $("#cargando");
  if (!caja) return;
  if (!motivo) {
    caja.remove();
    return;
  }
  caja.removeAttribute("aria-busy");
  caja.innerHTML = `<p class="vacio">${esc(motivo)}</p>`;
}

export async function init() {
  let payload;
  try {
    payload = await fetchJSON("data/offers.json");
  } catch {
    if (existe("#stats")) $("#stats").innerHTML = statBlock("estado", "sin datos aún");
    dejarDeCargar(
      "No se han podido leer los precios. Puede ser tu conexión, o que el último " +
        "scan no llegara a publicar. Vuelve a cargar en un rato."
    );
    return;
  }
  dejarDeCargar();
  frescura(payload.generated_at);

  OFFERS = payload.offers || [];
  renderStats(payload);
  sincronizarFavs(OFFERS);

  if (payload.errors?.length) {
    const box = $("#errors");
    box.hidden = false;
    box.querySelector("ul").innerHTML = payload.errors.map((e) => `<li>${esc(e)}</li>`).join("");
  }
  if (!OFFERS.length || !existe("#offers")) return;

  const maxPrice = Math.max(60, ...OFFERS.map((o) => o.price));
  const priceInput = $("#price");
  priceInput.max = Math.ceil(maxPrice / 10) * 10;
  priceInput.value = priceInput.max;
  $("#priceOut").textContent = priceInput.value;
  pintarRegla(priceInput);

  // El continente no viene en la oferta: se cruza con un mapa aparte.
  //
  // Antes se cargaba `airports_world.json` entero —270 KB— y de todo eso solo
  // se usaba el continente de cada codigo. Con `offers.json` al lado eran casi
  // 450 KB de JSON para pintar 120 filas, en un movil y antes de ver nada. El
  // listado completo se sigue cargando, pero solo al abrir el selector de
  // destinos, que es donde de verdad hacen falta ciudad y pais.
  //
  // El fichero viene agrupado por continente y con los codigos pegados en una
  // sola cadena, que es lo que lo deja en 10 KB en vez de 61: los codigos IATA
  // miden siempre tres letras, asi que se parte de tres en tres.
  // Lo que costo dormir en cada sitio. Si no esta, simplemente no se estima.
  try {
    ponerCamas(await fetchJSON("data/camas.json"));
  } catch {
    ponerCamas(null);
  }

  try {
    const mapa = await fetchJSON("data/continentes.json");
    for (const [continente, codigos] of Object.entries(mapa)) {
      for (let i = 0; i < codigos.length; i += 3) {
        CONTINENTES[codigos.slice(i, i + 3)] = continente;
      }
    }
    const presentes = [...new Set(OFFERS.map((o) => CONTINENTES[o.destination]).filter(Boolean))].sort();
    const hayLejos = OFFERS.some((o) => o.long_haul);
    $("#cont").insertAdjacentHTML(
      "beforeend",
      (hayLejos ? '<option value="__lejos__">Otros continentes</option>' : "") +
        presentes.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("")
    );
  } catch {
    $("#cont").parentElement.hidden = true;
  }

  $(".controls").hidden = false;
  ["#q", "#sort", "#price", "#unique", "#onlyWeekend", "#cont"].forEach((s) => $(s).addEventListener("input", render));

  // El scan diario guarda el precio de UNA persona (asi el historico es
  // comparable de un dia para otro). Este selector no vuelve a buscar: solo
  // multiplica lo que ya hay, y por eso las cifras salen con "≈" delante.
  const selector = $("#grupo");
  if (selector) {
    selector.value = String(grupo());
    selector.addEventListener("change", () => {
      // Lo guarda `precios.js`: un modulo no puede asignar a lo que importa.
      ponerGrupo(selector.value);
      render();
    });
  }
  render();

  const target = new URLSearchParams(location.search).get("offer");
  if (target) {
    ensureVisible(target);
    focusOffer(target);
  }
}

const statBlock = (label, value, hot = false) =>
  `<div><dt>${esc(label)}</dt><dd class="${hot ? "hot" : ""}">${esc(value)}</dd></div>`;

/* Cuanto hace que se actualizo: sin esto no sabes si miras datos de hoy o de
   hace tres dias, que en precios de vuelo es toda la diferencia. */
function frescura(iso) {
  const el = document.getElementById("frescura");
  if (!el) return;
  const d = parseISO(iso);
  if (!d) {
    el.textContent = "sin datos todavía";
    return;
  }
  const horas = Math.round((Date.now() - d.getTime()) / 3600000);
  const texto =
    horas < 1 ? "hace menos de una hora" : horas < 24 ? `hace ${horas} h` : `hace ${Math.round(horas / 24)} días`;
  // Sin línea, lo que se ve es la última tanda guardada, y hay que decirlo: un
  // precio de anteayer con el aspecto de uno de hoy es peor que no tener nada.
  const deLaCaja = typeof tfEsDeLaCaja === "function" && tfEsDeLaCaja();
  el.textContent = deLaCaja
    ? `sin conexión · lo último guardado, ${texto}`
    : `levantamiento: ${texto} · se revisa cada 12 h`;
  el.className = deLaCaja || horas > 36 ? "viejo" : "";
}

function renderStats(payload) {
  if (!existe("#stats")) return;
  const best = OFFERS.reduce((a, o) => (o.discount_pct > (a?.discount_pct ?? -1) ? o : a), null);
  const findes = OFFERS.filter((o) => o.weekend).length;
  $("#stats").innerHTML =
    statBlock("ofertas vivas", OFFERS.length) +
    (best ? statBlock("mejor descuento", `−${Math.round(best.discount_pct)}%`, true) : "") +
    (best ? statBlock("desde", fmtEUR(Math.min(...OFFERS.map((o) => o.price)))) : "") +
    statBlock("escapadas de finde", findes) +
    statBlock("actualizado", fmtDate(payload.generated_at) || "hoy");
}

function currentList() {
  const q = $("#q").value.trim().toLowerCase();
  const max = Number($("#price").value);
  const sort = $("#sort").value;

  const soloFindes = $("#onlyWeekend").checked;
  const continente = $("#cont").value;
  // Europa y el largo radio no compiten en la misma lista: un vuelo a Bangkok
  // nunca puntuara como un finde a Bergamo, asi que van en secciones aparte.
  const lejos = $("#cont").value === "__lejos__";
  const list = OFFERS.filter(
    (o) =>
      o.price <= max &&
      (!soloFindes || o.weekend) &&
      (lejos ? o.long_haul : !continente || CONTINENTES[o.destination] === continente) &&
      (lejos || !o.long_haul) &&
      (!q ||
        `${o.destination_name} ${o.destination} ${o.destination_country}`.toLowerCase().includes(q))
  );

  const by = {
    score: (a, b) => b.score - a.score || a.price - b.price,
    price: (a, b) => a.price - b.price,
    date: (a, b) => a.depart_date.localeCompare(b.depart_date),
    hours: (a, b) => (a.price_per_hour || 99) - (b.price_per_hour || 99),
  }[sort];
  list.sort(by);

  // El barrido de findes devuelve la misma ciudad una vez por fin de semana:
  // por defecto se muestra solo la mejor de cada destino.
  if ($("#unique").checked) {
    const visto = new Set();
    return list.filter((o) => !visto.has(o.destination) && visto.add(o.destination));
  }
  return list;
}

function escalas(o) {
  if (o.hidden_city) return `te bajas en la escala (billete a ${esc(o.hidden_city_ticket_to)})`;
  return o.stops ? `${o.stops} escala${o.stops > 1 ? "s" : ""}` : "directo";
}

/* El aviso no es decorativo: sin equipaje facturado y sin vuelta, esto sale
   caro si te pilla por sorpresa. */
const AVISO_HIDDEN = `
  <div class="hidden-warn">
    <strong>Te bajas en la escala.</strong> El billete va más lejos y tú te quedas aquí.
    Es legal, pero: <b>solo ida</b> (la aerolínea cancela el resto del billete, así que
    no vale para ida y vuelta), <b>sin equipaje facturado</b> (la maleta sigue al destino
    final) y sin tarjeta de fidelización, que algunas compañías cierran cuentas.
  </div>`;

function leg(label, iso, sale, llega, highlight) {
  if (!iso) return "";
  // Google no publica el horario del vuelo de vuelta en su listado: mejor
  // decirlo que dejar un hueco que parece un fallo.
  const horario = sale
    ? `${esc(sale)}${llega ? ` → ${esc(llega)}` : ""}`
    : "<i>horario en el enlace</i>";
  return `<div><dt>${label}</dt><dd class="${highlight ? "weekend" : ""}">${fmtDate(iso, true)}
    ${horario ? `<span class="hhmm">${horario}</span>` : ""}</dd></div>`;
}

function altsHTML(o) {
  if (!(o.alternatives || []).length) return "";
  const links = o.alternatives
    .map((a) => {
      // La alternativa se busco para la misma gente que la ganadora, asi que
      // su precio se reparte igual y las dos cifras son comparables.
      const gente = Math.max(1, Number(a.adults) || pax(o));
      const uno = Number(a.price_per_person) || a.price / gente;
      const cifra = gente > 1 ? `${fmtEUR(a.price)} (${Math.round(uno)} €/p)` : fmtEUR(a.price);
      return `<a href="${escURL(a.deep_link)}" target="_blank" rel="noopener">${esc(
        a.airline
      )} ${cifra}${a.depart_time ? ` (sale ${esc(a.depart_time)})` : ""}</a>`;
    })
    .join(" · ");
  return `<div class="alts">también ${links}</div>`;
}

/* LA PLANCHA. El destino del dia no es una tarjeta: es la lamina de un atlas.
   Regla mayor arriba con su cuadratin rojo, el toponimo grande en serif ligero,
   la referencia de cuadricula y la cifra en rojo a la derecha, y debajo la
   tabla reglada con los tramos. Sin fondo, sin marco, sin talon, sin troquel:
   lo que la delimita es la regla, igual que en una plancha impresa. */
function heroTicket(o) {
  const sub = [o.destination_country, o.airline, escalas(o), o.weekend ? "escapada de finde" : ""]
    .filter(Boolean)
    .join(" · ");
  const extra = [o.hidden_city ? AVISO_HIDDEN : "", altsHTML(o)].filter(Boolean).join("");
  return `
    <article class="ticket" id="offer-${esc(o.id)}">
      <span class="regla" aria-hidden="true"></span>
      <div class="ticket-top">
        <span class="kicker-tag">hoja del día · ${o.return_date ? "ida y vuelta" : "solo ida"}</span>
        <span class="ticket-ref">
          <span class="codes">${esc(o.origin)} — ${esc(o.destination)}</span>
          ${favBtn(o)}
        </span>
      </div>
      <div class="ticket-cab">
        <h2 class="dest">${esc(o.destination_name || o.destination)}<small>${esc(sub)}</small></h2>
        <div class="ticket-precio">
          ${
            o.discount_pct >= 5
              ? `<span class="stamp">chollo<b>−${Math.round(o.discount_pct)}%</b></span>`
              : ""
          }
          ${precioHTML(o, { grande: true })}
          <span class="ticket-notas">
            ${o.baseline > o.price ? `<s class="was">${fmtEUR(o.baseline)}</s>` : ""}
            <span class="per-person">vuelo completo${o.return_date ? ", ida y vuelta" : ""}</span>
          </span>
          ${escapadaHTML(o)}
        </div>
      </div>
      <dl class="legs">
        ${leg("Ida", o.depart_date, o.depart_time, o.arrive_time, o.weekend)}
        ${leg("Vuelta", o.return_date, o.return_time, o.return_arrive_time, o.weekend)}
        ${o.nights ? `<div><dt>Noches</dt><dd>${o.nights}</dd></div>` : ""}
        ${
          o.useful_hours
            ? `<div><dt>Viaje real</dt><dd class="useful">${Math.round(
                o.useful_hours
              )} h · ${o.price_per_hour} €/h</dd></div>`
            : ""
        }
      </dl>
      ${extra ? `<div class="hero-extra">${extra}</div>` : ""}
      <div class="actions">
        <button class="btn primary" data-stay="${esc(o.id)}">Buscar alojamiento</button>
        <a class="btn ghost" href="${escURL(o.deep_link)}" target="_blank" rel="noopener">Ver vuelo</a>
        ${
          o.airline_link
            ? `<a class="btn ghost" href="${escURL(o.airline_link)}" target="_blank" rel="noopener">
                 Reservar en ${esc(o.airline_link_label || o.airline)}</a>`
            : ""
        }
      </div>
    </article>`;
}

/* El resto, como el panel de salidas de un aeropuerto: una línea por vuelo. */
export function boardRow(o, i) {
  // Si ida y vuelta caen en el mismo mes, el mes no se repite: "vie 13 nov → dom 15".
  const mismoMes = o.return_date && o.return_date.slice(0, 7) === o.depart_date.slice(0, 7);
  const vueltaTxt = o.return_date
    ? mismoMes
      ? `${DAYS[parseISO(o.return_date).getDay()]} ${parseISO(o.return_date).getDate()}`
      : fmtDate(o.return_date, true)
    : "";
  const hora = o.depart_time ? ` ${esc(o.depart_time)}` : "";
  const horaVuelta = o.return_time ? ` ${esc(o.return_time)}` : "";
  const vuelta = vueltaTxt
    ? ` → <b>${vueltaTxt}</b>${horaVuelta || " <i>(hora en el enlace)</i>"}`
    : "";
  return `
    <div class="brow" id="offer-${esc(o.id)}" data-open="${esc(o.id)}" role="button" tabindex="0"
         style="animation-delay:${Math.min(i, 14) * 35}ms">
      <span class="iata ${o.hidden_city ? "hidden" : ""}">${esc(o.destination)}</span>
      <span class="dest-cell">
        <span class="city">${esc(o.destination_name || o.destination)}</span>
        <span class="country">${esc(o.destination_country || "")}</span>
      </span>
      <span class="when ${o.weekend ? "weekend" : ""}"><b>${fmtDate(
        o.depart_date,
        true
      )}</b>${hora}${vuelta}${
        o.nights ? `<small>${o.nights} noches</small>` : ""
      }</span>
      <span class="airline">${esc(o.airline || o.provider)}<small>${escalas(o)}${
        o.useful_hours ? ` · ${Math.round(o.useful_hours)} h de viaje` : ""
      }${o.long_haul ? " · larga distancia" : ""}</small></span>
      <span class="leader" aria-hidden="true"></span>
      <span class="price">${precioCorto(o)}${
        o.discount_pct >= 5 ? `<small class="off">−${Math.round(o.discount_pct)}%</small>` : ""
      }${deltaHTML(o)}${escapadaHTML(o)}</span>
      ${favBtn(o)}
      <div class="brow-detail" hidden></div>
    </div>`;
}

/* Cualquier viaje se abre y enseña sus vuelos, no solo el destacado. */
function detalleHTML(o) {
  return `
    ${o.hidden_city ? AVISO_HIDDEN : ""}
    ${historiaHTML(o)}
    <dl class="legs">
      ${leg("Ida", o.depart_date, o.depart_time, o.arrive_time, o.weekend)}
      ${leg("Vuelta", o.return_date, o.return_time, o.return_arrive_time, o.weekend)}
      <div><dt>Vuelo</dt><dd>${escalas(o)}</dd></div>
      ${
        o.useful_hours
          ? `<div><dt>Viaje real</dt><dd class="useful">${Math.round(o.useful_hours)} h · ${
              o.price_per_hour
            } €/h</dd></div>`
          : ""
      }
    </dl>
    ${altsHTML(o)}
    <div class="actions">
      <a class="btn primary" href="${escURL(o.deep_link)}" target="_blank" rel="noopener">Ver vuelo</a>
      ${
        o.airline_link
          ? `<a class="btn ghost" href="${escURL(o.airline_link)}" target="_blank" rel="noopener">
               Reservar en ${esc(o.airline_link_label || o.airline)}</a>`
          : ""
      }
      <button class="btn ghost" data-stay="${esc(o.id)}">Buscar alojamiento</button>
      ${
        edreamsURL(o)
          ? `<a class="btn ghost" href="${escURL(edreamsURL(o))}" target="_blank" rel="noopener"
               title="Se abre con tu sesión: si tienes Prime, verás tu precio de socio"
               >Comparar en eDreams</a>`
          : ""
      }
    </div>`;
}

/* El detalle se pinta dos veces: una al abrirlo y otra cuando llega el
   historico de precios, asi que sus botones se cablean aparte. */
function wireDetalle(caja, o) {
  caja.querySelectorAll("[data-stay]").forEach((b) =>
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (!OFFERS.some((x) => x.id === o.id)) OFFERS.push(o);
      openStays(o.id);
    })
  );
}

function toggleRow(fila) {
  const caja = fila.querySelector(".brow-detail");
  if (!caja) return;
  if (!caja.hidden) {
    caja.hidden = true;
    fila.classList.remove("open");
    return;
  }
  const o = OFFERS.find((x) => x.id === fila.dataset.open) || SEARCH_OFFERS[fila.dataset.open];
  if (!o) return;
  caja.innerHTML = detalleHTML(o);
  caja.hidden = false;
  fila.classList.add("open");
  wireDetalle(caja, o);
  // history.json son 60 kB: se baja una sola vez, la primera fila que se abre
  // lo pide y el detalle se repinta solo cuando llega.
  if (!HISTORIA) {
    cargarHistoria().then(() => {
      if (caja.hidden) return;
      caja.innerHTML = detalleHTML(o);
      wireDetalle(caja, o);
    });
  }
}

export function wireRows(raiz = document) {
  wireFavs(raiz);
  raiz.querySelectorAll(".brow[data-open]").forEach((fila) => {
    fila.addEventListener("click", (ev) => {
      if (ev.target.closest("a, button")) return; // los enlaces hacen lo suyo
      toggleRow(fila);
    });
    fila.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        toggleRow(fila);
      }
    });
  });
}

/* El tope es una regla graduada: lo recorrido va en rojo y lo que queda en
   linea fina. El navegador no lo hace solo, asi que la proporcion se calcula
   aqui y la pinta el CSS. */
function pintarRegla(input) {
  if (!input) return;
  const min = Number(input.min) || 0;
  const span = (Number(input.max) || 100) - min || 1;
  const pct = ((Number(input.value) - min) / span) * 100;
  input.style.setProperty("--pct", `${Math.max(0, Math.min(100, pct))}%`);
}

export function render() {
  if (!existe("#offers")) return;
  $("#priceOut").textContent = $("#price").value;
  pintarRegla($("#price"));
  const list = currentList();

  $("#hero").innerHTML = list.length ? heroTicket(list[0]) : "";
  $("#hero").hidden = !list.length;
  $("#offers").innerHTML = list.slice(1).map(boardRow).join("");
  $("#boardHead").hidden = list.length < 2;
  $("#empty").hidden = list.length > 0;

  document.querySelectorAll(".hero [data-stay]").forEach((el) =>
    el.addEventListener("click", () => openStays(el.dataset.stay))
  );
  wireFavs($("#hero"));
  wireRows();
}

function focusOffer(id) {
  const el = document.getElementById(`offer-${id}`);
  if (!el) return;
  el.classList.add("target");
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  openStays(id);
}

/* El enlace del email apunta a una oferta concreta: si los filtros la dejarían
   fuera (por precio o por "una por destino"), se relajan para poder enseñarla. */
function ensureVisible(id) {
  if (document.getElementById(`offer-${id}`)) return;
  const o = OFFERS.find((x) => x.id === id);
  if (!o) return;
  if (o.price > Number($("#price").value)) $("#price").value = $("#price").max;
  $("#unique").checked = false;
  $("#q").value = "";
  render();
}

