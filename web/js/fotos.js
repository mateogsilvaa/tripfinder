/* fotos.js — La ilustración de cada destino.

   Son dibujos hechos a mano, uno de DÍA y otro de NOCHE por ciudad, en
   `ilustraciones/<país>/<ciudad>/`. `tripfinder ilustraciones` los pasa a WebP
   en `web/ilustraciones/` y escribe `indice.json`, que dice qué carpeta va con
   cada aeropuerto (STN y LGW, Londres; BVA, París). Desde el panel se suben
   más (pestaña «Ilustraciones»).

   · CON EL TEMA: el hueco lleva las dos como variables de CSS (`--ilu-dia`,
     `--ilu-noche`) y la hoja de estilos usa la que toca. Cambiar de tema no
     vuelve a pedir nada, y el navegador solo descarga la que se ve.
   · SOLO DONDE HAY HUECO: el chollo del día y las cartas del HOP. Un destino
     sin ilustración se queda con el color de su sitio, sin hueco vacío.
   · En las pruebas no salen (`navigator.webdriver`): cambian el alto de las
     tarjetas. Una prueba las pide con `window.TF_FOTOS = true`. */
import { esc } from "./base.js";

const INDICE = new URL("../ilustraciones/indice.json", import.meta.url);
const enPrueba = () =>
  typeof window === "undefined" || (!window.TF_FOTOS && typeof navigator !== "undefined" && navigator.webdriver);

export const lugarDe = (o) => ({
  iata: String(o.iata || o.destination || "").toUpperCase(),
  ciudad: String(o.ciudad || o.destination_name || o.titulo || "").replace(/\s*\(.*\)\s*$/, ""),
  pais: String(o.pais || o.destination_country || ""),
});

const carpeta = (t) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

let indice = null;
function leerIndice() {
  indice =
    indice ||
    fetch(INDICE)
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));
  return indice;
}

/* La ilustración de un sitio: por aeropuerto y, si no, por el nombre de la
   ciudad (una propuesta de HOP escrita a mano no siempre trae código). */
function buscar(ind, l) {
  const ruta =
    (ind.por_iata || {})[l.iata] ||
    ((ind.ciudades || []).find((c) => c.ruta.split("/")[1] === carpeta(l.ciudad) || carpeta(c.nombre) === carpeta(l.ciudad)) || {})
      .ruta;
  const c = ruta && (ind.ciudades || []).find((x) => x.ruta === ruta);
  if (!c) return null;
  // Con su huella: una ilustración cambiada no sale de la caché vieja.
  const url = (m) => new URL(`../ilustraciones/${c.ruta}/${m}.webp?h=${(c.h || {})[m] || ""}`, import.meta.url).href;
  // Si falta una de las dos, la otra vale para los dos temas.
  const dia = c.dia ? url("dia") : url("noche");
  const noche = c.noche ? url("noche") : url("dia");
  return { dia, noche, nombre: c.nombre, ruta: c.ruta, y: Number.isFinite(c.y) ? c.y : 65 };
}

/* Las ilustraciones de un sitio, como lista (hoy, una): [] si no hay. */
export function fotosDe(lugar) {
  const l = lugarDe(lugar);
  if (enPrueba() || (!l.iata && !l.ciudad)) return Promise.resolve([]);
  return leerIndice().then((ind) => {
    const f = buscar(ind, l);
    return f ? [f] : [];
  });
}

// Las ilustraciones son de casa: no llevan crédito que enseñar.
export const creditoHTML = () => "";

/* El hueco: `<div class="foto-lugar" data-foto data-iata data-ciudad
   data-pais>`. `ponerFotos` los rellena cuando se van a ver. */
export const huecoFoto = (o, clase = "") => {
  const l = lugarDe(o);
  // `foto`: la del alojamiento guardado, para cuando la ciudad no tiene dibujo.
  const otra = o.foto && String(o.foto).startsWith("https://") ? ` data-otra="${esc(o.foto)}"` : "";
  return `<div class="foto-lugar ${clase}" data-foto data-iata="${esc(l.iata)}" data-ciudad="${esc(
    l.ciudad
  )}" data-pais="${esc(l.pais)}"${otra} aria-hidden="true"></div>`;
};

const css = (u) => `url("${String(u).replace(/"/g, "%22")}")`;

function rellenar(el) {
  if (el.dataset.fotoHecha) return;
  el.dataset.fotoHecha = "1";
  fotosDe({ iata: el.dataset.iata, ciudad: el.dataset.ciudad, pais: el.dataset.pais }).then(([f]) => {
    if (!f && el.dataset.otra) f = { dia: el.dataset.otra, noche: el.dataset.otra, y: 50 };
    if (!f) {
      el.classList.add("sin-foto");
      return;
    }
    el.style.setProperty("--ilu-dia", css(f.dia));
    el.style.setProperty("--ilu-noche", css(f.noche));
    // Por dónde se corta cuando el hueco es más apaisado que el dibujo.
    el.style.setProperty("--ilu-y", `${f.y}%`);
    // Se enseña cuando la que toca ya está: así no entra a medio pintar.
    const oscuro = document.documentElement.dataset.tema !== "claro";
    const img = new Image();
    img.onload = () => el.classList.add("con-foto");
    img.onerror = () => el.classList.add("sin-foto");
    img.src = oscuro ? f.noche : f.dia;
  });
}

let mirador = null;
export function ponerFotos(raiz = document) {
  const huecos = [...raiz.querySelectorAll("[data-foto]:not([data-foto-hecha])")];
  if (!huecos.length || enPrueba()) return;
  if (typeof IntersectionObserver !== "function") return huecos.forEach(rellenar);
  mirador =
    mirador ||
    new IntersectionObserver(
      (vistos) =>
        vistos.forEach((v) => {
          if (!v.isIntersecting) return;
          mirador.unobserve(v.target);
          rellenar(v.target);
        }),
      { rootMargin: "300px" }
    );
  huecos.forEach((h) => mirador.observe(h));
}
