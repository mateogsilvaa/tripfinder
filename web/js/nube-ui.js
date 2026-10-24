/* nube-ui.js — Las pantallas de la cuenta cuando hay Firebase.

   Entrar, crear una cuenta y la ficha de cada cual. Se cargan con un `import()`
   al pulsar (lo hacen `auth.js` y `cuenta.js`), igual que la pantalla de pedir
   cuenta de antes: son pantallas que casi nadie abre y no hay motivo para
   pagarlas en cada página.

   La web está abierta: cualquiera se registra con su correo y su contraseña y
   entra con una cuenta gratuita, que ve los chollos y los recibe por correo.
   Lanzar búsquedas, seguir viajes, pedir alojamiento e Interrail es de las
   cuentas premium, que da quien lleva la web desde el panel. El correo y lo que
   busca cada uno viven en Firebase, no en el repositorio. */

const esc = (s) => tfEsc(s);

const TEXTO_ESTADO = {
  premium: "Plan premium: todas las herramientas.",
  // Mientras premium no se exija (TF_PREMIUM_OBLIGATORIO), gratis lo tiene todo.
  gratis: TF_PREMIUM_OBLIGATORIO
    ? "Plan gratis: ves los chollos y te llegan por correo. Buscar, seguir viajes, alojamiento e " +
      "Interrail son de premium."
    : "Plan gratis. Mientras estrenamos la web, todas las herramientas están abiertas.",
  pendiente: "Tu cuenta se está abriendo: en unos minutos podrás usarla.",
  bloqueado: "Tu cuenta está bloqueada.",
};

const textoDe = (s) =>
  s.estado === "aprobado" ? TEXTO_ESTADO[s.plan === "premium" ? "premium" : "gratis"] : TEXTO_ESTADO[s.estado] || TEXTO_ESTADO.pendiente;

