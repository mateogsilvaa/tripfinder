/* atajos.js — Una tecla para lo que más se hace: «/» lleva al buscador del
   feed (o al de la página, si no hay feed), como en casi cualquier herramienta
   con un listado. No salta si ya estás escribiendo en un campo. */
export function montarAtajos() {
  const campo = () =>
    [document.querySelector("#q"), document.querySelector("#qm")].find(
      (c) => c && c.offsetParent !== null
    );
  if (!document.querySelector("#q, #qm")) return;
  document.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
    const c = campo();
    if (!c) return;
    e.preventDefault();
    c.focus();
    c.select();
  });
  // El atajo se dice donde se usa: una tecla dibujada dentro del campo, que se
  // va en cuanto escribes.
  const q = document.querySelector("#q");
  const caja = q && q.closest(".field");
  if (caja && !caja.querySelector(".tecla")) {
    caja.classList.add("con-tecla");
    caja.insertAdjacentHTML("beforeend", '<kbd class="tecla" aria-hidden="true">/</kbd>');
  }
}
