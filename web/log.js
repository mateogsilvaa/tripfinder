/* Registro de errores del navegador.
   La web es estatica: no hay servidor donde apuntar nada, asi que los fallos
   se guardan en este navegador (localStorage) y se exportan a CSV desde
   /admin. Es lo que convierte un "no me funciona" en algo accionable. */

const TF_LOG_KEY = "tf_errores";
const TF_LOG_MAX = 300;

function tfLeerLog() {
  try {
    return JSON.parse(localStorage.getItem(TF_LOG_KEY) || "[]");
  } catch {
    return [];
  }
}

function tfApuntar(tipo, mensaje, detalle = "") {
  const lista = tfLeerLog();
  lista.unshift({
    cuando: new Date().toISOString(),
    tipo,
    mensaje: String(mensaje || "").slice(0, 400),
    detalle: String(detalle || "").slice(0, 800),
    donde: location.pathname + location.search,
    navegador: navigator.userAgent.slice(0, 160),
  });
  try {
    localStorage.setItem(TF_LOG_KEY, JSON.stringify(lista.slice(0, TF_LOG_MAX)));
  } catch {
    /* si no cabe, se descarta lo mas viejo en el siguiente intento */
  }
}

function tfVaciarLog() {
  localStorage.removeItem(TF_LOG_KEY);
}

/* --- capturas automaticas ------------------------------------------------ */
window.addEventListener("error", (e) => {
  tfApuntar("js", e.message, `${e.filename || ""}:${e.lineno || ""}:${e.colno || ""}`);
});

window.addEventListener("unhandledrejection", (e) => {
  const r = e.reason;
  tfApuntar("promesa", (r && (r.message || r)) || "rechazo sin motivo", (r && r.stack) || "");
});

/* Toda peticion que falle queda registrada con su URL y su codigo: es donde
   aparecen los 403 del token o una respuesta que no esperabamos.

   Con una excepcion: un 404 sobre un JSON de data/ NO es un fallo, es el estado
   normal de "esto todavia no se ha generado". La web pregunta por
   data/stays/<id>.json cada 20 segundos mientras el scraper trabaja, asi que
   una sola busqueda de alojamiento llenaba el registro de 404 identicos y
   enterraba los errores de verdad. Se ignoran solo esos: cualquier otro codigo
   sobre el mismo fichero (403, 500, un Pages caido) sigue quedando apuntado. */
const TF_ESPERADO_404 = /(^|\/)data\/[^?]*\.json(\?|$)/;

function tfEsRuido(url, status) {
  return status === 404 && TF_ESPERADO_404.test(url);
}

const tfFetchOriginal = window.fetch;
window.fetch = async function (...args) {
  const url = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "";
  try {
    const r = await tfFetchOriginal.apply(this, args);
    if (!r.ok && !tfEsRuido(url, r.status)) {
      tfApuntar("red", `${r.status} en ${url}`, r.statusText || "");
    }
    return r;
  } catch (err) {
    tfApuntar("red", `fallo de red en ${url}`, err.message || "");
    throw err;
  }
};


/* --- interruptor de tema -------------------------------------------------
   El tema ya se aplica en un <script> del <head> (si no, se ve el fogonazo del
   otro tema antes de que cargue esto). Aqui solo va el boton, que vive en las
   cuatro paginas porque log.js es el unico script que cargan todas.

   El claro es un estado con nombre, no la ausencia de atributo: de casa se
   entra en oscuro, asi que "sin data-tema" ya no puede significar "claro". */
(function () {
  const boton = document.getElementById("tema");
  if (!boton) return;
  const raiz = document.documentElement;
  const texto = boton.querySelector(".tema-txt");

  const pintar = () => {
    const oscuro = raiz.dataset.tema === "oscuro";
    // La etiqueta dice a donde vas, no donde estas: la carta de dia o la de noche.
    if (texto) texto.textContent = oscuro ? "día" : "noche";
    boton.setAttribute("aria-pressed", String(oscuro));
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", oscuro ? "#0b1720" : "#f2efe6");
  };

  boton.addEventListener("click", () => {
    // Sin esto, cada elemento con `transition` cruza a su propio ritmo y el
    // cambio de tema se ve como un charco de colores durante medio segundo.
    const corte = document.createElement("style");
    corte.textContent = "*,*::before,*::after{transition:none!important}";
    document.head.appendChild(corte);
    requestAnimationFrame(() => requestAnimationFrame(() => corte.remove()));

    const oscuro = raiz.dataset.tema === "oscuro";
    raiz.dataset.tema = oscuro ? "claro" : "oscuro";
    try {
      localStorage.setItem("tf_tema", oscuro ? "claro" : "oscuro");
    } catch {
      /* navegacion privada: el tema dura lo que la pestaña */
    }
    pintar();
  });

  pintar();
})();

/* --- diálogos accesibles -------------------------------------------------
   Un diálogo que no atrapa el foco no es un diálogo: con teclado te sales sin
   darte cuenta y sigues tabulando por la página de detrás, que ademas sigue
   ahi debajo del velo. Esto lo arregla en un solo sitio y lo usan los cuatro
   que tiene la web —el selector de destinos, la hoja de alojamiento, el de
   entrar/preferencias y los del panel—, que si no acaba habiendo cuatro
   versiones distintas y tres a medias.

   Vive aqui porque log.js es el unico script que cargan las cuatro paginas.

   Lo que hace, en orden:
     1. marca el dialogo con role/aria-modal, que es lo que hace que un lector
        de pantalla lo anuncie como tal y deje de leer el fondo;
     2. apaga el resto de la pagina con `inert`, asi no se tabula ni se lee;
     3. lleva el foco dentro y lo cicla con Tab y Mayus+Tab;
     4. cierra con Escape;
     5. y al cerrar devuelve el foco a quien lo abrio, que es la mitad de la
        gracia: si no, vuelves al principio del documento.

   El `inert` ya impide tabular al fondo por si solo; el ciclo esta ademas para
   que Tab de la vuelta dentro del dialogo en vez de irse a la barra del
   navegador. */

