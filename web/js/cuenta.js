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

   EL EMAIL NO SE PIDE AQUÍ, y eso es apartarse del diseño a propósito. Una
   issue de un repositorio público la lee cualquiera y la rastrea cualquier bot.
   Este proyecto ya tiene tomada esa decisión en el otro sentido: `users.json`
   se publica SIN emails y hay un `grep` en el despliegue que falla si se cuela
   una arroba. Pedir el email en un formulario que acaba en una issue pública
   sería saltarse esa misma regla por otra puerta. Se pone luego, desde el
   panel, cuando ya hay cuenta donde ponerlo. */

import { $, esc, fetchJSON, on } from "./base.js";

const REPO = "mateogsilvaa/tripfinder";
export const MAX_PORQUE = 240;

let USUARIOS = null; // los que ya existen, del fichero publicado

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
export function cuerpoPeticion({ nombre, user, porque }) {
  return [
    `Nombre: ${nombre}`,
    `Usuario: ${user}`,
    "",
    "Por qué:",
    porque,
    "",
    "---",
    "Pedida desde la web. El email no se pide aquí a propósito: esta issue es",
    "pública. Si hace falta para los avisos, se pone desde el panel al crear la",
    "cuenta.",
  ].join("\n");
}

export function urlPeticion(datos) {
  return (
    `https://github.com/${REPO}/issues/new` +
    `?title=${encodeURIComponent(`[cuenta] ${datos.user}`)}` +
    `&labels=peticion-cuenta` +
    `&body=${encodeURIComponent(cuerpoPeticion(datos))}`
  );
}

function formHTML() {
  return `
    <p class="pedir-lede">Las cuentas las da a mano quien lleva la web: es un sitio pequeño y
      el token con el que se escribe es uno solo. Rellena esto y le llega al panel; cuando la
      apruebe, te pasa la contraseña.</p>
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
      <label class="campo">
        <span>Por qué deberían dejarte entrar</span>
        <textarea id="pcPorque" rows="4" maxlength="${MAX_PORQUE}"
          placeholder="Soy la hermana de Mateo y volamos juntos casi todos los findes."></textarea>
        <span class="campo-pie campo-pie-doble">
          <span>Quien aprueba esto conoce a la gente que entra. Dos líneas con quién eres bastan.</span>
          <span id="pcCuenta">0/${MAX_PORQUE}</span>
        </span>
      </label>
    </div>
    <div class="pedir-acc">
      <button class="btn primary" type="button" id="pcMandar">Pedir la cuenta</button>
      <button class="btn ghost" type="button" id="pcEntrar">Ya tengo una: entrar</button>
    </div>
    <p class="pedir-nota">La contraseña no se pide aquí: la pone quien aprueba la cuenta y te la
      pasa. Se manda abriendo una issue en GitHub con tu cuenta de GitHub, así que <b>lo que
      escribas queda publicado</b> junto a las demás peticiones.</p>
    <p class="pedir-nota" id="pcMsg" role="status"></p>`;
}

function mandadaHTML(user) {
  return `
    <div class="pedir-hecha">
      <h3>Te falta un toque: dale a «Submit new issue».</h3>
      <p>Te hemos abierto GitHub con la petición escrita, a nombre de <b>${esc(user)}</b>. En
        cuanto la publiques aparece en el panel de quien lleva la web.</p>
      <p class="meta">No podemos publicarla por ti: para escribir en el repositorio hace falta
        una cuenta, y la tuya es justo la que estás pidiendo.</p>
      <p class="meta">Cuando la apruebe te pasará la contraseña por donde te haya dicho; esta web
        no manda correos a quien todavía no tiene cuenta.</p>
      <div class="pedir-acc">
        <a class="btn primary" href="./">Ver los chollos mientras</a>
        <span class="meta">El tablón se ve sin cuenta: es lo mismo para todo el mundo.</span>
      </div>
    </div>`;
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

export function abrirPedirCuenta() {
  const caja = $("#pedirCuenta");
  if (!caja) return;
  $("#pedirBody").innerHTML = formHTML();
  caja.hidden = false;
  tfAbrirDialogo(caja, {
    foco: () => $("#pcNombre"),
    alCerrar: () => (caja.hidden = true),
  });
  cargarUsuarios();

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

  window.open(urlPeticion({ nombre, user, porque }), "_blank", "noopener");
  $("#pedirBody").innerHTML = mandadaHTML(user);
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
