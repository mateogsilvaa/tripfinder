/* nube-ui.js — Las pantallas de la cuenta cuando hay Firebase.

   Entrar, crear una cuenta y la ficha de cada cual. Se cargan con un `import()`
   al pulsar (lo hacen `auth.js` y `cuenta.js`), igual que la pantalla de pedir
   cuenta de antes: son pantallas que casi nadie abre y no hay motivo para
   pagarlas en cada página.

   Las cuentas ya no se piden por WhatsApp ni por issue. Cada cual se registra
   con su correo y su contraseña, y queda `pendiente`: puede mirar la web, pero
   no lanzar nada hasta que quien la lleva la apruebe desde el panel. El correo
   y lo que busca cada uno viven en Firebase, no en el repositorio. */

const esc = (s) => tfEsc(s);

const TEXTO_ESTADO = {
  aprobado: "Tu cuenta está aprobada.",
  pendiente:
    "Tu cuenta está pendiente de aprobación. Puedes mirar la web, pero no lanzar búsquedas ni " +
    "seguir viajes hasta que quien la lleva la apruebe.",
  bloqueado: "Tu cuenta está bloqueada.",
};

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
          ? "Los chollos del día son de todos. Tus favoritos, tus seguimientos y tus búsquedas son " +
            "tuyos. Cuando quien lleva la web apruebe tu cuenta podrás lanzar búsquedas y seguir viajes."
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
    // Una cuenta nueva, o una que aún no han aprobado, entra pero no puede
    // lanzar nada: se dice aquí, que es cuando se puede hacer algo, y no al
    // pulsar un botón que no responde.
    if (r.sesion.estado !== "aprobado") {
      const verificar = r.sesion.verificado
        ? ""
        : " Te hemos escrito un correo con un enlace para verificar que la dirección es tuya: si ya tenías cuenta de antes, es lo que permite recuperarla.";
      msg.innerHTML = `<span class="ojo">${esc(TEXTO_ESTADO[r.sesion.estado] || TEXTO_ESTADO.pendiente)}${esc(verificar)}</span>`;
      boton.textContent = "Entendido";
      boton.type = "button";
      boton.onclick = () => {
        tfCerrarModal();
        location.reload();
      };
      caja.querySelectorAll("[data-cerrar]").forEach((b) => b.addEventListener("click", () => location.reload()));
      if (typeof tfAnunciar === "function") tfAnunciar(TEXTO_ESTADO[r.sesion.estado]);
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
      <span class="${ahora.estado === "aprobado" ? "" : "cuenta-aviso"}" id="nubeEstado">${esc(
        TEXTO_ESTADO[ahora.estado] || TEXTO_ESTADO.pendiente
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
      <h3 class="bloque-head">Tus datos y avisos</h3>
      <label for="nubeNombre">Tu nombre</label>
      <input id="nubeNombre" maxlength="40" value="${esc(ahora.name)}" autocomplete="name">

      <label for="nubeChollos">Chollos del día</label>
      <div class="par-campo">
        <select id="nubeChollos">${tfOpciones(TF_FREQ_CHOLLOS, prefs.chollos || "cada_vez")}</select>
        <span class="par-tope">
          <span class="par-y">…y solo si bajan de</span>
          <input id="nubeTope" type="number" min="0" step="10" placeholder="sin tope"
            aria-label="Precio máximo de los chollos, en euros"
            value="${prefs.chollos_max_precio ? Math.round(prefs.chollos_max_precio) : ""}">
          <span class="par-unidad">€</span>
        </span>
      </div>

      <label for="nubeSeg">Parte de tus seguimientos</label>
      <select id="nubeSeg">${tfOpciones(TF_FREQ_SEGUIMIENTOS, prefs.seguimientos || "diario")}</select>
      <label class="switch sangrada">
        <input type="checkbox" id="nubeSoloNov"${prefs.seguimientos_solo_novedades ? " checked" : ""}>
        <span>Solo cuando haya algo nuevo que contar</span>
      </label>

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
    const tope = Number(caja.querySelector("#nubeTope").value);
    msg.textContent = "Guardando…";
    tfOcupado(guardar, true, "Guardando…");
    const r = await nubeGuardarPerfil(nombre, {
      chollos: caja.querySelector("#nubeChollos").value,
      chollos_max_precio: tope > 0 ? tope : null,
      seguimientos: caja.querySelector("#nubeSeg").value,
      seguimientos_solo_novedades: caja.querySelector("#nubeSoloNov").checked,
    });
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
