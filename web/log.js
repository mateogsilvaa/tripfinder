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

/* Y dos más que no son fallos de la web:
   · un 409 en un `:commit` de Firestore es «eso ya existe»: lo que se crea con
     id fijo (mandar a un HOP un vuelo que ya estaba, volver a votar) lo
     espera y lo trata quien escribe;
   · un fallo de red con la página oculta o sin conexión es el móvil que se ha
     dormido o se ha quedado sin cobertura, no la web. */
function tfEsRuido(url, status) {
  if (status === 404 && TF_ESPERADO_404.test(url)) return true;
  return status === 409 && /firestore\.googleapis\.com\/.*:commit$/.test(url);
}
const tfRedDormida = () => document.visibilityState === "hidden" || navigator.onLine === false;

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
    if (!tfRedDormida() && err.name !== "AbortError") tfApuntar("red", `fallo de red en ${url}`, err.message || "");
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

  const cambiar = () => {
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
  };
  // En un círculo que se abre desde el botón (más abajo, `tfTemaEnCirculo`).
  boton.addEventListener("click", () =>
    typeof tfTemaEnCirculo === "function" ? tfTemaEnCirculo(boton, cambiar) : cambiar()
  );

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

  // La salida: una copia que se va mientras el de verdad ya está cerrado.
  if (typeof tfSalidaDialogo === "function") tfSalidaDialogo(estado.caja);
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
    const url = `sw.js${v ? `?v=${encodeURIComponent(v)}` : ""}`;
    // Safari en el iPhone a veces lo rechaza («Rejected») si coincide con que
    // la app se va a segundo plano o la página aún no está activa del todo. Se
    // reintenta dos veces, con la página a la vista, antes de darlo por malo.
    const registrar = (quedan) =>
      navigator.serviceWorker.register(url).catch((err) => {
        if (quedan > 0) {
          return new Promise((ok) => {
            const otra = () => setTimeout(() => ok(registrar(quedan - 1)), 3000);
            if (document.visibilityState === "visible") otra();
            else document.addEventListener("visibilitychange", otra, { once: true });
          });
        }
        throw err;
      });
    registrar(2)
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

/* ------------------------------------------------- banderas donde no las hay
   Windows no dibuja el emoji de bandera: pinta las dos letras del código. Se
   mira en un lienzo de un píxel si una bandera sale en color (como hace
   `country-flag-emoji-polyfill`); si no, `html.sin-banderas` y la hoja de
   estilos usa una fuente que solo trae banderas. Donde sí las hay, nada. */
(function tfBanderas() {
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.textBaseline = "top";
    x.font = '100px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    x.scale(0.01, 0.01);
    const pinta = (t, color) => {
      x.clearRect(0, 0, 100, 100);
      x.fillStyle = color;
      x.fillText(t, 0, 0);
      return x.getImageData(0, 0, 1, 1).data.join(",");
    };
    // En color de verdad: igual pintado en blanco que en negro, y no vacío.
    const enColor = (t) => pinta(t, "#fff") === pinta(t, "#000") && !pinta(t, "#000").startsWith("0,0,0,");
    if (enColor("\u{1F60A}") && !enColor("\u{1F1E8}\u{1F1ED}")) document.documentElement.classList.add("sin-banderas");
  } catch {
    /* sin lienzo: se queda como esté */
  }
})();

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
  tfPreguntarCanal(1500);
});

/* Recién instalada (o abierta ya instalada, que en el iPhone es la única forma
   de saberlo): se pregunta una vez si los avisos van por notificación, por
   correo o por las dos. Ver `js/notificaciones.js`. */
function tfPreguntarCanal(espera) {
  setTimeout(() => {
    import("./js/notificaciones.js")
      .then((m) => m.preguntarCanal())
      .catch(() => {
        /* sin el módulo, se queda en el correo */
      });
  }, espera);
}
window.addEventListener("load", () => {
  try {
    localStorage.setItem(TF_VISITAS, String(Number(localStorage.getItem(TF_VISITAS) || 0) + 1));
  } catch {
    /* navegación privada */
  }
  tfPintarBotonInstalar();
  if (tfEsIOS()) setTimeout(() => tfOfrecerInstalar(), 4000);
  if (tfInstalada()) tfPreguntarCanal(2500);
});

