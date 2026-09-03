/* Cuentas: quien esta delante de la web.

   El tablon de chollos es el mismo para todo el mundo -- sale de offers.json y
   no tiene dueño --, pero los favoritos, los seguimientos y las busquedas son
   de quien las pide. Aqui esta lo unico que hace falta para distinguirlo: una
   sesion en este navegador y un espacio de nombres para todo lo que se guarda.

   Las contrasenas se comprueban contra data/users.json con el mismo PBKDF2-SHA256
   que usa src/tripfinder/users.py, calculado con WebCrypto. La contrasena en
   claro no sale de aqui: ni al hacer login (se compara el hash) ni al crear una
   cuenta desde el panel (viaja la sal y el hash, nunca la clave).

   Hasta donde llega esto, dicho claro: el repo es publico y users.json se sirve
   con la web, asi que los hashes los puede leer cualquiera. Esto separa a gente
   que se conoce y comparte la misma web; no es una caja fuerte. Lo unico que de
   verdad impide escribir es el token de GitHub, que solo esta en tu navegador. */

const TF_USERS_URL = "data/users.json";
const TF_SESION_KEY = "tf_sesion";
const TF_ITERACIONES = 210000; // el mismo numero que en users.py

/* ------------------------------------------------------------------ hashing */
const tfB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const tfDeB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function tfCryptoOK() {
  // crypto.subtle solo existe en contexto seguro (https o localhost). En Pages
  // siempre lo hay; abrir el index con file:// es lo unico que se queda fuera.
  return typeof crypto !== "undefined" && crypto.subtle;
}

async function tfHash(password, saltB64 = "", iteraciones = TF_ITERACIONES) {
  if (!tfCryptoOK()) throw new Error("Este navegador no puede cifrar aquí (hace falta https).");
  const salt = saltB64 ? tfDeB64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const clave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: iteraciones },
    clave,
    256
  );
  return { salt: tfB64(salt), hash: tfB64(bits), iterations: iteraciones };
}

/* Comparacion sin filtrar tiempos: aqui da un poco igual (el hash es publico),
   pero cuesta tres lineas y evita coger malas costumbres. */
function tfIguales(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

async function tfComprobar(password, guardado) {
  if (!guardado || !guardado.hash || !guardado.salt) return false;
  const calculado = await tfHash(password, guardado.salt, Number(guardado.iterations) || TF_ITERACIONES);
  return tfIguales(calculado.hash, String(guardado.hash));
}

/* ------------------------------------------------------------------ sobres
   El token con el que la web escribe en el repo no puede ir en claro: el sitio
   es publico y cualquiera vería el codigo. Va cifrado, y la llave de abrirlo la
   tienen solo las cuentas:

     clave maestra K  --AES-GCM-->  token          (en data/users.json, "site")
     tu contrasena --PBKDF2--> clave --AES-GCM--> K   (en tu ficha, "sobre")

   Al entrar, tu contrasena abre tu sobre, el sobre da K y K abre el token. Quien
   mire el fichero sin la contrasena de ninguna cuenta ve dos cajas cerradas, y
   forzarlas cuesta lo mismo que forzar el login: PBKDF2 con 210.000 vueltas.

   La sal del sobre es DISTINTA de la del login a proposito. Con la misma, la
   clave del sobre serían los mismos bits que el hash que se publica al lado, y
   entonces abrir el sobre no costaría nada: bastaria con copiar el hash. */
async function tfClaveDe(password, saltB64, iteraciones = TF_ITERACIONES) {
  if (!tfCryptoOK()) throw new Error("Este navegador no puede cifrar aquí (hace falta https).");
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: tfDeB64(saltB64), iterations: iteraciones },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function tfCifrar(clave, texto) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const datos = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    clave,
    new TextEncoder().encode(texto)
  );
  return { iv: tfB64(iv), data: tfB64(datos) };
}

async function tfDescifrar(clave, caja) {
  const claro = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: tfDeB64(caja.iv) },
    clave,
    tfDeB64(caja.data)
  );
  return new TextDecoder().decode(claro);
}

