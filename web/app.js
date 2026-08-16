/* TripFinder — frontend estatico. Lee los JSON que commitea GitHub Actions. */

const REPO = "mateogsilvaa/tripfinder";
const POLL_EVERY_MS = 20000;
const POLL_MAX_MS = 15 * 60 * 1000;

const $ = (sel) => document.querySelector(sel);
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

/* ------------------------------------------------------------------ ofertas */
async function init() {
  let payload;
  try {
    payload = await fetchJSON("data/offers.json");
  } catch {
    $("#stats").innerHTML = statBlock("estado", "sin datos aún");
    return;
  }

  OFFERS = payload.offers || [];
  renderStats(payload);

  if (payload.errors?.length) {
    const box = $("#errors");
    box.hidden = false;
    box.querySelector("ul").innerHTML = payload.errors.map((e) => `<li>${esc(e)}</li>`).join("");
  }
  if (!OFFERS.length) return;

  const maxPrice = Math.max(60, ...OFFERS.map((o) => o.price));
  const priceInput = $("#price");
  priceInput.max = Math.ceil(maxPrice / 10) * 10;
  priceInput.value = priceInput.max;
  $("#priceOut").textContent = priceInput.value;

  $(".controls").hidden = false;
  ["#q", "#sort", "#price", "#unique", "#onlyWeekend"].forEach((s) => $(s).addEventListener("input", render));
  render();

  const target = new URLSearchParams(location.search).get("offer");
  if (target) {
    ensureVisible(target);
    focusOffer(target);
  }
}

const statBlock = (label, value, hot = false) =>
  `<div><dd class="${hot ? "hot" : ""}">${esc(value)}</dd><dt>${esc(label)}</dt></div>`;

function renderStats(payload) {
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
  const list = OFFERS.filter(
    (o) =>
      o.price <= max &&
      (!soloFindes || o.weekend) &&
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
  return o.stops ? `${o.stops} escala${o.stops > 1 ? "s" : ""}` : "directo";
}

function leg(label, iso, sale, llega, highlight) {
  if (!iso) return "";
  const horario = sale ? `${esc(sale)}${llega ? ` → ${esc(llega)}` : ""}` : "";
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
        )}</a>`
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
  const vuelta = vueltaTxt ? ` → <b>${vueltaTxt}</b>${horaVuelta}` : "";
  return `
    <button class="brow" id="offer-${esc(o.id)}" data-stay="${esc(o.id)}"
            style="animation-delay:${Math.min(i, 14) * 35}ms">
      <span class="iata">${esc(o.destination)}</span>
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
      }</small></span>
      <span class="price">${fmtEUR(o.price)}${
        o.discount_pct >= 5 ? `<small>−${Math.round(o.discount_pct)}%</small>` : ""
      }</span>
    </button>`;
}

function render() {
  $("#priceOut").textContent = $("#price").value;
  const list = currentList();

  $("#hero").innerHTML = list.length ? heroTicket(list[0]) : "";
  $("#hero").hidden = !list.length;
  $("#offers").innerHTML = list.slice(1).map(boardRow).join("");
  $("#boardHead").hidden = list.length < 2;
  $("#empty").hidden = list.length > 0;

  document.querySelectorAll("[data-stay]").forEach((el) =>
    el.addEventListener("click", () => openStays(el.dataset.stay))
  );
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
$("#panelClose").addEventListener("click", closePanel);
$("#backdrop").addEventListener("click", closePanel);
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

  $("#launch").addEventListener("click", () => {
    const adultos = Math.min(8, Math.max(1, Number($("#party").value) || 2));
    // El precio del alojamiento depende de cuántos vais, así que el número
    // viaja en la petición: buscar para 2 y reservar para 4 no vale de nada.
    window.open(issueURL(offer, adultos), "_blank", "noopener");
    startPolling(offer.id);
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

$("#finderForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = {
    dest: $("#fDest").value.trim(),
    max: Number($("#fMax").value) || 150,
    nights: $("#fNights").value.trim() || "2-3",
    months: Number($("#fMonths").value) || 12,
    adults: Number($("#fAdults").value) || 2,
    weekend: $("#fWeekend").checked,
  };
  if (!f.dest) return;
  window.open(searchIssueURL(f), "_blank", "noopener");
  $("#searches").insertAdjacentHTML(
    "afterbegin",
    `<div class="saved"><b>${esc(f.dest)}</b>
      <span class="meta"><span class="spin"></span>buscando… tarda 2–3 min y aparece aquí sola</span></div>`
  );
  setTimeout(loadSearches, 60000);
});

async function loadSearches() {
  let indice;
  try {
    indice = await fetchJSON("data/searches/index.json");
  } catch {
    return;
  }
  const guardadas = indice.searches || [];
  if (!guardadas.length) return;

  $("#searches").innerHTML = guardadas
    .map(
      (s) => `
      <div class="saved" data-slug="${esc(s.slug)}">
        <b>${esc(s.label)}</b>
        <span class="meta">${s.count} viajes · buscado ${esc(desde(s.generated_at))}</span>
        ${s.best_price ? `<span class="best">desde ${fmtEUR(s.best_price)}</span>` : ""}
        <div class="saved-rows" hidden></div>
      </div>`
    )
    .join("");

  document.querySelectorAll(".saved[data-slug]").forEach((el) =>
    el.addEventListener("click", () => toggleSearch(el))
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
    caja.innerHTML = ofertas.length
      ? ofertas.map((o, i) => boardRow(o, i)).join("")
      : '<p class="meta">Nada dentro de ese presupuesto. Sube el tope o amplía los meses.</p>';
    caja.dataset.cargado = "1";
    caja.querySelectorAll("[data-stay]").forEach((b) =>
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const oferta = ofertas.find((o) => o.id === b.dataset.stay);
        if (oferta) {
          if (!OFFERS.some((x) => x.id === oferta.id)) OFFERS.push(oferta);
          openStays(oferta.id);
        }
      })
    );
  } catch {
    caja.innerHTML = '<p class="meta">No se pudo cargar.</p>';
  }
}

init();
loadSearches();
