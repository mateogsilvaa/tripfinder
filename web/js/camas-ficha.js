/* camas-ficha.js — Cómo se enseña una cama: sus fotos, de dónde viene y a qué
   distancia del centro cae. Son funciones puras, sin red ni estado, y viven
   aparte de `alojamiento.js` (que trae el panel, la búsqueda y media web) para
   que el HOP y el panel de alojamiento las usen sin arrastrar lo demás. */
import { esc, escURL } from "./base.js";

/* La ficha de una cama va SIN FOTO a propósito. Lo que decide dónde duermes en
   una escapada de dos noches es el precio total, de quién es y a qué distancia
   del centro cae; una foto de 300 px de un salón no ayuda a elegir y empuja el
   resto fuera de la pantalla. */
/* LAS FOTOS. Nadie elige dónde duerme sin ver la casa, y hasta ahora el panel
   era una lista de texto — con las fotos guardadas en el fichero, sin pintar.

   El carrusel es CSS puro: una tira con `scroll-snap`. Sin JavaScript, sin
   librería y sin estado que mantener; el dedo en el móvil y la rueda o la barra
   en el escritorio. Un carrusel con botones y temporizador sería diez veces más
   código para lo mismo.

   `loading="lazy"` y el hueco reservado con `aspect-ratio`: son hasta seis
   fotos por alojamiento y dieciocho alojamientos. Sin las dos cosas, abrir el
   panel se traga la conexión y la lista salta mientras cargan.

   Y si no hay foto no se pinta un hueco gris: la ficha se queda como estaba,
   que es mejor que una caja rota. */
export function fotos(s) {
  const lista = (Array.isArray(s.images) && s.images.length ? s.images : [s.image]).filter(
    (u) => typeof u === "string" && u.startsWith("https://")
  );
  if (!lista.length) return "";
  return `
    <div class="stay-fotos${lista.length > 1 ? " varias" : ""}">
      ${lista
        .map(
          (u, i) =>
            `<img src="${escURL(u)}" alt="${
              i === 0 ? `Foto de ${esc(s.name)}` : ""
            }" loading="lazy" decoding="async">`
        )
        .join("")}
      ${lista.length > 1 ? `<span class="stay-cuantas">${lista.length} fotos</span>` : ""}
    </div>`;
}

/* De dónde viene cada cama, dicho como se llama la web y no como el código. */
const FUENTES = {
  google_hotels: "Google Hoteles",
  airbnb: "Airbnb",
  holidu: "Holidu",
  amadeus_hotels: "Amadeus",
};

/* «a 12 min andando», «a 4,2 km». Lo mismo que dice el backend en el log, para
   que la web y el barrido cuenten la distancia igual. */
export function aPie(km) {
  if (km === null || km === undefined || !Number.isFinite(Number(km))) return "";
  const n = Number(km);
  if (n <= 3.5) return `a ${Math.max(1, Math.round((n / 4.8) * 60))} min andando del centro`;
  return `a ${n.toFixed(1).replace(".", ",")} km del centro`;
}

/* La línea de datos de una cama: de dónde sale, la nota y a qué distancia del
   centro cae. La usan el panel y la hoja de alojamiento del HOP. */
export function metaCama(s) {
  return [
    FUENTES[s.provider] || s.provider,
    s.rating
      ? `${String(s.rating).replace(".", ",")}/5${s.reviews ? ` (${Number(s.reviews).toLocaleString("es-ES")} opiniones)` : ""}`
      : "",
    // Lo que antes no se decía: un estudio a doce kilómetros del centro no es
    // más barato que uno normal y céntrico, es otro viaje.
    aPie(s.km_centro),
    s.note,
  ]
    .filter(Boolean)
    .join(" · ");
}
