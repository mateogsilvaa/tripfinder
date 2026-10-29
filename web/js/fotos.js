/* fotos.js — Las fotos de cada destino.

   La librería es Wikipedia: el artículo de cada ciudad ya tiene sus fotos
   escogidas (la de cabecera y las de dentro), con autor y licencia libre, y su
   API se deja leer desde el navegador sin clave (`origin=*`). De cada destino
   se sacan unas pocas: la de cabecera primero y luego las de dentro que son
   FOTOS (JPEG, apaisadas, grandes), no banderas, escudos ni mapas.

   · QUÉ ARTÍCULO: el nombre del destino no siempre es el de la ciudad
     («Ilinden» es el aeropuerto de Skopie, «Ranón» el de Asturias), así que
     por código de aeropuerto se va al artículo bueno (`ARTICULOS`). Lo que no
     está ahí se busca por «ciudad, país».
   · SE GUARDAN: un mes en el navegador (`localStorage`), y la falta de fotos
     dos días. Una portada con veinte destinos no hace cuarenta peticiones cada
     vez que se abre.
   · DE TRES EN TRES: las peticiones van en fila, y solo cuando la tarjeta se
     va a ver (`IntersectionObserver`).
   · APAGADAS (`ENCENDIDAS`, más abajo). Y en las pruebas tampoco salen
     (`navigator.webdriver`), salvo que la prueba las pida con
     `window.TF_FOTOS = true` y conteste ella a Wikipedia.
   · El crédito va siempre con la foto: es lo que pide su licencia. */
import { esc, escURL } from "./base.js";

const API = "https://es.wikipedia.org/w/api.php";
const CLAVE = "tf_fotos:v1:";
const DURA_MS = 30 * 864e5;
const DURA_SIN_MS = 2 * 864e5;
const ANCHO = 960;
const A_LA_VEZ = 3;

/* Código de aeropuerto → artículo de la Wikipedia en español. Los que sirven a
   otra ciudad (Beauvais a París, Bérgamo a Milán…) van a la ciudad: es lo que
   va a ver quien vuela allí. */
const ARTICULOS = {
  ACE: "Lanzarote", AGA: "Agadir", AGP: "Málaga", AHO: "Alguer", ALC: "Alicante", ALG: "Argel",
  AMS: "Ámsterdam", ARN: "Estocolmo", ATH: "Atenas", BCN: "Barcelona", BEG: "Belgrado", BER: "Berlín",
  BGY: "Bérgamo", BHX: "Birmingham", BIO: "Bilbao", BLQ: "Bolonia", BOD: "Burdeos", BRI: "Bari",
  BRS: "Bristol", BRU: "Bruselas", BSL: "Basilea", BTS: "Bratislava", BUD: "Budapest", BVA: "París",
  BBU: "Bucarest", CAG: "Cagliari", CDG: "París", CIA: "Roma", CLJ: "Cluj-Napoca", CPH: "Copenhague",
  CRA: "Craiova", CRL: "Bruselas", CTA: "Catania", DUB: "Dublín", DBV: "Dubrovnik", EDI: "Edimburgo",
  EIN: "Eindhoven", EZE: "Buenos Aires", FCO: "Roma", FEZ: "Fez", FLR: "Florencia", FRA: "Fráncfort del Meno",
  FUE: "Fuerteventura", GDN: "Gdansk", GOA: "Génova", GRU: "São Paulo", GVA: "Ginebra", HAM: "Hamburgo",
  IAS: "Iași", IBZ: "Ibiza", ICN: "Seúl", IST: "Estambul", KRK: "Cracovia", KTW: "Katowice",
  KUT: "Kutaisi", LCA: "Lárnaca", LGW: "Londres", LHR: "Londres", LIM: "Lima", LIS: "Lisboa",
  LPA: "Gran Canaria", LTN: "Londres", LUX: "Luxemburgo (ciudad)", LYS: "Lyon", MAD: "Madrid",
  MAN: "Mánchester", MEX: "Ciudad de México", MLA: "Malta", MRS: "Marsella", MUC: "Múnich", MXP: "Milán",
  NAP: "Nápoles", NCE: "Niza", NYO: "Estocolmo", OPO: "Oporto", ORY: "París", OSL: "Oslo",
  OTP: "Bucarest", OVD: "Oviedo", PMI: "Palma de Mallorca", PMO: "Palermo", PRG: "Praga", PSA: "Pisa",
  RAK: "Marrakech", RBA: "Rabat", RIX: "Riga", SBZ: "Sibiu", SCQ: "Santiago de Compostela", SKP: "Skopie",
  SOF: "Sofía", SPU: "Split", STN: "Londres", SUF: "Lamezia Terme", SVQ: "Sevilla", TFS: "Tenerife",
  TIA: "Tirana", TLL: "Tallin", TLS: "Toulouse", TNG: "Tánger", TPS: "Trapani", TRN: "Turín",
  TSF: "Venecia", TSR: "Timișoara", TTU: "Tetuán", VCE: "Venecia", VIE: "Viena", VLC: "Valencia",
  VNO: "Vilna", VRN: "Verona", WAW: "Varsovia", WMI: "Varsovia", WRO: "Breslavia", ZAG: "Zagreb",
  ZRH: "Zúrich",
};

