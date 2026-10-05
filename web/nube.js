/* nube.js — Firebase sin SDK: entrar, registrarse y hablar con Firestore.

   El repositorio es público y la web es estática, así que no hay dónde guardar
   una cuenta, un correo ni lo que busca cada cual sin que lo lea cualquiera.
   Firebase pone ese sitio: Authentication para entrar y Firestore para guardar,
   con reglas (`firestore.rules`) que dejan a cada persona ver solo lo suyo.

   NO SE USA EL SDK. Pesa cientos de kilobytes en cada página, pide un bundler
   o un CDN, y esta web no tiene ni lo uno ni lo otro. Firebase habla REST, y lo
   que hace falta cabe aquí: tres llamadas de Authentication y cuatro de
   Firestore. Lo único que se pierde son las suscripciones en vivo, y la web ya
   consulta por turnos.

   LA CLAVE DE LA API NO ES UN SECRETO. Va en el HTML, a la vista de todos, y
   está pensado así: solo identifica el proyecto. Lo que protege los datos son
   las reglas de Firestore, que se prueban en CI contra el emulador. Aun así
   conviene restringirla por dominio en la consola de Google Cloud.

   SIN CONFIGURACIÓN NO HAY FIREBASE. Mientras `NUBE_CONFIG` esté vacía, todo
   esto se queda quieto y la web sigue funcionando con las cuentas de
   `data/users.json`. Las pruebas la rellenan con `window.TF_NUBE` antes de
   cargar, apuntando al emulador. */

/* Aquí se pega la configuración de la app web de Firebase (consola → ajustes
   del proyecto → tus apps → configuración del SDK). Solo hacen falta estos dos
   campos. */
const NUBE_CONFIG = {
  apiKey: "AIzaSyAisQaTaTO0Kn7lBQmJ7YgekpDIGoyz1gA",
  projectId: "trip-a9418",
};

const NUBE_CLAVE = "tf_nube"; // los tokens: refresh, id, cuándo caduca, de quién
const NUBE_MIN_CLAVE = 8;
const NUBE_ERRORES_DE_SESION = [
  "TOKEN_EXPIRED",
  "USER_DISABLED",
  "USER_NOT_FOUND",
  "INVALID_REFRESH_TOKEN",
  "MISSING_REFRESH_TOKEN",
];

function nubeConfig() {
  const c = window.TF_NUBE || NUBE_CONFIG;
  return c && c.apiKey && c.projectId ? c : null;
}

const nubeActiva = () => !!nubeConfig();

/* Dónde está cada servicio. El emulador los sirve todos desde dos puertos, con
   las mismas rutas que producción colgadas detrás. */
function nubeRutas() {
  const e = (nubeConfig() || {}).emulador;
  if (e) {
    return {
      auth: `${e.auth}/identitytoolkit.googleapis.com`,
      token: `${e.auth}/securetoken.googleapis.com`,
      fs: e.firestore,
    };
  }
  return {
    auth: "https://identitytoolkit.googleapis.com",
    token: "https://securetoken.googleapis.com",
    fs: "https://firestore.googleapis.com",
  };
}

/* ----------------------------------------------------------------- errores */
const NUBE_TEXTOS = {
  EMAIL_EXISTS: "Ya hay una cuenta con ese correo. Entra, o pide una contraseña nueva.",
  INVALID_LOGIN_CREDENTIALS: "Correo o contraseña incorrectos.",
  INVALID_PASSWORD: "Correo o contraseña incorrectos.",
  EMAIL_NOT_FOUND: "Correo o contraseña incorrectos.",
  INVALID_EMAIL: "Ese correo no parece un correo.",
  MISSING_EMAIL: "Falta el correo.",
  WEAK_PASSWORD: `La contraseña, de ${NUBE_MIN_CLAVE} caracteres o más.`,
  TOO_MANY_ATTEMPTS_TRY_LATER: "Demasiados intentos seguidos. Espera un rato y vuelve a probar.",
  USER_DISABLED: "Esta cuenta está desactivada.",
  OPERATION_NOT_ALLOWED: "El acceso con correo y contraseña no está activado en Firebase.",
  API_KEY_INVALID: "La clave de Firebase de esta web no es válida.",
  CREDENTIAL_TOO_OLD_LOGIN_AGAIN: "Por seguridad, vuelve a entrar y repítelo.",
  PERMISSION_DENIED: "Esta cuenta no tiene permiso para eso.",
  red: "No hay conexión con la base de datos.",
  sesion: "Este navegador no deja guardar la sesión.",
};

