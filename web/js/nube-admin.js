/* nube-admin.js — El panel cuando hay Firebase: quién hay y quién es premium.

   La web es abierta: quien se registra entra gratis y ve los chollos. Desde
   aquí se le da premium —todas las herramientas— o se le quita, y se bloquea a
   quien sobre. Las cuentas de antes de abrir la web no tienen `plan` y cuentan
   como premium: son las de los conocidos.

   Con las cuentas de antes, el panel abría un token de GitHub con una clave
   maestra y escribía en `data/users.json`. Aquí no hay nada de eso: entras con
   tu cuenta, que tiene `admin: true` en su ficha, y las reglas de Firestore
   hacen el resto. Si tu cuenta no es administradora, la base de datos no te
   enseña las demás fichas aunque toques lo que toques en este HTML.

   El primer administrador no se puede crear desde aquí —sería lo mismo que
   dejar que cualquiera se hiciera administrador—: se pone a mano, una vez, en
   la consola de Firebase, en su ficha de `usuarios`: `estado: aprobado` y
   `admin: true`. */

const $ = (s) => document.querySelector(s);
const esc = (s) => tfEsc(s);

const ESTADOS = {
  pendiente: ["pendiente", "Pendiente"],
  aprobado: ["aprobado", "Aprobada"],
  bloqueado: ["bloqueado", "Bloqueada"],
};
const ORDEN = { pendiente: 0, aprobado: 1, bloqueado: 2 };

const fecha = (d) =>
  d instanceof Date && !Number.isNaN(d.getTime())
    ? d.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })
    : "";

export async function montarNube() {
  const caja = $("#nubeAdmin");
  if (!caja) return;
  caja.hidden = false;
  document.body.classList.add("adm-nube");
  const lede = $("#lede");
  if (lede) lede.textContent = "Quién hay en la web, cómo la usa y qué falla.";

  // Con sesión se mira la ficha de ahora: quizá te acaban de hacer administrador.
  const s = tfSesion() && tfSesion().nube ? await nubeSincronizar() : null;
  if (!s) return puerta(caja);
  if (!s.admin) return noEsAdmin(caja, s);
  return lista(caja, s);
}

/* ------------------------------------------------------------------ la puerta */
function puerta(caja, mensaje = "") {
  caja.innerHTML = `
    <section class="finder abierta">
      <div class="finder-body">
        <form id="nubeAdminForm" class="finder-form estrecha-form" novalidate>
          <p class="finder-lede">Entra con tu cuenta de administrador.</p>
          <div class="field grow">
            <label for="nubeAdminCorreo">Correo</label>
            <input id="nubeAdminCorreo" type="email" autocomplete="email" autocapitalize="none"
              autocorrect="off" spellcheck="false" required>
          </div>
          <div class="field grow">
            <label for="nubeAdminPass">Contraseña</label>
            ${tfCampoClave("nubeAdminPass")}
          </div>
          <button class="btn primary" type="submit">Entrar</button>
        </form>
        <p class="token-status" id="nubeAdminMsg" role="status">${esc(mensaje)}</p>
      </div>
    </section>`;
  tfWireVerClave(caja);
  const form = caja.querySelector("#nubeAdminForm");
  const boton = form.querySelector("button[type=submit]");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (boton.disabled) return;
    const msg = caja.querySelector("#nubeAdminMsg");
    msg.textContent = "Comprobando…";
    tfOcupado(boton, true);
    const r = await nubeEntrar(
      caja.querySelector("#nubeAdminCorreo").value,
      caja.querySelector("#nubeAdminPass").value
    );
    tfOcupado(boton, false);
    if (!r.ok) {
      msg.textContent = r.error;
      return;
    }
    montarNube();
  });
}

