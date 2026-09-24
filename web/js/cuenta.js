/* cuenta.js — Pedir una cuenta: el formulario, el usuario libre y la petición.

   Las cuentas las da a mano quien lleva la web. Hasta ahora eso no se decía en
   ninguna parte: sin cuenta, los formularios salían apagados con el motivo
   puesto y ahí se acababa el camino. Quien quisiera una tenía que conocer a
   alguien y pedírsela por fuera.

   CÓMO SALE DE AQUÍ LA PETICIÓN. Quien pide una cuenta no tiene cuenta, y sin
   cuenta no hay token: no puede escribir en el repositorio, que es como escribe
   todo lo demás en esta web. Lo único que puede hacer alguien de fuera es abrir
   una issue con su propio GitHub, así que eso es lo que se hace: se le abre
   GitHub con la petición ya escrita y él le da a publicar. Tiene un coste —hace
   falta cuenta de GitHub— y se dice en la pantalla en vez de descubrirlo al
   final.

   EL CORREO Y LA CONTRASEÑA VIAJAN CERRADOS. Una issue de un repositorio
   público la lee cualquiera y la rastrea cualquier bot, y este proyecto ya
   tiene tomada esa decisión en el otro sentido: `users.json` se publica SIN
   correos y hay un `grep` en el despliegue que falla si se cuela una arroba.
   Escribirlos en claro en la issue sería saltarse esa misma regla por otra
   puerta.

   Pero tampoco pueden faltar, porque sin ellos aprobar una cuenta no es
   aprobar: es inventar una contraseña, escribirla a mano y salir a decírsela
   por otro lado. Así que van dentro de un sobre cerrado con la clave PÚBLICA
   del panel (`admin.buzon`), que está publicada para eso. Cualquiera puede
   cerrar uno; abrirlo, solo quien tenga la privada, que vive cifrada con la
   clave maestra. En la issue no hay más que base64.

   Y si todavía no hay buzón publicado —una web recién montada, sin token—, el
   formulario vuelve a lo de antes: sin correo ni contraseña, y el panel las
   pregunta al crear la cuenta. Mejor eso que pedir una contraseña y mandarla a
   una issue pública en claro.

   Y NO HACE FALTA GITHUB. Abrir una issue pide tener cuenta de GitHub, que casi
   nadie de fuera tiene, y además `window.open` después de esperar a la red lo
   bloquea el navegador del móvil: la pantalla decía «dale a Submit new issue» y
   no se había abierto nada. Así que la petición sale ahora, sobre incluido,
   como un ENLACE al panel que se manda por WhatsApp (o por donde sea) a quien
   lleva la web; al abrirlo con la sesión del panel, aprobarla es el mismo clic.
   GitHub queda como segunda vía, con un enlace de verdad que se pulsa y no con
   una ventana que se abre sola. */

import { $, esc, fetchJSON, on } from "./base.js";

const REPO = "mateogsilvaa/tripfinder";
export const MAX_PORQUE = 240;

let USUARIOS = null; // los que ya existen, del fichero publicado
let BUZON = null; // la clave publica del panel, si la hay

/* La clave con la que se cierra el sobre. Sin ella el formulario sigue
   funcionando, solo que pidiendo menos: es un modo degradado de verdad, no un
   error. */
async function cargarBuzon() {
  if (BUZON !== null) return BUZON;
  try {
    const d = await fetchJSON("data/users.json");
    BUZON = ((d.admin || {}).buzon || {}).pub || "";
  } catch {
    BUZON = "";
  }
  return BUZON;
}

async function cargarUsuarios() {
  if (USUARIOS) return USUARIOS;
  try {
    const d = await fetchJSON("data/users.json");
    USUARIOS = new Set((d.users || []).map((u) => String(u.user || "").toLowerCase()));
  } catch {
    // Sin la lista no se puede avisar de que esta cogido, pero si dejar pedir:
    // quien aprueba lo vera igual. Peor seria no dejar pedir por esto.
    USUARIOS = new Set();
  }
  return USUARIOS;
}

export const usuarioValido = (u) => /^[a-z0-9._-]{3,24}$/.test(String(u || "").toLowerCase());

/* Alternativas cuando el que quieres esta cogido. Salen del nombre que ha
   escrito, no de un contador: "ana2" es lo ultimo que se ofrece, no lo primero,
   porque un numero pegado detras es el peor nombre de los tres. */
export function alternativas(user, nombre, cogidos) {
  const base = String(user || "").toLowerCase().replace(/[^a-z0-9._-]/g, "");
  if (!base) return [];
  const apellido = String(nombre || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z ]/g, "")
    .trim()
    .split(/\s+/)
    .slice(1)
    .join("");
  const candidatos = [
    apellido ? `${base}.${apellido.slice(0, 1)}` : `${base}.g`,
    apellido ? `${base}${apellido}` : `${base}es`,
    `${base}2`,
  ];
  return candidatos
    .filter((c) => usuarioValido(c) && !cogidos.has(c))
    .filter((c, i, a) => a.indexOf(c) === i)
    .slice(0, 3);
}