function nubeError(codigo, estado = 0, detalle = "") {
  const e = new Error(NUBE_TEXTOS[codigo] || `No se pudo (${codigo}).`);
  e.codigo = codigo;
  e.estado = estado;
  e.detalle = detalle;
  return e;
}

/* Authentication contesta `{error: {message: "WEAK_PASSWORD : …"}}` y Firestore
   `{error: {status: "PERMISSION_DENIED", message: "…"}}`. */
function nubeCodigo(datos, estado) {
  const e = (datos && datos.error) || {};
  const crudo = String(e.message || "");
  if (/API key not valid/i.test(crudo)) return "API_KEY_INVALID";
  const msg = crudo.split(" : ")[0].trim();
  if (/^[A-Z][A-Z_]+$/.test(msg)) return msg;
  return e.status || `HTTP_${estado}`;
}

async function nubeLlamar(url, { metodo = "POST", cuerpo, form, token } = {}) {
  const cabeceras = {};
  let body;
  if (form) {
    cabeceras["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(form).toString();
  } else if (cuerpo !== undefined) {
    cabeceras["Content-Type"] = "application/json";
    body = JSON.stringify(cuerpo);
  }
  if (token) cabeceras.Authorization = `Bearer ${token}`;
  const opciones = { method: metodo, headers: cabeceras };
  if (body !== undefined) opciones.body = body;
  let r;
  try {
    r = await fetch(url, opciones);
  } catch {
    throw nubeError("red");
  }
  let datos = null;
  try {
    datos = await r.json();
  } catch {
    /* un 204 o una respuesta que no es JSON */
  }
  if (!r.ok) throw nubeError(nubeCodigo(datos, r.status), r.status, (datos && datos.error && datos.error.message) || "");
  return datos;
}

/* --------------------------------------------------------- valores Firestore
   La REST de Firestore no habla JSON normal: cada valor lleva su tipo. */
function nubeCodificar(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === "string") return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(nubeCodificar) } };
  return { mapValue: { fields: nubeCampos(v) } };
}

function nubeCampos(objeto) {
  const campos = {};
  Object.entries(objeto || {}).forEach(([k, v]) => {
    if (v !== undefined) campos[k] = nubeCodificar(v);
  });
  return campos;
}

function nubeDecodificar(v) {
  if (!v || "nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("stringValue" in v) return v.stringValue;
  if ("timestampValue" in v) return new Date(v.timestampValue);
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(nubeDecodificar);
  if ("mapValue" in v) return nubeObjeto(v.mapValue.fields);
  return null;
}

function nubeObjeto(campos) {
  const o = {};
  Object.entries(campos || {}).forEach(([k, v]) => (o[k] = nubeDecodificar(v)));
  return o;
}

const nubeDeDocumento = (d) => ({ id: String(d.name || "").split("/").pop(), ...nubeObjeto(d.fields) });

/* ----------------------------------------------------------------- Firestore */
const nubeBase = () => `projects/${nubeConfig().projectId}/databases/(default)/documents`;
const nubeUrlFs = (ruta) => `${nubeRutas().fs}/v1/${nubeBase()}${ruta}`;

async function nubeLeerDoc(token, ruta) {
  try {
    return nubeDeDocumento(await nubeLlamar(nubeUrlFs(`/${ruta}`), { metodo: "GET", token }));
  } catch (e) {
    if (e.estado === 404 || e.codigo === "NOT_FOUND") return null;
    throw e;
  }
}

/* Escribir va siempre por `:commit`, porque es lo único que sabe poner la hora
   del servidor (`REQUEST_TIME`), y las reglas piden `creado == request.time`. */
const nubeCommit = (token, escrituras) =>
  nubeLlamar(`${nubeRutas().fs}/v1/${nubeBase()}:commit`, { cuerpo: { writes: escrituras }, token });

const nubeNuevoId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(15)), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

