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
      users: Array.isArray(d.users) ? d.users : [],
      updated: d.updated || "",
    };
  } catch {
    // Sin fichero (aun no hay cuentas) la web funciona igual, en modo compartido.
    TF_USERS_CACHE = { admin: {}, users: [], updated: "" };
  }
  return TF_USERS_CACHE;
}

/* -------------------------------------------------------------- disparador
   Escribir en el repo (una cuenta nueva, un seguimiento) no lo puede hacer la
   web sola: llama a la API de GitHub con el token que vive SOLO en este
   navegador y un workflow aplica el cambio. Esta aqui, y no en app.js, porque
   el panel de administracion tambien lo necesita y dos copias se desincronizan.

   Dicho de otra forma: la contrasena del panel es la puerta de la casa, pero
   la cerradura de verdad es el token. Sin el no se escribe nada. */
const TF_REPO = "mateogsilvaa/tripfinder";
const TF_TOKEN_KEY = "tf_token";
const tfToken = () => {
  try {
    return localStorage.getItem(TF_TOKEN_KEY) || "";
  } catch {
    return "";
  }
};

async function tfDispatch(evento, payload) {
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

  const sesion = { uid: u.id, user: u.user, name: u.name || u.user, desde: Date.now() };
  try {
    localStorage.setItem(TF_SESION_KEY, JSON.stringify(sesion));
  } catch {
    return { ok: false, error: "Este navegador no deja guardar la sesión." };
  }
  tfAdoptarAnonimos(u.id);
  return { ok: true, sesion };
}

function tfSalir() {
  try {
    localStorage.removeItem(TF_SESION_KEY);
  } catch {
    /* nada que hacer */
  }
}

/* La primera vez que alguien entra en un navegador que ya tenia favoritos sin
   cuenta, se los queda. Si no, al crear la cuenta parecia que se habian
   borrado: seguian ahi, pero en el cajon de nadie. Solo la primera vez y solo
   si su cajon esta vacio: entrar dos personas distintas no se mezcla. */
function tfAdoptarAnonimos(uid) {
  ["tf_favoritos", "tf_grupo"].forEach((base) => {
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
  caja.innerHTML = `<div class="modal-caja estrecha" role="dialog" aria-modal="true">${html}</div>`;
  caja.hidden = false;
  const cerrar = caja.querySelector("[data-cerrar]");
  if (cerrar) cerrar.addEventListener("click", tfCerrarModal);
  return caja;
}

function tfCerrarModal() {
  const caja = document.getElementById("tfModal");
  if (caja) {
    caja.hidden = true;
    caja.innerHTML = "";
  }
}

document.addEventListener("keydown", (e) => {
  const caja = document.getElementById("tfModal");
  if (e.key === "Escape" && caja && !caja.hidden) tfCerrarModal();
});

async function tfAbrirLogin() {
  const datos = await tfLeerUsuarios(true);
  const hay = datos.users.some((u) => u.active !== false);
  const caja = tfModal(`
    <header class="modal-head">
      <h2>Entrar</h2>
      <button data-cerrar aria-label="Cerrar">✕</button>
    </header>
    <form id="tfLoginForm" class="modal-form">
      <p class="meta">
        Los chollos del día son los mismos para todos. Tus favoritos, tus seguimientos
        y tus búsquedas son tuyos: para verlos, entra.
      </p>
      <label for="tfLoginUser">Usuario</label>
      <input id="tfLoginUser" autocomplete="username" autocapitalize="none" required>
      <label for="tfLoginPass">Contraseña</label>
      <input id="tfLoginPass" type="password" autocomplete="current-password" required>
      <p class="token-status" id="tfLoginMsg">${
        hay ? "" : "Todavía no hay ninguna cuenta creada. Se crean desde el panel de administración."
      }</p>
      <button class="btn primary" type="submit">Entrar</button>
    </form>`);

  const form = caja.querySelector("#tfLoginForm");
  const msg = caja.querySelector("#tfLoginMsg");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.textContent = "Comprobando…";
    const r = await tfEntrar(
      caja.querySelector("#tfLoginUser").value,
      caja.querySelector("#tfLoginPass").value
    );
    if (!r.ok) {
      msg.textContent = r.error;
      return;
    }
    tfCerrarModal();
    location.reload(); // lo mas simple y lo mas fiable: todo se repinta ya suyo
  });
  caja.querySelector("#tfLoginUser").focus();
}

function tfAbrirCuenta() {
  const s = tfSesion();
  if (!s) return tfAbrirLogin();
  const caja = tfModal(`
    <header class="modal-head">
      <h2>${tfEsc(s.name || s.user)}</h2>
      <button data-cerrar aria-label="Cerrar">✕</button>
    </header>
    <div class="modal-form">
      <p class="meta">
        Estás dentro como <strong>${tfEsc(s.user)}</strong>. Tus favoritos, tus
        seguimientos y tus búsquedas solo los ves tú en esta web.
      </p>
      <button class="btn ghost" id="tfSalir">Salir de la cuenta</button>
    </div>`);
  caja.querySelector("#tfSalir").addEventListener("click", () => {
    tfSalir();
    tfCerrarModal();
    location.reload();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", tfPintarBarra);
} else {
  tfPintarBarra();
}
