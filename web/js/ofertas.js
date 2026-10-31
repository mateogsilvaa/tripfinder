/* ofertas.js — La hoja del dia: cargar el scan, filtrar, y pintar la plancha y el indice. */

import { huecoFoto, ponerFotos } from "./fotos.js";
import { abrirMundo, paisesElegidos, rotuloPaises } from "./mundo.js";
import {
  $,
  CONTINENTES,
  NOMBRE_REGION,
  REGIONES,
  DAYS,
  SEARCH_OFFERS,
  esc,
  escURL,
  existe,
  fetchJSON,
  fmtDate,
  fmtEUR,
  parseISO,
  pintarStats,
  stat,
  statPie,
} from "./base.js";
import {
  edreamsURL,
  escapadaHTML,
  grupo,
  pax,
  ponerCamas,
  ponerGrupo,
  porPersona,
  precioCorto,
} from "./precios.js";
import {
  compartirCeldaHTML,
  compartirPrincipalHTML,
  wireCompartir,
  vueloDelEnlace,
} from "./compartir.js";
import { deltaHTML, favBtn, sincronizarFavs, wireFavs } from "./favoritos.js";
import { HISTORIA, cargarHistoria, historiaHTML, minimoHTML } from "./historia.js";
import { cargarCamasHechas, conCama, openStays } from "./alojamiento.js";
import { banderaDe, isoDe } from "./paises.js";

export let OFFERS = [];
/* El día del levantamiento, para el rótulo del chollo. No es la fecha del
   vuelo: es la de la tanda, que es lo que dice si esto es de hoy. */
let DIA_DEL_SCAN = "";

/* Cuantas filas se enseñan de entrada. Con 120 ofertas y "una por destino"
   puesto salen unas 60, que en pantalla son 5.500px de tabla: la portada se
   convertia en un rollo de papel y los dos paneles y lo que llevas apuntado
   quedaban donde no llega nadie.

   Doce es lo que cabe de un vistazo sin hacer scroll infinito, y el resto está
   a un clic. No es paginacion: no se pierde nada, solo deja de estar todo
   desplegado a la vez. */
const DE_ENTRADA = 12;
let ampliado = false;

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
    if (existe("#offers")) pintarStats(stat("estado", "sin datos aún"));
    dejarDeCargar(
      "No se han podido leer los precios. Puede ser tu conexión, o que el último " +
        "scan no llegara a publicar. Vuelve a cargar en un rato."
    );
    return;
  }
  dejarDeCargar();
  DIA_DEL_SCAN = fmtDate(payload.generated_at);
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

  // Y en cuales de estos vuelos ya se busco cama: se marcan en la fila, para no
  // volver a pagar tres minutos de workflow por algo que ya esta hecho.
  await cargarCamasHechas();

  try {
    const mapa = await fetchJSON("data/continentes.json");
    for (const [continente, codigos] of Object.entries(mapa)) {
      for (let i = 0; i < codigos.length; i += 3) {
        CONTINENTES[codigos.slice(i, i + 3)] = continente;
      }
    }
    const presentes = [...new Set(OFFERS.map((o) => CONTINENTES[o.destination]).filter(Boolean))].sort();
    const hayLejos = OFFERS.some((o) => o.long_haul);

    /* Y las regiones, que son el escalon que falta entre el continente —Europa
       son 44 paises— y el pais suelto. Solo salen las que hoy tienen algun
       vuelo: una lista con quince opciones de las que doce no dan nada es peor
       que no tenerla. Se derivan del MISMO sitio que el backend
       (`regiones.REGIONES` -> `data/regiones.json`), para que no puedan decir
       cosas distintas. */
    let conRegion = [];
    try {
      const mapa = await fetchJSON("data/regiones.json");
      for (const [region, { n, c }] of Object.entries(mapa)) {
        NOMBRE_REGION[region] = n;
        for (let i = 0; i < c.length; i += 3) {
          (REGIONES[c.slice(i, i + 3)] ||= []).push(region);
        }
      }
      const vivas = new Set();
      OFFERS.forEach((o) => (REGIONES[o.destination] || []).forEach((r) => vivas.add(r)));
      conRegion = [...vivas].sort((a, b) =>
        (NOMBRE_REGION[a] || a).localeCompare(NOMBRE_REGION[b] || b)
      );
    } catch {
      /* sin regiones el filtro sigue siendo el de continentes de siempre */
    }

    $("#cont").insertAdjacentHTML(
      "beforeend",
      (hayLejos ? '<option value="__lejos__">Otros continentes</option>' : "") +
        presentes.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("") +
        (conRegion.length
          ? `<optgroup label="Regiones">${conRegion
              .map((r) => `<option value="r:${esc(r)}">${esc(NOMBRE_REGION[r] || r)}</option>`)
              .join("")}</optgroup>`
          : "")
    );
  } catch {
    $("#cont").parentElement.hidden = true;
  }

  montarPaises();

  $(".controls").hidden = false;
  const barra = document.querySelector(".filtros-movil");
  if (barra) barra.hidden = false;
  // Tocar un filtro vuelve a empezar por arriba: si no, una búsqueda que deja
  // tres resultados seguiría "ampliada" y el botón de ver más no tendría nada
  // que enseñar.
  ["#q", "#sort", "#price", "#unique", "#onlyWeekend", "#cont"].forEach((s) =>
    $(s).addEventListener("input", () => {
      ampliado = false;
      render();
    })
  );
  montarHoja();

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
    if (!pintarCompartido(target)) focusOffer(target);
  }
}

