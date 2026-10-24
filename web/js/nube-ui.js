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

/* ------------------------------------------------------------ entrar / crear

   UNA SOLA PANTALLA. Correo, contraseña y «Continuar»: si tienes cuenta,
   entras; si no, se crea en ese momento y se te pregunta cómo llamarte (con
   un nombre ya puesto, sacado del correo). Con Google configurado, un botón
   encima y nada más que pensar. `modo` solo cambia el titular: «Crear cuenta»
   cuando se llega desde un botón que lo decía. */
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

async function pintarGoogle(caja, alEntrar) {
  const hueco = caja.querySelector("#nubeGoogle");
  const id = nubeGoogleId();
  if (!hueco || !id) return;
  hueco.hidden = false;
  caja.querySelector(".login-o").hidden = false;
  try {
    await cargarGoogle();
    window.google.accounts.id.initialize({
      client_id: id,
      ux_mode: "popup",
      callback: async ({ credential }) => alEntrar(await nubeConGoogle(credential)),
    });
    const oscuro = document.documentElement.dataset.tema !== "claro";
    window.google.accounts.id.renderButton(hueco, {
      theme: oscuro ? "filled_black" : "outline",
      size: "large",
      text: "continue_with",
      shape: "pill",
      locale: "es",
      width: Math.min(360, hueco.clientWidth || 320),
    });
  } catch {
    hueco.innerHTML = `<p class="meta">Google no ha cargado. Entra con tu correo.</p>`;
  }
}

export function abrirLogin(modo = "entrar") {
  const caja = tfModal(`
    <header class="modal-head">
      <h2>${modo === "registro" ? "Crea tu cuenta" : "Entra en TripFinder"}</h2>
      <button type="button" data-cerrar aria-label="Cerrar">cerrar</button>
    </header>
    <div class="login">
      <p class="meta login-lede">Gratis. Con tu cuenta guardas favoritos y eliges qué correos te llegan.</p>
      <div id="nubeGoogle" class="login-google" hidden></div>
      <p class="login-o" hidden><span>o con tu correo</span></p>
      <form id="nubeForm" class="modal-form login-form" novalidate>
        <label for="nubeCorreo">Correo</label>
        <input id="nubeCorreo" name="email" type="email" autocomplete="username email" autocapitalize="none"
          autocorrect="off" spellcheck="false" enterkeyhint="next" inputmode="email">
        <label for="nubePass">Contraseña</label>
        ${tfCampoClave("nubePass", "current-password")}
        <p class="meta login-pista">Si es tu primera vez, la que elijas ahora (8 caracteres o más).</p>
        <p class="token-status" id="nubeMsg" role="status"></p>
        <button class="btn primary login-boton" type="submit">Continuar</button>
        <p class="login-pedir"><button class="btn ghost small" type="button" id="nubeOlvide">
          ¿Olvidaste la contraseña?</button></p>
      </form>
    </div>`);

  const form = caja.querySelector("#nubeForm");
  const msg = caja.querySelector("#nubeMsg");
  const boton = form.querySelector("button[type=submit]");
  tfWireVerClave(caja);

  // El correo de la última vez, para no escribirlo otra vez.
  try {
    const ultimo = localStorage.getItem("tf_ultimo_correo");
    if (ultimo) caja.querySelector("#nubeCorreo").value = ultimo;
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
    const r = await nubeContinuar(correo, caja.querySelector("#nubePass").value);
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
  if (window.innerWidth > 620) (correo.value ? caja.querySelector("#nubePass") : correo).focus();
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
      )} <a class="cuenta-planes" href="planes.html">Ver planes</a></span>
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
    // Lo que no son correos (como «me interesa premium») se queda como estaba.
    const r = await nubeGuardarPerfil(nombre, { ...ahora.prefs, ...tfAvisosLeer(caja, "nube") });
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
