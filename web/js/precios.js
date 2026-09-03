/* precios.js — Cuanto cuesta y a cuanta gente cubre, mas la escapada completa. */

import { esc, fmtEUR } from "./base.js";
import { ESCAPADAS_REALES } from "./alojamiento.js";

/* ------------------------------------------------------------------ precios
   Cada oferta lleva a cuanta gente cubre su precio (`adults`). El scan diario
   busca para una persona; una busqueda o un seguimiento, para los que hayas
   dicho. Sin distinguirlo, "240 €" tanto puede ser lo que pagas tu como lo que
   pagais los cuatro, que es justo la duda que hace perder un chollo.

   Regla: si va mas de uno, manda el TOTAL (es lo que sale de la cuenta) y el
   por persona va debajo. Si va uno solo, no hay nada que repartir. */
export const pax = (o) => Math.max(1, Number(o?.adults) || 1);
export const porPersona = (o) =>
  Number.isFinite(Number(o?.price_per_person)) && Number(o.price_per_person) > 0
    ? Number(o.price_per_person)
    : o.price / pax(o);

/* Estimacion para la portada: el scan guarda el precio de una persona y multi-
   plicarlo es una aproximacion honesta mientras no se busque para el grupo.
   Va marcada con "≈" a proposito: las tarifas van por cupos y las ultimas
   plazas de un vuelo no valen lo mismo que las primeras. */
/* Cada cuenta tiene su cajon en este navegador: "tf_grupo:u-1a2b". Sin sesion
   se usa la clave de siempre, que es donde ya estaba lo tuyo. */
const GRUPO_KEY = tfClave("tf_grupo");
export let GRUPO = Math.min(8, Math.max(1, Number(localStorage.getItem(GRUPO_KEY)) || 1));

/* Un modulo no puede asignar a lo que importa de otro, asi que quien cambia el
   grupo o carga las camas pasa por aqui. Es la unica puerta: el dia que haya
   que enterarse de que cambian, se entera en un solo sitio. */
export function ponerGrupo(n) {
  GRUPO = Math.min(8, Math.max(1, Number(n) || 1));
  try {
    localStorage.setItem(GRUPO_KEY, String(GRUPO));
  } catch {
    /* navegacion privada: el grupo dura lo que la pestaña */
  }
  return GRUPO;
}
export const grupo = () => GRUPO;

/* Cuanta gente cubre de verdad el precio que se va a ensenar, y si el total es
   una cuenta nuestra o el numero que devolvio la aerolinea. */
function reparto(o) {
  const propios = pax(o);
  if (propios > 1) return { gente: propios, unidad: porPersona(o), estimado: false };
  return { gente: GRUPO, unidad: porPersona(o), estimado: GRUPO > 1 };
}

/* ------------------------------------------------- la escapada completa

   El vuelo es por persona y la cama es para el grupo: sumarlos bien da el
   unico numero que decide un viaje. Hasta ahora ese numero solo salia DESPUES
   de pedir alojamiento, que es un workflow de varios minutos, asi que quien
   miraba el tablon no lo veia nunca.

   `data/camas.json` trae lo que costo dormir en cada sitio, destilado de las
   busquedas de alojamiento que ya se hicieron. Donde no hay dato no se estima
   nada: un numero igual para todos no informa y encima parece que sabe algo.
   La cobertura crece sola cada vez que alguien pide una cama. */
let CAMAS = null;
export function ponerCamas(c) {
  CAMAS = c;
}

function camaPorNoche(o) {
  if (!CAMAS) return null;
  const porDestino = CAMAS.destinos && CAMAS.destinos[o.destination];
  if (porDestino) return { noche: porDestino.noche, de: "este destino" };
  const porPais = CAMAS.paises && CAMAS.paises[o.destination_country];
  if (porPais) return { noche: porPais.noche, de: esc(o.destination_country) };
  return null;
}

/* Lo que costaria el finde entero, por cabeza. Devuelve null si no hay con que
   estimarlo, que es la mitad de las veces y no pasa nada. */