/* El cuerpo de la issue. Va en texto plano y ordenado para que quien lo lea en
   el panel —o en GitHub— vea lo mismo en los dos sitios. */
export function cuerpoPeticion({ nombre, user, porque, sellado = null }) {
  const cola = sellado
    ? [
        "---",
        "Pedida desde la web. Aquí abajo van el correo y la contraseña que ha",
        "elegido, cerrados con la clave pública del panel: esta issue es pública",
        "y en claro no puede ir nada. Solo los abre quien tenga la privada, y con",
        "eso la cuenta queda activa de un clic, sin contraseñas de ida y vuelta.",
        "",
        "```tf-sobre",
        JSON.stringify(sellado),
        "```",
      ]
    : [
        "---",
        "Pedida desde la web. El correo y la contraseña no van aquí: esta issue",
        "es pública y todavía no hay buzón publicado con el que cerrarlos. Se",
        "ponen desde el panel al crear la cuenta.",
      ];
  return [`Nombre: ${nombre}`, `Usuario: ${user}`, "", "Por qué:", porque, "", ...cola].join("\n");
}

export function urlPeticion(datos) {
  return (
    `https://github.com/${REPO}/issues/new` +
    `?title=${encodeURIComponent(`[cuenta] ${datos.user}`)}` +
    `&labels=peticion-cuenta` +
    `&body=${encodeURIComponent(cuerpoPeticion(datos))}`
  );
}

/* La petición entera dentro de la dirección, en base64 «de URL» para que ni
   WhatsApp ni el correo la corten por un `+` o un `/`. Va detrás de `#`, que el
   navegador no manda nunca al servidor: ni Pages ni nadie en medio la ve. */
