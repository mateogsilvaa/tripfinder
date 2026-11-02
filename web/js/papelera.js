/* papelera.js — Borrar algo es tirarlo a la papelera, y se ve.

   Antes, al borrar, la fila se quedaba a media opacidad con «borrando…» hasta
   que contestaba la red: parecía que la web se había quedado pensando. Ahora
   lo borrado se arruga en una bola de papel, entra por la derecha una mano
   con una papelera, la bola hace la parábola y entra, y la mano se va. Lo que
   tarde la red pasa mientras tanto.

   Sin dependencias: la bola es un clon de la fila que se encoge con
   transformaciones (`Element.animate`), y la mano y la papelera son un SVG.
   Con «reducir movimiento» no hay vuelo: la fila se desvanece y ya. */

const MANO = `<svg viewBox="0 0 120 120" width="96" height="96" aria-hidden="true" focusable="false">
  <g class="papelera-cubo">
    <path d="M28 46h52l-6 58a6 6 0 0 1-6 5H40a6 6 0 0 1-6-5z" fill="var(--surface2)" stroke="var(--ink)" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M24 46h60" stroke="var(--ink)" stroke-width="3" stroke-linecap="round"/>
    <path d="M44 58l2 40M54 58v40M64 58l-2 40" stroke="var(--muted)" stroke-width="2" stroke-linecap="round"/>
  </g>
  <path class="papelera-mano" d="M84 70c6-2 12 0 16 4l14 14v32H90l-10-12c-3-4-2-9 2-11l4-2-6-8c-3-4-2-10 4-11z"
    fill="#e8b48f" stroke="var(--ink)" stroke-width="2.5" stroke-linejoin="round"/>
  <path d="M86 84l10 2M84 92l10 2" stroke="var(--ink)" stroke-width="2" stroke-linecap="round"/>
</svg>`;

const quieto = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const espera = (a) => (a && a.finished ? a.finished.catch(() => {}) : Promise.resolve());

/* Tira `el` a la papelera. Devuelve una promesa que se cumple cuando ya ha
   entrado (el elemento queda escondido: quien llama lo quita o repinta). */
export async function tirar(el) {
  if (!el || !el.isConnected) return;
  if (quieto() || typeof el.animate !== "function") {
    await espera(el.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: "forwards" }));
    el.style.visibility = "hidden";
    return;
  }
  const caja = el.getBoundingClientRect();

  // La mano con la papelera, abajo a la derecha.
  const mano = document.createElement("div");
  mano.className = "papelera";
  mano.innerHTML = MANO;
  document.body.appendChild(mano);
  const entra = mano.animate(
    [{ transform: "translate(140%, 30%) rotate(18deg)" }, { transform: "translate(0, 0) rotate(0deg)" }],
    { duration: 320, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" }
  );

  // La bola: un clon de lo borrado, encima de todo, que se arruga.
  const bola = el.cloneNode(true);
  bola.removeAttribute("id");
  bola.querySelectorAll("[id]").forEach((x) => x.removeAttribute("id"));
  bola.setAttribute("aria-hidden", "true");
  bola.classList.add("papelera-bola");
  Object.assign(bola.style, {
    left: `${caja.left}px`,
    top: `${caja.top}px`,
    width: `${caja.width}px`,
    height: `${caja.height}px`,
  });
  document.body.appendChild(bola);
  el.style.visibility = "hidden";

  const lado = Math.min(64, Math.max(36, caja.height * 0.6));
  const escala = lado / Math.max(caja.width, caja.height);
  await espera(
    bola.animate(
      [
        { transform: "scale(1) rotate(0deg)", borderRadius: "10px", filter: "none" },
        { transform: `scale(${Math.max(escala, 0.5)}) rotate(-8deg) skewX(6deg)`, borderRadius: "30%", filter: "contrast(1.1)", offset: 0.4 },
        { transform: `scale(${escala}) rotate(24deg)`, borderRadius: "50%", filter: "grayscale(1) brightness(1.15)" },
      ],
      { duration: 380, easing: "cubic-bezier(.5,0,.4,1)", fill: "forwards" }
    )
  );
  await espera(entra);

  // De donde está a la boca de la papelera, en parábola.
  const boca = mano.querySelector(".papelera-cubo").getBoundingClientRect();
  const dx = boca.left + boca.width * 0.45 - (caja.left + caja.width / 2);
  const dy = boca.top + 8 - (caja.top + caja.height / 2);
  const alto = Math.min(-80, dy / 2 - 120);
  const pasos = 14;
  const fotogramas = [];
  for (let i = 0; i <= pasos; i++) {
    const t = i / pasos;
    const x = dx * t;
    const y = dy * t + alto * 4 * t * (1 - t) * 0.5;
    fotogramas.push({ transform: `translate(${x}px, ${y}px) scale(${escala * (1 - 0.35 * t)}) rotate(${24 + 540 * t}deg)` });
  }
  await espera(bola.animate(fotogramas, { duration: 560, easing: "cubic-bezier(.3,.1,.6,1)", fill: "forwards" }));
  bola.remove();

  // Un golpecito de la papelera al recibirla, y la mano se va.
  await espera(
    mano.querySelector(".papelera-cubo").animate(
      [{ transform: "translateY(0)" }, { transform: "translateY(4px)" }, { transform: "translateY(0)" }],
      { duration: 160 }
    )
  );
  await espera(
    mano.animate(
      [{ transform: "translate(0, 0) rotate(0deg)" }, { transform: "translate(140%, 30%) rotate(18deg)" }],
      { duration: 300, easing: "cubic-bezier(.5,0,.8,.3)", fill: "forwards" }
    )
  );
  mano.remove();
}