function nubeCrear(ruta, campos) {
  return {
    update: { name: `${nubeBase()}/${ruta}`, fields: nubeCampos(campos) },
    updateTransforms: [{ fieldPath: "creado", setToServerValue: "REQUEST_TIME" }],
    currentDocument: { exists: false },
  };
}

function nubeCambiar(ruta, campos) {
  return {
    update: { name: `${nubeBase()}/${ruta}`, fields: nubeCampos(campos) },
    updateMask: { fieldPaths: Object.keys(campos) },
    currentDocument: { exists: true },
  };
}

async function nubeConsultar(token, consulta) {
  const filas = await nubeLlamar(`${nubeRutas().fs}/v1/${nubeBase()}:runQuery`, {
    cuerpo: { structuredQuery: consulta },
    token,
  });
  return (filas || []).filter((f) => f.document).map((f) => nubeDeDocumento(f.document));
}

/* --------------------------------------------------------------- los tokens
   Se guardan en localStorage, igual que hace el SDK. El de refresco vale meses;
   el de acceso, una hora, y se renueva solo cuando quedan menos de sesenta
   segundos. */
function nubeTokens() {
  try {
    const t = JSON.parse(localStorage.getItem(NUBE_CLAVE) || "null");
    return t && t.refresh ? t : null;
  } catch {
    return null;
  }
}

function nubeGuardarTokens(t) {
  try {
    localStorage.setItem(NUBE_CLAVE, JSON.stringify(t));
  } catch {
    /* navegación privada: la sesión dura lo que dure la página */
  }
}

/* Una respuesta de Authentication (`idToken`) o del refresco (`id_token`). */
function nubeDeRespuesta(r, previo = {}) {
  const segundos = Number(r.expiresIn || r.expires_in) || 3600;
  return {
    ...previo,
    uid: r.localId || r.user_id || previo.uid,
    refresh: r.refreshToken || r.refresh_token || previo.refresh,
    id: r.idToken || r.id_token,
    expira: Date.now() + segundos * 1000,
    correo: r.email || previo.correo,
  };
}

let NUBE_REFRESCO = null;

async function nubeRefrescar(t) {
  const c = nubeConfig();
  try {
    const r = await nubeLlamar(`${nubeRutas().token}/v1/token?key=${encodeURIComponent(c.apiKey)}`, {
      form: { grant_type: "refresh_token", refresh_token: t.refresh },
    });
    const nuevo = nubeDeRespuesta(r, t);
    nubeGuardarTokens(nuevo);
    return nuevo.id;
  } catch (e) {
    // Una cuenta borrada o desactivada, o un refresco revocado, no vuelven: se
    // sale. Un corte de red sí, y no es motivo para tirar la sesión.
    if (NUBE_ERRORES_DE_SESION.includes(e.codigo)) nubeSalir();
    return "";
  }
}

async function nubeToken() {
  const t = nubeTokens();
  if (!t) return "";
  if (t.id && t.expira - Date.now() > 60_000) return t.id;
  if (!NUBE_REFRESCO) {
    NUBE_REFRESCO = nubeRefrescar(t).finally(() => {
      NUBE_REFRESCO = null;
    });
  }
  return NUBE_REFRESCO;
}

/* ------------------------------------------------------------------- sesión
   `tf_sesion` es lo que lee el resto de la web, y tiene la misma forma de
   siempre: quién eres y cómo te llamas. Lo único nuevo es `estado`. */
