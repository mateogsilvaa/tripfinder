/* seguimientos.js — Apuntar un viaje para que lo revise el cron cada dia. */

import {
  $,
  SEARCH_OFFERS,
  cuadrarRejilla,
  esc,
  existe,
  fetchJSON,
  fmtDate,
  on,
  pintarStats,
  stat,
  statPie,
  tarjetaViaje,
} from "./base.js";
import { conGrupo } from "./precios.js";
import { alCambiarFavs, cuantosFavs, sincronizarFavs } from "./favoritos.js";
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
import { CON_MES, DIAS_CORTOS, FLEXIBLES, llenarMeses, llenarOrigenes, mesEnTramo } from "./opciones.js";
import { montarSemana } from "./semana.js";
import { montarHoras, textoHoras } from "./horas.js";
import { abrirDestinos } from "./destinos.js";
import { CAMPOS_SEGUIR, ampliar, recogerAmpliado } from "./ampliar.js";
import { desde } from "./alojamiento.js";

/* ------------------------------------------------------------ seguimientos
   Cosa aparte de la busqueda: no contesta ahora, se queda apuntado y lo revisa
   el cron cada dia. Avisa si entra en el tope o si baja de su propio minimo. */

on("#wDestBtn", "click", () => abrirDestinos("wDest"));

/* SEGUIR TIENE LAS MISMAS PREGUNTAS QUE BUSCAR. Antes eran tres —un finde, una
   fecha o cualquiera— y desde Madrid: quien buscaba «los findes de marzo desde
   Valencia» no lo podía dejar apuntado. Ahora son las mismas siete de buscar,
   con el mismo origen, y viajan igual (`viaje.desde/hasta/dias/origin`). */
const HINTS_W = {
  "any|weekend": "Cualquier destino, cualquier finde: avisa cuando algo baje del tope.",
  "any|mes": "Ese mes, donde sea: avisa del día más barato que baje del tope.",
  "any|mes-finde": "Los findes de ese mes, donde sea.",
  "any|dias": "Esos dos días, cualquier semana, donde sea.",
  "any|tramo": "Dentro de ese tramo, donde sea.",
  "any|exact": "Cualquier destino, para esas fechas exactas.",
  "any|anytime": "Cualquier destino y cualquier fecha del horizonte.",
  "one|weekend": "Ese destino, el finde que sea.",
  "one|mes": "Ese destino en ese mes, el día que baje.",
  "one|mes-finde": "Ese destino, los findes de ese mes.",
  "one|dias": "Ese destino, saliendo y volviendo esos días, la semana que baje.",
  "one|tramo": "Ese destino, dentro del tramo que has marcado.",
  "one|exact": "Ese destino, para esas fechas exactas.",
  "one|anytime": "Ese destino, cualquier día.",
};

function syncWatch() {
  if (!existe("#watchForm")) return;
  const donde = $("#wWhere").value;
  const cuando = $("#wWhen").value;
  if (existe("#wOrigen")) llenarOrigenes($("#wOrigen"));
  $("#wDestWrap").hidden = donde !== "one";
  if (existe("#wMesWrap")) {
    llenarMeses($("#wMes"));
    $("#wMesWrap").hidden = !CON_MES.has(cuando);
  }
  if (existe("#wHorasWrap")) montarHoras($("#wHorasWrap"), $("#wHoras"));
  if (existe("#wDiasWrap")) {
    $("#wDiasWrap").hidden = cuando !== "dias";
    montarSemana($("#wDiasWrap"), $("#wDiaIda"), $("#wDiaVuelta"));
  }
  $("#wDateWrap").hidden = cuando !== "exact" && cuando !== "tramo";
  if (existe("#wDepartRot")) {
    $("#wDepartRot").textContent = cuando === "tramo" ? "Entre" : "Fechas";
    $("#wDateBtn").dataset.modo = cuando === "tramo" ? "tramo" : "fechas";
  }
  if (existe("#wNightsWrap")) $("#wNightsWrap").hidden = cuando === "exact" || cuando === "dias";
  $("#wMonthsWrap").hidden = cuando === "exact" || FLEXIBLES.has(cuando);
  if (cuando !== "exact" && cuando !== "tramo") $("#wCal").hidden = true;
  $("#watchHint").textContent = HINTS_W[`${donde}|${cuando}`] || "";
  cuadrarRejilla($("#watchForm"));
}
["#wWhere", "#wWhen"].forEach((s) => on(s, "change", syncWatch));
if (existe("#watchForm")) syncWatch();

