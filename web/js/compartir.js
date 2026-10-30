/* compartir.js — Sacar un viaje de aqui: al calendario y a quien te apetezca.

   POR QUE HACE FALTA. Un chollo que sale hoy se vuela en noviembre. Hasta ahora
   lo unico que se podia hacer con el era marcarlo como favorito, y los
   favoritos viven en el `localStorage` de ESE navegador: cambias de movil y se
   quedan atras. Un `.ics` en tu calendario y un enlace en un chat sobreviven a
   cualquier cosa que le pase a esta web.

   Las dos cosas se hacen aqui, en el navegador, sin pedirle nada a nadie: el
   calendario es un fichero de texto que se genera al vuelo y el enlace es el
   `?offer=` que la web ya sabe abrir resaltado. */

import { esc, escURL, fmtDate, tonoDe } from "./base.js";

/* ------------------------------------------------------------ calendario */

/* Las horas van SIN zona (hora flotante) a proposito. Un vuelo sale a las 17:10
   de Madrid y aterriza a las 19:45 hora de Napoles, y aqui no sabemos la zona de
   cada aeropuerto: poner una Z convertiria las dos a UTC con la zona equivocada
   y el calendario enseñaria horas que no son. Flotante significa "las 17:10 que
   pone el billete", que es exactamente lo que se quiere ver.

   Y sin hora, dia entero: inventar las 12:00 para que "quede bonito" acaba con
   alguien en el aeropuerto a la hora equivocada. */
const zPad = (n) => String(n).padStart(2, "0");