function noEsAdmin(caja, s) {
  caja.innerHTML = `
    <section class="finder abierta">
      <div class="finder-body">
        <p class="finder-lede">Has entrado como <b>${esc(s.name)}</b>, pero esta cuenta no es
          administradora${
            s.estado === "aprobado" ? "" : " ni está aprobada todavía"
          }.</p>
        <p class="meta">Para serlo, en la consola de Firebase abre la colección <code>usuarios</code>,
          busca tu ficha y pon <code>estado: aprobado</code> y <code>admin: true</code>. Es la única
          vez que se hace a mano: después apruebas a los demás desde aquí.</p>
        <p class="controls">
          <button class="btn ghost" type="button" id="nubeReintentar">Ya lo he hecho: comprobar</button>
          <button class="btn ghost" type="button" id="nubeAdminSalir">Salir</button>
          <a class="btn ghost" href="./">← Volver a la web</a>
        </p>
      </div>
    </section>`;
  caja.querySelector("#nubeReintentar").addEventListener("click", montarNube);
  caja.querySelector("#nubeAdminSalir").addEventListener("click", () => salir(caja));
}

function salir(caja) {
  tfSalir();
  puerta(caja);
  const stats = $("#stats");
  if (stats) stats.innerHTML = "";
}

/* ---------------------------------------------------------------- las cuentas */
async function lista(caja, yo, aviso = "") {
  let cuentas;
  try {
    cuentas = await nubeCuentas();
  } catch (e) {
    caja.innerHTML = `<p class="token-status">No se pudieron leer las cuentas: ${esc(e.message)}</p>`;
    return;
  }
  // Las de antes de Firebase. Si aún no se han copiado, la lista sale vacía y todo
  // sigue como siempre: no es un error.
  let antiguas = [];
  try {
    antiguas = await nubeCuentasAntiguas();
  } catch {
    /* sin permiso o sin copiar: no se ofrece vincular */
  }
  const sinVincular = antiguas.filter((a) => !a.vinculada && a.activa !== false);
  const cuenta = (e) => cuentas.filter((c) => c.estado === e).length;
  const premium = cuentas.filter((c) => c.estado === "aprobado" && nubePlan(c) === "premium").length;
  const nuevas7 = cuentas.filter((c) => tiempo(c.creado) > Date.now() - 7 * 864e5).length;
  const kpi = (n, rotulo, extra = "", caliente = false) =>
    `<div class="adm-kpi${caliente ? " hot" : ""}"><dd>${n}</dd><dt>${rotulo}</dt>${
      extra ? `<span class="adm-kpi-extra">${extra}</span>` : ""
    }</div>`;
  $("#stats").innerHTML =
    kpi(cuentas.length, "cuentas", nuevas7 ? `+${nuevas7} esta semana` : "") +
    kpi(premium, "premium") +
    kpi(cuenta("aprobado") - premium, "gratis") +
    kpi(cuentas.filter((c) => c.prefs && c.prefs.quiere_premium && nubePlan(c) !== "premium").length, "quieren premium") +
    (cuenta("pendiente") ? kpi(cuenta("pendiente"), "pendientes", "", true) : "") +
    (cuenta("bloqueado") ? kpi(cuenta("bloqueado"), "bloqueadas") : "") +
    (sinVincular.length ? kpi(sinVincular.length, "cuentas de antes sin vincular", "", true) : "");

  const ordenadas = [...cuentas].sort(
    (a, b) =>
      (ORDEN[a.estado] ?? 3) - (ORDEN[b.estado] ?? 3) ||
      (b.creado instanceof Date ? b.creado.getTime() : 0) - (a.creado instanceof Date ? a.creado.getTime() : 0)
  );

  const icono = (d) =>
    `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
  // Las cifras de las cuentas van debajo del saludo, no en la cabecera de la
  // página. Antes de repintar se devuelven a su sitio: el `innerHTML` de abajo
  // se llevaría el nodo por delante.
  const stats = $("#stats");
  if (stats && caja.contains(stats)) $(".masthead")?.append(stats);
  caja.innerHTML = `
    <div class="adm-sup">
      <div class="adm-quien">
        <span class="adm-avatar grande" aria-hidden="true">${esc((yo.name || "?").slice(0, 1).toUpperCase())}</span>
        <span><b>Hola, ${esc(yo.name || "admin")}</b><small>Administración de TripFinder</small></span>
      </div>
      <div class="adm-acciones">
        <button class="btn ghost small" type="button" id="nubeRecargar">${icono(
          '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'
        )} Recargar</button>
        <a class="btn ghost small" href="./">← Volver a la web</a>
        <button class="btn ghost small" type="button" id="nubeAdminSalir">Salir</button>
      </div>
    </div>
    <div id="admStatsHueco"></div>
    <nav class="adm-nav" aria-label="Secciones del panel">
      <a href="#admActividad">Actividad</a><a href="#admCuentasSec">Cuentas</a><a href="#admErrores">Errores</a>
    </nav>
    <div class="adm-aviso" id="nubeAviso" role="status">${esc(aviso)}</div>

    <section class="adm-bloque" id="admActividad" aria-labelledby="admActTit">
      <div class="adm-cab">
        <h3 class="adm-tit" id="admActTit">Actividad</h3>
        <div class="adm-periodo" role="radiogroup" aria-label="Periodo">${PERIODOS.map(
          ([dias, rotulo]) =>
            `<button type="button" class="adm-seg" role="radio" data-periodo="${dias}"
              aria-checked="${dias === periodo ? "true" : "false"}">${rotulo}</button>`
        ).join("")}</div>
      </div>
      <div id="admActCuerpo"><p class="meta"><span class="spin"></span>Leyendo la actividad…</p></div>
    </section>

    <section class="adm-bloque" id="admCuentasSec" aria-labelledby="admCuentasTit">
      <div class="adm-cab">
        <h3 class="adm-tit" id="admCuentasTit">Cuentas · ${cuentas.length}</h3>
        <div class="adm-filtros">
          <input type="search" id="admBuscar" placeholder="Buscar por nombre o correo…" autocomplete="off"
            aria-label="Buscar una cuenta">
          <select id="admFiltro" aria-label="Qué cuentas">
            <option value="">Todas</option>
            <option value="premium">Premium</option>
            <option value="gratis">Gratis</option>
            <option value="pendiente">Pendientes</option>
            <option value="bloqueado">Bloqueadas</option>
            <option value="quiere">Quieren premium</option>
            <option value="sinverificar">Correo sin verificar</option>
            <option value="dormidas">Sin entrar en 30 días</option>
          </select>
          <select id="admOrden" aria-label="Ordenar">
            <option value="estado">Por estado</option>
            <option value="ultima">Última entrada</option>
            <option value="nuevas">Más nuevas</option>
            <option value="nombre">Por nombre</option>
          </select>
        </div>
      </div>
      <div class="adm-tabla">
        <div class="adm-fila adm-fila-cab" aria-hidden="true">
          <span>Cuenta</span><span>Plan</span><span>Estado</span><span>Última entrada</span><span></span>
        </div>
        <section class="adm-filas" id="nubeCuentas">${
          ordenadas.length
            ? ordenadas.map((c) => fila(c, yo, sinVincular)).join("")
            : `<p class="meta">Todavía no se ha registrado nadie.</p>`
        }</section>
      </div>
    </section>

    <section class="adm-bloque" id="admErrores" aria-labelledby="admErrTit">
      <div class="adm-cab"><h3 class="adm-tit" id="admErrTit">Errores</h3></div>
      <div id="admErrCuerpo"><p class="meta"><span class="spin"></span>Leyendo…</p></div>
    </section>`;

  if (stats) caja.querySelector("#admStatsHueco")?.replaceWith(stats);

  const filtrar = () => {
    const q = normal(caja.querySelector("#admBuscar").value);
    const f = caja.querySelector("#admFiltro").value;
    const orden = caja.querySelector("#admOrden").value;
    const cuantas = { vistas: 0 };
    const filas = [...caja.querySelectorAll("#nubeCuentas [data-cuenta]")];
    const porId = Object.fromEntries(cuentas.map((c) => [c.id, c]));
    filas.forEach((el) => {
      const c = porId[el.dataset.cuenta];
      const ok = c && (!q || normal(`${c.nombre} ${c.correo}`).includes(q)) && pasaFiltro(c, f);
      el.hidden = !ok;
      if (ok) cuantas.vistas += 1;
    });
    const clave = {
      estado: (c) => [ORDEN[c.estado] ?? 3, -tiempo(c.creado)],
      ultima: (c) => [-(ULTIMA[c.id] || 0)],
      nuevas: (c) => [-tiempo(c.creado)],
      nombre: (c) => [normal(c.nombre)],
    }[orden];
    filas
      .sort((a, b) => comparar(clave(porId[a.dataset.cuenta] || {}), clave(porId[b.dataset.cuenta] || {})))
      .forEach((el) => el.parentElement.appendChild(el));
    caja.querySelector("#admCuentasTit").textContent =
      cuantas.vistas === cuentas.length ? `Cuentas · ${cuentas.length}` : `Cuentas · ${cuantas.vistas} de ${cuentas.length}`;
  };
  ["#admBuscar", "#admFiltro", "#admOrden"].forEach((sel) =>
    caja.querySelector(sel).addEventListener("input", filtrar)
  );
  caja.querySelectorAll("[data-periodo]").forEach((b) =>
    b.addEventListener("click", () => {
      periodo = Number(b.dataset.periodo);
      caja.querySelectorAll("[data-periodo]").forEach((x) =>
        x.setAttribute("aria-checked", String(x === b))
      );
      actividad(caja, cuentas, filtrar);
    })
  );
  actividad(caja, cuentas, filtrar);

  caja.querySelector("#nubeRecargar").addEventListener("click", () => lista(caja, yo));
  caja.querySelector("#nubeAdminSalir").addEventListener("click", () => salir(caja));
  caja.querySelectorAll("[data-vincular]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (b.disabled) return;
      const uid = b.dataset.vincular;
      const legado = caja.querySelector(`[data-elegir="${uid}"]`).value;
      const vieja = antiguas.find((a) => a.id === legado);
      if (!vieja) return;
      document.querySelectorAll("[data-vincular], [data-estado]").forEach((x) => (x.disabled = true));
      const r = await nubeVincular(uid, legado, vieja.prefs || {});
      lista(
        caja,
        yo,
        r.ok
          ? `${b.dataset.nombre}: premium y vinculada con «${vieja.nombre || vieja.usuario}». Ya tiene lo de antes.`
          : `No se pudo: ${r.error}`
      );
    })
  );
  caja.querySelectorAll("[data-estado]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (b.disabled) return;
      document.querySelectorAll("[data-vincular], [data-estado]").forEach((x) => (x.disabled = true));
      const plan = b.dataset.plan || "";
      const r = await nubeCambiarEstado(b.dataset.uid, b.dataset.estado, plan);
      const hecho = plan ? (plan === "premium" ? "ahora es premium" : "ahora es gratis") : ESTADOS[b.dataset.estado][1].toLowerCase();
      lista(caja, yo, r.ok ? `${b.dataset.nombre}: ${hecho}.` : `No se pudo: ${r.error}`);
    })
  );
}

function fila(c, yo, sinVincular = []) {
  const [clase, texto] = ESTADOS[c.estado] || ["pendiente", c.estado || "Sin estado"];
  const esYo = c.id === yo.uid;
  const plan = nubePlan(c);
  const boton = (estado, rotulo, primario, conPlan = "") =>
    `<button class="btn ${primario ? "primary" : "ghost"} small" type="button" data-estado="${estado}"
      data-uid="${esc(c.id)}" data-nombre="${esc(c.nombre)}"${conPlan ? ` data-plan="${conPlan}"` : ""}>${rotulo}</button>`;
  const acciones = esYo
    ? `<span class="meta">tú</span>`
    : c.estado === "pendiente"
      ? boton("aprobado", "Abrir gratis", false, "gratis") +
        boton("aprobado", "Hacer premium", true, "premium") +
        boton("bloqueado", "Bloquear")
      : c.estado === "aprobado"
        ? (plan === "premium"
            ? boton("aprobado", "Quitar premium", false, "gratis")
            : boton("aprobado", "Hacer premium", true, "premium")) + boton("bloqueado", "Bloquear")
        : boton("aprobado", "Desbloquear", true, plan);
  // Vincular con una cuenta de antes: solo si ha verificado su correo y aún no
  // tiene ninguna. La que coincide por correo sale elegida; si cambió de correo,
  // se elige a mano.
  let vincular = "";
  if (!esYo && !c.legado && sinVincular.length && c.estado !== "bloqueado") {
    const mismo = sinVincular.find((a) => (a.correo || "").toLowerCase() === (c.correo || "").toLowerCase());
    const opciones = sinVincular
      .map(
        (a) =>
          `<option value="${esc(a.id)}"${mismo && mismo.id === a.id ? " selected" : ""}>${esc(
            a.nombre || a.usuario
          )} · ${esc(a.correo || "sin correo")}</option>`
      )
      .join("");
    vincular = c.verificado
      ? `<span class="nube-vincular">
           <select data-elegir="${esc(c.id)}" aria-label="Cuenta de antes de ${esc(c.nombre)}">${opciones}</select>
           <button class="btn primary small" type="button" data-vincular="${esc(c.id)}"
             data-nombre="${esc(c.nombre)}">Vincular y hacer premium</button>
         </span>
         ${mismo ? `<span class="meta">Su correo coincide con una cuenta de antes.</span>` : ""}`
      : `<span class="meta">Para vincularla con una cuenta de antes, antes tiene que verificar su correo.</span>`;
  }
  const estadoTxt = c.estado === "aprobado" ? "Activa" : texto;
  return `
    <div class="adm-fila nube-cuenta ${esc(clase)}" data-cuenta="${esc(c.id)}">
      <span class="adm-persona">
        <span class="adm-avatar" aria-hidden="true">${esc(String(c.nombre || "?").slice(0, 1).toUpperCase())}</span>
        <span class="adm-persona-txt">
          <b>${esc(c.nombre)}${c.admin ? ' <i class="adm-badge admin">admin</i>' : ""}</b>
          <small>${esc(c.correo)}</small>
        </span>
      </span>
      <span class="adm-col" data-rot="Plan">${
        c.estado === "aprobado"
          ? `<i class="adm-badge ${plan === "premium" ? "premium" : "gratis"}">${plan === "premium" ? "Premium" : "Gratis"}</i>`
          : "—"
      }${c.prefs && c.prefs.quiere_premium && plan !== "premium" ? ' <i class="adm-badge quiere">quiere premium</i>' : ""}</span>
      <span class="adm-col" data-rot="Estado">
        <i class="adm-badge est-${esc(clase)}">${esc(estadoTxt)}</i>
        <small class="${c.verificado ? "" : "ojo"}">${c.verificado ? "correo verificado" : "correo sin verificar"}</small>
      </span>
      <span class="adm-col" data-rot="Última entrada">
        <span data-ultima>—</span>
        <small>${fecha(c.creado) ? `desde ${esc(fecha(c.creado))}` : ""}${c.legado ? " · vinculada con una cuenta de antes" : ""}</small>
      </span>
      <span class="adm-col adm-acc peticion-acc">${acciones}</span>
      ${vincular ? `<span class="adm-vincular">${vincular}</span>` : ""}
    </div>`;
}

/* --------------------------------------------------------------- la actividad
   Lo que apunta `nubeApuntar` (nube.js): entradas, errores y tiempo por
   pantalla. Se trae lo del periodo elegido y se cuenta aquí: son unos cientos
   de filas, y así no hace falta ningún índice ni ninguna función en un
   servidor. */
const PERIODOS = [
  [1, "24 h"],
  [7, "7 días"],
  [30, "30 días"],
  [90, "90 días"],
];
let periodo = 7;
// uid -> última entrada (ms), para la lista de cuentas.
const ULTIMA = {};

const tiempo = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : 0);
const normal = (t) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
const comparar = (a, b) => {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
};

function pasaFiltro(c, f) {
  const plan = nubePlan(c);
  switch (f) {
    case "premium":
      return c.estado === "aprobado" && plan === "premium";
    case "gratis":
      return c.estado === "aprobado" && plan !== "premium";
    case "pendiente":
    case "bloqueado":
      return c.estado === f;
    case "quiere":
      return !!(c.prefs && c.prefs.quiere_premium) && plan !== "premium";
    case "sinverificar":
      return !c.verificado;
    case "dormidas":
      return (ULTIMA[c.id] || 0) < Date.now() - 30 * 864e5;
    default:
      return true;
  }
}

/* «3 h 12 min», «45 s». */
export function duracion(seg) {
  seg = Math.max(0, Math.round(seg || 0));
  if (seg < 60) return `${seg} s`;
  const min = Math.round(seg / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
}

const haceRato = (d) => {
  const ms = Date.now() - tiempo(d);
  const min = Math.round(ms / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const dias = Math.round(h / 24);
  return `hace ${dias} día${dias === 1 ? "" : "s"}`;
};

const METODOS = { correo: "con correo", google: "con Google", registro: "se registró", vuelve: "volvió con sesión" };

/* Las cuentas de lo apuntado: separado de la pintura para poder probarlo. */
export function resumirActividad(filas) {
  const entradas = filas.filter((f) => f.tipo === "entrada");
  const errores = filas.filter((f) => f.tipo === "error");
  const pantallas = filas.filter((f) => f.tipo === "pantalla");
  const porPantalla = {};
  for (const f of pantallas) {
    const p = (porPantalla[f.pantalla] ||= { pantalla: f.pantalla, segundos: 0, visitas: 0 });
    p.segundos += Number(f.segundos) || 0;
    p.visitas += Number(f.visitas) || 0;
  }
  const porError = {};
  for (const f of errores) {
    const e = (porError[f.mensaje] ||= { mensaje: f.mensaje, veces: 0, ultima: f.creado, pantallas: new Set(), detalle: f.detalle || "" });
    e.veces += 1;
    e.pantallas.add(f.pantalla);
    if (tiempo(f.creado) > tiempo(e.ultima)) e.ultima = f.creado;
  }
  const ultima = {};
  for (const f of entradas) if (f.uid) ultima[f.uid] = Math.max(ultima[f.uid] || 0, tiempo(f.creado));
  return {
    entradas,
    errores,
    personas: new Set(entradas.map((f) => f.uid).filter(Boolean)).size,
    segundos: pantallas.reduce((s, f) => s + (Number(f.segundos) || 0), 0),
    visitas: pantallas.reduce((s, f) => s + (Number(f.visitas) || 0), 0),
    pantallas: Object.values(porPantalla).sort((a, b) => b.segundos - a.segundos),
    tiposError: Object.values(porError).sort((a, b) => b.veces - a.veces),
    ultima,
  };
}

/* La actividad, día a día (o por horas en «24 h»): una columna por tramo con
   las pantallas vistas, y encima, en naranja, cuántos han entrado. */
function porTramos(filas) {
  const horas = periodo === 1;
  const n = horas ? 24 : Math.min(periodo, 30);
  const paso = horas ? 3600e3 : 864e5;
  const ahora = new Date();
  const fin = horas
    ? new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), ahora.getHours() + 1).getTime()
    : new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + 1).getTime();
  const tramos = Array.from({ length: n }, (_, i) => ({ desde: fin - (n - i) * paso, vistas: 0, entradas: 0 }));
  for (const f of filas) {
    const i = Math.floor((tiempo(f.creado) - (fin - n * paso)) / paso);
    if (i < 0 || i >= n) continue;
    if (f.tipo === "pantalla") tramos[i].vistas += Number(f.visitas) || 0;
    if (f.tipo === "entrada") tramos[i].entradas += 1;
  }
  const rot = (t) => {
    const d = new Date(t.desde);
    return horas ? `${d.getHours()} h` : d.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
  };
  return { tramos, rot, cada: horas ? 3 : n > 14 ? 5 : n > 7 ? 2 : 1 };
}

function graficaHTML(filas) {
  const { tramos, rot, cada } = porTramos(filas);
  const max = Math.max(1, ...tramos.map((t) => t.vistas + t.entradas));
  return `
    <div class="adm-grafica" role="img" aria-label="Pantallas vistas e inicios de sesión por ${
      periodo === 1 ? "hora" : "día"
    }">
      ${tramos
        .map(
          (t, i) => `<div class="adm-col-g" title="${esc(rot(t))}: ${t.vistas} pantallas, ${t.entradas} entradas">
            <span class="adm-g-barras">
              <i class="g-entradas" style="height:${(t.entradas / max) * 100}%"></i>
              <i class="g-vistas" style="height:${(t.vistas / max) * 100}%"></i>
            </span>
            <small>${i % cada === 0 || i === tramos.length - 1 ? esc(rot(t)) : ""}</small>
          </div>`
        )
        .join("")}
    </div>
    <p class="adm-leyenda"><span class="m-vistas"></span> pantallas vistas <span class="m-entradas"></span> inicios de sesión</p>`;
}

const NO_PUBLICADAS = `<div class="adm-alerta">
    <b>La actividad todavía no se puede leer.</b>
    Faltan por publicar las reglas nuevas de Firestore. En cuanto se publiquen
    (<code>firebase deploy --only firestore</code>), aquí aparecen las entradas, el tiempo por pantalla y
    los errores. Mientras, la web funciona igual y las cuentas de abajo se gestionan como siempre.
  </div>`;

async function actividad(caja, cuentas, alTerminar) {
  const cuerpo = caja.querySelector("#admActCuerpo");
  const errCuerpo = caja.querySelector("#admErrCuerpo");
  if (!cuerpo) return;
  cuerpo.innerHTML = `<p class="meta"><span class="spin"></span>Leyendo la actividad…</p>`;
  let filas;
  try {
    filas = await nubeActividad(new Date(Date.now() - periodo * 864e5));
  } catch (e) {
    cuerpo.innerHTML =
      e.codigo === "PERMISSION_DENIED" || e.estado === 403
        ? NO_PUBLICADAS
        : `<div class="adm-alerta"><b>No se pudo leer la actividad.</b> ${esc(e.message)}</div>`;
    if (errCuerpo) errCuerpo.innerHTML = `<p class="meta">Sin la actividad no hay errores que enseñar.</p>`;
    if (alTerminar) alTerminar();
    return;
  }
  const r = resumirActividad(filas);
  Object.assign(ULTIMA, r.ultima);
  const nombre = Object.fromEntries(cuentas.map((c) => [c.id, c.nombre || c.correo]));
  const max = Math.max(1, ...r.pantallas.map((p) => p.segundos));
  const sinNada = !filas.length;

  cuerpo.innerHTML = `
    <dl class="adm-kpis adm-cifras">
      <div class="adm-kpi"><dd>${r.personas}</dd><dt>personas han entrado</dt></div>
      <div class="adm-kpi"><dd>${r.entradas.length}</dd><dt>inicios de sesión</dt></div>
      <div class="adm-kpi"><dd>${r.visitas}</dd><dt>pantallas vistas</dt></div>
      <div class="adm-kpi"><dd>${esc(duracion(r.segundos))}</dd><dt>de uso en total</dt></div>
      <div class="adm-kpi${r.errores.length ? " hot" : ""}"><dd>${r.errores.length}</dd><dt>errores</dt></div>
    </dl>
    ${
      sinNada
        ? `<div class="adm-alerta suave"><b>Todavía no hay actividad en este periodo.</b> Se empieza a contar
            desde que se publicaron las reglas: en cuanto alguien abra la web, sale aquí.</div>`
        : ""
    }
    <div class="adm-rejilla">
      <section class="adm-caja adm-ancha">
        <h4>Uso ${periodo === 1 ? "por horas" : "por días"}</h4>
        ${graficaHTML(filas)}
      </section>
      <section class="adm-caja">
        <h4>Tiempo por pantalla</h4>
        ${
          r.pantallas.length
            ? `<ol class="adm-barras">${r.pantallas
                .map(
                  (p) => `<li>
                    <span class="adm-barra-nom">${esc(p.pantalla)}</span>
                    <span class="adm-barra"><i style="width:${Math.max(2, Math.round((p.segundos / max) * 100))}%"></i></span>
                    <span class="adm-barra-dato">${esc(duracion(p.segundos))} · ${p.visitas} visita${
                      p.visitas === 1 ? "" : "s"
                    }${p.visitas ? ` · ${esc(duracion(p.segundos / p.visitas))} de media` : ""}</span>
                  </li>`
                )
                .join("")}</ol>`
            : `<p class="meta">Nada todavía en este periodo.</p>`
        }
      </section>
      <section class="adm-caja">
        <h4>Últimos inicios de sesión</h4>
        ${
          r.entradas.length
            ? `<ul class="adm-lista">${r.entradas
                .slice(0, 25)
                .map(
                  (f) => `<li>
                    <span class="adm-avatar mini" aria-hidden="true">${esc(
                      String(nombre[f.uid] || "?").slice(0, 1).toUpperCase()
                    )}</span>
                    <span><b>${esc(nombre[f.uid] || f.uid || "?")}</b>
                    <small>${esc(METODOS[f.metodo] || f.metodo || "")} · ${esc(f.pantalla)}</small></span>
                    <time>${esc(haceRato(f.creado))}</time></li>`
                )
                .join("")}</ul>${
                r.entradas.length > 25 ? `<p class="meta">Y ${r.entradas.length - 25} más.</p>` : ""
              }`
            : `<p class="meta">Nadie ha entrado en este periodo.</p>`
        }
      </section>
    </div>`;

  if (errCuerpo) {
    errCuerpo.innerHTML = r.tiposError.length
      ? `<ul class="adm-lista adm-errores">${r.tiposError
          .slice(0, 30)
          .map(
            (e) => `<li><details><summary><b class="adm-veces">${e.veces}×</b>
              <span class="adm-err-txt">${esc(e.mensaje)}</span>
              <small>${esc(haceRato(e.ultima))} · ${esc([...e.pantallas].join(", "))}</small></summary>
              ${e.detalle ? `<pre class="adm-detalle">${esc(e.detalle)}</pre>` : ""}</details></li>`
          )
          .join("")}</ul>`
      : `<p class="meta">Ningún error en este periodo. 🎉</p>`;
  }

  // La última entrada de cada cuenta, en su fila.
  caja.querySelectorAll("#nubeCuentas [data-cuenta]").forEach((el) => {
    const hueco = el.querySelector("[data-ultima]");
    const ms = ULTIMA[el.dataset.cuenta];
    if (hueco) hueco.textContent = ms ? `entró ${haceRato(new Date(ms))}` : "—";
  });
  if (alTerminar) alTerminar();
}
