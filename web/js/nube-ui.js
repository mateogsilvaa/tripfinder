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
    : "Plan gratis. Mientras estrenamos la web casi todo está abierto; el Interrail a medida es de premium.",
  pendiente: "Tu cuenta se está abriendo: en unos minutos podrás usarla.",
  bloqueado: "Tu cuenta está bloqueada.",
};

const textoDe = (s) =>
  s.estado === "aprobado" ? TEXTO_ESTADO[s.plan === "premium" ? "premium" : "gratis"] : TEXTO_ESTADO[s.estado] || TEXTO_ESTADO.pendiente;

/* ------------------------------------------------------------ entrar / crear

   DOS PESTAÑAS A LA VISTA: «Entrar» y «Crear cuenta», y Google encima de las
   dos. Con una sola pantalla que hacía las dos cosas nadie veía cómo crear
   una cuenta. «Entrar» sigue creándola si el correo no tiene, por si acaso.
   `modo` dice qué pestaña sale abierta. */
const GSI = "https://accounts.google.com/gsi/client";
let gsiCargando = null;

function cargarGoogle() {
  if (window.google && window.google.accounts) return Promise.resolve();
  if (!gsiCargando) {
    gsiCargando = new Promise((ok, mal) => {
      const s = document.createElement("script");
      s.src = GSI;
      s.async = true;
      s.onload = ok;
      s.onerror = () => {
        gsiCargando = null;
        mal(new Error("Google no contesta"));
      };
      document.head.appendChild(s);
    });
  }
  return gsiCargando;
}

/* El botón de Google sale siempre. Con `googleClientId` puesto se usa el
   botón oficial (una ventanita, sin salir de la página); sin él, la ventana de
   Google que trae Firebase, que no pide configurar nada más. */
async function pintarGoogle(caja, alEntrar) {
  const hueco = caja.querySelector("#nubeGoogle");
  if (!hueco) return;
  const id = nubeGoogleId();
  if (!id) {
    const boton = hueco.querySelector("#nubeGoogleBtn");
    boton.addEventListener("click", async () => {
      if (typeof nubeGooglePopup !== "function") {
        // La página es de una versión y nube.js de otra (caché): recargar lo junta.
        location.reload();
        return;
      }
      tfOcupado(boton, true, "Abriendo Google…");
      const r = await nubeGooglePopup();
      tfOcupado(boton, false);
      if (!r.ok && !r.error) return;
      alEntrar(r);
    });
    return;
  }
  try {
    await cargarGoogle();
    window.google.accounts.id.initialize({
      client_id: id,
      ux_mode: "popup",
      callback: async ({ credential }) => alEntrar(await nubeConGoogle(credential)),
    });
    const oscuro = document.documentElement.dataset.tema !== "claro";
    hueco.innerHTML = "";
    window.google.accounts.id.renderButton(hueco, {
      theme: oscuro ? "filled_black" : "outline",
      size: "large",
      text: "continue_with",
      shape: "pill",
      locale: "es",
      width: Math.min(360, hueco.clientWidth || 320),
    });
  } catch {
    /* se queda el botón propio, que también vale */
  }
}

const G_LOGO = `<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M17.6 9.2c0-.6-.1-1.2-.2-1.7H9v3.3h4.8a4.1 4.1 0 0 1-1.8 2.7v2.2h2.9c1.7-1.6 2.7-3.9 2.7-6.5z"/><path fill="#34A853" d="M9 18c2.4 0 4.5-.8 6-2.2l-2.9-2.2c-.8.5-1.8.9-3.1.9-2.4 0-4.4-1.6-5.1-3.8H.9v2.3A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.9 10.7a5.4 5.4 0 0 1 0-3.4V5H.9a9 9 0 0 0 0 8z"/><path fill="#EA4335" d="M9 3.6c1.3 0 2.5.5 3.4 1.4l2.6-2.6A9 9 0 0 0 .9 5l3 2.3C4.6 5.2 6.6 3.6 9 3.6z"/></svg>`;