/* La clave maestra se genera una sola vez, cuando pones el token en el panel. */
const tfNuevaMaestra = () => tfB64(crypto.getRandomValues(new Uint8Array(32)));

/* Cerrar la clave maestra con una contrasena: esto es "darle acceso a alguien". */
async function tfHacerSobre(password, maestraB64) {
  const salt = tfB64(crypto.getRandomValues(new Uint8Array(16)));
  const clave = await tfClaveDe(password, salt);
  const caja = await tfCifrar(clave, maestraB64);
  return { salt, iterations: TF_ITERACIONES, ...caja };
}

/* Y abrirla. Devuelve "" si la contrasena no es la de ese sobre: AES-GCM avisa
   solo, porque el tag de autenticacion no cuadra. */
async function tfAbrirSobre(password, sobre) {
  if (!sobre || !sobre.data || !sobre.salt) return "";
  try {
    const clave = await tfClaveDe(password, sobre.salt, Number(sobre.iterations) || TF_ITERACIONES);
    return await tfDescifrar(clave, sobre);
  } catch {
    return "";
  }
}

/* El token del sitio, abierto con la clave maestra. */
async function tfAbrirToken(maestraB64, site) {
  const caja = (site || {}).token;
  if (!maestraB64 || !caja || !caja.data) return "";
  try {
    const clave = await crypto.subtle.importKey(
      "raw",
      tfDeB64(maestraB64),
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"]
    );
    return await tfDescifrar(clave, caja);
  } catch {
    return "";
  }
}

