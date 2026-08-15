/* TripFinder — frontend estatico. Lee los JSON que commitea GitHub Actions. */

const REPO = "mateogsilvaa/tripfinder";
const POLL_EVERY_MS = 20000;
const POLL_MAX_MS = 15 * 60 * 1000;

const $ = (sel) => document.querySelector(sel);
const fmtEUR = (n) => `${Math.round(n)} €`;
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
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
    $("#meta").textContent = "Todavia no hay datos. El primer scan los generara.";
    return;
  }

  OFFERS = payload.offers || [];
  $("#meta").textContent = OFFERS.length
    ? `${OFFERS.length} ofertas · actualizado ${payload.generated_at || "hoy"}`
    : "Sin ofertas en el ultimo scan.";

  if (payload.errors?.length) {
    const box = $("#errors");
    box.hidden = false;
    box.querySelector("ul").innerHTML = payload.errors.map((e) => `<li>${esc(e)}</li>`).join("");
  }

  const origins = [...new Set(OFFERS.map((o) => o.origin))].sort();
  $("#origin").insertAdjacentHTML(
    "beforeend",
    origins.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("")
  );

  const maxPrice = Math.max(60, ...OFFERS.map((o) => o.price));
  const priceInput = $("#price");
  priceInput.max = Math.ceil(maxPrice / 10) * 10;
  priceInput.value = priceInput.max;
  $("#priceOut").textContent = priceInput.value;

  document.querySelector(".controls").hidden = OFFERS.length === 0;
  ["#q", "#origin", "#sort", "#price"].forEach((s) => $(s).addEventListener("input", render));
  render();

  const target = new URLSearchParams(location.search).get("offer");
  if (target) focusOffer(target);
}

function currentList() {
  const q = $("#q").value.trim().toLowerCase();
  const origin = $("#origin").value;
  const max = Number($("#price").value);
  const sort = $("#sort").value;

  const list = OFFERS.filter(
    (o) =>
      o.price <= max &&
      (!origin || o.origin === origin) &&
      (!q ||
        `${o.destination_name} ${o.destination} ${o.destination_country} ${o.origin_name}`
          .toLowerCase()
          .includes(q))
  );

  const by = {
    score: (a, b) => b.score - a.score || a.price - b.price,
    price: (a, b) => a.price - b.price,
    date: (a, b) => a.depart_date.localeCompare(b.depart_date),
  }[sort];
  return list.sort(by);
}

function card(o) {
  const nights = o.nights ? ` · ${o.nights} noches` : "";
  const back = o.return_date ? ` → ${fmtDate(o.return_date)}` : "";
  const was = o.baseline && o.baseline > o.price ? `<span class="was">${fmtEUR(o.baseline)}</span>` : "";
  const tag = o.discount_pct >= 5 ? `<span class="tag">−${Math.round(o.discount_pct)}% · score ${o.score}</span>` : "";
  return `
    <article class="card" id="offer-${esc(o.id)}" data-id="${esc(o.id)}">
      <div>
        <div class="route">${esc(o.origin_name || o.origin)} → ${esc(o.destination_name || o.destination)}
          <small>${esc(o.origin)}–${esc(o.destination)}</small>
        </div>
        <div class="when">${fmtDate(o.depart_date)}${back}${nights} · ${esc(o.airline || o.provider)}</div>
      </div>
      <div class="priceline"><span class="price">${fmtEUR(o.price)}</span>${was}${tag}</div>
      <div class="actions">
        <button class="btn primary" data-stay="${esc(o.id)}">Buscar alojamiento</button>
        <a class="btn ghost" href="${esc(o.deep_link)}" target="_blank" rel="noopener">Ver vuelo</a>
      </div>
    </article>`;
}

function render() {
  $("#priceOut").textContent = $("#price").value;
  const list = currentList();
  $("#offers").innerHTML = list.map(card).join("");
  $("#empty").hidden = list.length > 0 || OFFERS.length === 0;
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
  $("#panelTitle").textContent = `Alojamiento en ${offer.destination_name || offer.destination}`;
  $("#panelDates").textContent =
    `${fmtDate(offer.depart_date)}${offer.return_date ? ` → ${fmtDate(offer.return_date)}` : ""}` +
    `${offer.nights ? ` · ${offer.nights} noches` : ""}`;
  $("#panelBody").innerHTML = '<p class="sub">Comprobando si ya hay resultados…</p>';

  try {
    const data = await fetchJSON(`data/stays/${id}.json`);
    renderStays(data);
  } catch {
    askForSearch(offer);
  }
}

function askForSearch(offer) {
  $("#panelBody").innerHTML = `
    <div class="status wait">
      Aun no hemos buscado alojamiento para esta oferta.
      Al pulsar el boton se abre una issue en GitHub que lanza el scraper
      (Airbnb, hoteles y comparadores) para <strong>estas fechas exactas</strong>.
      Tarda 2–3 minutos y esta pagina se actualiza sola.
    </div>
    <a class="btn primary" id="launch" href="${issueURL(offer)}" target="_blank" rel="noopener">
      Lanzar busqueda de alojamiento
    </a>`;
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
        '<div class="status wait">La busqueda esta tardando mas de lo normal. Revisa la issue en GitHub.</div>';
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

function renderStays(data) {
  const stays = data.stays || [];
  const priced = stays.filter((s) => s.price_total);
  const links = stays.filter((s) => !s.price_total);

  const row = (s) => `
    <div class="stay">
      ${s.image ? `<img src="${esc(s.image)}" alt="" loading="lazy">` : ""}
      <div>
        <div class="name"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a></div>
        <div class="meta">${esc(s.provider)}${s.rating ? ` · ★ ${s.rating}` : ""}${s.note ? ` · ${esc(s.note)}` : ""}</div>
      </div>
      ${
        s.price_total
          ? `<div class="amount">${fmtEUR(s.price_total)}<small>${
              s.price_per_night ? `${fmtEUR(s.price_per_night)}/noche` : ""
            }</small></div>`
          : ""
      }
    </div>`;

  $("#panelBody").innerHTML = `
    <div class="status">${priced.length} alojamientos con precio · buscado el ${esc(data.generated_at || "")}</div>
    ${priced.map(row).join("")}
    ${links.length ? `<h3 style="font-size:15px;margin:22px 0 4px">Seguir buscando</h3>` : ""}
    ${links.map(row).join("")}`;
}

init();