/* Un vuelo compartido que no está en el tablón de hoy (salió de una búsqueda,
   o ya no es chollo): se pinta arriba con lo que trae el enlace, diciendo de
   dónde sale el precio. Si sigue en el tablón, manda el tablón: su precio es
   el de hoy. */
function pintarCompartido(id) {
  if (OFFERS.some((x) => x.id === id)) return false;
  const o = vueloDelEnlace();
  if (!o) return false;
  let caja = document.getElementById("compartido");
  if (!caja) {
    caja = document.createElement("section");
    caja.id = "compartido";
    caja.className = "hero compartido";
    caja.setAttribute("aria-label", "El vuelo que te han pasado");
    $("#hero").before(caja);
  }
  const yaSalio = o.depart_date < new Date().toISOString().slice(0, 10);
  caja.innerHTML = `
    <p class="compartido-aviso">${
      yaSalio
        ? "<b>Este vuelo ya salió.</b> Te lo dejamos por si quieres ver cómo era; abajo, los chollos de hoy."
        : "<b>Este es el vuelo que te han pasado.</b> El precio es el de cuando lo compartieron: puede haber cambiado, confírmalo en «Ver vuelo»."
    }</p>
    ${heroTicket(o, true)}`;
  wireCompartir(caja, () => o);
  wireFavs(caja);
  const ticket = caja.querySelector(".ticket");
  ticket.classList.add("target");
  ticket.scrollIntoView({ block: "center", behavior: "smooth" });
  return true;
}


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
  // Y arriba, en el renglón del titular: lo primero que se lee es de cuándo es.
  const ante = document.getElementById("antetitulo");
  if (ante) ante.textContent = `Desde Madrid · actualizado ${texto}`;
}

function renderStats(payload) {
  // Solo el feed. `#stats` existe en las cuatro paginas, y mientras esto no
  // miraba de cual se trataba, buscar, seguimientos y el mapa enseñaban las
  // cifras del tablon de chollos en vez de las suyas.
  if (!existe("#offers") || !existe("#stats")) return;
  const best = OFFERS.reduce((a, o) => (o.discount_pct > (a?.discount_pct ?? -1) ? o : a), null);
  const findes = OFFERS.filter((o) => o.weekend).length;
  pintarStats(
    stat("ofertas vivas", OFFERS.length) +
      (best ? stat("mejor descuento", `−${Math.round(best.discount_pct)}%`, true) : "") +
      (best ? stat("desde", fmtEUR(Math.min(...OFFERS.map((o) => o.price)))) : "") +
      stat("escapadas de finde", findes) +
      statPie("actualizado", fmtDate(payload.generated_at) || "hoy")
  );
}