export function abrirLogin(modo = "entrar") {
  const caja = tfModal(`
    <header class="modal-head">
      <h2>TripFinder</h2>
      <button type="button" data-cerrar aria-label="Cerrar">cerrar</button>
    </header>
    <div class="login">
      <div class="login-tabs" role="tablist">
        <button type="button" role="tab" data-modo="entrar">Entrar</button>
        <button type="button" role="tab" data-modo="registro">Crear cuenta</button>
      </div>
      <div id="nubeGoogle" class="login-google">
        <button type="button" class="btn ghost login-google-btn" id="nubeGoogleBtn">${G_LOGO}<span>Continuar con Google</span></button>
      </div>
      <p class="login-o"><span>o con tu correo</span></p>
      <form id="nubeForm" class="modal-form login-form" novalidate>
        <div class="login-solo-registro">
          <label for="nubeNombreAlta">Cómo te llamamos <span class="meta">(opcional)</span></label>
          <input id="nubeNombreAlta" maxlength="40" autocomplete="given-name">
        </div>
        <label for="nubeCorreo">Correo</label>
        <input id="nubeCorreo" name="email" type="email" autocomplete="username email" autocapitalize="none"
          autocorrect="off" spellcheck="false" enterkeyhint="next" inputmode="email">
        <label for="nubePass">Contraseña</label>
        ${tfCampoClave("nubePass", "current-password")}
        <p class="meta login-pista"></p>
        <p class="token-status" id="nubeMsg" role="status"></p>
        <button class="btn primary login-boton" type="submit">Entrar</button>
        <p class="login-pedir"><button class="btn ghost small" type="button" id="nubeOlvide">
          ¿Olvidaste la contraseña?</button></p>
      </form>
      <p class="meta login-lede">Gratis. Guardas favoritos y eliges qué correos te llegan.
        Al entrar aceptas las <a href="condiciones">condiciones</a>.</p>
    </div>`);

  const form = caja.querySelector("#nubeForm");
  const msg = caja.querySelector("#nubeMsg");
  const boton = form.querySelector("button[type=submit]");
  const pass = caja.querySelector("#nubePass");
  tfWireVerClave(caja);

  const ponerModo = (m) => {
    modo = m;
    const alta = m === "registro";
    caja.querySelectorAll(".login-tabs [data-modo]").forEach((t) => {
      t.setAttribute("aria-selected", String(t.dataset.modo === m));
    });
    caja.querySelector(".login").classList.toggle("es-alta", alta);
    boton.textContent = alta ? "Crear cuenta" : "Entrar";
    pass.setAttribute("autocomplete", alta ? "new-password" : "current-password");
    caja.querySelector(".login-pista").textContent = alta ? "8 caracteres o más." : "";
    caja.querySelector(".login-pedir").hidden = alta;
    msg.textContent = "";
  };
  caja.querySelectorAll(".login-tabs [data-modo]").forEach((t) =>
    t.addEventListener("click", () => ponerModo(t.dataset.modo))
  );
  ponerModo(modo === "registro" ? "registro" : "entrar");

  // El correo de la última vez, para no escribirlo otra vez.
  try {
    const ultimo = localStorage.getItem("tf_ultimo_correo");
    if (ultimo && modo !== "registro") caja.querySelector("#nubeCorreo").value = ultimo;
  } catch {
    /* navegación privada */
  }

  const alEntrar = (r) => {
    if (!r.ok) {
      msg.textContent = r.error;
      if (r.codigo === "clave-mala") caja.querySelector("#nubeOlvide").classList.add("resalta");
      return;
    }
    if (r.nueva) return bienvenida(caja, r.sesion);
    tfCerrarModal();
    location.reload();
  };

  pintarGoogle(caja, alEntrar);

  caja.querySelector("#nubeOlvide").addEventListener("click", async () => {
    msg.textContent = "Mandando…";
    const r = await nubeOlvide(caja.querySelector("#nubeCorreo").value);
    msg.textContent = r.ok
      ? "Si hay una cuenta con ese correo, le llega ahora un enlace para poner otra contraseña."
      : r.error;
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (boton.disabled) return;
    const correo = caja.querySelector("#nubeCorreo").value;
    msg.textContent = "Un momento…";
    tfOcupado(boton, true, "Un momento…");
    let r;
    if (modo === "registro") {
      r = await nubeRegistrar(correo, pass.value, caja.querySelector("#nubeNombreAlta").value);
      if (r.ok) r.nueva = true;
      else if (r.codigo === "EMAIL_EXISTS") {
        r.error = "Ese correo ya tiene cuenta: entra con él.";
        ponerModo("entrar");
      }
    } else {
      // Entrar sigue creando la cuenta si no existe: nadie se queda fuera por
      // haber elegido la pestaña equivocada.
      r = await nubeContinuar(correo, pass.value);
    }
    tfOcupado(boton, false);
    if (r.ok) {
      try {
        localStorage.setItem("tf_ultimo_correo", String(correo).trim().toLowerCase());
      } catch {
        /* navegación privada */
      }
    }
    alEntrar(r);
  });

  const correo = caja.querySelector("#nubeCorreo");
  if (window.innerWidth > 620) (correo.value ? pass : correo).focus();
}

