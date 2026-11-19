/* puentes.js — Los puentes de España, sacados del calendario de festivos.

   El calendario sale de Nager.Date (date.nager.at), que es gratis, sin clave y
   abierto a cualquier web (CORS). Se toman los festivos nacionales y los de la
   Comunidad de Madrid, que es de donde sale casi todo el mundo aquí.

   UN PUENTE es un festivo pegado al fin de semana: si cae en viernes o lunes
   son tres días seguidos; si cae en martes o jueves, cogiendo el lunes o el
   viernes, son cuatro. Si se pegan dos festivos (6 y 8 de diciembre) salen
   juntos en un solo puente largo.

   Si Nager no contesta, se tira de la lista escrita abajo: un formulario no
   puede quedarse sin la opción porque un tercero esté caído. */
import { fetchJSON } from "./base.js";

const CACHE = "tf_festivos_v1";
const REGION = "ES-MD";

/* Respaldo: los festivos nacionales y de Madrid de 2026 y 2027. */
const RESPALDO = [
  ["2026-12-06", "Día de la Constitución"],
  ["2026-12-08", "Inmaculada Concepción"],
  ["2026-12-25", "Navidad"],
  ["2027-01-01", "Año Nuevo"],
  ["2027-01-06", "Reyes"],
  ["2027-03-25", "Jueves Santo"],
  ["2027-03-26", "Viernes Santo"],
  ["2027-05-01", "Día del Trabajo"],
  ["2027-05-03", "Día de la Comunidad de Madrid"],
  ["2027-08-16", "Asunción (lunes)"],
  ["2027-10-12", "Fiesta Nacional"],
  ["2027-11-01", "Todos los Santos"],
  ["2027-11-09", "Almudena"],
  ["2027-12-06", "Día de la Constitución"],
  ["2027-12-08", "Inmaculada Concepción"],
].map(([fecha, nombre]) => ({ fecha, nombre }));

const iso = (d) => d.toISOString().slice(0, 10);
const dia = (s) => new Date(`${s}T12:00:00Z`);
const mas = (d, n) => new Date(d.getTime() + n * 86400000);

async function festivosDe(anio) {
  const datos = await fetchJSON(`https://date.nager.at/api/v3/PublicHolidays/${anio}/ES`);
  return (datos || [])
    .filter((f) => f.global || (f.counties || []).includes(REGION))
    .map((f) => ({ fecha: f.date, nombre: f.localName || f.name }));
}

/* Los festivos que quedan de aquí a un año. Se guardan un día en el navegador:
   el calendario no cambia de una hora para otra. */
export async function festivos() {
  try {
    const g = JSON.parse(localStorage.getItem(CACHE) || "null");
    if (g && Date.now() - g.t < 86400000 && g.lista?.length) return g.lista;
  } catch {}
  const anio = new Date().getFullYear();
  let lista;
  try {
    lista = (await Promise.all([festivosDe(anio), festivosDe(anio + 1)])).flat();
    if (!lista.length) throw new Error("vacío");
  } catch {
    lista = RESPALDO;
  }
  try {
    localStorage.setItem(CACHE, JSON.stringify({ t: Date.now(), lista }));
  } catch {}
  return lista;
}

/* De festivos a puentes: cada festivo se estira por los días libres que lo
   rodean (fines de semana y otros festivos), y si al lado queda un único día
   laborable antes del finde, se «hace puente» con él. */
export function calcularPuentes(lista, hoy = new Date()) {
  const libres = new Map(lista.map((f) => [f.fecha, f.nombre]));
  const esLibre = (d) => [0, 6].includes(d.getUTCDay()) || libres.has(iso(d));
  const manana = iso(mas(hoy, 1));
  const puentes = [];
  for (const f of [...lista].sort((a, b) => a.fecha.localeCompare(b.fecha))) {
    if (f.fecha < manana) continue;
    const d = dia(f.fecha);
    if ([0, 6].includes(d.getUTCDay())) continue; // cae en finde: no regala nada
    let ini = d;
    let fin = d;
    while (esLibre(mas(ini, -1))) ini = mas(ini, -1);
    while (esLibre(mas(fin, 1))) fin = mas(fin, 1);
    let hacePuente = false;
    // Un solo día suelto entre el festivo y otro día libre (el finde u otro
    // festivo, como el 7 entre el 6 y el 8 de diciembre): se coge y es puente.
    if (!esLibre(mas(ini, -1)) && esLibre(mas(ini, -2))) {
      ini = mas(ini, -1);
      while (esLibre(mas(ini, -1))) ini = mas(ini, -1);
      hacePuente = true;
    } else if (!esLibre(mas(fin, 1)) && esLibre(mas(fin, 2))) {
      fin = mas(fin, 1);
      while (esLibre(mas(fin, 1))) fin = mas(fin, 1);
      hacePuente = true;
    }
    const dias = Math.round((fin - ini) / 86400000) + 1;
    if (dias < 3) continue;
    const desde = iso(ini);
    const hasta = iso(fin);
    const previo = puentes.find((p) => p.desde <= hasta && desde <= p.hasta);
    if (previo) {
      if (!previo.nombres.includes(f.nombre)) previo.nombres.push(f.nombre);
      previo.desde = previo.desde < desde ? previo.desde : desde;
      previo.hasta = previo.hasta > hasta ? previo.hasta : hasta;
      previo.dias = Math.round((dia(previo.hasta) - dia(previo.desde)) / 86400000) + 1;
      previo.hacePuente ||= hacePuente;
      continue;
    }
    puentes.push({ desde, hasta, dias, nombres: [f.nombre], hacePuente });
  }
  return puentes;
}

/* Lo que se manda al barrido: un tramo que empieza la tarde de antes (se sale
   al salir de trabajar) y las noches que caben dentro. */
export function puenteEnTramo(p) {
  return {
    desde: iso(mas(dia(p.desde), -1)),
    hasta: p.hasta,
    noches: `${Math.max(2, p.dias - 1)}-${p.dias}`,
  };
}