/* "3 de 120 ofertas · tope 200 € · 2 personas". Es lo que dice si lo que se
   está viendo es todo lo que hay o el resultado de haber filtrado de más. */
function renderCuenta(cuantas) {
  const el = document.getElementById("feedCuenta");
  if (!el) return;
  const gente = grupo();
  el.textContent =
    `${cuantas} de ${OFFERS.length} ofertas · tope ${$("#price").value} € · ` +
    `${gente} ${gente === 1 ? "persona" : "personas"}`;
  renderHoja(cuantas);
}

/* ------------------------------------------------------------- la hoja de
   filtros (solo movil)

   Nueve controles antes del primer vuelo era demasiado en una pantalla de
   375 px. Arriba se quedan dos —el buscador y "Filtros · N"— y el resto se
   guarda en una hoja que sube desde abajo. La hoja NO es otro formulario: es
   el MISMO `.controls`, con los mismos campos y los mismos oyentes; lo unico
   que cambia es donde se dibuja. Asi no hay dos estados que sincronizar. */

/* Cuantos filtros estan tocados. Es lo que convierte "Filtros" en
   "Filtros · 2" y enciende el boton: sin esto, desde la barra no se ve que
   quede algo puesto dentro de la hoja. */
function filtrosActivos() {
  const tope = $("#price");
  return (
    ($("#cont").value ? 1 : 0) +
    (paisesElegidos().size ? 1 : 0) +
    ($("#onlyWeekend").checked ? 1 : 0) +
    (!$("#unique").checked ? 1 : 0) +
    ($("#sort").value !== "score" ? 1 : 0) +
    (Number(tope.value) < Number(tope.max) ? 1 : 0) +
    (grupo() > 1 ? 1 : 0)
  );
}

function renderHoja(cuantas) {
  const boton = document.getElementById("filtrosBtn");
  if (!boton) return;
  const n = filtrosActivos();
  boton.textContent = n ? `Filtros · ${n}` : "Filtros";
  boton.classList.toggle("on", n > 0);
  const ver = document.getElementById("filtrosVer");
  if (ver) ver.textContent = `Ver ${cuantas} ${cuantas === 1 ? "oferta" : "ofertas"}`;
}

/* Un `<select>` es incomodo con el pulgar y esconde sus opciones. Dentro de la
   hoja se pintan como fichas, pero el `<select>` sigue siendo la fuente de
   verdad —lo rellena `data/continentes.json`— y es quien dispara el `input`
   que ya escucha el render. */
function chipsDe(sel) {
  if (!sel || sel.parentElement.querySelector(".hoja-chips")) return;
  const caja = document.createElement("div");
  caja.className = "hoja-chips hoja-solo";
  const pintar = () =>
    caja.querySelectorAll("[data-val]").forEach((x) =>
      x.setAttribute("aria-pressed", String(x.dataset.val === sel.value))
    );
  caja.innerHTML = [...sel.options]
    .map(
      (o) => `<button type="button" class="switch" data-val="${esc(o.value)}"
        aria-pressed="false">${esc(o.textContent)}</button>`
    )
    .join("");
  caja.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-val]");
    if (!b) return;
    sel.value = b.dataset.val;
    sel.dispatchEvent(new Event("input", { bubbles: true }));
    pintar();
  });
  sel.addEventListener("input", pintar);
  pintar();
  sel.parentElement.append(caja);
}