/* ------------------------------------------- la lente de la barra de abajo
   En el móvil, la zona en la que estás va en una lente de cristal. Al tocar
   otra, la lente se desliza hasta ella y entonces se cambia de página: el
   gesto se ve, en vez de saltar. Sin esto (sin JavaScript), la lente es el
   fondo de la pestaña activa (ver `.tabbar:not(.con-lente)` en la hoja). */
const tfSinMovimiento = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function tfLente() {
  const barra = document.querySelector(".tabbar");
  if (!barra || getComputedStyle(barra).display === "none" || barra.querySelector(".tab-lente")) return;
  const lente = document.createElement("span");
  lente.className = "tab-lente";
  lente.setAttribute("aria-hidden", "true");
  barra.prepend(lente);
  barra.classList.add("con-lente");
  const tabs = () => [...barra.querySelectorAll(".tab")];
  const activa = () => barra.querySelector(".tab.activa");
  let x = 0;
  let w = 0;
  let animacion = null;
  const fijar = (nx, nw) => {
    x = nx;
    w = nw;
    lente.style.width = `${nw}px`;
    lente.style.transform = `translateX(${nx}px)`;
  };
  const enTab = (tab) => fijar(tab.offsetLeft, tab.offsetWidth);
  const marcar = (tab) => tabs().forEach((t) => t.classList.toggle("activa", t === tab));

  /* EL MOVIMIENTO, COMO UNA GOTA. De una zona a otra la lente se estira hasta
     cubrir las dos, se aplasta un poco al ir y llega con un rebote. */
  const ir = (tab) => {
    if (animacion) animacion.cancel();
    const x1 = tab.offsetLeft;
    const w1 = tab.offsetWidth;
    if (tfSinMovimiento() || !lente.animate) return fijar(x1, w1);
    const desde = Math.min(x, x1);
    const largo = Math.max(x + w, x1 + w1) - desde;
    animacion = lente.animate(
      [
        { transform: `translateX(${x}px) scaleY(1)`, width: `${w}px` },
        { transform: `translateX(${desde}px) scaleY(0.86)`, width: `${largo}px`, offset: 0.45 },
        { transform: `translateX(${x1}px) scaleY(1)`, width: `${w1}px` },
      ],
      { duration: 520, easing: "cubic-bezier(0.3, 1.25, 0.4, 1)" }
    );
    fijar(x1, w1);
  };

  enTab(activa() || tabs()[0]);
  if (!activa()) lente.style.opacity = "0";

  const irA = (tab) => {
    if (!tab || tab.classList.contains("activa")) {
      if (tab) ir(tab);
      return;
    }
    marcar(tab);
    lente.style.opacity = "1";
    ir(tab);
    setTimeout(() => (location.href = tab.href), tfSinMovimiento() ? 0 : 320);
  };

  /* ARRASTRARLA: con el dedo sobre la barra, la lente lo sigue (algo
     agrandada, como una lupa) y al soltar se queda en la zona de debajo. */
  let dedo = null;
  const bajoDedo = (cx) =>
    tabs().reduce((mejor, t) => {
      const r = t.getBoundingClientRect();
      const d = Math.abs(cx - (r.left + r.width / 2));
      return !mejor || d < mejor.d ? { t, d } : mejor;
    }, null).t;
  barra.addEventListener("pointerdown", (e) => {
    if (e.button) return;
    dedo = { x0: e.clientX, arrastra: false, id: e.pointerId };
    lente.classList.add("pulsada");
  });
  barra.addEventListener("pointermove", (e) => {
    if (!dedo || e.pointerId !== dedo.id) return;
    if (!dedo.arrastra && Math.abs(e.clientX - dedo.x0) < 8) return;
    if (!dedo.arrastra) {
      dedo.arrastra = true;
      try {
        barra.setPointerCapture(e.pointerId);
      } catch {
        /* sin captura, sigue igual */
      }
      if (animacion) animacion.cancel();
    }
    const caja = barra.getBoundingClientRect();
    const nx = Math.max(4, Math.min(caja.width - w - 4, e.clientX - caja.left - w / 2));
    fijar(nx, w);
    tabs().forEach((t) => t.classList.toggle("bajo", t === bajoDedo(e.clientX)));
  });
  const soltar = (e) => {
    if (!dedo) return;
    lente.classList.remove("pulsada");
    tabs().forEach((t) => t.classList.remove("bajo"));
    if (dedo.arrastra && e.type === "pointerup") {
      dedo.sinClic = true;
      irA(bajoDedo(e.clientX));
    }
    const fue = dedo;
    setTimeout(() => {
      if (dedo === fue) dedo = null;
    }, 0);
  };
  barra.addEventListener("pointerup", soltar);
  barra.addEventListener("pointercancel", soltar);

  barra.addEventListener("click", (e) => {
    const tab = e.target.closest(".tab");
    if (!tab || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    // Tras arrastrar, el clic que llega ya está atendido.
    if (dedo && dedo.sinClic) return;
    irA(tab);
  });
  window.addEventListener("resize", () => activa() && enTab(activa()));
  // Volver con «atrás» deja la página como estaba al irse: la lente, en su sitio.
  window.addEventListener("pageshow", (ev) => {
    if (!ev.persisted) return;
    const aqui = barra.querySelector('.tab[aria-current="page"]');
    if (aqui) marcar(aqui);
    if (activa()) enTab(activa());
  });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", tfLente);
else tfLente();

/* ------------------------------------------------ ¡que es para el vertical!
   En la app instalada en el móvil, al ponerlo de lado la web se cae a trozos,
   pasa el avión del icono y deja escrito que esto es para tenerlo de pie. Al
   volver a ponerlo en vertical, todo vuelve a su sitio. Con «menos movimiento»
   en el sistema, sale el mensaje sin la caída. */
const tfApaisado = window.matchMedia
  ? window.matchMedia("(orientation: landscape) and (max-height: 500px) and (pointer: coarse)")
  : null;

function tfCaer() {
  if (document.getElementById("tfGiro")) return;
  const raiz = document.documentElement;
  const trozos = [
    ...document.querySelectorAll("body > *:not(main):not(script):not(style):not(link), main > *"),
  ].filter((n) => n.getBoundingClientRect().height > 0);
  // Cada trozo con su giro, su empujón de lado y su retraso: de arriba abajo,
  // como si cediera el suelo, con un poco de desorden.
  trozos.forEach((n, i) => {
    n.classList.add("tf-trozo");
    n.style.setProperty("--giro", `${Math.round(Math.random() * 60 - 30)}deg`);
    n.style.setProperty("--lado", `${Math.round(Math.random() * 120 - 60)}px`);
    n.style.setProperty("--retraso", `${Math.min(i, 9) * 55 + Math.round(Math.random() * 60)}ms`);
  });
  raiz.classList.remove("tf-volviendo");
  raiz.classList.add("tf-cayendo");
  const letras = (t, desde) =>
    [...t]
      .map((c, k) => `<i style="--k:${desde + k}">${c === " " ? "&nbsp;" : c}</i>`)
      .join("");
  const capa = document.createElement("div");
  capa.id = "tfGiro";
  capa.setAttribute("role", "alert");
  capa.setAttribute("aria-label", "Eyyyy, que está hecho para tenerlo vertical");
  // La estela y el avión van en el mismo dibujo: el avión sigue la curva
  // (`animateMotion`) mientras la estela se va pintando detrás.
  const RUTA = "M -80 300 C 120 300 220 150 380 170 S 560 330 500 250 S 400 120 560 130 S 860 250 1100 150";
  capa.innerHTML = `
    <svg class="tf-giro-cielo" viewBox="0 0 1000 420" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      <path class="tf-giro-estela" d="${RUTA}" pathLength="1"></path>
      <g class="tf-giro-avion">
        <path d="M-14 4 14 -14 6 14 -0.5 4.5 -5 12 -6 4z" fill="currentColor"></path>
        <animateMotion dur="1.9s" begin="indefinite" fill="freeze" rotate="auto" keyPoints="0;1" keyTimes="0;1"
          calcMode="spline" keySplines="0.45 0.05 0.35 1" path="${RUTA}"></animateMotion>
      </g>
    </svg>
    <p class="tf-giro-texto" aria-hidden="true">
      <span class="tf-giro-ey">${letras("Eyyyy,", 0)}</span>
      <span class="tf-giro-linea">que está hecho para tenerlo vertical</span>
    </p>
    <p class="tf-giro-pie" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
      stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>
      Gíralo y vuelve todo a su sitio</p>`;
  document.body.appendChild(capa);
  requestAnimationFrame(() => {
    capa.classList.add("en-marcha");
    const vuelo = capa.querySelector("animateMotion");
    if (!tfSinMovimiento() && vuelo && vuelo.beginElementAt) vuelo.beginElementAt(1.05);
  });
}

function tfLevantar() {
  const capa = document.getElementById("tfGiro");
  if (!capa) return;
  capa.classList.add("se-va");
  setTimeout(() => capa.remove(), 260);
  const raiz = document.documentElement;
  raiz.classList.remove("tf-cayendo");
  raiz.classList.add("tf-volviendo");
  setTimeout(() => {
    raiz.classList.remove("tf-volviendo");
    document.querySelectorAll(".tf-trozo").forEach((n) => {
      n.classList.remove("tf-trozo");
      ["--giro", "--lado", "--retraso"].forEach((v) => n.style.removeProperty(v));
    });
  }, 1400);
}

function tfGiro() {
  if (!tfApaisado || !tfInstalada()) return;
  if (tfApaisado.matches) tfCaer();
  else tfLevantar();
}
if (tfApaisado) {
  if (tfApaisado.addEventListener) tfApaisado.addEventListener("change", tfGiro);
  else if (tfApaisado.addListener) tfApaisado.addListener(tfGiro);
  window.addEventListener("load", tfGiro);
}

/* ======================================================= LA WEB, FLUIDA
   Lo de la barra de abajo, llevado al resto: lo que se elige se desliza en
   vez de saltar, lo que se abre entra con un muelle y se va en vez de
   desaparecer, y el tema cambia en un círculo desde el botón. Todo se apaga
   con «menos movimiento» en el sistema, y en las pruebas automáticas lo que
   deja copias en la página (el cierre de los diálogos) no se hace. */
const tfEnPrueba = () => typeof navigator !== "undefined" && navigator.webdriver;

/* --- el deslizador: la marca de la opción elegida se mueve como una gota ---
   En las pestañas (Buscar / Seguir), en los segmentos (franja horaria, por
   dónde avisar, el periodo del panel). Vale para cualquier grupo nuevo que se
   pinte después: se miran los que van apareciendo. */
const TF_GRUPOS = ".pestanas, .horas-chips, .adm-periodo";
const TF_ELEGIDO = '[aria-selected="true"], [aria-checked="true"]';

function tfDeslizador(grupo) {
  if (grupo.dataset.desliza) return;
  grupo.dataset.desliza = "1";
  const marca = document.createElement("span");
  marca.className = "tf-desliza";
  marca.setAttribute("aria-hidden", "true");
  grupo.prepend(marca);
  grupo.classList.add("con-deslizador");
  let r = null;
  let animacion = null;
  const caja = (el) => ({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
  const fijar = (c) => {
    r = c;
    marca.style.width = `${c.w}px`;
    marca.style.height = `${c.h}px`;
    marca.style.transform = `translate(${c.x}px, ${c.y}px)`;
  };
  const mover = (deGolpe) => {
    const el = grupo.querySelector(TF_ELEGIDO);
    marca.style.opacity = el ? "1" : "0";
    // `data-franja=""` es «cualquier hora»: no lleva marca, como antes.
    if (!el || el.dataset.franja === "") {
      marca.style.opacity = "0";
      if (el) fijar(caja(el));
      return;
    }
    const c = caja(el);
    if (!c.w) return;
    if (animacion) animacion.cancel();
    if (!r || deGolpe || tfSinMovimiento() || !marca.animate) return fijar(c);
    if (r.x === c.x && r.y === c.y && r.w === c.w) return;
    const enFila = r.y === c.y;
    const desde = Math.min(r.x, c.x);
    const largo = Math.max(r.x + r.w, c.x + c.w) - desde;
    const pasos = enFila
      ? [
          { transform: `translate(${r.x}px, ${r.y}px) scaleY(1)`, width: `${r.w}px` },
          { transform: `translate(${desde}px, ${c.y}px) scaleY(0.88)`, width: `${largo}px`, offset: 0.45 },
          { transform: `translate(${c.x}px, ${c.y}px) scaleY(1)`, width: `${c.w}px` },
        ]
      : [
          { transform: `translate(${r.x}px, ${r.y}px)`, width: `${r.w}px`, height: `${r.h}px` },
          { transform: `translate(${c.x}px, ${c.y}px)`, width: `${c.w}px`, height: `${c.h}px` },
        ];
    animacion = marca.animate(pasos, { duration: 480, easing: "cubic-bezier(0.3, 1.25, 0.4, 1)" });
    fijar(c);
  };
  mover(true);
  new MutationObserver(() => mover(false)).observe(grupo, {
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-selected", "aria-checked", "hidden"],
  });
  if (typeof ResizeObserver === "function") new ResizeObserver(() => mover(true)).observe(grupo);
}

function tfBuscarGrupos(raiz = document) {
  raiz.querySelectorAll(TF_GRUPOS).forEach(tfDeslizador);
}

/* --- los diálogos se van, no desaparecen ---
   Al cerrar, una copia muda (sin ids, inerte) hace la salida mientras el de
   verdad ya está cerrado: así cerrar sigue siendo inmediato para el código. */
function tfSalidaDialogo(caja) {
  if (tfSinMovimiento() || tfEnPrueba() || !caja || caja.hidden || !caja.isConnected) return;
  const copias = [caja];
  const velo = caja.id === "panel" ? document.getElementById("backdrop") : null;
  if (velo && !velo.hidden) copias.unshift(velo);
  copias.forEach((el) => {
    const copia = el.cloneNode(true);
    copia.removeAttribute("id");
    copia.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
    copia.setAttribute("aria-hidden", "true");
    copia.inert = true;
    copia.classList.add("tf-se-va");
    copia.hidden = false;
    document.body.appendChild(copia);
    const panel = copia.querySelector(".modal-caja") || copia;
    panel.scrollTop = (el.querySelector(".modal-caja") || el).scrollTop;
    setTimeout(() => copia.remove(), 320);
  });
}

/* --- el tema, en un círculo que se abre desde el botón --- */
function tfTemaEnCirculo(boton, cambiar) {
  if (tfSinMovimiento() || !document.startViewTransition) return cambiar();
  const r = boton.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const radio = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const raiz = document.documentElement;
  raiz.classList.add("tf-tema-vt");
  const t = document.startViewTransition(cambiar);
  t.ready
    .then(() =>
      raiz.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radio}px at ${x}px ${y}px)`] },
        { duration: 560, easing: "cubic-bezier(0.25, 0.8, 0.3, 1)", pseudoElement: "::view-transition-new(root)" }
      )
    )
    .catch(() => {});
  t.finished.finally(() => raiz.classList.remove("tf-tema-vt"));
}

(function tfFluida() {
  const empezar = () => {
    tfBuscarGrupos();
    // Lo que se pinta después (los segmentos de horas, el «por dónde» de la
    // cuenta, el panel): se mira en el siguiente fotograma, de una vez.
    let pendiente = false;
    new MutationObserver(() => {
      if (pendiente) return;
      pendiente = true;
      requestAnimationFrame(() => {
        pendiente = false;
        tfBuscarGrupos();
      });
    }).observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", empezar);
  else empezar();
})();
