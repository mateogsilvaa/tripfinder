/* Un vuelo convertido en propuesta de HOP: lo que se guarda en
   `hops/{id}/propuestas/{pid}` con `tipo: "vuelo"`.

   Lo usan dos sitios: el buscador de dentro del HOP (fase 3, «Guardar») y la
   hoja de compartir de cualquier vuelo («a un HOP»). Por eso vive aparte: el
   mismo vuelo tiene que dar el mismo `pid` venga de donde venga, y así
   mandarlo dos veces no lo duplica. */

import { escURL } from "./base.js";

export function hashCorto(t) {
  let h = 0;
  for (const c of String(t)) h = (h * 33 + c.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

export const enlaceOk = (u) => !!u && escURL(u) !== "#";
export const pidVuelo = (o) => `v-${o.id}`.slice(0, 120);
export const pidCombo = (o, c) => `v-${o.id}-c-${hashCorto(c.url || c.name)}`.slice(0, 120);

/* El precio va por persona, como se vota en el HOP: `price` es el del grupo. */
export function propuestaDeVuelo(o, stay = null) {
  const pax = Math.max(1, Number(o.adults) || 1);
  const ida = [o.depart_time, o.arrive_time].filter(Boolean).join("–");
  const vuelta = [o.return_time, o.return_arrive_time].filter(Boolean).join("–");
  const datos = {
    pid: stay ? pidCombo(o, stay) : pidVuelo(o),
    tipo: "vuelo",
    titulo: o.destination_name || o.destination,
    destino: o.destination_country || "",
    pais: o.destination_country || "",
    iata: o.destination || "",
    origen: o.origin || "",
    ida: o.depart_date,
    vuelta: o.return_date || "",
    precio: (Number(o.price) || 0) / pax,
    compania: o.airline_back && o.airline_back !== o.airline ? `${o.airline} + ${o.airline_back}` : o.airline || "",
    horario: [ida && `ida ${ida}`, vuelta && `vuelta ${vuelta}`, o.stops ? `${o.stops} escala${o.stops === 1 ? "" : "s"}` : "directo"]
      .filter(Boolean)
      .join(" · "),
    url: o.airline_link || o.deep_link || "",
    oferta: String(o.id),
  };
  if (stay) {
    datos.cama = String(stay.name || "Alojamiento").slice(0, 120);
    if (enlaceOk(stay.url) && String(stay.url).startsWith("https://")) datos.cama_url = stay.url;
    if (Number.isFinite(Number(stay.price_total))) datos.cama_precio = Number(stay.price_total) / pax;
    const foto = stay.image || (Array.isArray(stay.images) ? stay.images[0] : "");
    if (foto && String(foto).startsWith("https://")) datos.foto = foto;
  }
  return datos;
}