/* ------------------------------------------------------------ entrar / crear */
export function abrirLogin(modo = "entrar") {
  const registro = modo === "registro";
  const caja = tfModal(`
    <header class="modal-head">
      <h2>${registro ? "Crear una cuenta" : "Entrar"}</h2>
      <button type="button" data-cerrar aria-label="Cerrar">cerrar</button>
    </header>
    <div class="nube-pestanas" role="tablist" aria-label="Entrar o crear una cuenta">
      <button type="button" role="tab" data-modo="entrar" aria-selected="${!registro}">Entrar</button>
      <button type="button" role="tab" data-modo="registro" aria-selected="${registro}">Crear cuenta</button>
    </div>
    <form id="nubeForm" class="modal-form" novalidate>
      <p class="meta">${
        registro
          ? "Es gratis y para todo el mundo: con tu cuenta guardas favoritos y te llegan los chollos " +
            "por correo. Las cuentas premium, además, buscan viajes, los siguen y piden alojamiento."
          : "Los chollos del día son de todos. Tus favoritos, tus seguimientos y tus búsquedas son " +
            "tuyos: para verlos, entra."
      }</p>
      ${
        registro
          ? `<label for="nubeNombre">Tu nombre</label>
      <input id="nubeNombre" name="name" autocomplete="name" maxlength="40" enterkeyhint="next">`
          : ""
      }
      <label for="nubeCorreo">Correo</label>
      <input id="nubeCorreo" name="email" type="email" autocomplete="email" autocapitalize="none"
        autocorrect="off" spellcheck="false" enterkeyhint="next">
      <label for="nubePass">Contraseña</label>
      ${tfCampoClave("nubePass", registro ? "new-password" : "current-password")}
      ${registro ? `<p class="meta">De 8 caracteres o más.</p>` : ""}
      <p class="token-status" id="nubeMsg" role="status"></p>
      <button class="btn primary" type="submit">${registro ? "Crear la cuenta" : "Entrar"}</button>
      ${
        registro
          ? ""
          : `<p class="login-pedir"><button class="btn ghost small" type="button" id="nubeOlvide">
          ¿Olvidaste la contraseña?</button></p>`
      }
    </form>`);

  const form = caja.querySelector("#nubeForm");
  const msg = caja.querySelector("#nubeMsg");
  const boton = form.querySelector("button[type=submit]");
  tfWireVerClave(caja);

  caja.querySelectorAll("[data-modo]").forEach((b) =>
    b.addEventListener("click", () => {
      if (b.dataset.modo !== modo) abrirLogin(b.dataset.modo);
    })
  );

  const olvide = caja.querySelector("#nubeOlvide");
  if (olvide) {
    olvide.addEventListener("click", async () => {
      msg.textContent = "Mandando…";
      const r = await nubeOlvide(caja.querySelector("#nubeCorreo").value);
      msg.textContent = r.ok
        ? "Si hay una cuenta con ese correo, le llega ahora un enlace para poner otra contraseña."
        : r.error;
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (boton.disabled) return;
    const correo = caja.querySelector("#nubeCorreo").value;
    // Copiar y pegar del móvil se trae espacios de regalo.
    const clave = caja.querySelector("#nubePass").value;
    msg.textContent = registro ? "Creando la cuenta…" : "Comprobando…";
    tfOcupado(boton, true, msg.textContent);
    const r = registro
      ? await nubeRegistrar(correo, clave, caja.querySelector("#nubeNombre").value)
      : await nubeEntrar(correo, clave);
    tfOcupado(boton, false);
    if (!r.ok) {
      msg.textContent = r.error;
      return;
    }
    // Una cuenta nueva entra gratis: qué puede hacer, y que falta verificar el
    // correo, se dice aquí, que es cuando se lee, y no al pulsar un botón que
    // no responde.
    if (registro || r.sesion.estado !== "aprobado") {
      const verificar = r.sesion.verificado
        ? ""
        : " Te hemos escrito un correo con un enlace para verificar que la dirección es tuya: hasta " +
          "que lo pinches no te mandamos chollos, y si ya tenías cuenta de antes, es lo que permite recuperarla.";
      msg.innerHTML = `<span class="ojo">${esc(textoDe(r.sesion))}${esc(verificar)}</span>`;
      boton.textContent = "Entendido";
      boton.type = "button";
      boton.onclick = () => {
        tfCerrarModal();
        location.reload();
      };
      caja.querySelectorAll("[data-cerrar]").forEach((b) => b.addEventListener("click", () => location.reload()));
      if (typeof tfAnunciar === "function") tfAnunciar(textoDe(r.sesion));
      return;
    }
    tfCerrarModal();
    location.reload();
  });

  if (window.innerWidth > 620) (caja.querySelector("#nubeNombre") || caja.querySelector("#nubeCorreo")).focus();
}

/* ---------------------------------------------------------------- tu cuenta */
export async function abrirCuenta() {
  const s = tfSesion();
  if (!s) return abrirLogin();
  // Lo de ahora, no lo que se guardó el día que entraste: quizá te han aprobado.
  const ahora = (await nubeSincronizar()) || s;
  const t = nubeTokens() || {};
  const prefs = ahora.prefs || {};

  const caja = tfModal(`
    <header class="modal-head">
      <div>
        <p class="kicker">tu cuenta</p>
        <h2>${esc(ahora.name)}</h2>
      </div>
      <button type="button" data-cerrar aria-label="Cerrar">cerrar</button>
    </header>

    <p class="cuenta-quien">
      Entras con <b>${esc(t.correo || "tu correo")}</b>. Tus favoritos, tus seguimientos y tus
      búsquedas solo los ves tú.
      <span class="${nubePuedeLanzar(ahora) ? "cuenta-plan" : "cuenta-aviso"}" id="nubeEstado">${esc(
        textoDe(ahora)
      )}</span>
      ${ahora.admin ? `<a class="btn ghost small" href="admin.html" id="nubePanel">Panel de cuentas</a>` : ""}
    </p>

    ${
      ahora.legado
        ? `<p class="cuenta-quien" id="nubeVinculada">Tu cuenta de antes está vinculada a esta:
           tus seguimientos, tus búsquedas guardadas y tus avisos son los de siempre.</p>`
        : ""
    }
    ${
      ahora.verificado
        ? ""
        : `<div class="nube-verificar" id="nubeVerificar">
             <p class="cuenta-quien"><b>Falta verificar tu correo.</b> Te hemos escrito un enlace:
               pínchalo y vuelve aquí. Si ya tenías una cuenta de antes, es lo que permite
               recuperarla con todo lo que tenía.</p>
             <p class="controls">
               <button class="btn ghost small" type="button" id="nubeYaVerifique">Ya lo he verificado</button>
               <button class="btn ghost small" type="button" id="nubeReenviar">Reenviar el correo</button>
             </p>
             <p class="token-status" id="nubeVerificarMsg" role="status"></p>
           </div>`
    }

    <form id="nubePerfil" class="modal-form">
      <h3 class="bloque-head">Tus datos</h3>
      <label for="nubeNombre">Tu nombre</label>
      <input id="nubeNombre" maxlength="40" value="${esc(ahora.name)}" autocomplete="name">

      ${tfAvisosHTML("nube", prefs, nubePuedeLanzar(ahora))}

      <p class="token-status" id="nubePerfilMsg" role="status"></p>
      <button class="btn primary" type="submit">Guardar</button>
    </form>

    <form id="nubeClaveForm" class="modal-form tf-bloque">
      <h3 class="bloque-head">Tu contraseña</h3>
      <label for="nubeClaveVieja">La de ahora</label>
      ${tfCampoClave("nubeClaveVieja")}
      <label for="nubeClaveNueva">La nueva</label>
      ${tfCampoClave("nubeClaveNueva", "new-password")}
      <label for="nubeClaveRepe">Otra vez, para no jugársela</label>
      ${tfCampoClave("nubeClaveRepe", "new-password")}
      <p class="token-status" id="nubeClaveMsg" role="status"></p>
      <button class="btn primary" type="submit">Cambiar la contraseña</button>
      <p class="meta">¿La has olvidado? Cierra la sesión y usa «¿Olvidaste la contraseña?» al entrar.</p>
    </form>

    <div class="cuenta-salir">
      <button class="quitar" type="button" id="nubeSalir">Salir de la cuenta</button>
      <span class="meta">En este navegador. Lo tuyo se queda donde está.</span>
    </div>`);

  tfWireVerClave(caja);
  tfAvisosAtar(caja, "nube");

  const verificarMsg = caja.querySelector("#nubeVerificarMsg");
  if (verificarMsg) {
    caja.querySelector("#nubeReenviar").addEventListener("click", async () => {
      verificarMsg.textContent = "Mandando…";
      const r = await nubeReenviarVerificacion();
      verificarMsg.textContent = r.ok ? "Hecho. Mira tu correo (y la carpeta de spam)." : r.error;
    });
    caja.querySelector("#nubeYaVerifique").addEventListener("click", async () => {
      verificarMsg.textContent = "Comprobando…";
      const ahora2 = await nubeSincronizar();
      if (ahora2 && ahora2.verificado) {
        tfCerrarModal();
        abrirCuenta();
      } else {
        verificarMsg.textContent = "Todavía no consta. Pincha el enlace del correo y vuelve a probar.";
      }
    });
  }

  caja.querySelector("#nubeSalir").addEventListener("click", () => {
    tfSalir();
    tfCerrarModal();
    location.reload();
  });

  const guardar = caja.querySelector("#nubePerfil button[type=submit]");
  caja.querySelector("#nubePerfil").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (guardar.disabled) return;
    const msg = caja.querySelector("#nubePerfilMsg");
    const nombre = caja.querySelector("#nubeNombre").value.trim();
    if (!nombre) {
      msg.textContent = "El nombre no puede quedar vacío.";
      return;
    }
    msg.textContent = "Guardando…";
    tfOcupado(guardar, true, "Guardando…");
    const r = await nubeGuardarPerfil(nombre, tfAvisosLeer(caja, "nube"));
    tfOcupado(guardar, false);
    msg.textContent = r.ok ? "Guardado." : r.error;
  });

  const cambiar = caja.querySelector("#nubeClaveForm button[type=submit]");
  caja.querySelector("#nubeClaveForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (cambiar.disabled) return;
    const msg = caja.querySelector("#nubeClaveMsg");
    const vieja = caja.querySelector("#nubeClaveVieja").value;
    const nueva = caja.querySelector("#nubeClaveNueva").value;
    if (nueva.length < 8) {
      msg.textContent = "La nueva, de 8 caracteres o más.";
      return;
    }
    if (nueva !== caja.querySelector("#nubeClaveRepe").value) {
      msg.textContent = "Las dos nuevas no coinciden.";
      return;
    }
    if (nueva === vieja) {
      msg.textContent = "Esa es la que ya tienes.";
      return;
    }
    msg.textContent = "Comprobando…";
    tfOcupado(cambiar, true, "Guardando…");
    const r = await nubeCambiarClave(vieja, nueva);
    tfOcupado(cambiar, false);
    if (r.ok) caja.querySelectorAll("#nubeClaveForm input").forEach((i) => (i.value = ""));
    msg.textContent = r.ok ? "Cambiada." : r.error;
  });
}
