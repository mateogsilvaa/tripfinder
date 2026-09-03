/* historia.js — El historico de una ruta: si esto esta barato o solo lo parece. */

import { esc, fetchJSON } from "./base.js";
import { porPersona } from "./precios.js";
import { sparkline } from "./favoritos.js";

/* ------------------------------------------------------- histórico de precios
   `data/history.json` lleva meses acumulando el precio de cada ruta y la web
   no lo miraba: el "−51%" del sello sale del scoring, pero al abrir un vuelo no
   había forma de ver si eso es barato de verdad o es que la referencia estaba
   inflada. Aquí se dibuja la serie de esa ruta y se dice, sin adornos, dónde
   cae el precio de hoy dentro de lo que ha valido históricamente. */
export let HISTORIA = null;

export async function cargarHistoria() {
  if (HISTORIA) return HISTORIA;
  try {
    HISTORIA = await fetchJSON("data/history.json");
  } catch {
    HISTORIA = {};
  }
  return HISTORIA;
}

/* La serie se guarda separada por finde y no finde: un viernes por la tarde no
   compite contra un martes, y mezclarlos falsea las dos medias. */
function serieDe(o) {
  if (!HISTORIA) return [];
  const ruta = `${o.origin}-${o.destination}`;
  const propia = HISTORIA[ruta + (o.weekend ? "|finde" : "")] || [];
  return (propia.length >= 4 ? propia : HISTORIA[ruta] || propia) || [];
}

const percentil = (ordenados, q) =>
  ordenados[Math.min(ordenados.length - 1, Math.floor(ordenados.length * q))];

/* Un veredicto de una línea, que es lo que de verdad se quiere saber. */
function veredicto(precio, serie) {
  const precios = serie.map((e) => Number(e.p)).filter(Number.isFinite).sort((a, b) => a - b);
  if (precios.length < 5) return null;
  const barato = percentil(precios, 0.25);
  const caro = percentil(precios, 0.75);
  const minimo = precios[0];
  if (precio <= minimo * 1.02)
    return { clase: "chollo", texto: "es lo más barato que se ha visto en esta ruta" };
  if (precio <= barato)
    return { clase: "bien", texto: `barato: normalmente está entre ${Math.round(barato)} y ${Math.round(caro)} €` };
  if (precio >= caro)
    return { clase: "mal", texto: `caro para esta ruta: suele bajar de ${Math.round(barato)} €` };
  return { clase: "normal", texto: `precio normal (lo habitual: ${Math.round(barato)}–${Math.round(caro)} €)` };
}

export function historiaHTML(o) {
  const serie = serieDe(o);
  if (serie.length < 5) return "";
  // La serie trae varias tarifas del mismo día (una por vuelo): se resume cada
  // día con la más barata, que es la que se podía comprar ese día.
  const porDia = new Map();
  serie.forEach((e) => {
    const p = Number(e.p);
    if (!Number.isFinite(p)) return;
    const previo = porDia.get(e.d);
    if (previo === undefined || p < previo) porDia.set(e.d, p);
  });
  const dias = [...porDia.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const v = veredicto(porPersona(o), serie);
  if (!dias.length && !v) return "";
  return `
    <div class="historia ${v ? v.clase : ""}">
      ${sparkline(dias.map(([d, p]) => ({ d, p })), 150, 34)}
      <div>
        <b>${Math.round(porPersona(o))} € por persona</b>
        ${v ? `<span>${esc(v.texto)}</span>` : `<span>${dias.length} días de histórico</span>`}
      </div>
    </div>`;
}

