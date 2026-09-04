/* seguimientos.js — Apuntar un viaje para que lo revise el cron cada dia. */

import { $, SEARCH_OFFERS, esc, existe, fetchJSON, fmtDate, on } from "./base.js";
import { conGrupo } from "./precios.js";
import { sincronizarFavs } from "./favoritos.js";
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
import { esperarCambios } from "./busqueda.js";
import { abrirDestinos } from "./destinos.js";
import { CAMPOS_SEGUIR, ampliar, recogerAmpliado } from "./ampliar.js";
import { desde } from "./alojamiento.js";

/* ------------------------------------------------------------ seguimientos
   Cosa aparte de la busqueda: no contesta ahora, se queda apuntado y lo revisa
   el cron cada dia. Avisa si entra en el tope o si baja de su propio minimo. */

on("#wDestBtn", "click", () => abrirDestinos("wDest"));

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
  // El compacto de la portada se amplía a `seguimientos.html`; aquí no.
  if (ampliar(e.currentTarget, CAMPOS_SEGUIR)) return;
  const donde = $("#wWhere").value;
  const cuando = $("#wWhen").value;
  const dest = donde === "one" ? $("#wDest").value.trim() : "";
  const fecha = cuando === "exact" ? $("#wDepart").value : "";
  const vuelta = cuando === "exact" ? $("#wReturn").value : "";
  if (donde === "one" && !dest) return;
  if (cuando === "exact" && !fecha) return;
  const personasW = Number($("#wAdults").value) || 1;
  const etiqueta = [
    dest || "Donde sea",
    fecha ? `${fmtDate(fecha)}${vuelta ? ` → ${fmtDate(vuelta)}` : ""}` : `${$("#wMonths").value || 6} meses`,
    `avisa bajo ${$("#wMax").value} €`,
    personasW > 1 ? `${personasW} pers.` : "1 pers.",
  ].join(" · ");
  const r = await dispatch("watch", {
    ...comoDueno(),
    label: etiqueta,
    // De donde sale este seguimiento. El test de destinos manda "test" cuando
    // lo haya; asi se puede ver si trae gente o si todos acaban aqui (#13).
    source: "formulario",
    // Los datos del viaje van JUNTOS, en un objeto: GitHub solo admite diez
    // propiedades de primer nivel y sueltas eran once, asi que apuntar un
    // destino concreto devolvia un 422 y no se guardaba nada.
    viaje: {
      dest,
      depart: fecha,
      return_date: vuelta,
      max_price: $("#wMax").value,
      months: $("#wMonths").value || "6",
      adults: $("#wAdults").value || "2",
      weekend: cuando === "weekend" ? "si" : "no",
    },
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
  if (esFaltaDeAcceso(r)) {
    const caja = cajaAcceso(r);
    $("#watches").innerHTML = caja.html + $("#watches").innerHTML;
    caja.wire();
    return;
  }
  $("#watches").innerHTML = `<div class="watch"><span class="meta">No se pudo apuntar: ${esc(
    r.reason
  )}</span></div>`;
});

export async function cargarWatches() {
  if (!$("#watches")) return;  // solo existe en seguimientos.html
  let datos;
  try {
    datos = await fetchJSON("data/watch.json");
  } catch {
    return;
  }
  const vivos = (datos.watches || []).filter((w) => w.active !== false).filter(esMio);
  vivos.forEach((w) => conGrupo(w.last_offers || [], w.adults));
  sincronizarFavs(vivos.flatMap((w) => w.last_offers || []));
  if (!vivos.length) {
    $("#watches").innerHTML = avisoDeCuenta(
      "seguimientos",
      "Aún no sigues ningún viaje. Apunta uno aquí arriba y se revisa cada día por ti."
    );
    wireEntrar($("#watches"));
    return;
  }
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
          <button class="quitar" type="button" data-unwatch="${esc(w.id)}"
            aria-label="Dejar de seguir">quitar</button>
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
        const r = await dispatch("unwatch", {
          id: b.dataset.unwatch,
          ...comoDueno(),
        });
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



/* Lo que llega desde la portada: rellenar y apuntar sin pedir otro clic. */
export function recogerSeguimiento() {
  const form = $("#watchForm");
  if (!form || form.dataset.ampliar) return;
  recogerAmpliado(CAMPOS_SEGUIR, form);
}
