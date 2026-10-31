/* horas.js — A qué hora prefieres salir y llegar.

   Cuatro franjas opcionales, las mismas en buscar y en seguir: la salida y la
   llegada de la ida, la salida y la llegada de la vuelta. Cada una se elige con
   un toque (mañana, mediodía, tarde, noche) o a mano, desde-hasta. Sin tocar
   nada es «me da igual» y no se filtra.

   EL CAMPO ESCONDIDO ES LA VERDAD: `#fHoras` / `#wHoras` llevan las cuatro
   franjas como las entiende el backend ("6-12,,16-24,", ver
   `search.franjas_horarias`). Es lo que se manda, lo que viaja en la URL desde
   la portada (`ampliar.js`) y lo que se pinta. */

const FRANJAS = [
  ["", "Me da igual"],
  ["6-12", "Mañana", "6–12 h"],
  ["12-16", "Mediodía", "12–16 h"],
  ["16-21", "Tarde", "16–21 h"],
  ["21-6", "Noche", "21–6 h"],
];
/* Un dibujito por franja: el sol que sale, el de mediodía, el que se pone y la
   luna. Se reconoce antes que la palabra. */
const ICONOS = {
  "6-12": '<path d="M4 17h16M7 17a5 5 0 0 1 10 0M12 7V4M5.6 10.6 4 9M18.4 10.6 20 9"/>',
  "12-16": '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
  "16-21": '<path d="M4 17h16M7 17a5 5 0 0 1 10 0M12 10v-3M12 7l-2 2M12 7l2 2"/>',
  "21-6": '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5 7.5 7.5 0 1 0 19 14.5Z"/>',
};
const icono = (v) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONOS[v]}</svg>`;
const TRAMOS = ["Salida de la ida", "Llegada de la ida", "Salida de la vuelta", "Llegada de la vuelta"];
const CORTOS = ["sale", "llega", "vuelve", "llega a casa"];

export const leerFranjas = (valor) => [...String(valor || "").split(","), "", "", "", ""].slice(0, 4);

const deHora = (n) => `${String(n).padStart(2, "0")} h`;
const nombreDe = (f) => {
  const fija = FRANJAS.find(([v]) => v && v === f);
  if (fija) return fija[1].toLowerCase();
  const [a, b] = f.split("-");
  return `${a}–${b} h`;
};

/* «sale por la mañana · vuelve por la tarde», o "" si no hay preferencia. Para
   la etiqueta de la búsqueda y el resumen plegado. */
export function textoHoras(valor) {
  return leerFranjas(valor)
    .map((f, i) => {
      if (!f) return "";
      const n = nombreDe(f);
      const dicho = { mañana: "por la mañana", mediodía: "a mediodía", tarde: "por la tarde", noche: "por la noche" };
      return `${CORTOS[i]} ${dicho[n] || n}`;
    })
    .filter(Boolean)
    .join(" · ");
}

const opcionesHora = (sel) =>
  Array.from({ length: 25 }, (_, h) => `<option value="${h}"${h === sel ? " selected" : ""}>${deHora(h)}</option>`).join("");

export function montarHoras(caja, campo) {
  if (!caja || !campo || caja.querySelector(".horas")) return;
  /* Ida y vuelta, cada una con su salida y su llegada. Cada fila es el día
     partido en cuatro: se toca la franja, y tocarla otra vez la quita («me da
     igual»). Lo que no encaja en las cuatro, «a mano», desde-hasta. */
  const fila = (i, rot) => `<div class="horas-fila" data-tramo="${i}">
      <div class="horas-cab">
        <span class="horas-rot">${rot}</span>
        <button type="button" class="horas-otra" data-franja="otra" aria-pressed="false">a mano</button>
      </div>
      <div class="horas-chips" role="radiogroup" aria-label="${TRAMOS[i]}">
        ${FRANJAS.slice(1).map(
          ([v, nombre, sub]) => `<button type="button" class="horas-chip" role="radio" data-franja="${v}"
            aria-checked="false">${icono(v)}<span>${nombre}</span><small>${sub}</small></button>`
        ).join("")}
      </div>
      <div class="horas-mano" hidden>
        <label><span class="solo-lector">Desde</span><select data-desde>${opcionesHora(8)}</select></label>
        <span aria-hidden="true">→</span>
        <label><span class="solo-lector">Hasta</span><select data-hasta>${opcionesHora(14)}</select></label>
      </div>
    </div>`;
  caja.insertAdjacentHTML(
    "beforeend",
    `<details class="horas">
      <summary><span class="horas-tit">Horarios</span> <span class="horas-resumen"></span></summary>
      <div class="horas-filas">
        <section class="horas-bloque" aria-label="La ida">
          <h4 class="horas-bloque-tit">Ida</h4>
          ${fila(0, "Salir")}${fila(1, "Llegar")}
        </section>
        <section class="horas-bloque" aria-label="La vuelta">
          <h4 class="horas-bloque-tit">Vuelta</h4>
          ${fila(2, "Salir")}${fila(3, "Llegar")}
        </section>
        <p class="horas-nota">Toca una franja para quedarte solo con esos vuelos; otra vez, y se quita. Si una
          compañía no dice la hora, el vuelo se enseña igual. <button type="button" class="horas-borrar" data-horas-borrar>Quitar todas</button></p>
      </div>
    </details>`
  );
  const raiz = caja.querySelector(".horas");

  const poner = (franjas) => {
    campo.value = franjas.some(Boolean) ? franjas.join(",") : "";
    campo.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const pintar = () => {
    const franjas = leerFranjas(campo.value);
    raiz.querySelectorAll(".horas-fila").forEach((fila) => {
      const f = franjas[Number(fila.dataset.tramo)];
      const fija = FRANJAS.some(([v]) => v === f);
      // «Otra» se queda marcada mientras se está eligiendo a mano.
      const aMano = (f && !fija) || fila.dataset.aMano === "1";
      fila.querySelectorAll(".horas-chip").forEach((b) =>
        b.setAttribute("aria-checked", String(!aMano && b.dataset.franja === f))
      );
      fila.querySelector(".horas-otra").setAttribute("aria-pressed", String(!!aMano));
      fila.querySelector(".horas-mano").hidden = !aMano;
      if (f && !fija) {
        const [a, b] = f.split("-");
        fila.querySelector("[data-desde]").value = a;
        fila.querySelector("[data-hasta]").value = b;
      }
    });
    const txt = textoHoras(campo.value);
    raiz.querySelector(".horas-resumen").textContent = txt || "me da igual";
    raiz.classList.toggle("con-horas", !!txt);
    raiz.querySelector("[data-horas-borrar]").hidden = !txt;
  };

  raiz.addEventListener("click", (e) => {
    if (e.target.closest("[data-horas-borrar]")) {
      raiz.querySelectorAll(".horas-fila").forEach((f) => delete f.dataset.aMano);
      poner(["", "", "", ""]);
      return;
    }
    const chip = e.target.closest("[data-franja]");
    if (!chip) return;
    const fila = chip.closest(".horas-fila");
    const i = Number(fila.dataset.tramo);
    const franjas = leerFranjas(campo.value);
    if (chip.dataset.franja === "otra") {
      // «a mano» es un interruptor: otra vez, y vuelve a «me da igual».
      if (fila.dataset.aMano === "1") {
        delete fila.dataset.aMano;
        franjas[i] = "";
      } else {
        fila.dataset.aMano = "1";
        franjas[i] = `${fila.querySelector("[data-desde]").value}-${fila.querySelector("[data-hasta]").value}`;
      }
    } else {
      delete fila.dataset.aMano;
      franjas[i] = franjas[i] === chip.dataset.franja ? "" : chip.dataset.franja;
    }
    poner(franjas);
  });
  raiz.addEventListener("change", (e) => {
    const sel = e.target.closest("select");
    if (!sel) return;
    const fila = sel.closest(".horas-fila");
    const a = fila.querySelector("[data-desde]").value;
    const b = fila.querySelector("[data-hasta]").value;
    const franjas = leerFranjas(campo.value);
    franjas[Number(fila.dataset.tramo)] = a === b ? "" : `${a}-${b}`;
    poner(franjas);
  });
  campo.addEventListener("change", pintar);
  pintar();
}