export function codificarPeticion({ nombre, user, porque, sellado = null }) {
  const json = JSON.stringify({ v: 1, n: nombre, u: user, p: porque, s: sellado });
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function enlacePeticion(datos, base = location.href) {
  return new URL(`admin.html#peticion=${codificarPeticion(datos)}`, base).href;
}

export function mensajePeticion(datos, enlace) {
  return (
    `Hola, soy ${datos.nombre}. Te pido una cuenta en TripFinder con el usuario «${datos.user}». ` +
    `Ábrelo con tu sesión del panel y es un clic: ${enlace}`
  );
}

function formHTML(conBuzon) {
  return `
    <p class="pedir-lede">Las cuentas las da a mano quien lleva la web: es un sitio pequeño y
      el token con el que se escribe es uno solo. ${
        conBuzon
          ? "Elige aquí tu contraseña: cuando aprueben la cuenta ya podrás entrar con ella, sin que nadie te tenga que pasar nada."
          : "Rellena esto y le llega al panel; cuando la apruebe, te pasa la contraseña."
      }</p>
    <div class="pedir-campos">
      <label class="campo">
        <span>Nombre</span>
        <input id="pcNombre" type="text" placeholder="Ana" autocomplete="name" maxlength="60">
        <span class="campo-pie">Como quieras que te llame la web.</span>
      </label>
      <label class="campo">
        <span>Nombre de usuario</span>
        <input id="pcUser" type="text" placeholder="ana" autocomplete="username" maxlength="24"
          spellcheck="false">
        <span class="campo-pie" id="pcUserPie">De 3 a 24 caracteres, sin espacios ni acentos.
          Es con lo que entras.</span>
        <span class="pedir-sugerencias" id="pcSug" hidden></span>
      </label>
      ${
        conBuzon
          ? `
      <label class="campo">
        <span>Tu correo <i>(opcional)</i></span>
        <input id="pcEmail" type="email" placeholder="ana@ejemplo.com" autocomplete="email"
          maxlength="120" spellcheck="false">
        <span class="campo-pie">Solo para los avisos de chollos. Puedes dejarlo vacío y ponerlo
          después desde tu cuenta.</span>
      </label>
      <label class="campo">
        <span>Contraseña</span>
        <input id="pcPass" type="password" autocomplete="new-password" maxlength="120">
        <span class="campo-pie">De 8 caracteres o más. La eliges tú y no la ve nadie: viaja
          cerrada y solo la abre el panel al aprobarte.</span>
      </label>
      <label class="campo">
        <span>Repite la contraseña</span>
        <input id="pcPass2" type="password" autocomplete="new-password" maxlength="120">
        <span class="campo-pie" id="pcPassPie">Si no coinciden no se manda: aquí no hay «he
          olvidado mi contraseña».</span>
      </label>`
          : ""
      }
      <label class="campo">
        <span>Por qué deberían dejarte entrar</span>
        <textarea id="pcPorque" rows="4" maxlength="${MAX_PORQUE}"
          placeholder="Me gustaría tener acceso para poder viajar más."></textarea>
        <span class="campo-pie campo-pie-doble">
          <span>Quien aprueba esto conoce a la gente que entra. Dos líneas bastan: quién eres, o por qué te vendría bien.</span>
          <span id="pcCuenta">0/${MAX_PORQUE}</span>
        </span>
      </label>
    </div>
    <div class="pedir-acc">
      <button class="btn primary" type="button" id="pcMandar">Pedir la cuenta</button>
      <button class="btn ghost" type="button" id="pcEntrar">Ya tengo una: entrar</button>
    </div>
    <p class="pedir-nota">${
      conBuzon
        ? `No hace falta GitHub: te damos un enlace con la petición para que se lo mandes por
      WhatsApp a quien lleva la web. El correo y la contraseña van <b>cerrados</b> con la clave
      pública del panel: en el enlace solo se ve base64.`
        : `La contraseña no se pide aquí: la pone quien aprueba la cuenta y te la pasa. No hace
      falta GitHub: te damos un enlace con la petición para que se lo mandes por WhatsApp.`
    }</p>
    <p class="pedir-nota" id="pcMsg" role="status"></p>`;
}

function mandadaHTML(datos, conPass = false) {
  const enlace = enlacePeticion(datos);
  const texto = mensajePeticion(datos, enlace);
  return `
    <div class="pedir-hecha">
      <h3>Lista. Ahora mándasela a quien lleva la web.</h3>
      <p>La petición de <b>${esc(datos.user)}</b> va entera dentro de este enlace. Quien lleva la
        web lo abre con su sesión del panel y la aprueba de un clic.</p>
      <div class="pedir-acc pedir-mandar">
        <a class="btn primary" id="pcWhats" target="_blank" rel="noopener"
          href="https://wa.me/?text=${encodeURIComponent(texto)}">Mandar por WhatsApp</a>
        ${
          typeof navigator.share === "function"
            ? `<button class="btn ghost" type="button" id="pcCompartir">Compartir…</button>`
            : ""
        }
        <button class="btn ghost" type="button" id="pcCopiar">Copiar el enlace</button>
      </div>
      <p class="pedir-nota" id="pcCopiado" role="status"></p>
      <p class="meta">${
        conPass
          ? "Cuando la apruebe, tu cuenta queda activa con la contraseña que acabas de elegir: no hay que esperar a que nadie te mande nada."
          : "Cuando la apruebe te pasará la contraseña por donde te haya dicho; esta web no manda correos a quien todavía no tiene cuenta."
      }</p>
      <p class="meta">¿Tienes cuenta de GitHub? También puedes
        <a href="${esc(urlPeticion(datos))}" target="_blank" rel="noopener" id="pcGitHub">dejarla
        en GitHub</a>, y le sale sola en el panel. Lo que escribas ahí queda publicado, salvo el
        correo y la contraseña, que van cerrados.</p>
      <div class="pedir-acc">
        <a class="btn ghost" href="./">Ver los chollos mientras</a>
      </div>
    </div>`;
}

function atarMandada(datos) {
  const enlace = enlacePeticion(datos);
  const aviso = $("#pcCopiado");
  const copiar = $("#pcCopiar");
  if (copiar) {
    copiar.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(enlace);
        aviso.textContent = "Copiado. Pégaselo a quien lleva la web.";
      } catch {
        // Sin portapapeles (http, permisos): el enlace a la vista para copiarlo a mano.
        aviso.innerHTML = `Cópialo a mano: <span class="pedir-enlace">${esc(enlace)}</span>`;
      }
    });
  }
  const compartir = $("#pcCompartir");
  if (compartir) {
    compartir.addEventListener("click", () =>
      navigator.share({ title: "Cuenta en TripFinder", text: mensajePeticion(datos, enlace) }).catch(() => {})
    );
  }
}

async function revisarUsuario() {
  const campo = $("#pcUser");
  const pie = $("#pcUserPie");
  const sug = $("#pcSug");
  if (!campo || !pie || !sug) return;
  const v = campo.value.trim().toLowerCase();
  sug.hidden = true;
  sug.innerHTML = "";
  campo.classList.remove("mal");
  if (!v) {
    pie.textContent =
      "De 3 a 24 caracteres, sin espacios ni acentos. Es con lo que entras.";
    return;
  }
  if (!usuarioValido(v)) {
    campo.classList.add("mal");
    pie.textContent = "De 3 a 24 caracteres: letras, números, punto, guion o guion bajo.";
    return;
  }
  const cogidos = await cargarUsuarios();
  if (!cogidos.has(v)) {
    pie.textContent = "Libre.";
    return;
  }
  campo.classList.add("mal");
  pie.textContent = "Ya hay una cuenta con ese usuario. Prueba con otro, o entra si es la tuya.";
  const otros = alternativas(v, $("#pcNombre") ? $("#pcNombre").value : "", cogidos);
  if (!otros.length) return;
  sug.hidden = false;
  sug.innerHTML = otros
    .map((o) => `<button type="button" class="btn ghost small" data-sug="${esc(o)}">${esc(o)}</button>`)
    .join("");
  sug.querySelectorAll("[data-sug]").forEach((b) =>
    b.addEventListener("click", () => {
      campo.value = b.dataset.sug;
      revisarUsuario();
      campo.focus();
    })
  );
}