function nubeGuardarSesion(uid, ficha) {
  const nombre = ficha.nombre || "";
  const sesion = {
    uid,
    user: nombre,
    name: nombre,
    prefs: ficha.prefs || {},
    estado: ficha.estado || "pendiente",
    admin: ficha.admin === true,
    // A qué cuenta de antes de Firebase se vinculó, si lo hizo. Lo que hizo con
    // aquella —seguimientos, búsquedas— lleva su id como dueño, y con esto sigue
    // siendo suyo.
    legado: ficha.legado || "",
    // Lo dice Firebase, no esta web (ver `nubeVerificacion`).
    verificado: ficha.verificado === true,
    nube: true,
    desde: Date.now(),
  };
  try {
    localStorage.setItem(TF_SESION_KEY, JSON.stringify(sesion));
  } catch {
    throw nubeError("sesion");
  }
  return sesion;
}

function nubeSalir() {
  try {
    localStorage.removeItem(NUBE_CLAVE);
    const s = JSON.parse(localStorage.getItem(TF_SESION_KEY) || "null");
    if (s && s.nube) localStorage.removeItem(TF_SESION_KEY);
  } catch {
    /* nada que hacer */
  }
}

/* Lo único que solo vive en este navegador —favoritos, el grupo de viaje, el
   test— está guardado con el uid de la cuenta de antes. Al entrar por primera
   vez con Firebase se copia al uid nuevo, si ahí no hay nada: sin esto
   parecería que se han borrado, y siguen donde estaban, en un cajón al que ya
   nadie llega. Solo copia: lo de antes se queda. */
function nubeAdoptar(uidNuevo, ids) {
  try {
    [...new Set(ids)]
      .filter((id) => id && id !== uidNuevo)
      .forEach((viejo) =>
        ["tf_favoritos", "tf_grupo", "tf_quiz"].forEach((base) => {
          const antes = localStorage.getItem(`${base}:${viejo}`);
          if (antes === null || localStorage.getItem(`${base}:${uidNuevo}`) !== null) return;
          localStorage.setItem(`${base}:${uidNuevo}`, antes);
        })
      );
  } catch {
    /* navegación privada */
  }
}

/* El id de la sesión de las cuentas de antes que hubiera en ESTE navegador. */
function nubeIdDeLaSesionVieja() {
  try {
    const vieja = JSON.parse(localStorage.getItem(TF_SESION_KEY) || "null");
    return vieja && vieja.uid && !vieja.nube ? vieja.uid : "";
  } catch {
    return "";
  }
}

function nubeAdoptarDeLasCuentasViejas(uidNuevo) {
  nubeAdoptar(uidNuevo, [nubeIdDeLaSesionVieja()]);
}

/* Registrarse y entrar acaban igual: ya hay tokens, falta la ficha. La ficha
   puede no existir si el registro se cortó entre crear la cuenta y apuntarla
   (se pierde la red, se cierra la pestaña), así que entrar la rehace. */
async function nubeFichaDe(t, nombreSiFalta) {
  let ficha = await nubeLeerDoc(t.id, `usuarios/${t.uid}`);
  if (!ficha) {
    const nombre = (nombreSiFalta || (t.correo || "").split("@")[0] || "cuenta").slice(0, 40);
    try {
      await nubeCommit(t.id, [
        nubeCrear(`usuarios/${t.uid}`, { nombre, correo: t.correo, estado: "pendiente" }),
      ]);
    } catch (e) {
      // Si ya existía (otra pestaña acaba de crearla), se lee y listo.
      if (e.codigo !== "ALREADY_EXISTS") throw e;
    }
    ficha = await nubeLeerDoc(t.id, `usuarios/${t.uid}`);
  }
  return ficha || { nombre: nombreSiFalta, estado: "pendiente" };
}

async function nubeAuth(operacion, cuerpo) {
  const c = nubeConfig();
  return nubeLlamar(`${nubeRutas().auth}/v1/accounts:${operacion}?key=${encodeURIComponent(c.apiKey)}`, {
    cuerpo,
  });
}

