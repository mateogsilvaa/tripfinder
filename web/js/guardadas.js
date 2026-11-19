/* guardadas.js — Las búsquedas guardadas, más allá del rótulo.

   ANTES cada búsqueda era un bloque gris con su etiqueta y un precio. Con
   diez guardadas no había manera de encontrar «la de Italia en marzo» sin
   abrirlas una a una, y lo que más trabajo había costado —los viajes a los
   que ya se les había buscado cama— no se veía desde fuera.

   AHORA cada tarjeta lleva:
   - un nombre tuyo (✎ para renombrar), guardado en este navegador;
   - los destinos más baratos que encontró, como chips;
   - un desplegable con los viajes que ya tienen cama buscada.
   Y arriba un buscador que filtra por nombre, rótulo o destino. */
import { esc, fetchJSON, fmtDate, fmtEUR } from "./base.js";

const ALIAS = "tf_alias_busquedas";

function leerAlias() {
  try {
    return JSON.parse(localStorage.getItem(ALIAS) || "{}") || {};
  } catch {
    return {};
  }
}
export function alias(slug) {
  return leerAlias()[slug] || "";
}
function guardarAlias(slug, nombre) {
  const a = leerAlias();
  if (nombre) a[slug] = nombre;
  else delete a[slug];
  try {
    localStorage.setItem(ALIAS, JSON.stringify(a));
  } catch {}
}

/* El buscador de arriba. Solo aparece a partir de cuatro: con tres se ven. */
export function buscadorHTML(n) {
  if (n < 4) return "";
  return `<label class="sv-filtro">
      <span class="solo-lector">Buscar en tus búsquedas</span>
      <input type="search" id="svFiltro" placeholder="Buscar en tus ${n} búsquedas: nombre, destino, mes…" autocomplete="off">
    </label>`;
}

export function wireBuscador(caja) {
  const input = caja.querySelector("#svFiltro");
  if (!input) return;
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    caja.querySelectorAll(".saved[data-slug]").forEach((el) => {
      el.classList.toggle("sv-oculta", !!q && !(el.dataset.buscable || "").includes(q));
    });
  });
}

/* Renombrar: el rótulo se vuelve un campo, Enter guarda y Escape deja como
   estaba. Vacío = vuelve el nombre de siempre. */
export function wireRenombrar(caja, repintar) {
  caja.querySelectorAll("[data-renombrar]").forEach((b) =>
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const slug = b.dataset.renombrar;
      const tarjeta = b.closest(".saved");
      const sitio = tarjeta.querySelector(".tv-sitio");
      if (!sitio || tarjeta.querySelector(".sv-campo")) return;
      const campo = document.createElement("input");
      campo.className = "sv-campo";
      campo.value = alias(slug) || sitio.textContent.trim();
      campo.maxLength = 60;
      campo.setAttribute("aria-label", "Nombre de la búsqueda");
      sitio.replaceWith(campo);
      campo.focus();
      campo.select();
      let hecho = false;
      const cerrar = (guardar) => {
        if (hecho) return;
        hecho = true;
        if (guardar) {
          const nombre = campo.value.trim();
          guardarAlias(slug, nombre === tarjeta.dataset.original ? "" : nombre);
        }
        repintar();
      };
      campo.addEventListener("click", (e) => e.stopPropagation());
      campo.addEventListener("keydown", (e) => {
        if (e.key === "Enter") cerrar(true);
        if (e.key === "Escape") cerrar(false);
      });
      campo.addEventListener("blur", () => cerrar(true));
    })
  );
}

let CAMAS = null;
async function indiceCamas() {
  if (CAMAS) return CAMAS;
  try {
    CAMAS = (await fetchJSON("data/stays/index.json")).viajes || {};
  } catch {
    CAMAS = {};
  }
  return CAMAS;
}

/* Lo que no cabe en el índice —los destinos y las camas— sale del fichero de
   cada búsqueda. Se piden en paralelo y se pinta según llegan. */
export async function enriquecer(caja, guardadas, { pintarFila, wire }) {
  const camas = await indiceCamas();
  await Promise.all(
    guardadas.map(async (s) => {
      const el = caja.querySelector(`.saved[data-slug="${CSS.escape(s.slug)}"]`);
      if (!el) return;
      let data;
      try {
        data = await fetchJSON(`data/searches/${s.slug}.json`);
      } catch {
        return;
      }
      const ofertas = data.offers || [];

      // Los destinos: el más barato de cada uno, hasta cinco.
      const mejor = new Map();
      for (const o of ofertas) {
        const k = o.destination;
        if (!mejor.has(k) || o.price < mejor.get(k).price) mejor.set(k, o);
      }
      const top = [...mejor.values()].sort((a, b) => a.price - b.price);
      const chips = el.querySelector("[data-sv-destinos]");
      if (chips && top.length) {
        chips.innerHTML =
          top
            .slice(0, 5)
            .map(
              (o) =>
                `<li><span class="sv-iata">${esc(o.destination)}</span>${esc(
                  o.destination_name || ""
                )} <b>${fmtEUR(o.price)}</b></li>`
            )
            .join("") + (top.length > 5 ? `<li class="sv-mas">+${top.length - 5}</li>` : "");
        chips.hidden = false;
      }
      el.dataset.buscable += " " + top.map((o) => `${o.destination} ${o.destination_name || ""}`).join(" ").toLowerCase();

      // Los viajes con cama ya buscada, en su desplegable.
      const conCama = ofertas.filter((o) => camas[o.id]);
      const hueco = el.querySelector("[data-sv-camas]");
      if (!hueco || !conCama.length) return;
      hueco.innerHTML = `
        <details class="sv-camas">
          <summary><svg class="sv-cama-ico" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M3 18v-11M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5M7 11.5a1.5 1.5 0 1 0 0-.01" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            ${conCama.length} viaje${conCama.length === 1 ? "" : "s"} con cama buscada
            <span class="sv-cama-resumen">${conCama
              .slice(0, 3)
              .map((o) => `${esc(camas[o.id].n || o.destination_name)} ${fmtDate(o.depart_date)}`)
              .join(" · ")}</span>
          </summary>
          <div class="sv-camas-filas">${conCama.map((o, i) => pintarFila(o, i, camas[o.id])).join("")}</div>
        </details>`;
      hueco.hidden = false;
      const det = hueco.querySelector("details");
      det.addEventListener("click", (e) => e.stopPropagation());
      det.addEventListener("toggle", () => det.open && wire(det, conCama), { once: true });
      el.classList.add("sv-con-camas");
    })
  );
}
