/* disparador.js — Levantar un workflow desde el navegador, y que hacer si no se puede. */


/* --------------------------------------------------------------- disparador
   Para lanzar un scraper hace falta que corra algo fuera del navegador. En vez
   de abrir una issue (que era un rodeo horrible), la web llama directamente a
   la API de GitHub con un token que se guarda SOLO en este navegador
   (localStorage) y no viaja a ningun sitio que no sea api.github.com.

   La llamada vive en auth.js porque el panel de administracion tambien la usa
   para dar de alta cuentas, y dos copias de esto acaban diciendo cosas
   distintas el dia que GitHub cambia un codigo de error. */
export const dispatch = (evento, payload) => tfDispatch(evento, payload);

/* Lo que va en cada encargo para saber de quien es. Sin sesion va vacio: eso
   es un encargo compartido, como los de antes de que hubiera cuentas. */
export const comoDueno = () => ({ owner: tfUid(), owner_name: tfNombre() });

/* Que ves de lo que hay guardado en el repo: lo tuyo y nada mas.
   Lo que no tiene dueño es de cuando la web era de una sola persona. Antes se
   enseñaba a todo el mundo "porque ya se hacia asi", y el resultado fue que la
   primera persona en entrar se encontro los seguimientos y las busquedas de
   otro. Ahora no sale para nadie: desde el panel se le pone dueño y vuelve,
   pero de quien sea. */
export const esMio = (x) => !!x && !!x.owner && x.owner === tfUid();

/* Los tres motivos por los que un encargo no sale, y todos se arreglan igual:
   entrando con una cuenta que tenga acceso. */
export const esFaltaDeAcceso = (r) =>
  r.reason === "sin-cuenta" || r.reason === "sin-token" || r.reason === "token-invalido";

/* Lo que se enseña cuando no hay nada que enseñar: o no has entrado, o has
   entrado y todavia no tienes nada tuyo. Sin esto la caja se queda en blanco y
   no se distingue "no tienes nada" de "esto esta roto". */
export function avisoDeCuenta(que, vacio) {
  if (!tfUid()) {
    return `<p class="meta cuenta-nota">Entra con tu cuenta para ver tus ${que}.
      <button class="btn primary small" type="button" data-entrar>Entrar</button></p>`;
  }
  return `<p class="meta cuenta-nota">${vacio}</p>`;
}

/* Sin cuenta, los formularios que escriben en el repo se quedan a la vista pero
   apagados, con el motivo puesto. Es mas honesto que dejarlos vivos y fallar al
   darle al boton, y ademas se ve de un vistazo que la web tiene cuentas. */
export function candarFormularios() {
  if (tfUid()) return;
  [
    ["#finderForm", "buscar"],
    ["#watchForm", "seguir un viaje"],
  ].forEach(([sel, que]) => {
    const form = document.querySelector(sel);
    if (!form) return;
    form.querySelectorAll("input, select, button, textarea").forEach((c) => (c.disabled = true));
    form.classList.add("candado");
    form.insertAdjacentHTML(
      "beforeend",
      `<p class="candado-nota">Para ${que} hace falta una cuenta.
        <button class="btn primary small" type="button" data-entrar>Entrar</button></p>`
    );
  });
  wireEntrar(document);
}

/* Un solo sitio donde enganchar el boton de entrar que sale en esos avisos. */
export function wireEntrar(raiz = document) {
  raiz.querySelectorAll("[data-entrar]").forEach((b) =>
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      tfAbrirLogin();
    })
  );
}

/* Lo que se enseña cuando algo no se puede lanzar. Ya no se pide el token a
   nadie: lo pone el administrador una vez en el panel, cifrado, y cada cuenta lo
   abre con su contraseña al entrar. Aquí solo queda decir qué falta. */
export function cajaAcceso(r) {
  const sinCuenta = r.reason === "sin-cuenta";
  return {
    html: `
      <div class="token-box">
        <strong>${sinCuenta ? "Hace falta una cuenta." : "Tu cuenta no puede lanzar esto."}</strong>
        ${
          sinCuenta
            ? `Los chollos del día los ve todo el mundo, pero buscar, seguir un viaje
               o pedir alojamiento se guarda a tu nombre. Entra y lo lanzamos.`
            : `No tiene acceso para escribir: pídele al administrador que te ponga
               una contraseña nueva desde el panel y vuelve a entrar.`
        }
        ${sinCuenta ? '<button class="btn primary small" data-entrar type="button">Entrar</button>' : ""}
      </div>`,
    wire: () => wireEntrar(document),
  };
}

