/* calendario.js — El calendario de tres meses y la eleccion de un rango de fechas. */

import { $, MONTHS, existe, fmtDate, on } from "./base.js";

/* ---------------------------------------------------------- calendario
   Un solo calendario reutilizable: el primer clic pone la ida y el segundo la
   vuelta. Lo usan el buscador y los seguimientos, cada uno con sus campos. */
const CALS = {
  buscar: { btn: "#dateBtn", cal: "#cal", ida: "#fDepart", vuelta: "#fReturn", rango: {} },
  seguir: { btn: "#wDateBtn", cal: "#wCal", ida: "#wDepart", vuelta: "#wReturn", rango: {} },
};

function pintarCalendario(clave) {
  const c = CALS[clave];
  if (!existe(c.cal)) return;
  const hoy = new Date();
  const meses = [];
  for (let m = 0; m < 12; m++) {
    const base = new Date(hoy.getFullYear(), hoy.getMonth() + m, 1);
    const primero = (base.getDay() + 6) % 7; // lunes primero
    const dias = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
    let celdas = "";
    for (let i = 0; i < primero; i++) celdas += "<span></span>";
    for (let d = 1; d <= dias; d++) {
      const f = new Date(base.getFullYear(), base.getMonth(), d);
      const iso = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}-${String(
        d
      ).padStart(2, "0")}`;
      const pasado = f < new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
      const extremo = c.rango.ida === iso || c.rango.vuelta === iso;
      const dentro = c.rango.ida && c.rango.vuelta && iso > c.rango.ida && iso < c.rango.vuelta;
      celdas += `<button type="button" class="dia${extremo ? " extremo" : ""}${
        dentro ? " dentro" : ""
      }" data-iso="${iso}"${pasado ? " disabled" : ""}>${d}</button>`;
    }
    meses.push(`
      <div class="mes">
        <h4>${MONTHS[base.getMonth()]} ${base.getFullYear()}</h4>
        <div class="semana"><i>L</i><i>M</i><i>X</i><i>J</i><i>V</i><i>S</i><i>D</i></div>
        <div class="dias">${celdas}</div>
      </div>`);
  }
  $(c.cal).innerHTML = `<div class="meses">${meses.join("")}</div>`;
  $(c.cal)
    .querySelectorAll(".dia:not([disabled])")
    .forEach((b) => b.addEventListener("click", () => elegirDia(clave, b.dataset.iso)));
}

function elegirDia(clave, iso) {
  const c = CALS[clave];
  if (!c.rango.ida || c.rango.vuelta || iso < c.rango.ida) {
    c.rango = { ida: iso, vuelta: null };
  } else {
    c.rango.vuelta = iso;
  }
  $(c.ida).value = c.rango.ida || "";
  $(c.vuelta).value = c.rango.vuelta || "";
  $(c.btn).textContent = c.rango.ida
    ? `${fmtDate(c.rango.ida, true)}${
        c.rango.vuelta ? ` → ${fmtDate(c.rango.vuelta, true)}` : " → elige la vuelta"
      }`
    : "Elegir en el calendario";
  pintarCalendario(clave);
  if (c.rango.ida && c.rango.vuelta) setTimeout(() => ($(c.cal).hidden = true), 250);
}

Object.entries(CALS).forEach(([clave, c]) =>
  on(c.btn, "click", () => {
    const caja = $(c.cal);
    caja.hidden = !caja.hidden;
    if (!caja.hidden) pintarCalendario(clave);
  })
);

/* Lo de esconder el calendario cuando no toca vive dentro de `syncFinder`, que
   ya esta enganchado a los dos selectores mas arriba. */
