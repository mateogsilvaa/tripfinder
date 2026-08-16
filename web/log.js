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
   aparecen los 403 del token o un JSON que no existe todavia. */
const tfFetchOriginal = window.fetch;
window.fetch = async function (...args) {
  const url = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "";
  try {
    const r = await tfFetchOriginal.apply(this, args);
    if (!r.ok) tfApuntar("red", `${r.status} en ${url}`, r.statusText || "");
    return r;
  } catch (err) {
    tfApuntar("red", `fallo de red en ${url}`, err.message || "");
    throw err;
  }
};
