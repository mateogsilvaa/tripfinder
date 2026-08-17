/* TripFinder — frontend estatico. Lee los JSON que commitea GitHub Actions. */

const REPO = "mateogsilvaa/tripfinder";
const POLL_EVERY_MS = 20000;
// 45 vueltas x 20 s = 15 min, de sobra para una busqueda de las largas.
const MAX_VUELTAS = 45;
const POLL_MAX_MS = 15 * 60 * 1000;

const $ = (sel) => document.querySelector(sel);
/* La web esta partida en tres zonas y cada pagina solo tiene su parte, asi que
   engancharse a un elemento que no existe no puede tumbar el resto. */
const on = (sel, evento, fn) => {
  const el = document.querySelector(sel);
  if (el) el.addEventListener(evento, fn);
};
const existe = (sel) => !!document.querySelector(sel);
const fmtEUR = (n) => `${Math.round(n)} €`;
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

function parseISO(iso) {
  const [y, m, d] = (iso || "").split("-").map(Number);
  return y ? new Date(y, m - 1, d) : null;
}

function fmtDate(iso, withDay = false) {
  const d = parseISO(iso);
  if (!d) return "";
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return withDay ? `${DAYS[d.getDay()]} ${base}` : base;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

/* Cache-buster: Pages sirve los JSON con cache agresiva y aqui siempre queremos lo ultimo. */
const fetchJSON = (path) =>
  fetch(`${path}${path.includes("?") ? "&" : "?"}t=${Date.now()}`, { cache: "no-store" }).then((r) => {
    if (!r.ok) throw new Error(r.status);
    return r.json();
  });

let OFFERS = [];
let CONTINENTES = {}; // IATA -> continente, para filtrar
const SEARCH_OFFERS = {}; // ofertas de busquedas guardadas, por id

/* --------------------------------------------------------------- disparador
   Para lanzar un scraper hace falta que corra algo fuera del navegador. En vez
   de abrir una issue (que era un rodeo horrible), la web llama directamente a
   la API de GitHub con un token que se guarda SOLO en este navegador
   (localStorage) y no viaja a ningun sitio que no sea api.github.com. */
const TOKEN_KEY = "tf_token";
const getToken = () => localStorage.getItem(TOKEN_KEY) || "";

async function dispatch(evento, payload) {
  const token = getToken();
  if (!token) return { ok: false, reason: "sin-token" };
  const r = await fetch(`https://api.github.com/repos/${REPO}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ event_type: evento, client_payload: payload }),
  });
  if (r.status === 204) return { ok: true };

  let detalle = "";
  try {
    detalle = (await r.json()).message || "";
  } catch {
    /* GitHub no siempre contesta con JSON */
  }
  if (r.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    return { ok: false, reason: "token-invalido" };
  }
  if (r.status === 403 || r.status === 404) {
    // 404 aqui casi siempre es un token sin permiso sobre el repo, no un repo
    // inexistente: GitHub lo disfraza para no filtrar repos privados.
    return {
      ok: false,
      reason:
        `${r.status}: al token le falta permiso "Contents: Read and write" sobre ` +
        `${REPO}, o no le has dado acceso a este repositorio. ${detalle}`,
      _apuntado: typeof tfApuntar === "function" && tfApuntar("token", `${evento}: ${r.status}`, detalle),
    };
  }
  if (typeof tfApuntar === "function") tfApuntar("dispatch", `${evento}: ${r.status}`, detalle);
  return { ok: false, reason: `error ${r.status}. ${detalle}` };
}

/* Prueba el token contra un endpoint inofensivo y dice exactamente que pasa.
   Sin esto, un permiso mal puesto se manifiesta como "el boton no hace nada". */
async function probarToken() {
  const token = getToken();
  if (!token) return "No hay ningún token guardado en este navegador.";
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    if (r.status === 200) {
      const permisos = r.headers.get("x-accepted-github-permissions") || "";
      const d = await dispatch("ping", { origen: "prueba" });
      return d.ok
        ? "Token correcto y con permiso para lanzar búsquedas. ✓"
        : `El token lee el repo, pero no puede lanzar búsquedas → ${d.reason}` +
          (permisos ? ` (GitHub espera: ${permisos})` : "");
    }
    if (r.status === 401) return "Token inválido o caducado (401). Crea uno nuevo.";
    if (r.status === 404)
      return (
        "404: el token no tiene acceso a este repositorio. Al crearlo hay que elegir " +
        `"Only select repositories" → ${REPO}, no "Public repositories".`
      );
    return `GitHub responde ${r.status}.`;
  } catch (err) {
    return `No se pudo contactar con GitHub: ${err.message}`;
  }
}

function tokenBox(alTerminar) {
  const nuevo = `https://github.com/settings/personal-access-tokens/new`;
  return {
    html: `
      <div class="token-box">
        <strong>Una sola vez:</strong> pega aquí un token de GitHub para que la web
        pueda lanzar los scrapers sola, sin abrir issues.
        <a href="${nuevo}" target="_blank" rel="noopener">Crear token</a>
        (fine-grained, solo este repo, permiso <em>Contents: Read and write</em>).
        <input type="password" id="tokenInput" placeholder="github_pat_…" autocomplete="off">
        <button class="btn ghost small" id="tokenSave">Guardar en este navegador</button>
        <button class="btn ghost small" id="tokenTest">Probar conexión</button>
        <p class="token-status" id="tokenStatus"></p>
      </div>`,
    wire: () => {
      const guardar = document.getElementById("tokenSave");
      const probar = document.getElementById("tokenTest");
      const estado = document.getElementById("tokenStatus");
      if (guardar) {
        guardar.addEventListener("click", () => {
          const v = document.getElementById("tokenInput").value.trim();
          if (!v) return;
          localStorage.setItem(TOKEN_KEY, v);
          alTerminar();
        });
      }
      if (probar) {
        probar.addEventListener("click", async () => {
          const v = document.getElementById("tokenInput").value.trim();
          if (v) localStorage.setItem(TOKEN_KEY, v);
          estado.textContent = "Probando…";
          estado.textContent = await probarToken();
        });
      }
    },
  };
}

/* ------------------------------------------------------------------ ofertas */
async function init() {
  let payload;
  try {
    payload = await fetchJSON("data/offers.json");
  } catch {
    if (existe("#stats")) $("#stats").innerHTML = statBlock("estado", "sin datos aún");
    return;
  }
  frescura(payload.generated_at);

  OFFERS = payload.offers || [];
  renderStats(payload);

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

  // El continente no viene en la oferta: se cruza con el listado de aeropuertos.
  try {
    const aer = await fetchJSON("data/airports_world.json");
    aer.forEach((a) => (CONTINENTES[a.code] = a.cont));
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
  render();

  const target = new URLSearchParams(location.search).get("offer");
  if (target) {
    ensureVisible(target);
    focusOffer(target);
  }
}

const statBlock = (label, value, hot = false) =>
  `<div><dd class="${hot ? "hot" : ""}">${esc(value)}</dd><dt>${esc(label)}</dt></div>`;

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
  el.textContent = `Actualizado ${texto} · se revisa cada 12 h`;
  el.className = horas > 36 ? "viejo" : "";
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
    .map(
      (a) =>
        `<a href="${esc(a.deep_link)}" target="_blank" rel="noopener">${esc(a.airline)} ${fmtEUR(
          a.price
        )}${a.depart_time ? ` (sale ${esc(a.depart_time)})` : ""}</a>`
    )
    .join(" · ");
  return `<div class="alts">también ${links}</div>`;
}

/* El mejor chollo se lleva un billete entero: es lo primero que hay que ver. */
function heroTicket(o) {
  const sub = [o.destination_country, o.airline, escalas(o), o.weekend ? "escapada de finde" : ""]
    .filter(Boolean)
    .join(" · ");
  return `
    <article class="ticket" id="offer-${esc(o.id)}">
      <div class="stub">
        <span class="kicker-tag">${o.return_date ? "ida y vuelta" : "solo ida"}</span>
        <span class="amount">${Math.round(o.price)}<span>€</span></span>
        ${o.baseline > o.price ? `<span class="was">${fmtEUR(o.baseline)}</span>` : ""}
        <span class="per-person">vuelo completo, 1 adulto</span>
      </div>
      <div class="hero-body">
        ${o.hidden_city ? AVISO_HIDDEN : ""}
        ${
          o.discount_pct >= 5
            ? `<div class="stamp">chollo<b>−${Math.round(o.discount_pct)}%</b></div>`
            : ""
        }
        <div class="codes">${esc(o.origin)}<span class="line"></span>${esc(o.destination)}</div>
        <h2 class="dest">${esc(o.destination_name || o.destination)}<small>${esc(sub)}</small></h2>
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
        ${altsHTML(o)}
        <div class="actions">
          <button class="btn primary" data-stay="${esc(o.id)}">Buscar alojamiento</button>
          <a class="btn ghost" href="${esc(o.deep_link)}" target="_blank" rel="noopener">Ver vuelo</a>
        </div>
      </div>
    </article>`;
}

/* El resto, como el panel de salidas de un aeropuerto: una línea por vuelo. */
function boardRow(o, i) {
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
      <span class="price">${fmtEUR(o.price)}${
        o.discount_pct >= 5 ? `<small>−${Math.round(o.discount_pct)}%</small>` : ""
      }</span>
      <div class="brow-detail" hidden></div>
    </div>`;
}

/* Cualquier viaje se abre y enseña sus vuelos, no solo el destacado. */
function detalleHTML(o) {
  return `
    ${o.hidden_city ? AVISO_HIDDEN : ""}
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
      <a class="btn primary" href="${esc(o.deep_link)}" target="_blank" rel="noopener">Ver vuelo</a>
      <button class="btn ghost" data-stay="${esc(o.id)}">Buscar alojamiento</button>
    </div>`;
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
  caja.querySelectorAll("[data-stay]").forEach((b) =>
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (!OFFERS.some((x) => x.id === o.id)) OFFERS.push(o);
      openStays(o.id);
    })
  );
}

function wireRows(raiz = document) {
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

function render() {
  if (!existe("#offers")) return;
  $("#priceOut").textContent = $("#price").value;
  const list = currentList();

  $("#hero").innerHTML = list.length ? heroTicket(list[0]) : "";
  $("#hero").hidden = !list.length;
  $("#offers").innerHTML = list.slice(1).map(boardRow).join("");
  $("#boardHead").hidden = list.length < 2;
  $("#empty").hidden = list.length > 0;

  document.querySelectorAll(".hero [data-stay]").forEach((el) =>
    el.addEventListener("click", () => openStays(el.dataset.stay))
  );
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

/* ------------------------------------------------------------- alojamiento */
let pollTimer = null;

function closePanel() {
  clearInterval(pollTimer);
  $("#panel").hidden = true;
  $("#backdrop").hidden = true;
  document.body.style.overflow = "";
}
on("#panelClose", "click", closePanel);
on("#backdrop", "click", closePanel);
document.addEventListener("keydown", (e) => e.key === "Escape" && closePanel());

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

async function openStays(id) {
  const offer = OFFERS.find((o) => o.id === id);
  if (!offer) return;

  $("#panel").hidden = false;
  $("#backdrop").hidden = false;
  document.body.style.overflow = "hidden";
  $("#panelTitle").textContent = offer.destination_name || offer.destination;
  $("#panelDates").textContent =
    `${fmtDate(offer.depart_date, true)}${offer.return_date ? ` → ${fmtDate(offer.return_date, true)}` : ""}` +
    `${offer.nights ? ` · ${offer.nights} noches` : ""}`;
  $("#panelBody").innerHTML = '<p class="status">Comprobando si ya hay resultados…</p>';

  try {
    renderStays(await fetchJSON(`data/stays/${id}.json`));
  } catch {
    askForSearch(offer);
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
        <input type="number" id="party" min="1" max="8" value="2" inputmode="numeric">
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
    if (r.reason === "sin-token" || r.reason === "token-invalido") {
      const caja = tokenBox(() => askForSearch(offer));
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
  pollTimer = setInterval(async () => {
    if (Date.now() - started > POLL_MAX_MS) {
      clearInterval(pollTimer);
      $("#panelBody").innerHTML =
        '<div class="status wait">Está tardando más de lo normal. Revisa la issue en GitHub.</div>';
      return;
    }
    try {
      const data = await fetchJSON(`data/stays/${id}.json`);
      clearInterval(pollTimer);
      renderStays(data);
    } catch {
      /* todavia no esta publicado: se reintenta */
    }
  }, POLL_EVERY_MS);
}

function stayRow(s) {
  const meta = [s.provider, s.rating ? `★ ${s.rating}` : "", s.note].filter(Boolean).join(" · ");
  const precio = s.price_total
    ? `<div class="amount-s">${fmtEUR(s.price_total)}<small>${
        s.price_per_night ? `${fmtEUR(s.price_per_night)} la noche` : ""
      }</small></div>`
    : `<div class="amount-s link-tag">abrir</div>`;
  return `
    <a class="stay" href="${esc(s.url)}" target="_blank" rel="noopener">
      ${s.image ? `<img src="${esc(s.image)}" alt="" loading="lazy">` : ""}
      <div>
        <div class="name">${esc(s.name)}</div>
        <div class="meta">${esc(meta)}</div>
      </div>
      ${precio}
    </a>`;
}

function desde(iso) {
  const dias = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
  if (!Number.isFinite(dias)) return "";
  return dias <= 0 ? "hoy" : dias === 1 ? "ayer" : `hace ${dias} días`;
}

function renderStays(data) {
  const stays = data.stays || [];
  const priced = stays.filter((s) => s.price_total);
  const links = stays.filter((s) => !s.price_total);
  const offer = OFFERS.find((o) => o.id === data.offer_id);

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

/* --------------------------------------------------- buscador personalizado */
function searchIssueURL(f) {
  const cuerpo = [
    "Busqueda lanzada desde la web. No edites el bloque de abajo.",
    "",
    "```yaml",
    `dest: ${f.dest}`,
    `max_price: ${f.max}`,
    `nights: ${f.nights}`,
    `months: ${f.months}`,
    `adults: ${f.adults}`,
    `weekend: ${f.weekend ? "si" : "no"}`,
    "```",
  ].join("\n");
  const titulo = `[buscar] ${f.dest} · ${f.nights} noches · hasta ${f.max} €`;
  return (
    `https://github.com/${REPO}/issues/new?title=${encodeURIComponent(titulo)}` +
    `&labels=busqueda&body=${encodeURIComponent(cuerpo)}`
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
}
["#fWhere", "#fWhen"].forEach((s) => on(s, "change", syncFinder));
if (existe("#finderForm")) syncFinder();

on("#finderForm", "submit", async (e) => {
  e.preventDefault();
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

  const payload = {
    dest,
    label:
      (dest || "Donde sea") +
      (cuando === "exact" ? ` · ${$("#fDepart").value}` : ` · hasta ${$("#fMax").value} €`),
    max_price: $("#fMax").value,
    nights: $("#fNights").value.trim() || "2-3",
    months: $("#fMonths").value || "12",
    adults: $("#fAdults").value || "2",
    weekend: cuando === "weekend" ? "si" : "no",
    depart: cuando === "exact" ? $("#fDepart").value : "",
    return_date: cuando === "exact" ? $("#fReturn").value : "",
  };

  const aviso = (html) => ($("#searches").innerHTML = html + $("#searches").innerHTML);
  const r = await dispatch("search", payload);
  if (r.ok) {
    anadirPendiente(payload.label);
    loadSearches();
    return;
  }
  if (r.reason === "sin-token" || r.reason === "token-invalido") {
    const caja = tokenBox(() => $("#finderForm").requestSubmit());
    $("#searches").innerHTML = caja.html;
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
function esperarCambios() {
  if (window.__esperando) return;
  let vueltas = 0;
  window.__esperando = setInterval(async () => {
    vueltas += 1;
    const quedan =
      pendientes().length || JSON.parse(localStorage.getItem("tf_borrando") || "[]").length;
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

async function loadSearches() {
  // Esta caja solo existe en buscar.html, pero app.js es el mismo en las cuatro
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
  const guardadas = indice.searches || [];

  // Lo que ya esta en el indice deja de estar pendiente.
  const etiquetas = new Set(guardadas.map((s) => s.label));
  let pend = pendientes().filter((p) => !etiquetas.has(p.label));
  guardarPendientes(pend);
  const ahora = Date.now();
  const cabecera = pend
    .map((p) => pendienteHTML(p, ahora - p.desde > MAX_ESPERA_MS))
    .join("");

  if (!guardadas.length && !cabecera) return;

  $("#searches").innerHTML = cabecera + guardadas
    .map(
      (s) => `
      <div class="saved" data-slug="${esc(s.slug)}">
        <b>${esc(s.label)}</b>
        <span class="meta">${s.count} viajes · buscado ${esc(desde(s.generated_at))}</span>
        ${s.best_price ? `<span class="best">desde ${fmtEUR(s.best_price)}</span>` : ""}
        <button class="quitar" data-borrar="${esc(s.slug)}" title="Quitar esta búsqueda">✕</button>
        <div class="saved-rows" hidden></div>
      </div>`
    )
    .join("");

  // Lo que se ha mandado borrar sigue marcado hasta que desaparece de verdad.
  const borrando = JSON.parse(localStorage.getItem("tf_borrando") || "[]");
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
  localStorage.setItem("tf_borrando", JSON.stringify(siguen));
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
    b.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      b.disabled = true;
      const r = await dispatch("delete_search", { tipo: "delete_search", id: b.dataset.borrar });
      if (r.ok) {
        const cola = JSON.parse(localStorage.getItem("tf_borrando") || "[]");
        cola.push(b.dataset.borrar);
        localStorage.setItem("tf_borrando", JSON.stringify(cola));
        loadSearches();
      } else {
        b.disabled = false;
        alert("No se pudo borrar: " + r.reason);
      }
    })
  );

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
    const ofertas = data.offers || [];
    ofertas.forEach((o) => (SEARCH_OFFERS[o.id] = o));
    caja.innerHTML = ofertas.length
      ? ofertas.map((o, i) => boardRow(o, i)).join("")
      : '<p class="meta">Nada dentro de ese presupuesto. Sube el tope o amplía los meses.</p>';
    caja.dataset.cargado = "1";
    wireRows(caja);
  } catch {
    caja.innerHTML = '<p class="meta">No se pudo cargar.</p>';
  }
}

init();
loadSearches();
cargarWatches();

/* --------------------------------------------------- selector de destino
   El mapa de puntos quedaba precioso y era inutil: sin costas ni fronteras no
   se sabe que es cada punto. Para ELEGIR funciona mejor una lista que se
   busca escribiendo, agrupada por pais y con el pais entero seleccionable. */
let DESTINOS = null;

/* Las busquedas lanzadas se guardan en el navegador hasta que aparecen en el
   indice. Antes el "buscando..." lo borraba el siguiente refresco de la lista
   y parecia que la busqueda se hubiera esfumado. */
const PEND_KEY = "tf_pendientes";
const MAX_ESPERA_MS = 18 * 60 * 1000;  // cuando una busqueda pendiente se marca como colgada

const pendientes = () => {
  try {
    return JSON.parse(localStorage.getItem(PEND_KEY) || "[]");
  } catch {
    return [];
  }
};
const guardarPendientes = (lista) => localStorage.setItem(PEND_KEY, JSON.stringify(lista));

function anadirPendiente(label) {
  const lista = pendientes().filter((p) => p.label !== label);
  lista.unshift({ label, desde: Date.now() });
  guardarPendientes(lista);
}

function pendienteHTML(p, caducada) {
  return caducada
    ? `<div class="saved"><b>${esc(p.label)}</b>
         <span class="meta">no llegó a terminar · vuelve a lanzarla</span>
         <button class="quitar" data-olvidar="${esc(p.label)}">✕</button></div>`
    : `<div class="saved"><b>${esc(p.label)}</b>
         <span class="meta"><span class="spin"></span>buscando… tarda 2–3 min</span></div>`;
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
            <span>${esc(p.pais)}</span>
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
  $("#destList").innerHTML = html || '<p class="meta">Nada con ese nombre.</p>';
  $("#destList")
    .querySelectorAll("[data-valor]")
    .forEach((b) => b.addEventListener("click", () => elegirDestino(b.dataset.valor)));
}

function elegirDestino(valor) {
  if (destinoPara === "wDest") {
    $("#wDest").value = valor;
    $("#wDestBtn").textContent = valor;
  } else {
    $("#fDest").value = valor;
    $("#destBtn").textContent = valor;
  }
  cerrarDestinos();
}

function abrirDestinos() {
  $("#destModal").hidden = false;
  document.body.style.overflow = "hidden";
  cargarDestinos().then(() => {
    pintarDestinos($("#destSearch").value);
    $("#destSearch").focus();
  });
}

function cerrarDestinos() {
  $("#destModal").hidden = true;
  document.body.style.overflow = "";
}

on("#destBtn", "click", () => {
  destinoPara = "fDest";
  abrirDestinos();
});
on("#destClose", "click", cerrarDestinos);
on("#destModal", "click", (e) => {
  if (e.target.id === "destModal") cerrarDestinos();
});
on("#destSearch", "input", (e) => pintarDestinos(e.target.value));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#destModal").hidden) cerrarDestinos();
});

/* ------------------------------------------------------------ seguimientos
   Cosa aparte de la busqueda: no contesta ahora, se queda apuntado y lo revisa
   el cron cada dia. Avisa si entra en el tope o si baja de su propio minimo. */
let destinoPara = "fDest"; // que campo rellena el selector de destinos

on("#wDestBtn", "click", () => {
  destinoPara = "wDest";
  abrirDestinos();
});

const HINTS_W = {
  "any|weekend": "Cualquier destino, cualquier finde: avisa cuando algo baje del tope.",
  "any|exact": "Cualquier destino, para esas fechas exactas.",
  "any|anytime": "Cualquier destino y cualquier fecha del horizonte.",
  "one|weekend": "Ese destino, el finde que sea.",
  "one|exact": "Ese destino, para esas fechas exactas.",
  "one|anytime": "Ese destino, cualquier día.",
};

function syncWatch() {
  if (!existe("#watchForm")) return;
  const donde = $("#wWhere").value;
  const cuando = $("#wWhen").value;
  $("#wDestWrap").hidden = donde !== "one";
  $("#wDateWrap").hidden = cuando !== "exact";
  $("#wMonthsWrap").hidden = cuando === "exact";
  if (cuando !== "exact") $("#wCal").hidden = true;
  $("#watchHint").textContent = HINTS_W[`${donde}|${cuando}`] || "";
}
["#wWhere", "#wWhen"].forEach((s) => on(s, "change", syncWatch));
if (existe("#watchForm")) syncWatch();

on("#watchForm", "submit", async (e) => {
  e.preventDefault();
  const donde = $("#wWhere").value;
  const cuando = $("#wWhen").value;
  const dest = donde === "one" ? $("#wDest").value.trim() : "";
  const fecha = cuando === "exact" ? $("#wDepart").value : "";
  const vuelta = cuando === "exact" ? $("#wReturn").value : "";
  if (donde === "one" && !dest) return;
  if (cuando === "exact" && !fecha) return;
  const etiqueta = (dest || "Donde sea") + (fecha ? ` · ${fecha}` : ` · hasta ${$("#wMax").value} €`);
  const r = await dispatch("watch", {
    tipo: "watch",
    dest,
    label: etiqueta,
    depart: fecha,
    return_date: vuelta,
    max_price: $("#wMax").value,
    months: $("#wMonths").value || "6",
    adults: $("#wAdults").value || "2",
    weekend: cuando === "weekend" ? "si" : "no",
    nights: "2-3",
  });
  if (r.ok) {
    $("#watches").insertAdjacentHTML(
      "afterbegin",
      `<div class="watch"><b>${esc(etiqueta)}</b>
        <span class="meta">apuntado · se revisa cada día</span></div>`
    );
    setTimeout(cargarWatches, 45000);
    return;
  }
  if (r.reason === "sin-token" || r.reason === "token-invalido") {
    const caja = tokenBox(() => $("#watchForm").requestSubmit());
    $("#watches").innerHTML = caja.html;
    caja.wire();
    return;
  }
  $("#watches").innerHTML = `<div class="watch"><span class="meta">No se pudo apuntar: ${esc(
    r.reason
  )}</span></div>`;
});

async function cargarWatches() {
  if (!$("#watches")) return;  // solo existe en seguimientos.html
  let datos;
  try {
    datos = await fetchJSON("data/watch.json");
  } catch {
    return;
  }
  const vivos = (datos.watches || []).filter((w) => w.active !== false);
  if (!vivos.length) return;
  $("#watches").innerHTML =
    '<h3 class="watch-head">Siguiendo a diario</h3>' +
    vivos
      .map(
        (w) => `
        <div class="watch" data-abrir="${esc(w.id)}">
          <b>${esc(w.label || w.destination || "Donde sea")}</b>
          <span class="meta">${
            w.depart ? esc(w.depart) : `próximos ${w.months} meses`
          }${w.max_price ? ` · hasta ${Math.round(w.max_price)} €` : ""}${
          w.best_price ? ` · mejor visto ${Math.round(w.best_price)} €` : ""
        }${w.last_checked ? ` · revisado ${esc(desde(w.last_checked))}` : ""}${
          (w.last_offers || []).length ? ` · ${w.last_offers.length} resultados` : " · sin resultados aún"
        }</span>
          <button class="quitar" data-unwatch="${esc(w.id)}" title="Dejar de seguir">✕</button>
          <div class="watch-rows" hidden></div>
        </div>`
      )
      .join("");

  // Cada seguimiento enseña lo ultimo que encontro, sin esperar a que salte
  // un aviso: asi se ve que esta trabajando aunque no haya chollo.
  $("#watches")
    .querySelectorAll(".watch[data-abrir]")
    .forEach((fila) =>
      fila.addEventListener("click", (ev) => {
        if (ev.target.closest("button, a")) return;
        const caja = fila.querySelector(".watch-rows");
        const w = vivos.find((x) => x.id === fila.dataset.abrir);
        if (!caja || !w) return;
        if (!caja.hidden) {
          caja.hidden = true;
          return;
        }
        const ofertas = w.last_offers || [];
        ofertas.forEach((o) => (SEARCH_OFFERS[o.id] = o));
        caja.innerHTML = ofertas.length
          ? ofertas.map((o, i) => boardRow(o, i)).join("")
          : '<p class="meta">Todavía no ha encontrado nada dentro de tu tope.</p>';
        caja.hidden = false;
        wireRows(caja);
      })
    );

  $("#watches")
    .querySelectorAll("[data-unwatch]")
    .forEach((b) =>
      b.addEventListener("click", async () => {
        b.disabled = true;
        const r = await dispatch("unwatch", { tipo: "unwatch", id: b.dataset.unwatch });
        if (r.ok) {
          const fila = b.closest(".watch");
          fila.style.opacity = 0.45;
          fila.querySelector(".meta").innerHTML = '<span class="spin"></span>quitando…';
          esperarCambios();
        } else {
          b.disabled = false;
          alert("No se pudo quitar: " + r.reason);
        }
      })
    );
}

/* ---------------------------------------------------------- calendario
   Un solo calendario reutilizable: el primer clic pone la ida y el segundo la
   vuelta. Lo usan el buscador y los seguimientos, cada uno con sus campos. */
const CALS = {
  buscar: { btn: "#dateBtn", cal: "#cal", ida: "#fDepart", vuelta: "#fReturn", rango: {} },
  seguir: { btn: "#wDateBtn", cal: "#wCal", ida: "#wDepart", vuelta: "#wReturn", rango: {} },
};

function pintarCalendario(clave) {
  const c = CALS[clave];
  if (!existe(c.cal)) return;
  const hoy = new Date();
  const meses = [];
  for (let m = 0; m < 12; m++) {
    const base = new Date(hoy.getFullYear(), hoy.getMonth() + m, 1);
    const primero = (base.getDay() + 6) % 7; // lunes primero
    const dias = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
    let celdas = "";
    for (let i = 0; i < primero; i++) celdas += "<span></span>";
    for (let d = 1; d <= dias; d++) {
      const f = new Date(base.getFullYear(), base.getMonth(), d);
      const iso = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}-${String(
        d
      ).padStart(2, "0")}`;
      const pasado = f < new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
      const extremo = c.rango.ida === iso || c.rango.vuelta === iso;
      const dentro = c.rango.ida && c.rango.vuelta && iso > c.rango.ida && iso < c.rango.vuelta;
      celdas += `<button type="button" class="dia${extremo ? " extremo" : ""}${
        dentro ? " dentro" : ""
      }" data-iso="${iso}"${pasado ? " disabled" : ""}>${d}</button>`;
    }
    meses.push(`
      <div class="mes">
        <h4>${MONTHS[base.getMonth()]} ${base.getFullYear()}</h4>
        <div class="semana"><i>L</i><i>M</i><i>X</i><i>J</i><i>V</i><i>S</i><i>D</i></div>
        <div class="dias">${celdas}</div>
      </div>`);
  }
  $(c.cal).innerHTML = `<div class="meses">${meses.join("")}</div>`;
  $(c.cal)
    .querySelectorAll(".dia:not([disabled])")
    .forEach((b) => b.addEventListener("click", () => elegirDia(clave, b.dataset.iso)));
}

