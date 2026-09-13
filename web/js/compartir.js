/* compartir.js — Sacar un viaje de aqui: al calendario y a quien te apetezca.

   POR QUE HACE FALTA. Un chollo que sale hoy se vuela en noviembre. Hasta ahora
   lo unico que se podia hacer con el era marcarlo como favorito, y los
   favoritos viven en el `localStorage` de ESE navegador: cambias de movil y se
   quedan atras. Un `.ics` en tu calendario y un enlace en un chat sobreviven a
   cualquier cosa que le pase a esta web.

   Las dos cosas se hacen aqui, en el navegador, sin pedirle nada a nadie: el
   calendario es un fichero de texto que se genera al vuelo y el enlace es el
   `?offer=` que la web ya sabe abrir resaltado. */

import { esc, escURL, fmtDate } from "./base.js";

/* ------------------------------------------------------------ calendario */

/* Las horas van SIN zona (hora flotante) a proposito. Un vuelo sale a las 17:10
   de Madrid y aterriza a las 19:45 hora de Napoles, y aqui no sabemos la zona de
   cada aeropuerto: poner una Z convertiria las dos a UTC con la zona equivocada
   y el calendario enseñaria horas que no son. Flotante significa "las 17:10 que
   pone el billete", que es exactamente lo que se quiere ver.

   Y sin hora, dia entero: inventar las 12:00 para que "quede bonito" acaba con
   alguien en el aeropuerto a la hora equivocada. */
const zPad = (n) => String(n).padStart(2, "0");

function comoFechaICS(iso, hora) {
  const dia = String(iso || "").slice(0, 10).replace(/-/g, "");
  if (!dia) return null;
  if (!hora) return { valor: dia, entero: true };
  const [h, m] = String(hora).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return { valor: dia, entero: true };
  return { valor: `${dia}T${zPad(h)}${zPad(m)}00`, entero: false };
}

/* Un dia entero en un `.ics` termina el dia SIGUIENTE: DTEND es exclusivo. Sin
   esto, un vuelo del 13 sale en el calendario como "12 al 13". */
function diaSiguiente(yyyymmdd) {
  const d = new Date(
    Number(yyyymmdd.slice(0, 4)),
    Number(yyyymmdd.slice(4, 6)) - 1,
    Number(yyyymmdd.slice(6, 8)) + 1
  );
  return `${d.getFullYear()}${zPad(d.getMonth() + 1)}${zPad(d.getDate())}`;
}

/* Los saltos de linea de un `.ics` son CRLF y el texto lleva escapadas propias:
   una coma sin escapar parte el campo y el evento entra sin la mitad del
   titulo. */
const textoICS = (s) =>
  String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");

/* El final de un tramo. Un vuelo que sale a las 21:55 y aterriza a las 00:30 lo
   hace AL DIA SIGUIENTE: sin esto el evento terminaria antes de empezar, y un
   `.ics` con DTEND anterior a DTSTART no lo abre ningun calendario. */
function finDeTramo(iso, sale, llega) {
  const inicio = comoFechaICS(iso, sale);
  if (!inicio) return null;
  if (inicio.entero) return { valor: diaSiguiente(inicio.valor), entero: true };
  const fin = comoFechaICS(iso, llega || sale);
  if (!fin || fin.entero) return inicio;
  if (llega && sale && llega < sale) {
    return { valor: `${diaSiguiente(fin.valor.slice(0, 8))}${fin.valor.slice(8)}`, entero: false };
  }
  return fin;
}