/* La cuenta acaba de nacer: cómo te llamamos, y que falta verificar el correo.
   Un paso, con el nombre ya puesto: «Listo» y a la web. */
function bienvenida(caja, sesion) {
  const cuerpo = caja.querySelector(".login");
  cuerpo.innerHTML = `
    <form id="nubeBienvenida" class="modal-form">
      <p class="login-hecho">Cuenta creada.</p>
      <label for="nubeNombre">¿Cómo te llamamos?</label>
      <input id="nubeNombre" maxlength="40" autocomplete="given-name" value="${esc(sesion.name)}">
      <p class="meta">${esc(textoDe(sesion))}${
        sesion.verificado
          ? ""
          : " Te hemos mandado un correo para confirmar la dirección: hasta entonces no te escribimos nada más."
      }</p>
      <p class="token-status" id="nubeBienMsg" role="status"></p>
      <button class="btn primary" type="submit" id="nubeListo">Listo</button>
    </form>`;
  const listo = cuerpo.querySelector("#nubeListo");
  const nombre = cuerpo.querySelector("#nubeNombre");
  nombre.focus();
  nombre.select();
  cuerpo.querySelector("#nubeBienvenida").addEventListener("submit", async (e) => {
    e.preventDefault();
    const n = nombre.value.trim();
    if (n && n !== sesion.name) {
      tfOcupado(listo, true, "Guardando…");
      const r = await nubeGuardarPerfil(n, sesion.prefs || {});
      tfOcupado(listo, false);
      if (!r.ok) {
        cuerpo.querySelector("#nubeBienMsg").textContent = r.error;
        return;
      }
    }
    tfCerrarModal();
    location.reload();
  });
  caja.querySelectorAll("[data-cerrar]").forEach((b) => b.addEventListener("click", () => location.reload()));
  if (typeof tfAnunciar === "function") tfAnunciar("Cuenta creada.");
}