function elegirDia(clave, iso) {
  const c = CALS[clave];
  if (!c.rango.ida || c.rango.vuelta || iso < c.rango.ida) {
    c.rango = { ida: iso, vuelta: null };
  } else {
    c.rango.vuelta = iso;
  }
  $(c.ida).value = c.rango.ida || "";
  $(c.vuelta).value = c.rango.vuelta || "";
  $(c.btn).textContent = c.rango.ida
    ? `${fmtDate(c.rango.ida, true)}${
        c.rango.vuelta ? ` → ${fmtDate(c.rango.vuelta, true)}` : " → elige la vuelta"
      }`
    : "Elegir en el calendario";
  pintarCalendario(clave);
  if (c.rango.ida && c.rango.vuelta) setTimeout(() => ($(c.cal).hidden = true), 250);
}

Object.entries(CALS).forEach(([clave, c]) =>
  on(c.btn, "click", () => {
    const caja = $(c.cal);
    caja.hidden = !caja.hidden;
    if (!caja.hidden) pintarCalendario(clave);
  })
);

/* El mapa solo aparece cuando eliges un sitio concreto. */
const syncOriginal = syncFinder;
syncFinder = function () {
  syncOriginal();
  if ($("#fWhen").value !== "exact") $("#cal").hidden = true;
};
["#fWhere", "#fWhen"].forEach((s) => on(s, "change", syncFinder));
if (existe("#finderForm")) syncFinder();