const TF_FOCABLES = [
  "a[href]", "button:not([disabled])", "input:not([disabled])",
  "select:not([disabled])", "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/* Solo lo que de verdad se puede enfocar: un boton dentro de algo con [hidden]
   sale en el querySelectorAll pero no recibe el foco, y el ciclo se atascaria. */
const tfVisible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);

let tfDialogoAbierto = null;

function tfAbrirDialogo(caja, { dialogo, foco, alCerrar, etiqueta } = {}) {
  if (!caja) return;
  if (tfDialogoAbierto) tfCerrarDialogo(tfDialogoAbierto.caja);

  const panel = dialogo || caja.querySelector('[role="dialog"]') || caja;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  if (etiqueta && !panel.getAttribute("aria-label")) panel.setAttribute("aria-label", etiqueta);

  // El fondo, apagado. Se apunta lo que apagamos nosotros para no despertar
  // luego algo que ya estaba inerte por su cuenta.
  const apagados = [];
  for (const hijo of Array.from(document.body.children)) {
    if (hijo === caja || hijo.contains(caja) || caja.contains(hijo)) continue;
    if (hijo.inert) continue;
    hijo.inert = true;
    apagados.push(hijo);
  }

  const estado = {
    caja,
    panel,
    apagados,
    alCerrar,
    // A donde vuelve el foco al cerrar.
    volverA: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    teclas: null,
  };

  estado.teclas = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      tfCerrarDialogo(caja);
      return;
    }
    if (e.key !== "Tab") return;
    const focables = Array.from(panel.querySelectorAll(TF_FOCABLES)).filter(tfVisible);
    if (!focables.length) {
      e.preventDefault();
      return;
    }
    const primero = focables[0];
    const ultimo = focables[focables.length - 1];
    if (e.shiftKey && document.activeElement === primero) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primero.focus();
    }
  };
  document.addEventListener("keydown", estado.teclas, true);

  document.body.style.overflow = "hidden";
  tfDialogoAbierto = estado;

  // El foco, dentro. Si no se dice cual, el primero que haya; y si no hay
  // ninguno, el propio panel, para que el lector lea al menos el titulo.
  const destino =
    (typeof foco === "function" ? foco() : foco) ||
    Array.from(panel.querySelectorAll(TF_FOCABLES)).filter(tfVisible)[0];
  if (destino && destino.focus) {
    destino.focus();
  } else {
    panel.setAttribute("tabindex", "-1");
    panel.focus();
  }
}

function tfCerrarDialogo(caja) {
  const estado = tfDialogoAbierto;
  if (!estado || (caja && estado.caja !== caja)) return;
  tfDialogoAbierto = null;

  document.removeEventListener("keydown", estado.teclas, true);
  estado.apagados.forEach((el) => (el.inert = false));
  document.body.style.overflow = "";
  estado.panel.removeAttribute("aria-modal");

  if (estado.alCerrar) estado.alCerrar();
  // Devolver el foco al final: antes de esto el fondo todavia estaba inerte y
  // el navegador se negaria a enfocar nada de ahi.
  if (estado.volverA && document.contains(estado.volverA)) estado.volverA.focus();
}

const tfHayDialogo = () => !!tfDialogoAbierto;

/* --- decir en voz alta lo que esta pasando -------------------------------
   Las esperas de esta web son largas de verdad: una busqueda "donde sea" son
   ocho minutos y el alojamiento hace polling durante quince. Quien no ve la
   pantalla no tiene forma de saber que hay algo en marcha, ni cuando ha
   terminado —que es la mitad que siempre se olvida.

   Un solo sitio donde hablar, fuera de la vista pero no del lector. `polite`
   y no `assertive` a proposito: esto es informacion de fondo, no una alarma,
   y no debe cortar lo que el lector este diciendo.

   Lo importante: NO repetir. El polling da una vuelta cada pocos segundos y
   sin esto anunciaria "buscando…" para siempre. Solo se dice lo que cambia. */
let tfUltimoAnuncio = "";

function tfRegion() {
  let region = document.getElementById("tfAnuncios");
  if (!region) {
    region = document.createElement("p");
    region.id = "tfAnuncios";
    region.className = "solo-lector";
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    region.setAttribute("aria-atomic", "true");
    document.body.appendChild(region);
  }
  return region;
}

/* La region tiene que existir ANTES de escribir en ella: una `aria-live` que
   aparece en el DOM a la vez que su contenido no la anuncian la mitad de los
   lectores, porque no estaba ahi cuando el navegador empezo a observarla. */
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", tfRegion, { once: true });
} else {
  tfRegion();
}

function tfAnunciar(mensaje) {
  const texto = String(mensaje || "").trim();
  if (!texto || texto === tfUltimoAnuncio) return;
  tfUltimoAnuncio = texto;
  tfRegion().textContent = texto;
}

/* Para cuando lo siguiente que se diga pueda ser lo mismo que ya se dijo y aun
   asi haya que decirlo (otra busqueda igual, otra vuelta al mismo estado). */
function tfOlvidarAnuncio() {
  tfUltimoAnuncio = "";
}