// Lo que, por el nombre del archivo, no es una foto del sitio.
const NO_ES_FOTO =
  /flag|bandera|escudo|coat[_ ]of[_ ]arms|blas[oó]n|wappen|mapa|map[_ .-]|location|locator|localizaci|logo|icon|seal|sello|plano|diagram|signature|firma|pictogram|s[ií]mbolo|symbol|commons-|wiki|portal|question|disambig|edit-|stub/i;

/* APAGADAS de momento: las fotos de Wikipedia no convencen y se van a poner a
   mano, empezando por las ciudades que más salen. Con esto en false no se
   pide nada a Wikipedia y cada hueco se queda con el color de su sitio. Una
   prueba las enciende con `window.TF_FOTOS = true`. */
const ENCENDIDAS = false;
const enPrueba = () =>
  typeof window === "undefined" ||
  (!window.TF_FOTOS && (!ENCENDIDAS || (typeof navigator !== "undefined" && navigator.webdriver)));

export const lugarDe = (o) => ({
  iata: String(o.iata || o.destination || "").toUpperCase(),
  ciudad: String(o.ciudad || o.destination_name || o.titulo || "").replace(/\s*\(.*\)\s*$/, ""),
  pais: String(o.pais || o.destination_country || ""),
});

const claveDe = (l) => (l.iata && ARTICULOS[l.iata] ? `a:${ARTICULOS[l.iata]}` : `c:${l.ciudad}|${l.pais}`).toLowerCase();

function leer(clave) {
  try {
    const g = JSON.parse(localStorage.getItem(CLAVE + clave) || "null");
    if (g && Date.now() - g.t < (g.f.length ? DURA_MS : DURA_SIN_MS)) return g.f;
  } catch {
    /* sin almacenamiento: se pregunta */
  }
  return null;
}

function guardar(clave, fotos) {
  try {
    localStorage.setItem(CLAVE + clave, JSON.stringify({ t: Date.now(), f: fotos }));
  } catch {
    /* lleno o bloqueado: la próxima vez se pregunta otra vez */
  }
}

/* La fila: como mucho A_LA_VEZ peticiones a Wikipedia en marcha. */
let enMarcha = 0;
const cola = [];
function enFila(tarea) {
  return new Promise((ok, mal) => {
    cola.push(() => tarea().then(ok, mal));
    siguiente();
  });
}
function siguiente() {
  if (enMarcha >= A_LA_VEZ || !cola.length) return;
  enMarcha += 1;
  cola
    .shift()()
    .finally(() => {
      enMarcha -= 1;
      siguiente();
    });
}

async function api(params) {
  const q = new URLSearchParams({ action: "query", format: "json", formatversion: "2", origin: "*", ...params });
  const r = await fetch(`${API}?${q}`);
  if (!r.ok) throw new Error(`wikipedia ${r.status}`);
  return r.json();
}