function evento({ uid, sello, inicio, fin, titulo, detalle, sitio }) {
  const fecha = (f, etiqueta) =>
    f.entero ? `${etiqueta};VALUE=DATE:${f.valor}` : `${etiqueta}:${f.valor}`;
  return [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${sello}`,
    fecha(inicio, "DTSTART"),
    fecha(fin, "DTEND"),
    `SUMMARY:${textoICS(titulo)}`,
    `DESCRIPTION:${textoICS(detalle)}`,
    sitio ? `LOCATION:${textoICS(sitio)}` : "",
    "END:VEVENT",
  ].filter(Boolean);
}

/* Dos eventos, ida y vuelta, no uno que abarque el viaje entero: lo que quieres
   en el calendario es la hora a la que sales de casa, no una franja de colores
   de tres dias sobre el resto de tus cosas. */
export function calendarioICS(o) {
  const destino = o.destination_name || o.destination;
  const sello = `${new Date().toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
  const url = `${location.origin}${location.pathname.replace(/[^/]*$/, "")}?offer=${o.id}`;
  const precio = Math.round(Number(o.price) || 0);
  const detalle = [
    `${o.origin} → ${o.destination} · ${o.airline || o.provider}`,
    precio ? `${precio} € ${o.adults > 1 ? `para ${o.adults}` : "ida y vuelta"}` : "",
    o.deep_link || "",
    url,
  ]
    .filter(Boolean)
    .join("\n");

  const lineas = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TripFinder//ES",
    "CALSCALE:GREGORIAN",
  ];

  const ida = comoFechaICS(o.depart_date, o.depart_time);
  if (ida) {
    lineas.push(
      ...evento({
        uid: `${o.id}-ida@tripfinder`,
        sello,
        inicio: ida,
        fin: finDeTramo(o.depart_date, o.depart_time, o.arrive_time) || ida,
        titulo: `Vuelo ${o.origin} → ${destino}`,
        detalle,
        sitio: `${o.origin} · aeropuerto`,
      })
    );
  }
  const vuelta = comoFechaICS(o.return_date, o.return_time);
  if (vuelta) {
    lineas.push(
      ...evento({
        uid: `${o.id}-vuelta@tripfinder`,
        sello,
        inicio: vuelta,
        fin: finDeTramo(o.return_date, o.return_time, o.return_arrive_time) || vuelta,
        titulo: `Vuelo ${destino} → ${o.origin}`,
        detalle,
        sitio: `${o.destination} · aeropuerto`,
      })
    );
  }
  lineas.push("END:VCALENDAR");
  // CRLF: hay clientes (Outlook entre ellos) que con \n solo no abren el fichero.
  return lineas.join("\r\n");
}

function descargar(nombre, texto) {
  const blob = new Blob([texto], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Sin esto el blob se queda en memoria hasta que se cierra la pestaña.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function alCalendario(o) {
  if (!o || !o.depart_date) return false;
  const destino = (o.destination_name || o.destination || "viaje")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .toLowerCase();
  descargar(`tripfinder-${destino}-${o.depart_date}.ics`, calendarioICS(o));
  if (typeof tfAnunciar === "function") tfAnunciar("Viaje descargado para tu calendario.");
  return true;
}

/* -------------------------------------------------------------- compartir */

export function enlaceDe(o) {
  const base = `${location.origin}${location.pathname.replace(/[^/]*$/, "")}`;
  return `${base}?offer=${encodeURIComponent(o.id)}`;
}

/* El texto que acompaña al enlace en un chat. Corto a proposito: lo que se
   pega en WhatsApp tiene que caber en la burbuja sin que nadie lo despliegue. */
function resumen(o) {
  const destino = o.destination_name || o.destination;
  const precio = Math.round(Number(o.price) || 0);
  return [
    `${o.origin} → ${destino}`,
    precio ? `${precio} €` : "",
    o.depart_date ? fmtDate(o.depart_date, true) : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/* La hoja.

   POR QUE UNA HOJA Y NO `navigator.share` A SECAS. En el movil, `share` abre el
   menu del sistema y es justo lo que se quiere; en un escritorio no existe
   —Chrome y Firefox de sobremesa no lo traen— y lo unico que quedaba era
   copiar el enlace al portapapeles y decirlo en un boton. Eso es la mitad de la
   funcion: quien comparte un chollo lo manda por WhatsApp o por correo, y esos
   dos son enlaces normales que funcionan en cualquier sitio. La hoja los pone
   todos, y deja el menu del sistema como una opcion mas donde lo haya. */
let VIAJE = null;

function ficha(o) {
  const destino = o.destination_name || o.destination;
  const precio = Math.round(porPersonaSegura(o));
  const fechas = o.depart_date
    ? `${fmtDate(o.depart_date, true)}${o.return_date ? ` → ${fmtDate(o.return_date, true)}` : ""}`
    : "";
  const gente = Math.max(1, Number(o.adults) || 1);
  return `
    <div class="hoja-ficha-cab">
      <b>${esc(destino)}</b>
      <span>${precio} €</span>
    </div>
    <div class="hoja-ficha-pie">
      ${esc(o.origin)} → ${esc(o.destination)}${fechas ? ` · ${esc(fechas)}` : ""}<br>
      ${esc(o.airline || o.provider || "")} · ${gente === 1 ? "1 persona" : `${gente} personas`}
    </div>`;
}

/* El precio que se enseña es por persona, como en el resto de la web: `price`
   es el total del grupo y enseñarlo aqui sin decirlo asustaria sin motivo. */
function porPersonaSegura(o) {
  const total = Number(o.price) || 0;
  return total / Math.max(1, Number(o.adults) || 1);
}

function appsHTML(url, texto) {
  const q = encodeURIComponent(`${texto} ${url}`);
  const apps = [
    ["WhatsApp", `https://wa.me/?text=${q}`],
    ["Telegram", `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(texto)}`],
    ["Correo", `mailto:?subject=${encodeURIComponent(`TripFinder · ${texto}`)}&body=${q}`],
  ]
    .map(
      ([nombre, destino]) =>
        `<a class="btn ghost" href="${escURL(destino)}" target="_blank" rel="noopener">${esc(nombre)}</a>`
    )
    .join("");
  // El menu del sistema solo donde existe: un boton que no hace nada es peor
  // que un boton que no esta.
  return apps + (navigator.share ? '<button type="button" class="btn ghost" data-sistema>Más apps del móvil</button>' : "");
}

export function abrirHoja(o) {
  const caja = document.getElementById("hojaCompartir");
  if (!caja) return false;
  wireHoja();
  VIAJE = o;
  const url = enlaceDe(o);
  const texto = resumen(o);

  document.getElementById("hojaFicha").innerHTML = ficha(o);
  const campo = document.getElementById("hojaURL");
  campo.textContent = url;
  campo.title = url;
  document.getElementById("hojaApps").innerHTML = appsHTML(url, texto);

  const copiar = document.getElementById("hojaCopiar");
  copiar.textContent = "Copiar";
  copiar.disabled = false;

  caja.hidden = false;
  if (typeof tfAbrirDialogo === "function") {
    tfAbrirDialogo(caja, { foco: () => copiar, alCerrar: () => (caja.hidden = true) });
  }
  return true;
}

function cerrarHoja() {
  const caja = document.getElementById("hojaCompartir");
  if (!caja) return;
  if (typeof tfCerrarDialogo === "function") tfCerrarDialogo(caja);
  else caja.hidden = true;
}

async function copiarEnlace() {
  if (!VIAJE) return;
  const url = enlaceDe(VIAJE);
  const boton = document.getElementById("hojaCopiar");
  try {
    await navigator.clipboard.writeText(url);
    avisar(boton, "copiado");
    if (typeof tfAnunciar === "function") tfAnunciar("Enlace copiado al portapapeles.");
  } catch {
    // Sin permiso de portapapeles (o sin HTTPS): se enseña para copiar a mano.
    window.prompt("Copia el enlace:", url);
  }
}

/* La hoja es una sola y vive en el armazon de la pagina: no se crea y se
   destruye con cada viaje, asi que sus botones se cablean una vez. Se hace al
   abrirla por primera vez y no al cargar el modulo, porque aqui solo
   `arranque.js` hace cosas al cargar (lo comprueba `test_montar`). */
let hojaCableada = false;

function wireHoja() {
  const caja = document.getElementById("hojaCompartir");
  if (!caja || hojaCableada) return;
  hojaCableada = true;
  document.getElementById("hojaCopiar").addEventListener("click", copiarEnlace);
  document.getElementById("hojaCompartirClose").addEventListener("click", cerrarHoja);
  caja.addEventListener("click", (ev) => {
    if (ev.target === caja) cerrarHoja();
  });
  document.getElementById("hojaICS").addEventListener("click", () => {
    if (VIAJE) alCalendario(VIAJE);
  });
  document.getElementById("hojaApps").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-sistema]");
    if (!b || !VIAJE) return;
    navigator
      .share({
        title: `TripFinder · ${VIAJE.destination_name || VIAJE.destination}`,
        text: resumen(VIAJE),
        url: enlaceDe(VIAJE),
      })
      .catch(() => {});
  });
}

/* Compartir un viaje: se abre la hoja. Si por lo que sea no esta en la pagina
   —el mapa y la 404 no la llevan—, se cae al portapapeles, que es lo que habia
   antes y sigue siendo mejor que nada. */
export async function compartir(o, boton) {
  if (abrirHoja(o)) return "hoja";
  try {
    await navigator.clipboard.writeText(enlaceDe(o));
    avisar(boton, "enlace copiado");
    return "copiado";
  } catch {
    window.prompt("Copia el enlace:", enlaceDe(o));
    return "a mano";
  }
}

function avisar(boton, texto) {
  if (!boton) return;
  const antes = boton.textContent;
  boton.textContent = texto;
  boton.disabled = true;
  setTimeout(() => {
    boton.textContent = antes;
    boton.disabled = false;
  }, 1600);
}

/* Los tres sitios donde aparece compartir, cada uno con su peso.

   · En el chollo del dia, como boton principal: es el viaje que apetece pasar.
   · En una fila, como «compartir» en su columna, sin abrir nada.
   · Al abrir una fila, junto a «al calendario» y detras del filo que los separa
     de Ver vuelo y Alojamiento: ahi ya no son la accion principal. */
export function compartirPrincipalHTML(o) {
  return `<button class="btn primary" data-share="${esc(o.id)}">Compartir</button>`;
}

export function compartirCeldaHTML(o) {
  return `<span class="compartir-cell"><button type="button" class="compartir-btn"
    data-share="${esc(o.id)}" aria-label="Compartir este viaje">compartir</button></span>`;
}

export function botonesHTML(o) {
  return `
    <span class="filo" aria-hidden="true"></span>
    <button class="btn ghost" data-ics="${esc(o.id)}">Al calendario</button>
    <button class="btn ghost" data-share="${esc(o.id)}">Compartir</button>`;
}

/* Se cablea sobre el contenedor que se acaba de pintar.

   UNA SOLA VEZ POR BOTON, y de ahi el `data-cableado`. El chollo del dia cae
   dentro de dos llamadas —la suya y la de `wireRows(document)`— y con dos
   oyentes el mismo clic abria la hoja dos veces: la segunda apertura cierra la
   primera (asi se relevan los dialogos) y lo que veias era que el boton no
   hacia nada. */
function cablear(raiz, atributo, accion) {
  raiz.querySelectorAll(`[data-${atributo}]`).forEach((b) => {
    if (b.dataset.cableado) return;
    b.dataset.cableado = "1";
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      accion(b.dataset[atributo], b);
    });
  });
}

export function wireCompartir(raiz, buscar) {
  if (!raiz) return;
  cablear(raiz, "ics", (id) => {
    const o = buscar(id);
    if (o) alCalendario(o);
  });
  cablear(raiz, "share", (id, boton) => {
    const o = buscar(id);
    if (o) compartir(o, boton);
  });
}
