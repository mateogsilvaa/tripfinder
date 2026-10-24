/* pestanas.js — Las pestañas de la portada: «Buscar ahora» y «Seguir un viaje».

   Antes eran dos paneles de un palmo cada uno, uno al lado del otro, y la
   portada se convertía en un cajón. Ahora son una sola tarjeta y se ve una. Con
   el ratón, con las flechas (como pide el patrón de pestañas de ARIA) y con
   `#seguir` en la dirección, que abre directamente la segunda. */
export function montarPestanas(raiz = document) {
  raiz.querySelectorAll('[role="tablist"]').forEach((lista) => {
    const tabs = [...lista.querySelectorAll('[role="tab"]')];
    const elegir = (tab, foco = false) => {
      tabs.forEach((t) => {
        const si = t === tab;
        t.setAttribute("aria-selected", String(si));
        t.tabIndex = si ? 0 : -1;
        const panel = document.getElementById(t.getAttribute("aria-controls"));
        if (panel) panel.hidden = !si;
      });
      if (foco) tab.focus();
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
    if (pedida) elegir(pedida);
  });
}