async function tfCerrarToken(maestraB64, token) {
  const clave = await crypto.subtle.importKey(
    "raw",
    tfDeB64(maestraB64),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
  return tfCifrar(clave, token);
}

/* ------------------------------------------------------------- las cuentas */
let TF_USERS_CACHE = null;

async function tfLeerUsuarios(forzar = false) {
  if (TF_USERS_CACHE && !forzar) return TF_USERS_CACHE;
  try {
    const r = await fetch(`${TF_USERS_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    TF_USERS_CACHE = {
      admin: d.admin || {},
      site: d.site || {},
      users: Array.isArray(d.users) ? d.users : [],
      updated: d.updated || "",
    };
  } catch {
    // Sin fichero (aun no hay cuentas) la web funciona igual, en modo compartido.
    TF_USERS_CACHE = { admin: {}, site: {}, users: [], updated: "" };
  }
  return TF_USERS_CACHE;
}

/* -------------------------------------------------------------- disparador
   Escribir en el repo (una cuenta nueva, un seguimiento) no lo puede hacer la
   web sola: llama a la API de GitHub con el token que vive SOLO en este
   navegador y un workflow aplica el cambio. Esta aqui, y no en los modulos de js/, porque
   el panel de administracion tambien lo necesita y dos copias se desincronizan.

   Dicho de otra forma: la contrasena del panel es la puerta de la casa, pero
   la cerradura de verdad es el token. Sin el no se escribe nada. */
const TF_REPO = "mateogsilvaa/tripfinder";
const TF_TOKEN_KEY = "tf_token"; // el que se pega a mano (solo tú, para el panel)
const TF_TOKEN_SESION = "tf_token_abierto"; // el que sale del sobre al entrar

/* Vive en sessionStorage y no en localStorage a proposito: al cerrar la pestana
   desaparece y hay que volver a entrar para sacarlo del sobre. En disco solo
   queda lo cifrado. */
const tfToken = () => {
  try {
    return sessionStorage.getItem(TF_TOKEN_SESION) || localStorage.getItem(TF_TOKEN_KEY) || "";
  } catch {
    return "";
  }
};

const tfGuardarTokenSesion = (token) => {
  try {
    if (token) sessionStorage.setItem(TF_TOKEN_SESION, token);
    else sessionStorage.removeItem(TF_TOKEN_SESION);
  } catch {
    /* navegacion privada: el token dura lo que dura la pagina */
  }
};

async function tfDispatch(evento, payload) {
  // Lanzar un scraper escribe en el repo y lo que escribe lleva tu nombre: sin
  // cuenta no hay a quien apuntarselo, asi que no se manda.
  if (!tfSesion() && !localStorage.getItem(TF_TOKEN_KEY)) {
    return { ok: false, reason: "sin-cuenta" };
  }
  const token = tfToken();
  if (!token) return { ok: false, reason: "sin-token" };
  const r = await fetch(`https://api.github.com/repos/${TF_REPO}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ event_type: evento, client_payload: payload }),
  });
  if (r.status === 204) return { ok: true };

  let detalle = "";
  try {
    detalle = (await r.json()).message || "";
  } catch {
    /* GitHub no siempre contesta con JSON */
  }
  if (r.status === 401) {
    try {
      localStorage.removeItem(TF_TOKEN_KEY);
    } catch {
      /* nada */
    }
    return { ok: false, reason: "token-invalido" };
  }
  if (r.status === 403 || r.status === 404) {
    // 404 aqui casi siempre es un token sin permiso sobre el repo, no un repo
    // inexistente: GitHub lo disfraza para no filtrar repos privados.
    if (typeof tfApuntar === "function") tfApuntar("token", `${evento}: ${r.status}`, detalle);
    return {
      ok: false,
      reason:
        `${r.status}: al token le falta permiso "Contents: Read and write" sobre ` +
        `${TF_REPO}, o no le has dado acceso a este repositorio. ${detalle}`,
    };
  }
  if (typeof tfApuntar === "function") tfApuntar("dispatch", `${evento}: ${r.status}`, detalle);
  return { ok: false, reason: `error ${r.status}. ${detalle}` };
}

/* Prueba el token contra un endpoint inofensivo y dice exactamente que pasa.
   Sin esto, un permiso mal puesto se manifiesta como "el boton no hace nada". */
async function tfProbarToken() {
  const token = tfToken();
  if (!token) return "No hay ningún token disponible.";
  try {
    const r = await fetch(`https://api.github.com/repos/${TF_REPO}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    if (r.status === 200) {
      const d = await tfDispatch("ping", { origen: "prueba" });
      return d.ok
        ? "Token correcto y con permiso para lanzar búsquedas. ✓"
        : `El token lee el repo, pero no puede lanzar búsquedas → ${d.reason}`;
    }
    if (r.status === 401) return "Token inválido o caducado (401). Crea uno nuevo.";
    if (r.status === 404)
      return (
        "404: el token no tiene acceso a este repositorio. Al crearlo hay que elegir " +
        `"Only select repositories" → ${TF_REPO}, no "Public repositories".`
      );
    return `GitHub responde ${r.status}.`;
  } catch (err) {
    return `No se pudo contactar con GitHub: ${err.message}`;
  }
}

/* ------------------------------------------------------------------ sesion */
function tfSesion() {
  try {
    const s = JSON.parse(localStorage.getItem(TF_SESION_KEY) || "null");
    return s && s.uid ? s : null;
  } catch {
    return null;
  }
}

const tfUid = () => (tfSesion() || {}).uid || "";
const tfNombre = () => (tfSesion() || {}).name || (tfSesion() || {}).user || "";

/* La clave con la que se guarda algo en ESTE navegador para ESTA cuenta.
   Sin sesion se usa la clave de siempre, que es lo que ya tenias guardado. */
function tfClave(base) {
  const uid = tfUid();
  return uid ? `${base}:${uid}` : base;
}

async function tfEntrar(usuario, password) {
  const datos = await tfLeerUsuarios(true);
  const login = String(usuario || "").trim().toLowerCase();
  const u = datos.users.find((x) => String(x.user || "").toLowerCase() === login);
  if (!u) return { ok: false, error: "No hay ninguna cuenta con ese usuario." };
  if (u.active === false) return { ok: false, error: "Esa cuenta está desactivada." };
  let vale = false;
  try {
    vale = await tfComprobar(password, u);
  } catch (err) {
    return { ok: false, error: err.message };
  }
  if (!vale) return { ok: false, error: "Contraseña incorrecta." };

  // La contrasena abre el sobre, el sobre da la clave maestra y esa abre el
  // token con el que la web escribe. Es lo unico que se hace con la contrasena
  // aparte de comprobarla, y pasa entero aqui dentro.
  // Por que no se puede escribir, cuando no se puede. Son tres averias
  // distintas y se arreglan en sitios distintos; decir "no se puede" a secas
  // manda a la gente a mirar donde no es (#15).
  let token = "";
  let porque = "";
  if (!u.sobre || !u.sobre.data) {
    porque =
      "Esta cuenta no tiene sobre: se creó antes de que se guardara el token del sitio. " +
      "Puedes mirar la web y guardar favoritos, pero no lanzar búsquedas ni seguir viajes. " +
      "Quien lleve el panel lo arregla con «Darle acceso».";
  } else if (u.sobre.stale) {
    porque =
      "El sobre de esta cuenta es de un token anterior y ya no abre nada. " +
      "Quien lleve el panel lo arregla con «Darle acceso».";
  } else {
    const maestra = await tfAbrirSobre(password, u.sobre);
    token = maestra ? await tfAbrirToken(maestra, datos.site) : "";
    if (!token) {
      porque =
        "La contraseña es correcta, pero el token del sitio no se ha podido abrir. " +
        "Suele ser que el token se cambió y todavía no se ha vuelto a repartir.";
    }
  }

  const sesion = {
    uid: u.id,
    user: u.user,
    name: u.name || u.user,
    prefs: u.prefs || {},
    desde: Date.now(),
  };
  try {
    localStorage.setItem(TF_SESION_KEY, JSON.stringify(sesion));
  } catch {
    return { ok: false, error: "Este navegador no deja guardar la sesión." };
  }
  tfGuardarTokenSesion(token);
  tfAdoptarAnonimos(u.id);
  // Entrar funciona igual sin token (ver la web, los favoritos); lo que no se
  // puede sin el es lanzar nada, y la web lo dice donde toca.
  return { ok: true, sesion, puedeEscribir: !!token, porque };
}

function tfSalir() {
  try {
    localStorage.removeItem(TF_SESION_KEY);
  } catch {
    /* nada que hacer */
  }
  tfGuardarTokenSesion("");
}

/* Si la web puede escribir ahora mismo: hay cuenta dentro y token abierto. */
const tfPuedeEscribir = () => !!tfToken() && (!!tfSesion() || !!localStorage.getItem(TF_TOKEN_KEY));

/* La primera vez que alguien entra en un navegador que ya tenia favoritos sin
   cuenta, se los queda. Si no, al crear la cuenta parecia que se habian
   borrado: seguian ahi, pero en el cajon de nadie. Solo la primera vez y solo
   si su cajon esta vacio: entrar dos personas distintas no se mezcla. */
function tfAdoptarAnonimos(uid) {
  // "tf_quiz": un test hecho sin cuenta se adopta al entrar, igual que los
  // favoritos. Sin esto habria que rehacerlo, y nadie rehace un test (#11).
  ["tf_favoritos", "tf_grupo", "tf_quiz"].forEach((base) => {
    try {
      const anonimo = localStorage.getItem(base);
      if (anonimo === null) return;
      const mio = `${base}:${uid}`;
      if (localStorage.getItem(mio) !== null) return;
      localStorage.setItem(mio, anonimo);
    } catch {
      /* navegacion privada */
    }
  });
}

/* ------------------------------------------------------------------- la UI
   El boton vive en la barra de arriba de las cuatro paginas, asi que se pinta
   desde aqui en vez de repetirlo en cuatro HTML que se desincronizan solos. */
function tfPintarBarra() {
  const barra = document.querySelector(".topbar");
  // El panel tiene su propia puerta: un "entrar" al lado solo confundiria.
  if (!barra || document.body.dataset.sinCuenta !== undefined) return;
  if (document.getElementById("tfCuenta")) return;
  const s = tfSesion();
  const boton = document.createElement("button");
  boton.id = "tfCuenta";
  boton.type = "button";
  boton.className = "cuenta" + (s ? " dentro" : "");
  boton.innerHTML = s
    ? `<b aria-hidden="true">${tfEsc((s.name || s.user || "?").slice(0, 1).toUpperCase())}</b>
       <span class="cuenta-txt">${tfEsc(s.name || s.user)}</span>`
    : `<b aria-hidden="true">○</b><span class="cuenta-txt">entrar</span>`;
  boton.title = s ? "Tu cuenta" : "Entrar con tu cuenta";
  boton.addEventListener("click", () => (tfSesion() ? tfAbrirCuenta() : tfAbrirLogin()));
  const tema = barra.querySelector("#tema");
  barra.insertBefore(boton, tema || null);
}

const tfEsc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

function tfModal(html) {
  let caja = document.getElementById("tfModal");
  if (!caja) {
    caja = document.createElement("div");
    caja.id = "tfModal";
    caja.className = "modal";
    document.body.appendChild(caja);
    caja.addEventListener("click", (e) => {
      if (e.target === caja) tfCerrarModal();
    });
  }
  caja.innerHTML = `<div class="modal-caja estrecha" role="dialog">${html}</div>`;
  caja.hidden = false;
  const cerrar = caja.querySelector("[data-cerrar]");
  if (cerrar) cerrar.addEventListener("click", tfCerrarModal);
  // El aria-modal, la trampa de foco, el Escape y devolver el foco a quien
  // abrio los pone tfAbrirDialogo (log.js), igual que en los otros tres
  // dialogos de la web.
  tfAbrirDialogo(caja, {
    dialogo: caja.querySelector(".modal-caja"),
    alCerrar: () => {
      caja.hidden = true;
      caja.innerHTML = "";
    },
  });
  return caja;
}

function tfCerrarModal() {
  const caja = document.getElementById("tfModal");
  if (caja) tfCerrarDialogo(caja);
}

/* Un campo de contraseña con el ojo para verla. En el móvil, escribir a ciegas
   una contraseña que te han pasado por WhatsApp es la mitad de los "no me deja
   entrar": si se puede mirar lo que se ha escrito, se acaba el misterio. */
function tfCampoClave(id, autocompletar = "current-password") {
  return `
    <div class="campo-clave">
      <input id="${id}" type="password" name="${id}" required
        autocomplete="${autocompletar}" autocapitalize="none" autocorrect="off"
        spellcheck="false" enterkeyhint="go">
      <button type="button" class="ver-clave" data-ver="${id}"
        aria-label="Ver la contraseña" aria-pressed="false">ver</button>
    </div>`;
}

function tfWireVerClave(raiz) {
  raiz.querySelectorAll("[data-ver]").forEach((b) =>
    b.addEventListener("click", () => {
      const campo = raiz.querySelector(`#${b.dataset.ver}`);
      const visible = campo.type === "text";
      campo.type = visible ? "password" : "text";
      b.textContent = visible ? "ver" : "ocultar";
      b.setAttribute("aria-pressed", String(!visible));
      campo.focus();
    })
  );
}