/* ---------------------------------------------------------------- tu cuenta */
export async function abrirCuenta() {
  const s = tfSesion();
  if (!s) return abrirLogin();
  // Lo de ahora, no lo que se guardó el día que entraste: quizá te han aprobado.
  const ahora = (await nubeSincronizar()) || s;
  const t = nubeTokens() || {};
  const prefs = ahora.prefs || {};

  const premium = nubeEsPremium(ahora);
  const caja = tfModal(`
    <header class="modal-head cuenta-cab">
      <h2>Mi cuenta</h2>
      <button type="button" data-cerrar aria-label="Cerrar">cerrar</button>
    </header>

    <div class="cuenta-rejilla">
    <aside class="cuenta-lado">
    <section class="cuenta-ficha">
      <span class="cuenta-avatar" aria-hidden="true">${esc((ahora.name || "?").slice(0, 1).toUpperCase())}</span>
      <span class="cuenta-ficha-txt">
        <b id="cuentaNombreVer">${esc(ahora.name)}</b>
        <span>${esc(t.correo || "")}</span>
      </span>
      <a class="plan-chip${premium ? " premium" : ""}" href="planes" title="Ver los planes">${
        premium ? "Premium" : "Gratis"
      }</a>
    </section>
    <p class="cuenta-linea" id="nubeEstado">${esc(textoDe(ahora))}
      <a class="cuenta-planes" href="planes">Ver planes</a></p>

    ${
      ahora.legado
        ? `<p class="cuenta-linea" id="nubeVinculada">Tu cuenta de antes está vinculada a esta:
           tus seguimientos, búsquedas y avisos son los de siempre.</p>`
        : ""
    }
    ${
      ahora.verificado
        ? ""
        : `<div class="nube-verificar" id="nubeVerificar">
             <p class="cuenta-linea"><b>Falta verificar tu correo.</b> Pincha el enlace que te hemos
               mandado: hasta entonces no te escribimos nada.</p>
             <p class="controls">
               <button class="btn ghost small" type="button" id="nubeYaVerifique">Ya lo he verificado</button>
               <button class="btn ghost small" type="button" id="nubeReenviar">Reenviar el correo</button>
             </p>
             <p class="token-status" id="nubeVerificarMsg" role="status"></p>
           </div>`
    }
    </aside>

    <div class="cuenta-main">
    <form id="nubePerfil" class="modal-form cuenta-bloque">
      <h3 class="cuenta-seccion">Tu perfil</h3>
      <label class="bloque-head" for="nubeNombre">Cómo te llamamos</label>
      <input id="nubeNombre" maxlength="40" value="${esc(ahora.name)}" autocomplete="name">

      ${tfAvisosHTML("nube", prefs, nubePuedeLanzar(ahora))}

      <p class="cuenta-guardado" id="nubePerfilMsg" role="status">Los cambios se guardan solos.</p>
      <button type="submit" hidden>Guardar</button>
    </form>

    <details class="cuenta-bloque" id="nubeClaveCaja">
      <summary><span class="cuenta-seccion">Seguridad</span> Cambiar la contraseña</summary>
      <form id="nubeClaveForm" class="modal-form">
        <label for="nubeClaveVieja">La de ahora</label>
        ${tfCampoClave("nubeClaveVieja")}
        <label for="nubeClaveNueva">La nueva (8 caracteres o más)</label>
        ${tfCampoClave("nubeClaveNueva", "new-password")}
        <label for="nubeClaveRepe">Repite la nueva</label>
        ${tfCampoClave("nubeClaveRepe", "new-password")}
        <p class="token-status" id="nubeClaveMsg" role="status"></p>
        <button class="btn primary" type="submit">Cambiar la contraseña</button>
      </form>
    </details>
    </div>

    <div class="cuenta-salir">
      ${ahora.admin ? `<a class="btn ghost small" href="admin" id="nubePanel">Panel de cuentas</a>` : ""}
      <button class="quitar" type="button" id="nubeSalir">Salir de la cuenta</button>
    </div>
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

  /* SE GUARDA SOLO. Cada cambio espera un momento (por si sigues tocando) y se
     guarda; debajo se dice «Guardando…» y «Guardado.». Un botón de guardar al
     final de un formulario largo es el sitio donde se pierden los cambios. */
  const form = caja.querySelector("#nubePerfil");
  const msg = caja.querySelector("#nubePerfilMsg");
  let espera = null;
  const guardar = async () => {
    clearTimeout(espera);
    const nombre = caja.querySelector("#nubeNombre").value.trim();
    if (!nombre) {
      msg.textContent = "El nombre no puede quedar vacío.";
      return;
    }
    msg.textContent = "Guardando…";
    // Lo que no son correos (como «me interesa premium») se queda como estaba.
    const r = await nubeGuardarPerfil(nombre, { ...ahora.prefs, ...tfAvisosLeer(caja, "nube") });
    msg.textContent = r.ok ? "Guardado." : r.error;
    if (r.ok) caja.querySelector("#cuentaNombreVer").textContent = nombre;
  };
  const pronto = () => {
    clearTimeout(espera);
    msg.textContent = "…";
    espera = setTimeout(guardar, 700);
  };
  form.addEventListener("input", pronto);
  form.addEventListener("change", pronto);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    guardar();
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
