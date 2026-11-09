/* avisos.js — Un aviso pequeño abajo, con un botón: «Hay precios nuevos · Ver».
   El mismo aspecto que el «Deshacer» de `borrar.js`, y se va solo. */
let actual = null;

export function avisar(texto, { boton = "", alPulsar = null, ms = 6000 } = {}) {
  if (actual) actual.remove();
  const caja = document.createElement("div");
  caja.className = "deshacer";
  caja.setAttribute("role", "status");
  caja.innerHTML = `<span class="deshacer-txt"></span>${boton ? '<button type="button" class="deshacer-btn"></button>' : ""}<span class="deshacer-tiempo" aria-hidden="true"></span>`;
  caja.querySelector(".deshacer-txt").textContent = texto;
  if (boton) {
    const b = caja.querySelector(".deshacer-btn");
    b.textContent = boton;
    b.addEventListener("click", () => {
      caja.remove();
      if (alPulsar) alPulsar();
    });
  }
  caja.style.setProperty("--dura", `${ms}ms`);
  document.body.appendChild(caja);
  actual = caja;
  setTimeout(() => {
    if (actual === caja) actual = null;
    caja.classList.add("sale");
    setTimeout(() => caja.remove(), 200);
  }, ms);
}
