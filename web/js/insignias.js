/* insignias.js — Lo pequeño de la barra que sale en TODAS las páginas: el número
   de viajes que sigues y el punto del test. Vive aparte para que ponerlo no
   obligue a bajarse el feed, los alojamientos y los mapas (antes lo hacía
   `favoritos.js`, y con él medio sitio, hasta en la página del HOP). */

const leerJSON = (clave) => {
  try {
    return JSON.parse(localStorage.getItem(clave) || "null");
  } catch {
    return null;
  }
};

/* Cuántos vuelos sigues en este navegador (los de la cuenta con la que has
   entrado; sin cuenta, los de siempre). */
export function cuantosSigues() {
  const d = leerJSON(tfClave("tf_favoritos"));
  return d && typeof d === "object" && !Array.isArray(d) ? Object.keys(d).length : 0;
}

/* El número de lo que sigues, en la pestaña de «Mis avisos» (arriba y en la
   barra del móvil). Sin nada, no sale: un 0 en rojo sería ruido. */
export function insigniaSeguimientos(n) {
  document.querySelectorAll('.zona[data-zona="follows"], .tab[data-zona="follows"]').forEach((a) => {
    let b = a.querySelector(".insignia");
    if (!n) {
      if (b) b.remove();
      return;
    }
    if (!b) {
      b = document.createElement("span");
      b.className = "insignia";
      a.appendChild(b);
    }
    b.textContent = n > 99 ? "99+" : String(n);
    b.setAttribute("aria-label", `${n} ${n === 1 ? "viaje" : "viajes"}`);
  });
}

/* El contador de la portada. No es la lista —esa vive en `seguimientos.html`—:
   es la línea que dice cuántos hay y qué se hace con ellos, para que el
   botón de Seguir de cada fila signifique algo desde la primera vez que se pulsa. */
export function refrescarObservacion() {
  const n = cuantosSigues();
  insigniaSeguimientos(n);
  const num = document.getElementById("obsCuenta");
  const txt = document.getElementById("obsTexto");
  if (!num || !txt) return;
  num.textContent = n === 0 ? "—" : String(n);
  txt.textContent =
    n === 0
      ? "Todavía no sigues ningún viaje. Toca la campana de cualquier vuelo y aquí verás si sube o baja."
      : n === 1
        ? "1 viaje apuntado. Se revisa cada 12 h."
        : `${n} viajes apuntados. Se revisan cada 12 h.`;
}

/* El punto del botón de «Ayúdame a elegir» cuando hay un test guardado. */
export function loRecordado() {
  const d = leerJSON(tfClave("tf_quiz"));
  return d && d.respuestas ? d : null;
}

export function marcarFlap() {
  const flap = document.getElementById("tfDescubrir");
  if (!flap) return;
  const hay = !!loRecordado();
  flap.classList.toggle("con-memoria", hay);
  flap.setAttribute(
    "aria-label",
    hay ? "Ver tus destinos, o volver a hacer el test" : "Descubrir tu destino ideal"
  );
}