/* Mientras se comprueba, el botón se apaga y lo dice. El PBKDF2 son 210.000
   vueltas: en un móvil viejo tarda un segundo largo, y sin esto la reacción
   natural es volver a pulsar y acabar con dos intentos cruzados. */
function tfOcupado(boton, si, textoOcupado = "Comprobando…") {
  if (!boton) return;
  if (si) {
    boton.dataset.texto = boton.dataset.texto || boton.textContent;
    boton.textContent = textoOcupado;
    boton.disabled = true;
  } else {
    boton.textContent = boton.dataset.texto || boton.textContent;
    boton.disabled = false;
  }
}

async function tfAbrirLogin() {
  const datos = await tfLeerUsuarios(true);
  const hay = datos.users.some((u) => u.active !== false);
  const caja = tfModal(`
    <header class="modal-head">
      <h2>Entrar</h2>
      <button type="button" data-cerrar aria-label="Cerrar">cerrar</button>
    </header>
    <form id="tfLoginForm" class="modal-form">
      <p class="meta">
        Los chollos del día son los mismos para todos. Tus favoritos, tus seguimientos
        y tus búsquedas son tuyos: para verlos, entra.
      </p>
      <label for="tfLoginUser">Usuario</label>
      <input id="tfLoginUser" name="username" autocomplete="username" autocapitalize="none"
        autocorrect="off" spellcheck="false" enterkeyhint="next" required>
      <label for="tfLoginPass">Contraseña</label>
      ${tfCampoClave("tfLoginPass")}
      <p class="token-status" id="tfLoginMsg">${
        hay ? "" : "Todavía no hay ninguna cuenta creada. Pídesela a quien lleve la web."
      }</p>
      <button class="btn primary" type="submit">Entrar</button>
    </form>`);

  const form = caja.querySelector("#tfLoginForm");
  const msg = caja.querySelector("#tfLoginMsg");
  const boton = form.querySelector("button[type=submit]");
  tfWireVerClave(caja);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (boton.disabled) return;
    const usuario = caja.querySelector("#tfLoginUser").value;
    const clave = caja.querySelector("#tfLoginPass").value;
    if (!usuario.trim() || !clave) {
      msg.textContent = "Faltan el usuario o la contraseña.";
      return;
    }
    // Segunda pulsacion, ya sabiendo lo que hay: se entra sin repetir el aviso.
    if (boton.dataset.avisado === "1") {
      tfCerrarModal();
      location.reload();
      return;
    }
    msg.textContent = "Comprobando…";
    tfOcupado(boton, true);
    let r = await tfEntrar(usuario, clave);
    // Copiar y pegar del móvil se trae espacios de regalo, y una contraseña con
    // un espacio detrás no falla por culpa de quien la escribió. Se reintenta
    // sin ellos antes de decir que no; nunca al revés, para no romper a quien
    // los tenga a propósito.
    if (!r.ok && clave !== clave.trim()) r = await tfEntrar(usuario, clave.trim());
    tfOcupado(boton, false);
    if (!r.ok) {
      msg.textContent = r.error;
      return;
    }
    // Entrar ha funcionado, pero la cuenta puede no poder lanzar nada. Antes eso
    // se descubria pulsando un boton que no respondia; ahora se dice aqui, que
    // es cuando se puede hacer algo al respecto (#15).
    if (!r.puedeEscribir && r.porque) {
      msg.innerHTML = `<span class="ojo">${tfEsc(r.porque)}</span>`;
      boton.textContent = "Entendido, entrar";
      boton.dataset.avisado = "1";
      if (typeof tfAnunciar === "function") tfAnunciar(r.porque);
      // La sesión ya está guardada: cerrar el aviso con la X no puede dejar la
      // página con la cabecera de antes y la sesión abierta por detrás.
      caja.querySelectorAll("[data-cerrar]").forEach((b) =>
        b.addEventListener("click", () => location.reload())
      );
      return;
    }
    tfCerrarModal();
    location.reload(); // lo mas simple y lo mas fiable: todo se repinta ya suyo
  });
  // En el móvil, abrir el teclado nada más aparecer el modal tapa medio
  // formulario; el foco se pone solo cuando hay sitio para verlo.
  if (window.innerWidth > 620) caja.querySelector("#tfLoginUser").focus();
}

