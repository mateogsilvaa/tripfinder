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
  ["#q", "#sort", "#price", "#unique"].forEach((s) => $(s).addEventListener("input", render));
  render();

  const target = new URLSearchParams(location.search).get("offer");
  if (target) focusOffer(target);
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

  const list = OFFERS.filter(
    (o) =>
      o.price <= max &&
      (!q ||
        `${o.destination_name} ${o.destination} ${o.destination_country}`.toLowerCase().includes(q))
  );

  const by = {
    score: (a, b) => b.score - a.score || a.price - b.price,
    price: (a, b) => a.price - b.price,
    date: (a, b) => a.depart_date.localeCompare(b.depart_date),
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

function leg(label, iso, time, highlight) {
  if (!iso) return "";
  return `<div><dt>${label}</dt><dd class="${highlight ? "weekend" : ""}">${fmtDate(iso, true)}${
    time ? ` · ${esc(time)}` : ""
  }</dd></div>`;
}

function card(o, i) {
  const was = o.baseline > o.price ? `<span class="was">${fmtEUR(o.baseline)}</span>` : "";
  const pill =
    o.discount_pct >= 5 ? `<span class="pill">−${Math.round(o.discount_pct)}%</span>` : "";
  const sub = [o.destination_country, o.airline].filter(Boolean).join(" · ");
  const alts = (o.alternatives || []).length
    ? `<div class="alts">también ${o.alternatives
        .map((a) => `<a href="${esc(a.deep_link)}" target="_blank" rel="noopener">${esc(a.airline)} ${fmtEUR(a.price)}</a>`)
        .join(" · ")}</div>`
    : "";
  return `
    <article class="ticket" id="offer-${esc(o.id)}" style="animation-delay:${Math.min(i, 12) * 45}ms">
      ${o.weekend ? '<span class="tag-weekend">escapada de finde</span>' : ""}
      <div class="stub">
        <span class="trip-kind">${o.return_date ? "ida y vuelta" : "solo ida"}</span>
        <span class="amount">${Math.round(o.price)}<span>€</span></span>
        ${was}${pill}
      </div>
      <div class="body">
        <div class="codes">${esc(o.origin)}<span class="line"></span>${esc(o.destination)}</div>
        <h2 class="dest">${esc(o.destination_name || o.destination)}<small>${esc(sub)}</small></h2>
        <dl class="legs">
          ${leg("Ida", o.depart_date, o.depart_time, o.weekend)}
          ${leg("Vuelta", o.return_date, o.return_time, o.weekend)}
          ${o.nights ? `<div><dt>Noches</dt><dd>${o.nights}</dd></div>` : ""}
        </dl>
        ${alts}
        <div class="actions">
          <button class="btn primary" data-stay="${esc(o.id)}">Buscar alojamiento</button>
          <a class="btn ghost" href="${esc(o.deep_link)}" target="_blank" rel="noopener">Ver vuelo</a>
        </div>
      </div>
    </article>`;
}

function render() {
  $("#priceOut").textContent = $("#price").value;
  const list = currentList();
  $("#offers").innerHTML = list.map(card).join("");
  $("#empty").hidden = list.length > 0;
  document.querySelectorAll("[data-stay]").forEach((b) =>
    b.addEventListener("click", () => openStays(b.dataset.stay))
  );
}

function focusOffer(id) {
  const el = document.getElementById(`offer-${id}`);
  if (!el) return;
  el.classList.add("target");
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  openStays(id);
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

function issueURL(o) {
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

function askForSearch(offer) {
  $("#panelBody").innerHTML = `
    <div class="status wait">
      <p>
        Todavía no hemos buscado cama para estas fechas. El botón abre una issue en GitHub
        que lanza el scraper (Airbnb, hoteles y comparadores) para
        <strong>estas fechas exactas</strong>. Tarda 2–3 minutos y esta página se actualiza sola.
      </p>
      <a class="btn primary" id="launch" href="${issueURL(offer)}" target="_blank" rel="noopener">
        Lanzar búsqueda
      </a>
    </div>`;
  $("#launch").addEventListener("click", () => startPolling(offer.id));
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
  return `
    <div class="stay">
      ${s.image ? `<img src="${esc(s.image)}" alt="" loading="lazy">` : ""}
      <div>
        <div class="name"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a></div>
        <div class="meta">${esc(meta)}</div>
      </div>
      ${
        s.price_total
          ? `<div class="amount-s">${fmtEUR(s.price_total)}<small>${
              s.price_per_night ? `${fmtEUR(s.price_per_night)}/noche` : ""
            }</small></div>`
          : ""
      }
    </div>`;
}

function renderStays(data) {
  const stays = data.stays || [];
  const priced = stays.filter((s) => s.price_total);
  const links = stays.filter((s) => !s.price_total);
  $("#panelBody").innerHTML = `
    <div class="status">${priced.length} alojamientos con precio · buscado el ${esc(
      data.generated_at || ""
    )}</div>
    ${priced.map(stayRow).join("")}
    ${links.length ? "<h3>Seguir buscando</h3>" : ""}
    ${links.map(stayRow).join("")}`;
}

init();
