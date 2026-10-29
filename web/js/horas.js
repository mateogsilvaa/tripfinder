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
  caja.insertAdjacentHTML(
    "beforeend",
    `<details class="horas">
      <summary><span class="horas-tit">Horarios</span> <span class="horas-resumen"></span></summary>
      <div class="horas-filas">
        ${TRAMOS.map(
          (t, i) => `<div class="horas-fila" data-tramo="${i}">
            <span class="horas-rot">${t}</span>
            <div class="horas-chips" role="radiogroup" aria-label="${t}">
              ${FRANJAS.map(
                ([v, rot, sub]) => `<button type="button" class="horas-chip" role="radio" data-franja="${v}"
                  aria-checked="false">${rot}${sub ? `<small>${sub}</small>` : ""}</button>`
              ).join("")}
              <button type="button" class="horas-chip" role="radio" data-franja="otra" aria-checked="false">Otra</button>
            </div>
            <div class="horas-mano" hidden>
              <label><span class="solo-lector">Desde</span><select data-desde>${opcionesHora(8)}</select></label>
              <span aria-hidden="true">→</span>
              <label><span class="solo-lector">Hasta</span><select data-hasta>${opcionesHora(14)}</select></label>
            </div>
          </div>`
        ).join("")}
        <p class="horas-nota">Lo que no cae en tu franja no sale. Si una compañía no dice la hora, el vuelo se
          enseña igual.</p>
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
      fila.querySelectorAll("[data-franja]").forEach((b) =>
        b.setAttribute("aria-checked", String(aMano ? b.dataset.franja === "otra" : b.dataset.franja === f))
      );
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
  };

  raiz.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-franja]");
    if (!chip) return;
    const fila = chip.closest(".horas-fila");
    const i = Number(fila.dataset.tramo);
    const franjas = leerFranjas(campo.value);
    if (chip.dataset.franja === "otra") {
      fila.dataset.aMano = "1";
      franjas[i] = `${fila.querySelector("[data-desde]").value}-${fila.querySelector("[data-hasta]").value}`;
    } else {
      delete fila.dataset.aMano;
      franjas[i] = chip.dataset.franja;
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