/* Las opciones de correo. Solo lo que el sistema puede cumplir de verdad: el
   scan de vuelos y el repaso diario de seguimientos son los dos unicos sitios
   desde los que sale un email, asi que son las dos unicas cosas que hay que
   decidir. Una lista de opciones que no se cumplen es peor que no tenerlas. */
const TF_FREQ_CHOLLOS = [
  ["cada_vez", "En cuanto aparezca"],
  ["diario", "Como mucho uno al día"],
  ["semanal", "Un resumen a la semana"],
  ["nunca", "Ninguno"],
];
const TF_FREQ_SEGUIMIENTOS = [
  ["diario", "El parte de cada día"],
  ["semanal", "Un resumen a la semana"],
  ["nunca", "Ninguno"],
];

const tfOpciones = (lista, elegido) =>
  lista
    .map(([v, t]) => `<option value="${v}"${v === elegido ? " selected" : ""}>${t}</option>`)
    .join("");

async function tfAbrirCuenta() {
  const s = tfSesion();
  if (!s) return tfAbrirLogin();
  // Del fichero, no de la sesion: si lo cambiaste desde otro sitio, manda lo
  // publicado, no lo que se guardo en este navegador el dia que entraste.
  const datos = await tfLeerUsuarios(true);
  const yo = datos.users.find((u) => u.id === s.uid) || {};
  const prefs = yo.prefs || {};
  const puede = tfPuedeEscribir();

  const caja = tfModal(`
    <header class="modal-head">
      <h2>${tfEsc(s.name || s.user)}</h2>
      <button type="button" data-cerrar aria-label="Cerrar">cerrar</button>
    </header>
    <form id="tfPrefsForm" class="modal-form">
      <p class="meta">
        Estás dentro como <strong>${tfEsc(s.user)}</strong>. Tus favoritos, tus
        seguimientos y tus búsquedas solo los ves tú.
        ${
          puede
            ? ""
            : `<br><span class="ojo">Esta cuenta no puede lanzar búsquedas todavía:
               pídele al administrador que te ponga una contraseña nueva desde el panel.</span>`
        }
      </p>

      <label for="tfEmail">Tus avisos van a</label>
      <input id="tfEmail" type="email" autocomplete="email"
        placeholder="${yo.tiene_email ? "el que ya tienes guardado" : "sin email: no recibes nada"}">
      <p class="meta">${
        yo.tiene_email
          ? "Ya tienes uno guardado. Déjalo en blanco para no cambiarlo, o escribe otro."
          : "Sin dirección no se te manda nada."
      }</p>

      <label for="tfChollos">Chollos del día</label>
      <select id="tfChollos">${tfOpciones(TF_FREQ_CHOLLOS, prefs.chollos || "cada_vez")}</select>

      <label for="tfTope">…y solo si bajan de (€, opcional)</label>
      <input id="tfTope" type="number" min="0" step="10" placeholder="sin tope"
        value="${prefs.chollos_max_precio ? Math.round(prefs.chollos_max_precio) : ""}">

      <label for="tfSeg">Parte de tus seguimientos</label>
      <select id="tfSeg">${tfOpciones(TF_FREQ_SEGUIMIENTOS, prefs.seguimientos || "diario")}</select>

      <label class="switch suelto">
        <input type="checkbox" id="tfSoloNov"${prefs.seguimientos_solo_novedades ? " checked" : ""}>
        <span>Solo cuando haya algo nuevo que contar</span>
      </label>

      <p class="token-status" id="tfPrefsMsg"></p>
      <button class="btn primary" type="submit">Guardar</button>
      <button class="btn ghost" type="button" id="tfSalir">Salir de la cuenta</button>
    </form>`);

  caja.querySelector("#tfSalir").addEventListener("click", () => {
    tfSalir();
    tfCerrarModal();
    location.reload();
  });

  const guardar = caja.querySelector("#tfPrefsForm button[type=submit]");
  caja.querySelector("#tfPrefsForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (guardar.disabled) return;
    const msg = caja.querySelector("#tfPrefsMsg");
    const tope = Number(caja.querySelector("#tfTope").value);
    msg.textContent = "Guardando…";
    tfOcupado(guardar, true, "Guardando…");
    const r = await tfDispatch("user_prefs", {
      user: s.user,
      email: caja.querySelector("#tfEmail").value.trim(),
      prefs: {
        chollos: caja.querySelector("#tfChollos").value,
        chollos_max_precio: tope > 0 ? tope : null,
        seguimientos: caja.querySelector("#tfSeg").value,
        seguimientos_solo_novedades: caja.querySelector("#tfSoloNov").checked,
      },
    });
    tfOcupado(guardar, false);
    msg.textContent = r.ok
      ? "Guardado. Tarda un par de minutos en publicarse."
      : tfExplicarFallo(r);
  });
}

/* El mismo mensaje en todos los sitios donde algo no se puede lanzar. */
function tfExplicarFallo(r) {
  if (r.reason === "sin-cuenta") return "Para esto hay que entrar con una cuenta.";
  if (r.reason === "sin-token" || r.reason === "token-invalido") {
    return "Esta cuenta no tiene acceso para escribir: pídele al administrador una contraseña nueva.";
  }
  return "No se pudo: " + r.reason;
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", tfPintarBarra);
} else {
  tfPintarBarra();
}
