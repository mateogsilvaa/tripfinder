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
  // Y al panel, si hay Firebase: lo de este navegador solo lo ve quien lo usa,
  // y un «no me funciona» de otro no llegaba nunca.
  if (typeof nubeApuntarError === "function") {
    try {
      nubeApuntarError(tipo, mensaje, detalle);
    } catch {
      /* el registro nunca rompe la página */
    }
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
// Para lo que no debe apuntarse a si mismo si falla (la actividad de nube.js).
window.tfFetchSinLog = (...args) => tfFetchOriginal.apply(window, args);
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
    // Los mismos que el <head>: la barra del sistema (y la de la app
    // instalada) del color del papel, no de otro azul que no sale en ningún sitio.
    document
      .querySelectorAll('meta[name="theme-color"]')
      .forEach((m) => m.setAttribute("content", oscuro ? "#100f0e" : "#f3f0e9"));
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

/* --------------------------------------------------- la aplicacion instalable
   Se registra solo donde hay manifiesto, que son las tres paginas publicas: el
   panel escribe en el repo con un token y la 404 no es un sitio, y ninguno de
   los dos gana nada con una copia en disco.

   El `scope` sale de la ruta del propio fichero, asi que en /tripfinder/ cubre
   /tripfinder/ y no la raiz del dominio. */
if (
  "serviceWorker" in navigator &&
  document.querySelector('link[rel="manifest"]') &&
  // Solo en contexto seguro. En https siempre; en file:// no hay nada que hacer.
  window.isSecureContext
) {
  window.addEventListener("load", () => {
    // La version va en la URL: sin ella el navegador se queda con el sw.js
    // guardado y un despliegue nuevo no llegaria a activarse nunca.
    const v = (document.querySelector('link[rel="manifest"]')?.href.split("v=")[1] || "").trim();
    navigator.serviceWorker
      .register(`sw.js${v ? `?v=${encodeURIComponent(v)}` : ""}`)
      .catch((err) => {
        // Que falle no rompe nada: la web funciona igual, solo que sin red no
        // abre. Se apunta porque un registro que falla siempre es un sintoma.
        if (typeof tfApuntar === "function") tfApuntar("sw", "No se pudo registrar", String(err));
      });
  });
}

/* Si lo ultimo que se pinto salio de la caja y no de la red. Lo pone `fetchJSON`
   al ver la cabecera que mete el service worker, y lo lee el pie. */
let tfDeLaCaja = false;
function tfMarcarCaja(si) {
  tfDeLaCaja = !!si;
}
function tfEsDeLaCaja() {
  return tfDeLaCaja;
}

/* ------------------------------------------------- ofrecer instalarla como app
   En el móvil, a la pantalla de inicio; en el ordenador, como una ventana
   propia, sin la barra del navegador. Chrome y Edge avisan con
   `beforeinstallprompt`: se guarda y se ofrece con nuestras palabras, abajo y
   pequeño. Safari en iPhone no avisa de nada, así que ahí se explica el gesto.

   SIN DAR LA LATA: nunca en la primera visita (quien acaba de llegar no sabe
   aún si le sirve), nunca si ya está instalada, y «Ahora no» calla treinta
   días. Y siempre queda el botón del pie, para quien lo quiera luego. */
const TF_INSTALAR_NO = "tf_instalar_no";
const TF_VISITAS = "tf_visitas";
let tfAvisoInstalar = null;

const tfInstalada = () =>
  (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
const tfEsIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios|edgios/i.test(navigator.userAgent);
const tfEsMovil = () => (window.matchMedia ? window.matchMedia("(pointer: coarse)").matches : false);

function tfPuedeOfrecer() {
  if (tfInstalada() || !document.querySelector('link[rel="manifest"]')) return false;
  try {
    const no = Number(localStorage.getItem(TF_INSTALAR_NO) || 0);
    if (no && Date.now() - no < 30 * 864e5) return false;
    return Number(localStorage.getItem(TF_VISITAS) || 0) >= 2;
  } catch {
    return false;
  }
}

function tfOfrecerInstalar(forzar = false) {
  if (!forzar && !tfPuedeOfrecer()) return;
  if (document.getElementById("tfInstalar")) return;
  const ios = !tfAvisoInstalar && tfEsIOS();
  if (!tfAvisoInstalar && !ios) return;
  const caja = document.createElement("aside");
  caja.id = "tfInstalar";
  caja.className = "instalar";
  caja.setAttribute("role", "dialog");
  caja.setAttribute("aria-label", "Instalar TripFinder");
  const donde = tfEsMovil() ? "en tu pantalla de inicio" : "en tu ordenador, como una app";
  caja.innerHTML = ios
    ? `<p><b>TripFinder ${donde}.</b> Pulsa <span class="instalar-ico" aria-label="Compartir">⎙</span>
         Compartir y luego «Añadir a pantalla de inicio».</p>
       <button type="button" class="btn ghost small" data-instalar-no>Entendido</button>`
    : `<p><b>TripFinder ${donde}.</b> Se abre en su propia ventana y avisa más rápido.</p>
       <button type="button" class="btn primary small" data-instalar-si>Instalar</button>
       <button type="button" class="btn ghost small" data-instalar-no>Ahora no</button>`;
  document.body.appendChild(caja);
  const quitar = () => caja.remove();
  caja.querySelector("[data-instalar-no]").addEventListener("click", () => {
    try {
      localStorage.setItem(TF_INSTALAR_NO, String(Date.now()));
    } catch {
      /* navegación privada */
    }
    quitar();
  });
  const si = caja.querySelector("[data-instalar-si]");
  if (si) {
    si.addEventListener("click", async () => {
      const aviso = tfAvisoInstalar;
      tfAvisoInstalar = null;
      quitar();
      if (!aviso) return;
      aviso.prompt();
      try {
        await aviso.userChoice;
      } catch {
        /* da igual lo que conteste */
      }
      tfPintarBotonInstalar();
    });
  }
}

/* El botón del pie: sale cuando el navegador deja instalar (o en un iPhone) y
   no está instalada ya. */
function tfPintarBotonInstalar() {
  const pie = document.querySelector(".foot-in");
  if (!pie) return;
  let b = document.getElementById("tfInstalarPie");
  const puede = !tfInstalada() && (tfAvisoInstalar || tfEsIOS());
  if (!puede) {
    if (b) b.remove();
    return;
  }
  if (b) return;
  b = document.createElement("button");
  b.id = "tfInstalarPie";
  b.type = "button";
  b.className = "instalar-pie";
  b.textContent = tfEsMovil() ? "Instalar la app" : "Instalar en el ordenador";
  b.addEventListener("click", () => tfOfrecerInstalar(true));
  pie.appendChild(b);
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  tfAvisoInstalar = e;
  tfPintarBotonInstalar();
  setTimeout(() => tfOfrecerInstalar(), 4000);
});
window.addEventListener("appinstalled", () => {
  tfAvisoInstalar = null;
  document.getElementById("tfInstalar")?.remove();
  tfPintarBotonInstalar();
});
window.addEventListener("load", () => {
  try {
    localStorage.setItem(TF_VISITAS, String(Number(localStorage.getItem(TF_VISITAS) || 0) + 1));
  } catch {
    /* navegación privada */
  }
  tfPintarBotonInstalar();
  if (tfEsIOS()) setTimeout(() => tfOfrecerInstalar(), 4000);
});