function escapadaEstimada(o) {
  const noches = Number(o.nights);
  const cama = camaPorNoche(o);
  if (!cama || !noches) return null;
  const { gente } = reparto(o);
  const vuelos = porPersona(o) * gente;
  const total = vuelos + cama.noche * noches;
  return { total, porCabeza: total / gente, gente, noches, de: cama.de };
}

/* Y como se escribe. El `≈` es el mismo trato honesto que el del selector de
   personas: se ve a simple vista que es una cuenta nuestra y no un precio
   consultado. */
export function escapadaHTML(o) {
  // Si ya se pidio alojamiento de verdad, manda el numero real y se va el `≈`.
  const real = ESCAPADAS_REALES[o.id];
  if (real && real.total) {
    return `<small class="escapada real" title="Vuelos + la cama más barata de las que salieron. Precio consultado, no estimado."
      >escapada ${Math.round(real.total)} €</small>`;
  }
  const e = escapadaEstimada(o);
  if (!e) return "";
  return `<small class="escapada" title="Vuelos de ${e.gente} + ${e.noches} noche${
    e.noches === 1 ? "" : "s"
  } de cama, con lo que costó dormir en ${e.de}. Estimación: al buscar alojamiento sale el precio real."
    >escapada ≈ ${Math.round(e.total)} €</small>`;
}

/* El bloque de precio, igual en el billete grande, en el panel de salidas y en
   las filas de una busqueda guardada. */
export function precioHTML(o, { grande = false } = {}) {
  const { gente, unidad, estimado } = reparto(o);
  const total = unidad * gente;
  const clase = grande ? "amount" : "cifra";
  if (gente <= 1) {
    return `<span class="${clase}">${Math.round(unidad)}<span>€</span></span>
      <span class="pax-nota">por persona</span>`;
  }
  return `<span class="${clase}">${estimado ? "≈" : ""}${Math.round(total)}<span>€</span></span>
    <span class="pax-nota">${Math.round(unidad)} € × ${gente} pers.${
      estimado ? " · estimado" : ""
    }</span>`;
}

/* Las búsquedas y los seguimientos guardan a cuánta gente se buscó en su
   cabecera, pero los ficheros escritos antes de que las ofertas llevaran su
   propio `adults` no lo tienen dentro de cada vuelo. Sin esto, una búsqueda
   para cuatro seguía enseñando el precio como si fuera de uno. */
export function conGrupo(ofertas, cuantos) {
  const n = Math.max(1, Number(cuantos) || 1);
  (ofertas || []).forEach((o) => {
    if (!Number(o.adults)) o.adults = n;
  });
  return ofertas || [];
}

/* Version de una linea, para las filas del panel de salidas. */
export function precioCorto(o) {
  const { gente, unidad, estimado } = reparto(o);
  if (gente <= 1) {
    return `<span class="cifra">${fmtEUR(unidad)}</span><small>por persona</small>`;
  }
  return `<span class="cifra">${estimado ? "≈" : ""}${fmtEUR(
    unidad * gente
  )}</span><small>${Math.round(unidad)} €/persona</small>`;
}

/* Comparadores que valen la pena abrir con la ruta ya puesta. eDreams va
   aparte porque con una cuenta Prime los precios que ves tu no son los que ve
   nadie mas: no hay forma de scrapearlos desde aqui (harian falta tus claves),
   pero el enlace se abre en TU navegador, ya con tu sesion, y ahi si sale tu
   tarifa de socio. Es la unica manera honesta de aprovecharlo. */
export function edreamsURL(o) {
  const ida = (o.depart_date || "").slice(0, 10);
  if (!ida) return "";
  const vuelta = (o.return_date || "").slice(0, 10);
  const gente = Math.max(1, pax(o) > 1 ? pax(o) : GRUPO);
  const partes = [
    `type=${vuelta ? "R" : "O"}`,
    `from=${o.origin || "MAD"}`,
    `to=${o.destination}`,
    `dep=${ida}`,
    vuelta ? `ret=${vuelta}` : "",
    `adults=${gente}`,
  ].filter(Boolean);
  return `https://www.edreams.es/travel/#/results/${partes.join(";")}`;
}