export function comoFechaICS(iso, hora) {
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
export const textoICS = (s) =>
  String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");

/* El final de un tramo. Un vuelo que sale a las 21:55 y aterriza a las 00:30 lo
   hace AL DIA SIGUIENTE: sin esto el evento terminaria antes de empezar, y un
   `.ics` con DTEND anterior a DTSTART no lo abre ningun calendario. */
export function finDeTramo(iso, sale, llega) {
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

export function evento({ uid, sello, inicio, fin, titulo, detalle, sitio }) {
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

export function descargar(nombre, texto) {
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

/* EL VUELO VA DENTRO DEL ENLACE. Con solo el id, quien lo abría veía el vuelo
   si seguía en el tablón de hoy; uno sacado de una búsqueda, o uno que ya no
   es chollo, no estaba en ningún sitio y se quedaba en la portada sin más.
   Ahora el enlace lleva también lo que hace falta para enseñarlo (`v=`), y la
   portada lo pinta aunque no lo encuentre. */
const CAMPOS_ENLACE = [
  "id", "provider", "origin", "destination", "depart_date", "return_date", "price", "currency",
  "origin_name", "destination_name", "destination_country", "airline", "airline_back", "deep_link",
  "airline_link", "airline_link_label", "adults", "nights", "depart_time", "arrive_time", "return_time",
  "return_arrive_time", "stops", "weekend", "baseline", "discount_pct", "useful_hours", "price_per_hour",
];

const aB64 = (texto) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(texto))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const deB64 = (b64) =>
  new TextDecoder().decode(
    Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))
  );

export function enlaceDe(o) {
  const base = `${location.origin}${location.pathname.replace(/[^/]*$/, "")}`;
  const datos = Object.fromEntries(
    CAMPOS_ENLACE.filter((k) => o[k] !== undefined && o[k] !== null && o[k] !== "" && o[k] !== false).map((k) => [k, o[k]])
  );
  let v = "";
  try {
    v = `&v=${aB64(JSON.stringify(datos))}`;
  } catch {
    /* sin datos, el enlace de siempre */
  }
  return `${base}?offer=${encodeURIComponent(o.id)}${v}`;
}

/* El vuelo que trae un enlace compartido, o null. Solo lo que se sabe pintar,
   y con los enlaces de reservar pasados por `escURL` al pintarlos. */
export function vueloDelEnlace(params = new URLSearchParams(location.search)) {
  const v = params.get("v");
  if (!v) return null;
  try {
    const d = JSON.parse(deB64(v));
    if (!d || typeof d !== "object" || !d.destination || !d.depart_date || !Number.isFinite(Number(d.price))) return null;
    const o = Object.fromEntries(CAMPOS_ENLACE.filter((k) => k in d).map((k) => [k, d[k]]));
    o.id = String(params.get("offer") || o.id || "");
    o.price = Number(o.price);
    return o;
  } catch {
    return null;
  }
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

/* La cabecera: la ilustración del destino detrás, la ciudad y lo que cuesta
   por persona. Antes era una ficha invertida (crema sobre oscuro), lo más
   llamativo de la hoja sin ser una acción; ahora la cara del viaje es la foto
   y lo que se pulsa es lo naranja. */
function fechasDe(o, corto = false) {
  if (!o.depart_date) return "";
  const ida = fmtDate(o.depart_date, !corto);
  if (!o.return_date) return ida;
  const vuelta = fmtDate(o.return_date, !corto);
  // Mismo mes: se dice una vez («vie 13 nov → dom 15», «13 → 15 nov»).
  const mes = (s) => s.split(" ").pop();
  if (mes(ida) !== mes(vuelta)) return `${ida} → ${vuelta}`;
  const sinMes = (s) => s.slice(0, s.lastIndexOf(" "));
  return corto ? `${sinMes(ida)} → ${vuelta}` : `${ida} → ${sinMes(vuelta)}`;
}

function escalas(o) {
  const n = Number(o.stops);
  if (!Number.isFinite(n)) return "";
  return n === 0 ? "directo" : n === 1 ? "1 escala" : `${n} escalas`;
}

function pintarCabecera(o) {
  const destino = o.destination_name || o.destination;
  const compania = o.airline || o.provider || "";
  document.getElementById("hojaCompartirTit").textContent = destino;
  document.getElementById("hojaPrecio").textContent = `${Math.round(porPersonaSegura(o))} €`;
  document.getElementById("hojaDatos").textContent = [fechasDe(o), compania, escalas(o)].filter(Boolean).join(" · ");
  document.getElementById("hojaSub").textContent = [fechasDe(o, true), compania].filter(Boolean).join(" · ");
  const foto = document.getElementById("hojaFoto");
  foto.innerHTML = "";
  import("./fotos.js")
    .then(({ huecoFoto, ponerFotos }) => {
      if (VIAJE !== o) return;
      foto.innerHTML = huecoFoto(o, "hoja-ilu");
      ponerFotos(foto);
    })
    .catch(() => {});
}

/* El precio que se enseña es por persona, como en el resto de la web: `price`
   es el total del grupo y enseñarlo aqui sin decirlo asustaria sin motivo. */
function porPersonaSegura(o) {
  const total = Number(o.price) || 0;
  return total / Math.max(1, Number(o.adults) || 1);
}

/* Los iconos de las apps, en trazo y con `currentColor`: monocromos como el
   resto de la web, y no una letra en un círculo. */
const ICONOS_APPS = {
  copiar:
    '<rect x="8.5" y="8.5" width="11" height="11" rx="2.2"/><path d="M15.5 8.5V6.7a2.2 2.2 0 0 0-2.2-2.2H6.7a2.2 2.2 0 0 0-2.2 2.2v6.6a2.2 2.2 0 0 0 2.2 2.2h1.8"/>',
  whatsapp:
    '<path d="M4.2 19.8 5.3 16A8.2 8.2 0 1 1 8.2 18.8z"/><path d="M9.2 8.6c.2-.5.5-.5.8-.5h.5c.2 0 .4 0 .6.5l.7 1.6c.1.2 0 .5-.1.6l-.5.6c-.1.1-.2.3 0 .6.5.9 1.6 2 2.5 2.4.3.1.5.1.6 0l.6-.7c.2-.2.4-.2.6-.1l1.5.7c.3.1.4.3.4.5 0 .9-.7 1.7-1.6 1.8-.9.1-2.4-.2-4.3-1.9-1.6-1.4-2.4-3-2.6-3.9-.1-.9.1-1.6.3-2.2z"/>',
  telegram: '<path d="M20.5 4.2 3.6 10.8c-.6.2-.6 1.1 0 1.3l4.1 1.4 1.6 5c.2.5.8.7 1.2.3l2.4-2.2 4.2 3.1c.5.3 1.1.1 1.2-.5L21.5 5.2c.2-.7-.4-1.2-1-1z"/><path d="m7.7 13.5 9.1-6.1-6.6 7.3"/>',
  correo: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.2"/><path d="m4 7 8 6 8-6"/>',
  mas: '<circle cx="6" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18" cy="12" r="1.3"/>',
};

const iconoApp = (nombre) =>
  `<span class="hoja-app-ico"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONOS_APPS[nombre]}</svg></span>`;

/* Cuatro tiles: WhatsApp, Telegram, Correo y Más (el menú del sistema, solo
   donde existe). En el móvil va primero «Copiar» y el correo pasa a vivir
   dentro de «Más», que allí siempre lo trae. */
function appsHTML(url, texto) {
  const q = encodeURIComponent(`${texto} ${url}`);
  const sistema = !!navigator.share;
  const tile = (icono, nombre, destino, clase = "") =>
    `<a class="hoja-app${clase}" href="${escURL(destino)}" target="_blank" rel="noopener">${iconoApp(icono)}<span>${esc(
      nombre
    )}</span></a>`;
  return [
    `<button type="button" class="hoja-app hoja-app-copiar" data-copiar>${iconoApp("copiar")}<span>Copiar</span></button>`,
    tile("whatsapp", "WhatsApp", `https://wa.me/?text=${q}`),
    tile("telegram", "Telegram", `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(texto)}`),
    tile(
      "correo",
      "Correo",
      `mailto:?subject=${encodeURIComponent(`TripFinder · ${texto}`)}&body=${q}`,
      sistema ? " hoja-app-correo" : ""
    ),
    // El menu del sistema solo donde existe: un boton que no hace nada es peor
    // que un boton que no esta.
    sistema ? `<button type="button" class="hoja-app" data-sistema>${iconoApp("mas")}<span>Más</span></button>` : "",
  ].join("");
}

export function abrirHoja(o) {
  const caja = document.getElementById("hojaCompartir");
  if (!caja) return false;
  wireHoja();
  VIAJE = o;
  const url = enlaceDe(o);
  const texto = resumen(o);

  pintarCabecera(o);
  const campo = document.getElementById("hojaURL");
  campo.textContent = url;
  campo.title = url;
  document.getElementById("hojaApps").innerHTML = appsHTML(url, texto);

  const copiar = document.getElementById("hojaCopiar");
  clearTimeout(copiar._vuelta);
  copiar._antes = "";
  copiar.textContent = "Copiar enlace";
  copiar.disabled = false;
  pintarHops(o);

  caja.hidden = false;
  // En el móvil la píldora del enlace no se ve: el foco va al «Copiar» redondo.
  const visible = () => (copiar.offsetParent ? copiar : caja.querySelector("[data-copiar]") || copiar);
  if (typeof tfAbrirDialogo === "function") {
    tfAbrirDialogo(caja, { foco: visible, alCerrar: () => (caja.hidden = true) });
  }
  return true;
}

/* A UN HOP. Con la cuenta dentro y algún HOP del que seas miembro, el vuelo se
   manda como opción para votar (`tipo: "vuelo"`), igual que si se hubiera
   guardado desde el buscador del HOP: el mismo vuelo da la misma propuesta,
   así que mandarlo dos veces no lo duplica.

   Cada HOP es una fila que dice quién está y en qué fase va, y una vez
   mandado se queda en «✓ Ya está», con el enlace para ir a votarlo. Al abrir
   la hoja se mira qué HOP lo tienen ya (`pidVuelo`), para no ofrecer otra vez
   lo que ya está. */
const FASES_HOP = ["Cuándo", "Dónde no", "Buscar", "Votar", "El plan"];

function avataresHop(h) {
  const miembros = Array.isArray(h.miembros) ? h.miembros : [];
  const nombres = h.nombres || {};
  return `<span class="hop-avs mini">${miembros
    .slice(0, 3)
    .map(
      (u) =>
        `<span class="hop-av ${tonoDe(u)}" aria-hidden="true">${esc(
          String(nombres[u] || "?").trim().slice(0, 1).toUpperCase() || "?"
        )}</span>`
    )
    .join("")}</span>`;
}

function filaHop(h, hecho) {
  const n = Array.isArray(h.miembros) ? h.miembros.length : 0;
  const fase = FASES_HOP[Math.min(5, Math.max(1, Number(h.fase) || 1)) - 1];
  const accion = hecho
    ? `<a class="hoja-hop-hecho" href="hop?j=${encodeURIComponent(h.id)}&fase=4">✓ Ya está · Votar</a>`
    : `<button type="button" class="btn deep-ghost small" data-hop="${esc(h.id)}">Proponer</button>`;
  return `<li class="hoja-hop" data-fila="${esc(h.id)}">
    ${avataresHop(h)}
    <span class="hoja-hop-txt"><b>${esc(h.nombre || "HOP")}</b><span>${n === 1 ? "1 persona" : `${n} personas`} · fase ${esc(
    fase
  )}</span></span>
    ${accion}
  </li>`;
}

async function pintarHops(o) {
  const caja = document.getElementById("hojaHop");
  if (!caja) return;
  caja.hidden = true;
  if (typeof nubeActiva !== "function" || !nubeActiva() || typeof tfSesion !== "function" || !tfSesion()) return;
  let hops = [];
  try {
    hops = (await nubeMisHops()).filter((h) => !h.fin || h.fin >= new Date().toISOString().slice(0, 10));
  } catch {
    return;
  }
  if (VIAJE !== o || !hops.length) return;
  const { pidVuelo, propuestaDeVuelo } = await import("./propuesta-vuelo.js");
  // Los que ya lo tienen. Si no se puede mirar, se ofrece igual: mandarlo otra
  // vez no lo duplica, solo contesta «ya estaba».
  const hechos = new Set();
  try {
    const token = typeof nubeHopToken === "function" ? await nubeHopToken() : { error: true };
    if (!token.error) {
      const vistos = await Promise.all(
        hops.map((h) => nubeLeerDoc(token.token, `hops/${h.id}/propuestas/${pidVuelo(o)}`).catch(() => null))
      );
      vistos.forEach((d, i) => d && hechos.add(hops[i].id));
    }
  } catch {
    /* sin comprobar */
  }
  if (VIAJE !== o) return;
  const msg = document.getElementById("hojaHopMsg");
  msg.textContent = "";
  const lista = document.getElementById("hojaHops");
  lista.innerHTML = hops.map((h) => filaHop(h, hechos.has(h.id))).join("");
  lista.onclick = async (e) => {
    const b = e.target.closest("[data-hop]");
    if (!b || b.disabled) return;
    const h = hops.find((x) => x.id === b.dataset.hop);
    b.disabled = true;
    b.textContent = "Mandando…";
    const r = await nubeProponer(b.dataset.hop, propuestaDeVuelo(o));
    if (!r.ok) {
      b.disabled = false;
      b.textContent = "Proponer";
      msg.textContent = r.error;
      return;
    }
    b.closest(".hoja-hop").outerHTML = filaHop(h, true);
    msg.textContent = "";
    const nombre = (h && h.nombre) || "el HOP";
    if (typeof tfAnunciar === "function") tfAnunciar(`${r.yaEstaba ? "Ya estaba en" : "Mandado a"} ${nombre}.`);
  };
  caja.hidden = false;
}

function cerrarHoja() {
  const caja = document.getElementById("hojaCompartir");
  if (!caja) return;
  if (typeof tfCerrarDialogo === "function") tfCerrarDialogo(caja);
  else caja.hidden = true;
}

async function copiarEnlace(ev) {
  if (!VIAJE) return;
  const url = enlaceDe(VIAJE);
  const boton = (ev && ev.currentTarget) || document.getElementById("hojaCopiar");
  try {
    await navigator.clipboard.writeText(url);
    hecho(boton);
    if (typeof tfAnunciar === "function") tfAnunciar("Enlace copiado al portapapeles.");
  } catch {
    // Sin permiso de portapapeles (o sin HTTPS): se enseña para copiar a mano.
    window.prompt("Copia el enlace:", url);
  }
}

/* «Copiado ✓» durante dos segundos, en el botón que se pulsó (la píldora en
   el ordenador, el redondo en el móvil). */
function hecho(boton) {
  const rotulo = boton.querySelector("span:last-child") || boton;
  const antes = boton._antes || rotulo.textContent;
  boton._antes = antes;
  clearTimeout(boton._vuelta);
  rotulo.textContent = "Copiado ✓";
  boton._vuelta = setTimeout(() => {
    rotulo.textContent = antes;
    boton._antes = "";
  }, 2000);
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
  arrastrarParaCerrar(caja.querySelector(".hoja-compartir"));
  document.getElementById("hojaICS").addEventListener("click", () => {
    if (VIAJE) alCalendario(VIAJE);
  });
  document.getElementById("hojaApps").addEventListener("click", (ev) => {
    if (ev.target.closest("[data-copiar]")) {
      copiarEnlace({ currentTarget: ev.target.closest("[data-copiar]") });
      return;
    }
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

/* En el móvil la hoja sube desde abajo y se baja con el dedo, como las del
   sistema: se arrastra desde arriba (con la hoja sin rodar) y, pasado un
   tercio de su alto o con un tirón, se cierra. Si no, vuelve a su sitio. */
function arrastrarParaCerrar(hoja) {
  if (!hoja) return;
  let y0 = null;
  let t0 = 0;
  let dy = 0;
  hoja.addEventListener(
    "touchstart",
    (e) => {
      if (hoja.scrollTop > 0 || e.touches.length !== 1 || !matchMedia("(max-width: 760px)").matches) return;
      if (e.target.closest("a, button, input")) return;
      y0 = e.touches[0].clientY;
      t0 = Date.now();
      dy = 0;
    },
    { passive: true }
  );
  hoja.addEventListener(
    "touchmove",
    (e) => {
      if (y0 === null) return;
      dy = Math.max(0, e.touches[0].clientY - y0);
      hoja.style.transition = "none";
      hoja.style.transform = dy ? `translateY(${dy}px)` : "";
    },
    { passive: true }
  );
  hoja.addEventListener("touchend", () => {
    if (y0 === null) return;
    y0 = null;
    hoja.style.transition = "";
    const tiron = dy > 40 && dy / Math.max(1, Date.now() - t0) > 0.6;
    if (dy > hoja.offsetHeight / 3 || tiron) {
      cerrarHoja();
      // Se queda abajo mientras se va, y la siguiente vez sube limpia.
      setTimeout(() => (hoja.style.transform = ""), 300);
    } else {
      hoja.style.transform = "";
    }
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
