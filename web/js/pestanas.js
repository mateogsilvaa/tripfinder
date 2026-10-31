/* pestanas.js — Las pestañas de la portada: «Buscar ahora» y «Seguir un viaje».

   Antes eran dos paneles de un palmo cada uno, uno al lado del otro, y la
   portada se convertía en un cajón. Ahora son una sola tarjeta y se ve una. Con
   el ratón, con las flechas (como pide el patrón de pestañas de ARIA) y con
   `#seguir` en la dirección, que abre directamente la segunda. */
export function montarPestanas(raiz = document) {
  raiz.querySelectorAll('[role="tablist"]').forEach((lista) => {
    const tabs = [...lista.querySelectorAll('[role="tab"]')];
    /* EL CAMBIO, SUAVE. La tarjeta pasa de un alto al otro sin saltar, y lo
       nuevo entra deslizándose desde el lado de la pestaña elegida (desde la
       derecha si vas a la de la derecha). Sin animación con «menos
       movimiento» en el sistema. */
    const caja = lista.parentElement;
    const quieto = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const elegir = (tab, foco = false, animar = true) => {
      const antes = tabs.findIndex((t) => t.getAttribute("aria-selected") === "true");
      const ahora = tabs.indexOf(tab);
      const alto0 = caja.offsetHeight;
      let nuevo = null;
      tabs.forEach((t) => {
        const si = t === tab;
        t.setAttribute("aria-selected", String(si));
        t.tabIndex = si ? 0 : -1;
        const panel = document.getElementById(t.getAttribute("aria-controls"));
        if (!panel) return;
        if (si && panel.hidden) nuevo = panel;
        panel.hidden = !si;
      });
      if (foco) tab.focus();
      if (!animar || !nuevo || antes === ahora || quieto() || !caja.animate) return;
      const alto1 = caja.offsetHeight;
      const lado = ahora > antes ? 1 : -1;
      const curva = "cubic-bezier(0.25, 0.8, 0.25, 1)";
      if (alto0 && alto1 && alto0 !== alto1) {
        caja.animate([{ height: `${alto0}px` }, { height: `${alto1}px` }], { duration: 360, easing: curva });
      }
      nuevo.animate(
        [
          { opacity: 0, transform: `translateX(${lado * 24}px)` },
          { opacity: 1, transform: "none" },
        ],
        { duration: 340, easing: curva }
      );
    };
    tabs.forEach((t, i) => {
      t.addEventListener("click", () => elegir(t));
      t.addEventListener("keydown", (e) => {
        const salto = { ArrowRight: 1, ArrowLeft: -1, Home: -i, End: tabs.length - 1 - i }[e.key];
        if (salto === undefined) return;
        e.preventDefault();
        elegir(tabs[(i + salto + tabs.length) % tabs.length], true);
      });
    });
    const pedida = tabs.find((t) => `#${t.getAttribute("aria-controls")}` === location.hash);
    if (pedida) elegir(pedida, false, false);
  });
}
