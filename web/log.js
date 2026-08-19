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
   tema claro antes de que cargue esto). Aqui solo va el boton, que vive en las
   cuatro paginas porque log.js es el unico script que cargan todas. */
(function () {
  const boton = document.getElementById("tema");
  if (!boton) return;
  const raiz = document.documentElement;
  const texto = boton.querySelector(".tema-txt");

  const pintar = () => {
    const oscuro = raiz.dataset.tema === "oscuro";
    // La etiqueta dice a donde vas, no donde estas.
    if (texto) texto.textContent = oscuro ? "claro" : "oscuro";
    boton.setAttribute("aria-pressed", String(oscuro));
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", oscuro ? "#0d0b0a" : "#ece6da");
  };

  boton.addEventListener("click", () => {
    // Sin esto, cada elemento con `transition` cruza a su propio ritmo y el
    // cambio de tema se ve como un charco de colores durante medio segundo.
    const corte = document.createElement("style");
    corte.textContent = "*,*::before,*::after{transition:none!important}";
    document.head.appendChild(corte);
    requestAnimationFrame(() => requestAnimationFrame(() => corte.remove()));

    const oscuro = raiz.dataset.tema === "oscuro";
    if (oscuro) delete raiz.dataset.tema;
    else raiz.dataset.tema = "oscuro";
    try {
      localStorage.setItem("tf_tema", oscuro ? "claro" : "oscuro");
    } catch (e) {
      /* navegacion privada: el tema dura lo que la pestaña */
    }
    pintar();
  });

  pintar();
})();