function nubeValidarCorreo(correo) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo);
}

/* ------------------------------------------------- verificar que el correo es suyo
   Firebase deja registrarse con cualquier dirección sin comprobar que sea de
   quien la escribe. Para recuperar una cuenta de antes eso no vale: si bastara
   con escribir el correo de otro, cualquiera se quedaría con sus seguimientos.
   Por eso se vincula solo a quien ha pinchado el enlace que Firebase manda a esa
   dirección. */
const nubeEnviarVerificacion = (idToken) => nubeAuth("sendOobCode", { requestType: "VERIFY_EMAIL", idToken });

async function nubeReenviarVerificacion() {
  const token = await nubeToken();
  if (!token) return { ok: false, error: "Entra primero." };
  try {
    await nubeEnviarVerificacion(token);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* Lo que dice el token que firma Firebase. Es lo mismo que comprueban las
   reglas al guardar `verificado`: no se puede escribir una cosa distinta. */
function nubeClaimVerificado(idToken) {
  try {
    const carga = idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(carga)).email_verified === true;
  } catch {
    return false;
  }
}

/* Pone la ficha al día con lo que dice Firebase. El token tarda hasta una hora
   en enterarse de que has pinchado el enlace, así que si Firebase ya lo sabe y el
   token todavía no, se renueva el token. Devuelve si está verificado. */
async function nubeVerificacion(ficha) {
  let t = nubeTokens();
  if (!t) return false;
  let verificado = nubeClaimVerificado(t.id);
  if (!verificado) {
    try {
      const r = await nubeAuth("lookup", { idToken: t.id });
      if (r && r.users && r.users[0] && r.users[0].emailVerified) {
        await nubeRefrescar(t);
        t = nubeTokens() || t;
        verificado = nubeClaimVerificado(t.id);
      }
    } catch {
      /* sin red: se queda como estaba */
    }
  }
  if ((ficha.verificado === true) !== verificado) {
    try {
      await nubeCommit(t.id, [nubeCambiar(`usuarios/${t.uid}`, { verificado })]);
    } catch {
      return ficha.verificado === true;
    }
  }
  return verificado;
}

async function nubeRegistrar(correo, clave, nombre) {
  correo = String(correo || "").trim().toLowerCase();
  nombre = String(nombre || "").trim();
  if (!nombre) return { ok: false, error: "Falta tu nombre: es como te va a llamar la web." };
  if (nombre.length > 40) return { ok: false, error: "El nombre, de 40 caracteres como mucho." };
  if (!nubeValidarCorreo(correo)) return { ok: false, error: NUBE_TEXTOS.INVALID_EMAIL };
  if (String(clave || "").length < NUBE_MIN_CLAVE) return { ok: false, error: NUBE_TEXTOS.WEAK_PASSWORD };
  try {
    const r = await nubeAuth("signUp", { email: correo, password: clave, returnSecureToken: true });
    const t = nubeDeRespuesta(r);
    nubeGuardarTokens(t);
    // El enlace para verificar el correo. Si falla no pasa nada: se puede pedir
    // otro desde «tu cuenta».
    await nubeEnviarVerificacion(t.id).catch(() => {});
    const ficha = await nubeFichaDe(t, nombre);
    nubeAdoptarDeLasCuentasViejas(t.uid);
    const sesion = nubeGuardarSesion(t.uid, ficha);
    if (typeof tfAdoptarAnonimos === "function") tfAdoptarAnonimos(t.uid);
    return { ok: true, sesion };
  } catch (e) {
    return { ok: false, error: e.message, codigo: e.codigo };
  }
}

async function nubeEntrar(correo, clave) {
  correo = String(correo || "").trim().toLowerCase();
  if (!correo || !clave) return { ok: false, error: "Faltan el correo o la contraseña." };
  try {
    const r = await nubeAuth("signInWithPassword", { email: correo, password: clave, returnSecureToken: true });
    const t = nubeDeRespuesta(r);
    nubeGuardarTokens(t);
    const ficha = await nubeFichaDe(t, "");
    if (ficha.estado === "bloqueado") {
      nubeSalir();
      return { ok: false, error: "Esta cuenta está bloqueada.", codigo: "bloqueada" };
    }
    nubeAdoptarDeLasCuentasViejas(t.uid);
    const sesion = nubeGuardarSesion(t.uid, ficha);
    if (typeof tfAdoptarAnonimos === "function") tfAdoptarAnonimos(t.uid);
    return { ok: true, sesion };
  } catch (e) {
    return { ok: false, error: e.message, codigo: e.codigo };
  }
}

async function nubeOlvide(correo) {
  correo = String(correo || "").trim().toLowerCase();
  if (!nubeValidarCorreo(correo)) return { ok: false, error: NUBE_TEXTOS.INVALID_EMAIL };
  try {
    await nubeAuth("sendOobCode", { requestType: "PASSWORD_RESET", email: correo });
    return { ok: true };
  } catch (e) {
    // Firebase dice EMAIL_NOT_FOUND si no hay cuenta. Se da por hecho igual: no
    // hace falta enseñar qué correos tienen cuenta a quien se lo pregunte.
    if (e.codigo === "EMAIL_NOT_FOUND") return { ok: true };
    return { ok: false, error: e.message };
  }
}

/* Cambiar la contraseña pide haber entrado hace poco, así que se vuelve a
   entrar con la de ahora —que de paso comprueba que es esa— y con ese token
   fresco se cambia. */
async function nubeCambiarClave(vieja, nueva) {
  const t = nubeTokens();
  if (!t || !t.correo) return { ok: false, error: "Entra primero." };
  if (String(nueva || "").length < NUBE_MIN_CLAVE) return { ok: false, error: NUBE_TEXTOS.WEAK_PASSWORD };
  try {
    const dentro = await nubeAuth("signInWithPassword", {
      email: t.correo,
      password: vieja,
      returnSecureToken: true,
    });
    const r = await nubeAuth("update", { idToken: dentro.idToken, password: nueva, returnSecureToken: true });
    nubeGuardarTokens(nubeDeRespuesta(r, t));
    return { ok: true };
  } catch (e) {
    if (["INVALID_LOGIN_CREDENTIALS", "INVALID_PASSWORD"].includes(e.codigo)) {
      return { ok: false, error: "La de ahora no es esa." };
    }
    return { ok: false, error: e.message };
  }
}

/* La ficha de este momento: si te han aprobado o bloqueado desde el panel, aquí
   se entera la web. Sin sesión, o sin red, no hace nada. */
async function nubeSincronizar() {
  const s = tfSesion();
  if (!s || !s.nube) return s;
  const token = await nubeToken();
  if (!token) return tfSesion();
  try {
    const ficha = await nubeFichaDe(nubeTokens(), s.name);
    ficha.verificado = await nubeVerificacion(ficha);
    // Lo que solo vive en este navegador y era de la cuenta de antes.
    if (ficha.legado) nubeAdoptar(s.uid, [ficha.legado]);
    return nubeGuardarSesion(s.uid, ficha);
  } catch {
    return s;
  }
}

/* ------------------------------------------------------------------ encargos
   Lo que antes era un `repository_dispatch` con un token escondido: se apunta
   en Firestore, y `encargos.yml` lo recoge y levanta el workflow. Quien manda el
   encargo no decide de quién es: el dueño y el nombre los pone el servidor
   desde la ficha de la cuenta. */
async function nubeEncargar(tipo, payload) {
  let s = tfSesion();
  if (!s || !s.uid) return { ok: false, reason: "sin-cuenta" };
  if (s.estado !== "aprobado") {
    // Quizá te acaban de aprobar: se mira antes de decir que no.
    s = (await nubeSincronizar()) || s;
    if (s.estado !== "aprobado") return { ok: false, reason: s.estado === "bloqueado" ? "bloqueada" : "pendiente" };
  }
  const token = await nubeToken();
  if (!token) return { ok: false, reason: "sin-cuenta" };
  const id = nubeNuevoId();
  try {
    await nubeCommit(token, [nubeCrear(`encargos/${id}`, { tipo, owner: s.uid, payload, estado: "pendiente" })]);
    return { ok: true, id };
  } catch (e) {
    if (e.codigo === "PERMISSION_DENIED") {
      // La sesión guardada decía «aprobada» y la base de datos dice que no: te
      // han bloqueado, o devuelto a pendiente, desde que entraste. Se mira qué.
      const ahora = (await nubeSincronizar()) || s;
      if (ahora.estado === "bloqueado") return { ok: false, reason: "bloqueada" };
      if (ahora.estado !== "aprobado") return { ok: false, reason: "pendiente" };
    }
    if (typeof tfApuntar === "function") tfApuntar("encargo", `${tipo}: ${e.codigo}`, e.detalle);
    return { ok: false, reason: e.message };
  }
}

/* Tus encargos recientes y cómo van (pendiente, enviado, error…). */
async function nubeMisEncargos() {
  const s = tfSesion();
  const token = await nubeToken();
  if (!s || !token) return [];
  return nubeConsultar(token, {
    from: [{ collectionId: "encargos" }],
    where: { fieldFilter: { field: { fieldPath: "owner" }, op: "EQUAL", value: { stringValue: s.uid } } },
    limit: 50,
  });
}

/* ----------------------------------------------------------------- las cuentas */
async function nubeGuardarPerfil(nombre, prefs) {
  const s = tfSesion();
  const token = await nubeToken();
  if (!s || !token) return { ok: false, error: "Entra primero." };
  nombre = String(nombre || "").trim() || s.name;
  try {
    await nubeCommit(token, [nubeCambiar(`usuarios/${s.uid}`, { nombre, prefs: prefs || {} })]);
    nubeGuardarSesion(s.uid, { ...s, nombre, prefs: prefs || {} });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* Solo el administrador: todas las fichas, y cambiar el estado de una. */
async function nubeCuentas() {
  const token = await nubeToken();
  if (!token) return [];
  const r = await nubeLlamar(nubeUrlFs("/usuarios?pageSize=300"), { metodo: "GET", token });
  return (r.documents || []).map(nubeDeDocumento);
}

/* Las cuentas de antes de Firebase (copiadas con `tripfinder migrar-cuentas`). */
async function nubeCuentasAntiguas() {
  const token = await nubeToken();
  if (!token) return [];
  const r = await nubeLlamar(nubeUrlFs("/cuentas_antiguas?pageSize=300"), { metodo: "GET", token });
  return (r.documents || []).map(nubeDeDocumento);
}

/* Aprueba la cuenta y la vincula con una de antes, de una vez: hereda sus avisos
   (se le copian sus preferencias), sus seguimientos y sus búsquedas. Son dos
   escrituras en la misma operación; las reglas comprueban que el correo está
   verificado y que la cuenta antigua no estaba ya vinculada. */
async function nubeVincular(uid, legado, prefs) {
  const token = await nubeToken();
  if (!token) return { ok: false, error: "Entra primero." };
  try {
    await nubeCommit(token, [
      nubeCambiar(`usuarios/${uid}`, { estado: "aprobado", legado, prefs: prefs || {} }),
      nubeCambiar(`cuentas_antiguas/${legado}`, { vinculada: uid }),
    ]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function nubeCambiarEstado(uid, estado) {
  const token = await nubeToken();
  if (!token) return { ok: false, error: "Entra primero." };
  try {
    await nubeCommit(token, [nubeCambiar(`usuarios/${uid}`, { estado })]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* Al cargar cada página con sesión de Firebase se mira la ficha, sin esperar: si
   te han aprobado, la próxima acción ya lo sabe. */
if (nubeActiva()) {
  const s = tfSesion();
  if (s && s.nube) setTimeout(nubeSincronizar, 800);
}
