/* compartir.js — Sacar un viaje de aqui: al calendario y a quien te apetezca.

   POR QUE HACE FALTA. Un chollo que sale hoy se vuela en noviembre. Hasta ahora
   lo unico que se podia hacer con el era marcarlo como favorito, y los
   favoritos viven en el `localStorage` de ESE navegador: cambias de movil y se
   quedan atras. Un `.ics` en tu calendario y un enlace en un chat sobreviven a
   cualquier cosa que le pase a esta web.

   Las dos cosas se hacen aqui, en el navegador, sin pedirle nada a nadie: el
   calendario es un fichero de texto que se genera al vuelo y el enlace es el
   `?offer=` que la web ya sabe abrir resaltado. */

import { esc, fmtDate } from "./base.js";

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

/* `navigator.share` es lo que quiere el movil —abre WhatsApp, Telegram, lo que
   tengas—; en escritorio casi nunca existe y ahi se copia el enlace. Las dos
   ramas terminan diciendo que ha pasado algo, porque un boton que no da señal
   parece roto y se pulsa tres veces. */
export async function compartir(o, boton) {
  const url = enlaceDe(o);
  const destino = o.destination_name || o.destination;
  const precio = Math.round(Number(o.price) || 0);
  const texto = [
    `${o.origin} → ${destino}`,
    precio ? `${precio} €` : "",
    o.depart_date ? fmtDate(o.depart_date, true) : "",
  ]
    .filter(Boolean)
    .join(" · ");

  if (navigator.share) {
    try {
      await navigator.share({ title: `TripFinder · ${destino}`, text: texto, url });
      return "compartido";
    } catch (e) {
      // Cancelar el diálogo no es un fallo: no hay nada que decir.
      if (e && e.name === "AbortError") return "cancelado";
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    avisar(boton, "enlace copiado");
    if (typeof tfAnunciar === "function") tfAnunciar("Enlace copiado al portapapeles.");
    return "copiado";
  } catch {
    // Sin permiso de portapapeles (o sin HTTPS): se enseña para copiar a mano.
    window.prompt("Copia el enlace:", url);
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

/* Los dos botones, para pegarlos donde haga falta. */
export function botonesHTML(o) {
  return `
    <button class="btn ghost" data-ics="${esc(o.id)}">Al calendario</button>
    <button class="btn ghost" data-share="${esc(o.id)}">Compartir</button>`;
}

/* Se cablea por delegacion sobre el contenedor que se acaba de pintar. */
export function wireCompartir(raiz, buscar) {
  if (!raiz) return;
  raiz.querySelectorAll("[data-ics]").forEach((b) =>
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const o = buscar(b.dataset.ics);
      if (o) alCalendario(o);
    })
  );
  raiz.querySelectorAll("[data-share]").forEach((b) =>
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const o = buscar(b.dataset.share);
      if (o) compartir(o, b);
    })
  );
}