const sinEtiquetas = (html) => String(html || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

async function articulo(titulo) {
  const d = await api({
    titles: titulo,
    redirects: "1",
    prop: "pageimages|pageprops|images",
    piprop: "name",
    ppprop: "disambiguation",
    imlimit: "60",
  });
  const p = (d.query && d.query.pages && d.query.pages[0]) || null;
  if (!p || p.missing || (p.pageprops && "disambiguation" in p.pageprops)) return null;
  return p;
}

async function buscarArticulo(l) {
  const d = await api({ list: "search", srsearch: `${l.ciudad} ${l.pais}`.trim(), srlimit: "1" });
  const t = d.query && d.query.search && d.query.search[0] && d.query.search[0].title;
  return t ? articulo(t) : null;
}

async function pedir(l, n) {
  let p = l.iata && ARTICULOS[l.iata] ? await articulo(ARTICULOS[l.iata]) : null;
  if (!p && l.ciudad) p = (await articulo(l.ciudad)) || (await buscarArticulo(l));
  if (!p) return [];
  const portada = p.pageimage ? `Archivo:${p.pageimage.replace(/_/g, " ")}` : "";
  const nombres = (p.images || [])
    .map((i) => i.title)
    .filter((t) => /\.jpe?g$/i.test(t) && !NO_ES_FOTO.test(t) && t !== portada);
  const candidatas = [portada, ...nombres].filter(Boolean).slice(0, 24);
  if (!candidatas.length) return [];
  const d = await api({
    titles: candidatas.join("|"),
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: String(ANCHO),
    iiextmetadatafilter: "Artist|LicenseShortName",
  });
  const porTitulo = new Map((d.query.pages || []).map((x) => [x.title.replace(/^(File|Archivo):/, ""), x]));
  const fotos = [];
  for (const t of candidatas) {
    const x = porTitulo.get(t.replace(/^(File|Archivo):/, ""));
    const ii = x && x.imageinfo && x.imageinfo[0];
    if (!ii || ii.mime !== "image/jpeg" || !ii.thumburl) continue;
    const proporcion = ii.width / ii.height;
    const esPortada = t === portada;
    if (ii.width < 800 || proporcion > 2.4 || proporcion < (esPortada ? 0.7 : 1.15)) continue;
    const meta = ii.extmetadata || {};
    fotos.push({
      src: ii.thumburl,
      w: ii.thumbwidth,
      h: ii.thumbheight,
      autor: sinEtiquetas(meta.Artist && meta.Artist.value).slice(0, 60),
      licencia: sinEtiquetas(meta.LicenseShortName && meta.LicenseShortName.value).slice(0, 30),
      pagina: ii.descriptionurl || "",
    });
    if (fotos.length >= n) break;
  }
  return fotos;
}

const pidiendo = new Map();

/* Las fotos de un sitio (hasta `n`), o [] si no hay o no se puede preguntar. */
export function fotosDe(lugar, n = 8) {
  const l = lugarDe(lugar);
  if (enPrueba() || (!l.iata && !l.ciudad)) return Promise.resolve([]);
  const clave = claveDe(l);
  const guardadas = leer(clave);
  if (guardadas) return Promise.resolve(guardadas.slice(0, n));
  if (!pidiendo.has(clave)) {
    pidiendo.set(
      clave,
      enFila(() => pedir(l, 8))
        .then((f) => {
          guardar(clave, f);
          return f;
        })
        .catch(() => [])
        .finally(() => pidiendo.delete(clave))
    );
  }
  return pidiendo.get(clave).then((f) => f.slice(0, n));
}

export const creditoHTML = (f) =>
  f && f.pagina
    ? `<a class="foto-credito" href="${escURL(f.pagina)}" target="_blank" rel="noopener"
        title="Ver la foto en Wikimedia Commons">${esc([f.autor || "Wikimedia Commons", f.licencia].filter(Boolean).join(" · "))}</a>`
    : "";

/* El hueco de una foto: `<div class="foto-lugar" data-foto data-iata data-ciudad
   data-pais>`. `ponerFotos` los rellena cuando se van a ver. */
export const huecoFoto = (o, clase = "") => {
  const l = lugarDe(o);
  return `<div class="foto-lugar ${clase}" data-foto data-iata="${esc(l.iata)}" data-ciudad="${esc(
    l.ciudad
  )}" data-pais="${esc(l.pais)}" aria-hidden="true"></div>`;
};

function rellenar(el) {
  if (el.dataset.fotoHecha) return;
  el.dataset.fotoHecha = "1";
  const i = Number(el.dataset.fotoN || 0);
  fotosDe({ iata: el.dataset.iata, ciudad: el.dataset.ciudad, pais: el.dataset.pais }, i + 1).then((fotos) => {
    const f = fotos[i] || fotos[0];
    if (!f) {
      el.classList.add("sin-foto");
      return;
    }
    const img = new Image();
    img.onload = () => {
      el.style.backgroundImage = `url("${f.src.replace(/"/g, "%22")}")`;
      el.classList.add("con-foto");
      if (!el.querySelector(".foto-credito")) el.insertAdjacentHTML("beforeend", creditoHTML(f));
    };
    img.onerror = () => el.classList.add("sin-foto");
    img.src = f.src;
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