export async function abrirPedirCuenta() {
  const caja = $("#pedirCuenta");
  if (!caja) return;
  /* El formulario se pinta DOS veces a propósito: primero el de siempre, para
     que la ventana se abra al momento, y luego con los campos de contraseña en
     cuanto se sabe que hay buzón. Esperar a la red con el diálogo en blanco se
     nota; que aparezcan dos campos más, no. */
  $("#pedirBody").innerHTML = formHTML(false);
  caja.hidden = false;
  tfAbrirDialogo(caja, {
    foco: () => $("#pcNombre"),
    alCerrar: () => (caja.hidden = true),
  });
  cargarUsuarios();
  atarForm(caja);

  if (await cargarBuzon()) {
    const antes = {
      nombre: $("#pcNombre").value,
      user: $("#pcUser").value,
      porque: $("#pcPorque").value,
    };
    $("#pedirBody").innerHTML = formHTML(true);
    $("#pcNombre").value = antes.nombre;
    $("#pcUser").value = antes.user;
    $("#pcPorque").value = antes.porque;
    atarForm(caja);
  }
}

function atarForm(caja) {
  $("#pcUser").addEventListener("input", revisarUsuario);
  $("#pcPorque").addEventListener("input", (e) => {
    $("#pcCuenta").textContent = `${e.target.value.length}/${MAX_PORQUE}`;
  });
  $("#pcEntrar").addEventListener("click", () => {
    tfCerrarDialogo(caja);
    tfAbrirLogin();
  });
  $("#pcMandar").addEventListener("click", mandar);
}

async function mandar() {
  const nombre = $("#pcNombre").value.trim();
  const user = $("#pcUser").value.trim().toLowerCase();
  const porque = $("#pcPorque").value.trim();
  const msg = $("#pcMsg");

  if (!nombre) return fallo(msg, "Falta el nombre: es como te va a llamar la web.");
  if (!usuarioValido(user)) return fallo(msg, "El usuario: de 3 a 24 caracteres, sin espacios ni acentos.");
  const cogidos = await cargarUsuarios();
  if (cogidos.has(user)) return fallo(msg, "Ese usuario ya está cogido. Prueba con otro.");
  if (porque.length < 15) {
    return fallo(msg, "Cuenta un poco quién eres: quien aprueba esto conoce a la gente que entra.");
  }

  /* El sobre: correo y contraseña cerrados con la clave pública del panel. Si
     algo falla aquí NO se manda la petición a medias — una cuenta creada con
     una contraseña que el que la pidió no conoce es peor que no crearla. */
  let sellado = null;
  const pass = $("#pcPass") ? $("#pcPass").value : "";
  if ($("#pcPass")) {
    if (pass.length < 8) return fallo(msg, "La contraseña, de 8 caracteres o más.");
    if (pass !== $("#pcPass2").value) return fallo(msg, "Las dos contraseñas no son la misma.");
    const email = $("#pcEmail").value.trim();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return fallo(msg, "Ese correo no parece un correo. Déjalo vacío si no quieres avisos.");
    }
    try {
      sellado = await tfSellar(await cargarBuzon(), { email, pass });
    } catch (err) {
      return fallo(msg, `No se ha podido cerrar el sobre (${err.message}). Prueba a recargar.`);
    }
  }

  const datos = { nombre, user, porque, sellado };
  $("#pedirBody").innerHTML = mandadaHTML(datos, Boolean(sellado));
  // El formulario es largo y el botón está abajo: sin esto, en el móvil lo
  // nuevo salía con el título y el «cerrar» por encima del borde.
  const caja = document.querySelector("#pedirCuenta .modal-caja");
  if (caja) caja.scrollTop = 0;
  atarMandada(datos);
}

function fallo(msg, texto) {
  if (msg) {
    msg.textContent = texto;
    msg.classList.add("mal");
  }
}

on("#pedirClose", "click", () => tfCerrarDialogo($("#pedirCuenta")));
on("#pedirCuenta", "click", (e) => {
  if (e.target.id === "pedirCuenta") tfCerrarDialogo($("#pedirCuenta"));
});
