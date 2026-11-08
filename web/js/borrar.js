/* borrar.js — Borrar es tachar, y se puede deshacer.

   La web ya tiene un gesto para «esto no»: en el HOP las ciudades se TACHAN.
   Borrar hace lo mismo: una raya cruza la fila de lado a lado, la fila se
   pliega y abajo queda un aviso con «Deshacer» unos segundos. Hasta que el
   aviso se va no se borra nada de verdad, así que deshacer no le cuesta nada
   a nadie (ni un encargo a GitHub, ni una escritura en la nube).

   Antes se pedía confirmación con un `confirm()` y después se esperaba a la
   red con la fila a media opacidad: dos pasos para una cosa que con deshacer
   no necesita ninguno. Con «reducir movimiento» no hay raya ni pliegue: la
   fila desaparece y el aviso sale igual. */

const quieto = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const fin = (a) => (a && a.finished ? a.finished.catch(() => {}) : Promise.resolve());

/* Tacha `el` y lo pliega. Al terminar queda `hidden`; `reaparecer` lo trae. */
export async function tachar(el) {
  if (!el || !el.isConnected) return;
  if (quieto() || typeof el.animate !== "function") {
    el.hidden = true;
    return;
  }
  const raya = document.createElement("span");
  raya.className = "tachon";
  raya.setAttribute("aria-hidden", "true");
  if (getComputedStyle(el).position === "static") el.style.position = "relative";
  el.appendChild(raya);
  await fin(raya.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], {
    duration: 240,
    easing: "cubic-bezier(.2,.8,.2,1)",
    fill: "forwards",
  }));
  const alto = el.getBoundingClientRect().height;
  const cs = getComputedStyle(el);
  el.style.overflow = "hidden";
  await fin(
    el.animate(
      [
        { height: `${alto}px`, opacity: 1, marginTop: cs.marginTop, marginBottom: cs.marginBottom, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom },
        { height: "0px", opacity: 0, marginTop: "0px", marginBottom: "0px", paddingTop: "0px", paddingBottom: "0px" },
      ],
      { duration: 220, delay: 120, easing: "cubic-bezier(.4,0,.2,1)" }
    )
  );
  raya.remove();
  el.style.overflow = "";
  el.hidden = true;
}

/* Lo tachado vuelve (al deshacer, o si el borrado falla). */
export function reaparecer(el) {
  if (!el) return;
  el.hidden = false;
  el.style.visibility = "";
  el.querySelectorAll(":scope > .tachon").forEach((r) => r.remove());
  if (!quieto() && typeof el.animate === "function") {
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180 });
  }
}

/* El aviso de abajo: «Quitado Roma · Deshacer». Devuelve una promesa con
   `true` si se deshizo y `false` si pasó el tiempo (o se cerró la página:
   entonces se borra, que es lo que se pidió). Un aviso nuevo despacha el
   anterior, que se da por bueno. */
let actual = null;

export function avisoDeshacer(texto, ms = 5000) {
  if (actual) actual.cerrar(false);
  return new Promise((resolver) => {
    const caja = document.createElement("div");
    caja.className = "deshacer";
    caja.setAttribute("role", "status");
    caja.innerHTML = `<span class="deshacer-txt"></span>
      <button type="button" class="deshacer-btn">Deshacer</button>
      <span class="deshacer-tiempo" aria-hidden="true"></span>`;
    caja.querySelector(".deshacer-txt").textContent = texto;
    caja.style.setProperty("--dura", `${ms}ms`);
    document.body.appendChild(caja);
    let hecho = false;
    const cerrar = (deshecho) => {
      if (hecho) return;
      hecho = true;
      clearTimeout(reloj);
      window.removeEventListener("pagehide", alIrse);
      if (actual && actual.caja === caja) actual = null;
      caja.classList.add("sale");
      setTimeout(() => caja.remove(), 200);
      resolver(deshecho);
    };
    const alIrse = () => cerrar(false);
    const reloj = setTimeout(() => cerrar(false), ms);
    window.addEventListener("pagehide", alIrse);
    caja.querySelector(".deshacer-btn").addEventListener("click", () => cerrar(true));
    actual = { caja, cerrar };
  });
}

/* Todo junto: tacha, ofrece deshacer y, si no se deshace, borra de verdad.
   `hacer` es lo que borra (puede ser asíncrono y devolver `{ ok, error }`);
   si falla, la fila vuelve y se dice por qué. Devuelve si se borró. */
export async function borrarConDeshacer(el, texto, hacer) {
  await tachar(el);
  if (await avisoDeshacer(texto)) {
    reaparecer(el);
    return false;
  }
  let r;
  try {
    r = await hacer();
  } catch (e) {
    r = { ok: false, error: String((e && e.message) || e) };
  }
  if (r && r.ok === false) {
    reaparecer(el);
    alert(r.error || r.reason || "No se pudo borrar.");
    return false;
  }
  return true;
}