function montarHoja() {
  const hoja = document.getElementById("filtrosHoja");
  const boton = document.getElementById("filtrosBtn");
  const fondo = document.getElementById("filtrosFondo");
  const qm = document.getElementById("qm");
  if (!hoja || !boton || !fondo || !qm) return;

  chipsDe($("#cont"));
  chipsDe($("#sort"));

  // El buscador de la barra y el de la hoja son el mismo filtro escrito dos
  // veces: se copian el valor y solo uno dispara el render.
  qm.addEventListener("input", () => {
    $("#q").value = qm.value;
    $("#q").dispatchEvent(new Event("input", { bubbles: true }));
  });
  $("#q").addEventListener("input", () => {
    if (document.activeElement !== qm) qm.value = $("#q").value;
  });

  const abrir = () => {
    hoja.classList.add("abierta");
    fondo.hidden = false;
    boton.setAttribute("aria-expanded", "true");
    document.body.style.overflow = "hidden";
    const primero = hoja.querySelector("#filtrosCerrar");
    if (primero) primero.focus();
  };
  const cerrar = () => {
    hoja.classList.remove("abierta");
    fondo.hidden = true;
    boton.setAttribute("aria-expanded", "false");
    document.body.style.overflow = "";
  };

  boton.addEventListener("click", abrir);
  fondo.addEventListener("click", cerrar);
  ["#filtrosCerrar", "#filtrosVer"].forEach((sel) => {
    const b = document.querySelector(sel);
    if (b) b.addEventListener("click", cerrar);
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && hoja.classList.contains("abierta")) cerrar();
  });

  const limpiar = document.getElementById("filtrosLimpiar");
  if (limpiar) {
    limpiar.addEventListener("click", () => {
      $("#q").value = "";
      qm.value = "";
      $("#price").value = $("#price").max;
      $("#cont").value = "";
      $("#sort").value = "score";
      $("#unique").checked = true;
      $("#onlyWeekend").checked = false;
      const gr = $("#grupo");
      if (gr) {
        gr.value = "1";
        ponerGrupo("1");
      }
      // Uno solo basta: todos van al mismo `render()`.
      $("#cont").dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  renderHoja(0);
}

/* EL MAPAMUNDI. El único filtro de sitio: sustituye al desplegable «Zona»,
   que se queda escondido como fuente de verdad (lo rellena
   `data/continentes.json` y su `input` es lo que repinta el feed). El botón
   dice qué hay elegido y abre el mapa (`mundo.js`), con las zonas arriba. */
function montarPaises() {
  if (existe("#mundoBtn") || !existe("#cont")) return;
  const campo = $("#cont").closest(".field");
  const zonas = () =>
    [...$("#cont").options].filter((o) => o.value).map((o) => ({ valor: o.value, nombre: o.textContent }));
  const nombreZona = () => (zonas().find((z) => z.valor === $("#cont").value) || {}).nombre || "";
  campo.insertAdjacentHTML(
    "afterend",
    `<div class="field"><label for="mundoBtn">Zona</label>
      <button type="button" id="mundoBtn" class="mundo-btn">${esc(rotuloPaises(nombreZona()))}</button></div>`
  );
  campo.hidden = true;
  const rotular = () => ($("#mundoBtn").textContent = rotuloPaises(nombreZona()));
  $("#cont").addEventListener("input", rotular);
  $("#mundoBtn").addEventListener("click", () => {
    // Cuántos vuelos hay hoy en cada país: el selector lo dice en cada fila.
    const conChollo = new Map();
    OFFERS.forEach((o) => {
      const iso = isoDe(o.destination_country);
      if (iso) conChollo.set(iso, (conChollo.get(iso) || 0) + 1);
    });
    abrirMundo(
      conChollo,
      () => {
        rotular();
        $("#cont").dispatchEvent(new Event("input", { bubbles: true }));
      },
      {
        zonas: zonas(),
        zona: $("#cont").value,
        alZona: (v) => {
          $("#cont").value = v;
          $("#cont").dispatchEvent(new Event("input", { bubbles: true }));
        },
      }
    );
  });
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
      (lejos
        ? o.long_haul
        : !continente ||
          (continente.startsWith("r:")
            ? (REGIONES[o.destination] || []).includes(continente.slice(2))
            : CONTINENTES[o.destination] === continente)) &&
      (lejos || !o.long_haul) &&
      (!paisesElegidos().size || paisesElegidos().has(isoDe(o.destination_country))) &&
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

/* EL CHOLLO DEL DÍA. La única lámina invertida de la página: fondo claro sobre
   fondo oscuro (y al revés en el tema claro). Es lo que la separa del feed sin
   necesidad de un borde grueso ni de una sombra.

   Dos columnas: a la izquierda el sitio y los cuatro tramos del viaje; a la
   derecha el precio grande y los dos botones. El precio va aparte a propósito
   —es lo que se mira primero y lo único que decide— y el desglose de debajo es
   lo que nadie más te da: lo que sale de verdad para los que vais. */
function heroTicket(o, compartido = false) {
  const pais = [banderaDe(o.destination_country), o.destination_country]
    .filter(Boolean)
    .join(" ");
  const sub = [pais, o.airline, escalas(o), o.weekend ? "escapada de finde" : ""]
    .filter(Boolean)
    .join(" · ");
  const extra = [o.hidden_city ? AVISO_HIDDEN : "", altsHTML(o)].filter(Boolean).join("");
  const gente = Math.max(1, pax(o) > 1 ? pax(o) : grupo());
  const esc_ = escapadaHTML(o);
  return `
    <article class="ticket" id="offer-${esc(o.id)}">
      ${huecoFoto(o, "ticket-foto")}
      <div class="ticket-izq">
        <div class="ticket-top">
          ${
            compartido
              ? `<span class="kicker">te lo han pasado</span>
                 <span class="kicker-tag">precio de cuando lo compartieron</span>`
              : `<span class="kicker">chollo</span>
                 <span class="kicker-tag">del día · ${esc(DIA_DEL_SCAN || "hoy")}</span>`
          }
          ${conCama(o.id) ? '<span class="kicker-tag cama-ok">cama buscada</span>' : ""}
          ${favBtn(o)}
        </div>
        <h2 class="dest">${esc(o.destination_name || o.destination)}<small>${esc(sub)}</small></h2>
        <dl class="legs">
          ${leg("Ida", o.depart_date, o.depart_time, o.arrive_time, o.weekend)}
          ${leg("Vuelta", o.return_date, o.return_time, o.return_arrive_time, o.weekend)}
          <div><dt>Noches</dt><dd class="dias">${o.nights || "—"}</dd></div>
          ${
            o.useful_hours
              ? `<div><dt>Viaje real</dt><dd class="useful">${Math.round(o.useful_hours)} h
                   <small>${o.price_per_hour} €/h</small></dd></div>`
              : "<div><dt>Viaje real</dt><dd class=\"useful\">—</dd></div>"
          }
        </dl>
        ${extra ? `<div class="hero-extra">${extra}</div>` : ""}
      </div>
      <div class="ticket-der">
        <div class="ticket-precio">
          <div class="ticket-cab">
            <span class="amount">${Math.round(porPersona(o))}<span>€</span></span>
            ${
              o.discount_pct >= 5
                ? `<span class="stamp">−${Math.round(o.discount_pct)}%</span>`
                : ""
            }
            ${minimoHTML(o)}
          </div>
          <span class="per-person">por persona${o.return_date ? ", ida y vuelta" : ""}</span>
          <span class="ticket-notas">
            ${
              gente > 1
                ? `<span><span>${gente} personas</span><b>${fmtEUR(porPersona(o) * gente)}</b></span>`
                : ""
            }
            ${
              o.baseline > o.price
                ? `<span><span>lo habitual</span><b class="was">${fmtEUR(o.baseline)}</b></span>`
                : ""
            }
            ${esc_ ? `<span><span>+ cama</span><b>${esc_}</b></span>` : ""}
          </span>
        </div>
        <div class="actions">
          ${compartirPrincipalHTML(o)}
          <a class="btn ghost" href="${escURL(o.deep_link)}" target="_blank" rel="noopener">Ver vuelo</a>
          ${
            compartido
              ? ""
              : `<button class="btn ${conCama(o.id) ? "deep-ghost" : "ghost"}" data-stay="${esc(o.id)}"
            >${conCama(o.id) ? "Ver el alojamiento" : "Buscar alojamiento"}</button>`
          }
          ${
            o.airline_link
              ? `<a class="btn ghost" href="${escURL(o.airline_link)}" target="_blank" rel="noopener">
                   Reservar en ${esc(o.airline_link_label || o.airline)}</a>`
              : ""
          }
        </div>
      </div>
    </article>`;
}

/* La bandera del país, delante de su nombre. Se reconoce antes que el nombre, y
   en una lista de veinte destinos eso es la diferencia entre leer y ojear.

   Va DENTRO de `.country` a propósito, y no en una columna suya: esa rejilla ya
   se comió el nombre de la ciudad una vez, y el país es justo el elemento que
   cede primero cuando falta sitio. Así la bandera se encoge con él.

   `aria-hidden`: el país ya está escrito al lado, y un lector de pantalla que
   diga «bandera de Italia, Italia» sobra. */
const bandera = (o) => {
  const b = banderaDe(o.destination_country);
  return b ? `<i class="bandera" aria-hidden="true">${b}</i>` : "";
};

/* El resto, como el panel de salidas de un aeropuerto: una línea por vuelo. */
export function boardRow(o, i) {
  /* Si este vuelo ya tiene la cama buscada se marca, y fuerte: buscarla nueva
     son tres minutos de workflow y aqui esta hecha, con sus precios, a un clic.
     Es lo que mas cambia lo que haces con la fila, asi que no puede ser un
     detalle escondido en el desplegable. */
  const cama = conCama(o.id);
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
    <div class="brow${cama ? " con-cama" : ""}" id="offer-${esc(o.id)}"
         data-open="${esc(o.id)}" role="button" tabindex="0" aria-expanded="false"
         style="animation-delay:${Math.min(i, 14) * 35}ms">
      ${favBtn(o)}
      <span class="dest-cell">
        <span class="iata ${o.hidden_city ? "hidden" : ""}">${esc(o.destination)}</span>
        <span class="city">${esc(o.destination_name || o.destination)}</span>
        <span class="country">${bandera(o)}${esc(o.destination_country || "")}</span>
      </span>
      <span class="when ${o.weekend ? "weekend" : ""}"><b>${fmtDate(
        o.depart_date,
        true
      )}</b>${hora}${vuelta}${
        o.nights || cama
          ? `<small>${o.nights ? `${o.nights} noches` : ""}${
              o.nights && cama ? " · " : ""
            }${cama ? '<i class="cama-ok">cama buscada</i>' : ""}</small>`
          : ""
      }</span>
      <span class="airline">${esc(o.airline || o.provider)}<small>${escalas(o)}${
        o.useful_hours ? ` · ${Math.round(o.useful_hours)} h de viaje` : ""
      }${o.long_haul ? " · larga distancia" : ""}</small></span>
      <span class="price">${precioCorto(
        o,
        o.discount_pct >= 5 ? `<small class="off">−${Math.round(o.discount_pct)}%</small>` : "",
        minimoHTML(o) + deltaHTML(o) + escapadaHTML(o)
      )}</span>
      ${compartirCeldaHTML(o)}
      <div class="brow-detail" hidden></div>
    </div>`;
}

/* EL DETALLE DE UN VUELO. Cada tramo como un trayecto que se lee de un
   vistazo («16:10 MAD ──✈── 18:30 BGY»), una línea con lo demás, y los
   botones ordenados: «Ver vuelo» manda, y el resto son accesos con su icono,
   en fila en el ordenador y en una rejilla de cuatro en el móvil (antes eran
   seis píldoras iguales que en el móvil se amontonaban). Los `data-*` y los
   textos son los de siempre: `wireDetalle` y `wireCompartir` los cablean. */
const ICO = {
  cama: '<path d="M3 18v-8m0 4h18m0 4v-6a3 3 0 0 0-3-3h-7v6"/><circle cx="7" cy="11" r="1.6"/>',
  lupa: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>',
  cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4m6-4v4"/>',
  comp: '<path d="M12 4v11m0-11-4 4m4-4 4 4"/><path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/>',
  avion: '<path d="M10.5 13.5 3 11l1.5-1.5L12 10l4.5-5a1.6 1.6 0 0 1 2.4 2.1L14 11.5l.5 7.5L13 20.5l-2.5-7"/>',
};
const ico = (d) =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;

function duracion(sale, llega) {
  const m = (t) => {
    const [h, mm] = String(t || "").split(":").map(Number);
    return Number.isFinite(h) && Number.isFinite(mm) ? h * 60 + mm : null;
  };
  const a = m(sale);
  const b = m(llega);
  if (a === null || b === null) return "";
  const d = (b - a + 1440) % 1440;
  return d ? `${Math.floor(d / 60)} h${d % 60 ? ` ${String(d % 60).padStart(2, "0")}` : ""}` : "";
}

function tramoHTML(rotulo, de, a, iso, sale, llega) {
  if (!iso) return "";
  const dur = duracion(sale, llega);
  return `<div class="det-tramo">
      <span class="det-rot">${rotulo} · ${esc(fmtDate(iso, true))}</span>
      ${
        sale
          ? `<div class="det-linea">
              <span class="det-punto"><b>${esc(sale)}</b><small>${esc(de || "")}</small></span>
              <span class="det-raya" aria-hidden="true">${ico(ICO.avion)}${dur ? `<em>${esc(dur)}</em>` : ""}</span>
              <span class="det-punto fin"><b>${esc(llega || "—")}</b><small>${esc(a || "")}</small></span>
            </div>`
          : `<p class="det-sin-hora">${esc(de || "")} → ${esc(a || "")} · horario en el enlace</p>`
      }
    </div>`;
}

function detalleHTML(o) {
  const nota = [
    escalas(o),
    o.airline,
    o.useful_hours ? `${Math.round(o.useful_hours)} h de viaje real · ${o.price_per_hour} €/h` : "",
  ].filter(Boolean);
  return `
    ${o.hidden_city ? AVISO_HIDDEN : ""}
    <div class="det-viaje">
      ${tramoHTML("Ida", o.origin, o.destination, o.depart_date, o.depart_time, o.arrive_time)}
      ${tramoHTML("Vuelta", o.destination, o.origin, o.return_date, o.return_time, o.return_arrive_time)}
    </div>
    <p class="det-nota">${nota.map(esc).join(" · ")}</p>
    ${historiaHTML(o)}
    ${altsHTML(o)}
    <div class="det-acciones">
      <a class="btn primary det-ver" href="${escURL(o.deep_link)}" target="_blank" rel="noopener">Ver vuelo</a>
      ${
        o.airline_link
          ? `<a class="btn ghost det-ver" href="${escURL(o.airline_link)}" target="_blank" rel="noopener">
               Reservar en ${esc(o.airline_link_label || o.airline)}</a>`
          : ""
      }
      <div class="det-mas">
        <button type="button" class="det-accion${conCama(o.id) ? " hecha" : ""}" data-stay="${esc(o.id)}"
          >${ico(ICO.cama)}<span>${conCama(o.id) ? "Ver el alojamiento" : "Buscar alojamiento"}</span></button>
        ${
          edreamsURL(o)
            ? `<a class="det-accion" href="${escURL(edreamsURL(o))}" target="_blank" rel="noopener"
                 title="Se abre con tu sesión: si tienes Prime, verás tu precio de socio"
                 >${ico(ICO.lupa)}<span>Comparar en eDreams</span></a>`
            : ""
        }
        <button type="button" class="det-accion" data-ics="${esc(o.id)}">${ico(ICO.cal)}<span>Al calendario</span></button>
        <button type="button" class="det-accion" data-share="${esc(o.id)}">${ico(ICO.comp)}<span>Compartir</span></button>
      </div>
    </div>`;
}

/* El detalle se pinta dos veces: una al abrirlo y otra cuando llega el
   historico de precios, asi que sus botones se cablean aparte. */
function wireDetalle(caja, o) {
  wireCompartir(caja, () => o);
  caja.querySelectorAll("[data-stay]").forEach((b) =>
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (!OFFERS.some((x) => x.id === o.id)) OFFERS.push(o);
      openStays(o.id);
    })
  );
}

/* La fila se anuncia como `role="button"` y se despliega, asi que tiene que
   decir si esta abierta o cerrada: sin `aria-expanded`, quien la oye recibe un
   boton sin estado y no sabe si pulsarlo abre algo o lo cierra. El atributo se
   pone al pintar y se mueve aqui, que es el unico sitio que abre y cierra. */
function toggleRow(fila) {
  const caja = fila.querySelector(".brow-detail");
  if (!caja) return;
  if (!caja.hidden) {
    caja.hidden = true;
    fila.classList.remove("open");
    fila.setAttribute("aria-expanded", "false");
    return;
  }
  const o = OFFERS.find((x) => x.id === fila.dataset.open) || SEARCH_OFFERS[fila.dataset.open];
  if (!o) return;
  caja.innerHTML = detalleHTML(o);
  caja.hidden = false;
  fila.classList.add("open");
  fila.setAttribute("aria-expanded", "true");
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
  // El «compartir» de la columna: abre la hoja sin desplegar la fila.
  wireCompartir(raiz, (id) => OFFERS.find((x) => x.id === id) || SEARCH_OFFERS[id]);
  raiz.querySelectorAll(".brow[data-open]").forEach((fila) => {
    fila.addEventListener("click", (ev) => {
      if (ev.target.closest("a, button")) return; // los enlaces hacen lo suyo
      toggleRow(fila);
    });
    fila.addEventListener("keydown", (ev) => {
      // Con el foco en un botón de dentro —seguir, compartir— el Enter es de
      // ese botón. Sin esta línea la fila se abría además de lo que pulsabas,
      // que con el teclado es la única forma de usarla.
      if (ev.target.closest("a, button")) return;
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
  ponerFotos($("#hero"));
  // La primera va arriba, en la lámina: el resto es el feed.
  const resto = list.slice(1);
  const visibles = ampliado ? resto : resto.slice(0, DE_ENTRADA);
  $("#offers").innerHTML = visibles.map(boardRow).join("");
  $("#boardHead").hidden = list.length < 2;
  $("#empty").hidden = list.length > 0;
  renderCuenta(list.length);
  pintarVerMas(resto.length - visibles.length);

  document.querySelectorAll(".hero [data-stay]").forEach((el) =>
    el.addEventListener("click", () => openStays(el.dataset.stay))
  );
  wireCompartir($("#hero"), (id) => list.find((x) => x.id === id));
  wireFavs($("#hero"));
  wireRows();
}

/* El botón de "ver el resto". Se pinta solo cuando queda algo por enseñar, y
   al pulsarlo desaparece: no vuelve a plegarse, porque plegar una lista que
   acabas de abrir es quitarle a alguien lo que estaba mirando. */
function pintarVerMas(quedan) {
  const caja = document.getElementById("verMas");
  if (!caja) return;
  caja.hidden = quedan <= 0;
  if (quedan <= 0) return;
  caja.innerHTML = `<button class="btn ghost" type="button">Ver ${quedan} viaje${
    quedan === 1 ? "" : "s"
  } más</button>`;
  caja.querySelector("button").addEventListener("click", () => {
    ampliado = true;
    render();
    if (typeof tfAnunciar === "function") tfAnunciar(`${quedan} viajes más en la lista.`);
  });
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
  // Puede estar más allá de las doce primeras: se despliega el resto.
  ampliado = true;
  if (o.price > Number($("#price").value)) $("#price").value = $("#price").max;
  $("#unique").checked = false;
  $("#q").value = "";
  render();
}

