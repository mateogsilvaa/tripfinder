/* frescura.js — «levantamiento: hace 3 h · se revisa cada 12 h», el renglón del
   pie de TODAS las páginas. Cuánto hace que se actualizó: sin esto no sabes si
   miras datos de hoy o de hace tres días, que en precios de vuelo es toda la
   diferencia.

   Vive aparte del feed para que las páginas que no lo llevan (el HOP, el
   Interrail) puedan decirlo sin bajarse los precios: les basta con
   `data/frescura.json`, cien bytes, en vez de `offers.json`. */
import { fetchJSON, parseISO } from "./base.js";

export function pintarFrescura(iso) {
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

/* Para las páginas sin feed: lee solo la fecha. Si el fichero pequeño aún no
   existe (el primer barrido tras publicar esto lo crea), cae al grande. */
export async function frescuraSola() {
  if (!document.getElementById("frescura")) return;
  try {
    pintarFrescura((await fetchJSON("data/frescura.json")).generated_at);
  } catch {
    try {
      pintarFrescura((await fetchJSON("data/offers.json")).generated_at);
    } catch {
      /* sin datos: el renglón se queda como estaba */
    }
  }
}
