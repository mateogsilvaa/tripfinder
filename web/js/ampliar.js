/* ampliar.js — La portada lleva las dos herramientas en pequeño; usarlas de
   verdad abre la herramienta entera.

   La idea: en la portada, "buscar" y "seguir" son dos formularios compactos
   junto al feed, que es donde se decide si te interesan siquiera. En cuanto
   pulsas el botón, la ventana se amplía: lo que has escrito viaja en la URL a
   `buscar.html` o a `seguimientos.html`, y allí se rellena y se lanza solo.

   Por qué no lanzarlo desde la portada y ya: porque el resultado no cabe. Una
   búsqueda escribe una lista de búsquedas guardadas, un calendario, avisos de
   cuenta y el panel de alojamiento; un seguimiento, su propia lista con curvas
   de precio. Meter todo eso debajo del feed convierte la portada en un cajón.
   Y porque así la URL de una búsqueda se puede compartir y volver a abrir. */

/* Los campos de cada herramienta: nombre en la URL -> selector. Se listan
   aquí, y no se leen del DOM, para que la URL no dependa de en qué orden
   estén los campos ni cambie sola al mover uno. */
export const CAMPOS_BUSCAR = {
  donde: "#fWhere",
  cuando: "#fWhen",
  dest: "#fDest",
  depart: "#fDepart",
  regreso: "#fReturn",
  noches: "#fNights",
  meses: "#fMonths",
  tope: "#fMax",
  personas: "#fAdults",
};

export const CAMPOS_SEGUIR = {
  donde: "#wWhere",
  cuando: "#wWhen",
  dest: "#wDest",
  depart: "#wDepart",
  regreso: "#wReturn",
  meses: "#wMonths",
  tope: "#wMax",
  personas: "#wAdults",
};

/* Si este formulario es el compacto de la portada, se lleva lo escrito a la
   página de la herramienta y devuelve `true` para que el que llama no siga.
   En la propia página de la herramienta no hay `data-ampliar` y devuelve
   `false`: el mismo código sirve en los dos sitios. */
export function ampliar(form, campos) {
  const destino = form && form.dataset ? form.dataset.ampliar : "";
  if (!destino) return false;

  const q = new URLSearchParams();
  Object.entries(campos).forEach(([nombre, selector]) => {
    const el = document.querySelector(selector);
    const valor = el ? String(el.value == null ? "" : el.value).trim() : "";
    if (valor) q.set(nombre, valor);
  });
  // La marca de que esto viene de la portada: sin ella, abrir la página a pelo
  // no debe lanzar nada, y con ella se lanza sin pedir que pulses otra vez.
  q.set("ir", "1");
  location.href = `${destino}?${q.toString()}`;
  return true;
}

/* Al llegar a la página de la herramienta: se rellenan los campos y, si venía
   de pulsar el botón, se envía. Devuelve `true` si ha enviado.

   El `change` de cada campo no es decorativo: es lo que hace que aparezcan el
   selector de destino o el calendario cuando la respuesta lo pide. Sin él, la
   página llegaría con "un sitio concreto" elegido y el campo del destino
   escondido. */
export function recogerAmpliado(campos, form) {
  if (!form) return false;
  const q = new URLSearchParams(location.search);
  if (![...q.keys()].length) return false;

  let algo = false;
  Object.entries(campos).forEach(([nombre, selector]) => {
    if (!q.has(nombre)) return;
    const el = document.querySelector(selector);
    if (!el) return;
    el.value = q.get(nombre);
    el.dispatchEvent(new Event("change", { bubbles: true }));
    algo = true;
  });
  if (!algo || q.get("ir") !== "1") return false;

  // La URL se limpia: recargar no puede volver a lanzar una búsqueda de ocho
  // minutos, y el botón de atrás tampoco.
  try {
    history.replaceState(null, "", location.pathname);
  } catch {
    /* file:// no deja tocar el historial; se sigue igual */
  }
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  return true;
}
