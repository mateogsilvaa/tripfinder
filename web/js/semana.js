/* semana.js — «Unos días de la semana», tocando la semana.

   Eran dos desplegables, «Salgo el» y «Vuelvo el», con una flecha en medio:
   había que abrir dos listas de siete nombres para decir «de jueves a
   domingo», y no se veía cuántas noches eran. Ahora es la semana entera en
   una tira: se toca el día de salida, luego el de vuelta, y se pinta el tramo
   como una banda seguida, con las noches contadas. Arriba, los tres que pide casi todo el mundo.

   LOS DESPLEGABLES SIGUEN AHÍ, escondidos para la vista y no para el lector de
   pantalla: son la fuente de verdad que leen el envío, la URL de la portada
   (`ampliar.js`) y las pruebas. La fila solo los cambia y se repinta con su
   `change`, venga el cambio de donde venga. */

const CORTOS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const NOMBRES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const ATAJOS = [
  ["4-0", "Finde largo", "vie → lun"],
  ["3-6", "Puente", "jue → dom"],
  ["0-3", "Entre semana", "lun → jue"],
];

/* Las noches entre dos días de la semana: de viernes a lunes, tres. El mismo
   día es una semana entera, igual que en el backend (`_candidate_trips`). */
export const nochesEntre = (ida, vuelta) => (vuelta - ida + 7) % 7 || 7;

export function montarSemana(caja, selIda, selVuelta) {
  if (!caja || !selIda || !selVuelta || caja.querySelector(".sem7")) return;
  caja.classList.add("con-semana");
  // El paso en el que estás: el siguiente toque es la ida o la vuelta.
  let paso = "ida";

  caja.insertAdjacentHTML(
    "beforeend",
    `<div class="sem7" role="group" aria-label="Días de la semana">
      <div class="sem7-atajos">${ATAJOS.map(
        ([v, rot, sub]) =>
          `<button type="button" class="sem7-atajo" data-atajo="${v}" aria-pressed="false">${rot}<small>${sub}</small></button>`
      ).join("")}</div>
      <div class="sem7-dias">${CORTOS.map(
        (l, i) =>
          `<button type="button" class="sem7-dia" data-dia="${i}" aria-label="${NOMBRES[i]}"><b>${l}</b><small></small></button>`
      ).join("")}</div>
      <p class="sem7-resumen" aria-live="polite"></p>
    </div>`
  );
  const semana = caja.querySelector(".sem7");

  const pintar = () => {
    const ida = Number(selIda.value);
    const vuelta = Number(selVuelta.value);
    const n = nochesEntre(ida, vuelta);
    semana.querySelectorAll("[data-dia]").forEach((b) => {
      const d = Number(b.dataset.dia);
      const dentro = paso === "ida" && d !== ida && (d - ida + 7) % 7 < n;
      b.classList.toggle("ida", d === ida);
      b.classList.toggle("vuelta", paso === "ida" && d === vuelta && d !== ida);
      b.classList.toggle("dentro", dentro && d !== vuelta);
      // Debajo de cada punta, qué es: así se lee sin mirar el resumen.
      b.querySelector("small").textContent =
        d === ida ? "sales" : paso === "ida" && d === vuelta ? "vuelves" : "";
      b.setAttribute(
        "aria-pressed",
        String(d === ida || (paso === "ida" && d === vuelta))
      );
    });
    semana.querySelectorAll("[data-atajo]").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.atajo === `${ida}-${vuelta}`))
    );
    semana.querySelector(".sem7-resumen").innerHTML =
      paso === "vuelta"
        ? `Sales el <b>${NOMBRES[ida]}</b>. Ahora toca el día de vuelta.`
        : `Sales el <b>${NOMBRES[ida]}</b> y vuelves el <b>${NOMBRES[vuelta]}</b> · ${n} noche${
            n === 1 ? "" : "s"
          }, la semana que salga más barata.`;
  };

  const poner = (sel, v) => {
    sel.value = String(v);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  };

  semana.addEventListener("click", (e) => {
    const atajo = e.target.closest("[data-atajo]");
    if (atajo) {
      const [a, b] = atajo.dataset.atajo.split("-");
      paso = "ida";
      poner(selIda, a);
      poner(selVuelta, b);
      return;
    }
    const dia = e.target.closest("[data-dia]");
    if (!dia) return;
    if (paso === "ida") {
      paso = "vuelta";
      poner(selIda, dia.dataset.dia);
    } else {
      paso = "ida";
      poner(selVuelta, dia.dataset.dia);
    }
  });
  selIda.addEventListener("change", pintar);
  selVuelta.addEventListener("change", pintar);
  pintar();
}