on("#watchForm", "submit", async (e) => {
  e.preventDefault();
  // El compacto de la portada se amplía a `seguimientos.html`; aquí no.
  if (ampliar(e.currentTarget, CAMPOS_SEGUIR)) return;
  const donde = $("#wWhere").value;
  const cuando = $("#wWhen").value;
  const val = (sel) => (existe(sel) ? $(sel).value.trim() : "");
  const dest = donde === "one" ? $("#wDest").value.trim() : "";
  const fecha = cuando === "exact" ? $("#wDepart").value : "";
  const vuelta = cuando === "exact" ? $("#wReturn").value : "";
  if (donde === "one" && !dest) return;
  if (cuando === "exact" && !fecha) return;
  if (cuando === "tramo" && !($("#wDepart").value && $("#wReturn").value)) {
    $("#watchHint").textContent = "Marca los dos extremos del tramo en el calendario.";
    $("#wCal").hidden = false;
    $("#wDateBtn").focus();
    return;
  }
  const ventana = CON_MES.has(cuando)
    ? mesEnTramo(val("#wMes"))
    : cuando === "tramo"
      ? { desde: $("#wDepart").value, hasta: $("#wReturn").value }
      : { desde: "", hasta: "" };
  const mesTxt = CON_MES.has(cuando) ? $("#wMes").selectedOptions[0]?.textContent.trim() || val("#wMes") : "";
  const dias = cuando === "dias" ? `${val("#wDiaIda")}-${val("#wDiaVuelta")}` : "";
  const meses = $("#wMonths").value || 6;
  const origen = val("#wOrigen").toUpperCase();
  const personasW = Number($("#wAdults").value) || 1;
  const cuandoTxt =
    cuando === "exact"
      ? `${fmtDate(fecha)}${vuelta ? ` → ${fmtDate(vuelta)}` : ""}`
      : cuando === "mes"
        ? mesTxt
        : cuando === "mes-finde"
          ? `findes de ${mesTxt}`
          : cuando === "tramo"
            ? `${fmtDate(ventana.desde)} → ${fmtDate(ventana.hasta)}`
            : cuando === "dias"
              ? `${DIAS_CORTOS[val("#wDiaIda")]} → ${DIAS_CORTOS[val("#wDiaVuelta")]} · ${meses} meses`
              : cuando === "weekend"
                ? `findes · ${meses} meses`
                : `${meses} meses`;
  const etiqueta = [
    origen && origen !== "MAD" ? `${dest || "Donde sea"} (desde ${origen})` : dest || "Donde sea",
    cuandoTxt,
    `avisa bajo ${$("#wMax").value} €`,
    personasW > 1 ? `${personasW} pers.` : "1 pers.",
    val("#wHoras") ? textoHoras(val("#wHoras")) : "",
  ]
    .filter(Boolean)
    .join(" · ");
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
      origin: origen,
      depart: fecha,
      return_date: vuelta,
      desde: ventana.desde,
      hasta: ventana.hasta,
      dias,
      horas: val("#wHoras"),
      nights: cuando === "exact" || cuando === "dias" ? "" : val("#wNights") || "2-3",
      max_price: $("#wMax").value,
      months: String(meses),
      adults: $("#wAdults").value || "2",
      weekend: cuando === "weekend" || cuando === "mes-finde" ? "si" : "no",
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

/* Las cifras de esta pagina. «Siguiendo» son los encargos que se revisan
   solos; «apuntados», los viajes concretos que has marcado en el feed. Son dos
   cosas distintas y la pagina enseña las dos, asi que la cabecera tambien.

   Se guarda lo ultimo pintado porque las dos mitades llegan por su cuenta: los
   seguimientos son un fetch y los apuntados salen de `localStorage`, que puede
   cambiar despues (al quitar uno de la lista). Quien llegue segundo repinta
   con lo que ya sabia el primero. */
let VIVOS = [];
let apuntadoACambios = false;

function pintarCifras(vivos) {
  if (vivos) VIVOS = vivos;
  const apuntados = cuantosFavs();
  const ultima = VIVOS
    .map((w) => w.last_checked)
    .filter(Boolean)
    .sort()
    .pop();
  pintarStats(
    stat("siguiendo", VIVOS.length) +
      stat("apuntados", apuntados) +
      (ultima ? statPie("revisado", desde(ultima)) : "")
  );
}

export async function cargarWatches() {
  if (!$("#watches")) return;  // solo existe en seguimientos.html
  // Si quitas un viaje de la lista, la cifra de arriba baja con él. Se apunta
  // aquí y no al cargar el módulo —solo `arranque.js` hace cosas al cargar— y
  // una sola vez, que esto se llama otra vez en cada refresco automático.
  if (!apuntadoACambios) {
    apuntadoACambios = true;
    alCambiarFavs(() => pintarCifras());
  }
  let datos;
  try {
    datos = await fetchJSON("data/watch.json");
  } catch {
    return;
  }
  const vivos = (datos.watches || []).filter((w) => w.active !== false).filter(esMio);
  pintarCifras(vivos);
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
        <div class="watch tv" data-abrir="${esc(w.id)}">${tarjetaViaje({
          rotulo: [
            w.label || w.destination || "Donde sea",
            // Las condiciones que no estén ya dichas en el rótulo.
            ...(w.label ? [] : [w.depart ? w.depart : w.desde
              ? `del ${fmtDate(w.desde)} al ${fmtDate(w.hasta || w.desde)}`
              : `próximos ${w.months} meses`, w.max_price ? `hasta ${Math.round(w.max_price)} €` : ""]),
          ].filter(Boolean).join(" · "),
          precio: w.best_price,
          vivo: true,
          ver: (w.last_offers || []).length ? "Ver lo último" : "",
          estado: `${
            (w.last_offers || []).length
              ? `${w.last_offers.length} resultado${w.last_offers.length === 1 ? "" : "s"}`
              : "sin resultados aún"
          }${w.last_checked ? ` · revisado ${esc(desde(w.last_checked))}` : " · se revisa cada día"}`,
          quitar: `<button class="quitar" type="button" data-unwatch="${esc(w.id)}"
            aria-label="Dejar de seguir">quitar</button>`,
        })}
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
