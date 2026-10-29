/* nube-admin.js — El panel cuando hay Firebase: quién hay y quién es premium.

   La web es abierta: quien se registra entra gratis y ve los chollos. Desde
   aquí se le da premium o Max, o se le quita, y se bloquea a quien sobre.

   Las cuentas de antes de Firebase ya no se vinculan desde aquí: quien no
   migró a tiempo entra como cuenta nueva.

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

/* ---------------------------------------------------------------- el panel
   Tres pestañas y nada más: RESUMEN (cómo va la web: cifras, uso por día,
   planes, pantallas y quién ha entrado), CUENTAS (la tabla, con el plan a un
   toque) y ERRORES. Arriba, solo lo que pide que hagas algo. */
const PESTANAS = [
  ["resumen", "Resumen"],
  ["cuentas", "Cuentas"],
  ["errores", "Errores"],
];
let pestana = "resumen";
try {
  pestana = sessionStorage.getItem("tf_adm_pestana") || "resumen";
} catch {
  /* sin almacenamiento: se empieza por el resumen */
}

const icono = (d, tam = 16) =>
  `<svg viewBox="0 0 24 24" width="${tam}" height="${tam}" fill="none" stroke="currentColor" stroke-width="1.8"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
const inicial = (n) => esc(String(n || "?").trim().slice(0, 1).toUpperCase() || "?");
const nPlan = (cuentas, p) => cuentas.filter((c) => c.estado === "aprobado" && nubePlan(c) === p).length;

async function lista(caja, yo, aviso = "") {
  let cuentas;
  try {
    cuentas = await nubeCuentas();
  } catch (e) {
    caja.innerHTML = `<p class="token-status">No se pudieron leer las cuentas: ${esc(e.message)}</p>`;
    return;
  }
  const stats = $("#stats");
  if (stats) stats.hidden = true;
  const pendientes = cuentas.filter((c) => c.estado === "pendiente").length;
  const quieren = cuentas.filter((c) => c.prefs && c.prefs.quiere_premium && nubePlan(c) === "gratis").length;

  caja.innerHTML = `
    <header class="adm-sup">
      <div class="adm-quien">
        <span class="adm-avatar grande" aria-hidden="true">${inicial(yo.name)}</span>
        <span><b>Hola, ${esc(yo.name || "admin")}</b><small>${cuentas.length} cuenta${cuentas.length === 1 ? "" : "s"} en la web</small></span>
      </div>
      <div class="adm-acciones">
        <button class="btn ghost small" type="button" id="nubeRecargar">${icono(
          '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'
        )} Recargar</button>
        <a class="btn ghost small" href="./">Volver a la web</a>
        <button class="btn ghost small" type="button" id="nubeAdminSalir">Salir</button>
      </div>
    </header>
    <div class="adm-pendiente" id="admPendiente">${
      pendientes || quieren
        ? `${pendientes ? `<button type="button" data-ir="cuentas" data-filtro="pendiente"><b>${pendientes}</b> pendiente${pendientes === 1 ? "" : "s"} de abrir</button>` : ""}
           ${quieren ? `<button type="button" data-ir="cuentas" data-filtro="quiere"><b>${quieren}</b> quiere${quieren === 1 ? "" : "n"} premium</button>` : ""}`
        : ""
    }</div>
    <div class="adm-aviso" id="nubeAviso" role="status">${esc(aviso)}</div>
    <nav class="adm-tabs" role="tablist" aria-label="Partes del panel">${PESTANAS.map(
      ([k, t]) => `<button type="button" role="tab" id="admTab-${k}" aria-controls="admPanel-${k}" data-tab="${k}"
        aria-selected="${k === pestana}">${t}<i id="admTabN-${k}">${k === "cuentas" ? cuentas.length : ""}</i></button>`
    ).join("")}</nav>

    <section class="adm-panel" id="admPanel-resumen" role="tabpanel" aria-labelledby="admTab-resumen" ${pestana === "resumen" ? "" : "hidden"}>
      <div class="adm-cab">
        <h3 class="adm-tit">Cómo va la web</h3>
        <div class="adm-periodo" role="radiogroup" aria-label="Periodo">${PERIODOS.map(
          ([dias, rotulo]) =>
            `<button type="button" class="adm-seg" role="radio" data-periodo="${dias}"
              aria-checked="${dias === periodo ? "true" : "false"}">${rotulo}</button>`
        ).join("")}</div>
      </div>
      <div id="admActividad"><div id="admActCuerpo"><p class="meta"><span class="spin"></span>Leyendo la actividad…</p></div></div>
    </section>

    <section class="adm-panel" id="admPanel-cuentas" role="tabpanel" aria-labelledby="admTab-cuentas" ${pestana === "cuentas" ? "" : "hidden"}>
      <div class="adm-cab">
        <div class="adm-chips" role="radiogroup" aria-label="Qué cuentas" id="admChips"></div>
        <div class="adm-filtros">
          <input type="search" id="admBuscar" placeholder="Buscar por nombre o correo" autocomplete="off"
            aria-label="Buscar una cuenta">
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
          <span>Cuenta</span><span>Plan</span><span>Última entrada</span><span></span>
        </div>
        <div class="adm-filas" id="nubeCuentas">${
          cuentas.length
            ? [...cuentas]
                .sort((a, b) => (ORDEN[a.estado] ?? 3) - (ORDEN[b.estado] ?? 3) || tiempo(b.creado) - tiempo(a.creado))
                .map((c) => fila(c, yo))
                .join("")
            : `<p class="meta">Todavía no se ha registrado nadie.</p>`
        }</div>
        <p class="meta adm-nadie" id="admNadie" hidden>Ninguna cuenta con eso.</p>
      </div>
    </section>

    <section class="adm-panel" id="admPanel-errores" role="tabpanel" aria-labelledby="admTab-errores" ${pestana === "errores" ? "" : "hidden"}>
      <div id="admErrores"><div id="admErrCuerpo"><p class="meta"><span class="spin"></span>Leyendo…</p></div></div>
    </section>`;

  /* Las pestañas. */
  const ir = (k) => {
    pestana = k;
    try {
      sessionStorage.setItem("tf_adm_pestana", k);
    } catch {
      /* nada */
    }
    caja.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === k)));
    caja.querySelectorAll(".adm-panel").forEach((p) => (p.hidden = p.id !== `admPanel-${k}`));
  };
  caja.querySelector(".adm-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) ir(b.dataset.tab);
  });
  caja.querySelector(".adm-tabs").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = PESTANAS.findIndex(([k]) => k === pestana);
    const j = (i + (e.key === "ArrowRight" ? 1 : PESTANAS.length - 1)) % PESTANAS.length;
    ir(PESTANAS[j][0]);
    caja.querySelector(`[data-tab="${PESTANAS[j][0]}"]`).focus();
  });

  /* Los filtros de las cuentas: chips con su cuenta. */
  const FILTROS = [
    ["", "Todas", cuentas.length],
    ["premium", "Premium y Max", nPlan(cuentas, "premium") + nPlan(cuentas, "max")],
    ["gratis", "Gratis", nPlan(cuentas, "gratis")],
    ["quiere", "Quieren premium", quieren],
    ["pendiente", "Pendientes", pendientes],
    ["bloqueado", "Bloqueadas", cuentas.filter((c) => c.estado === "bloqueado").length],
    ["sinverificar", "Sin verificar", cuentas.filter((c) => !c.verificado).length],
    ["dormidas", "Sin entrar en 30 días", null],
  ];
  let filtro = "";
  const pintarChips = () => {
    caja.querySelector("#admChips").innerHTML = FILTROS.filter(([k, , n]) => !k || n === null || n > 0)
      .map(
        ([k, t, n]) => `<button type="button" class="adm-chip" role="radio" data-filtrar="${k}" aria-checked="${k === filtro}">${t}${
          n === null ? "" : ` <i>${n}</i>`
        }</button>`
      )
      .join("");
  };
  const filtrar = () => {
    const q = normal(caja.querySelector("#admBuscar").value);
    const orden = caja.querySelector("#admOrden").value;
    const filas = [...caja.querySelectorAll("#nubeCuentas [data-cuenta]")];
    const porId = Object.fromEntries(cuentas.map((c) => [c.id, c]));
    let vistas = 0;
    filas.forEach((el) => {
      const c = porId[el.dataset.cuenta];
      const ok = c && (!q || normal(`${c.nombre} ${c.correo}`).includes(q)) && pasaFiltro(c, filtro);
      el.hidden = !ok;
      if (ok) vistas += 1;
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
    caja.querySelector("#admNadie").hidden = vistas > 0 || !cuentas.length;
  };
  pintarChips();
  caja.querySelector("#admChips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-filtrar]");
    if (!b) return;
    filtro = b.dataset.filtrar;
    pintarChips();
    filtrar();
  });
  ["#admBuscar", "#admOrden"].forEach((sel) => caja.querySelector(sel).addEventListener("input", filtrar));
  caja.querySelector("#admPendiente").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ir]");
    if (!b) return;
    ir(b.dataset.ir);
    filtro = b.dataset.filtro || "";
    pintarChips();
    filtrar();
  });

  caja.querySelectorAll("[data-periodo]").forEach((b) =>
    b.addEventListener("click", () => {
      periodo = Number(b.dataset.periodo);
      caja.querySelectorAll("[data-periodo]").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
      actividad(caja, cuentas, filtrar);
    })
  );
  actividad(caja, cuentas, filtrar);

  caja.querySelector("#nubeRecargar").addEventListener("click", () => lista(caja, yo));
  caja.querySelector("#nubeAdminSalir").addEventListener("click", () => salir(caja));
  caja.querySelectorAll("[data-estado]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (b.disabled || b.getAttribute("aria-pressed") === "true") return;
      caja.querySelectorAll("[data-estado]").forEach((x) => (x.disabled = true));
      const plan = b.dataset.plan || "";
      const r = await nubeCambiarEstado(b.dataset.uid, b.dataset.estado, plan);
      const hecho =
        b.dataset.estado === "bloqueado"
          ? "bloqueada"
          : plan
            ? `ahora es ${plan === "max" ? "Max" : plan}`
            : ESTADOS[b.dataset.estado][1].toLowerCase();
      lista(caja, yo, r.ok ? `${b.dataset.nombre}: ${hecho}.` : `No se pudo: ${r.error}`);
    })
  );
}

/* Una cuenta: quién es, su plan a un toque (gratis, premium, Max), cuándo entró
   y bloquear. Una pendiente se abre (gratis o premium); una bloqueada se
   desbloquea. */
function fila(c, yo) {
  const [clase] = ESTADOS[c.estado] || ["pendiente"];
  const esYo = c.id === yo.uid;
  const plan = nubePlan(c);
  const boton = (estado, rotulo, { conPlan = "", pulsado = false, extra = "" } = {}) =>
    `<button class="${extra}" type="button" data-estado="${estado}" data-uid="${esc(c.id)}" data-nombre="${esc(c.nombre)}"${
      conPlan ? ` data-plan="${conPlan}"` : ""
    } aria-pressed="${pulsado}">${rotulo}</button>`;
  let planes = "";
  if (esYo) planes = `<span class="meta">tú${c.admin ? " · admin" : ""}</span>`;
  else if (c.estado === "aprobado") {
    planes = `<div class="adm-plan" role="group" aria-label="Plan de ${esc(c.nombre)}">${[
      ["gratis", "Gratis"],
      ["premium", "Premium"],
      ["max", "Max"],
    ]
      .map(([p, t]) => boton("aprobado", t, { conPlan: p, pulsado: plan === p, extra: `adm-plan-b p-${p}` }))
      .join("")}</div>`;
  } else if (c.estado === "pendiente") {
    planes = `<span class="adm-estado pendiente">Pendiente</span>
      ${boton("aprobado", "Abrir gratis", { conPlan: "gratis", extra: "btn ghost small" })}
      ${boton("aprobado", "Abrir premium", { conPlan: "premium", extra: "btn primary small" })}`;
  } else {
    planes = `<span class="adm-estado bloqueado">Bloqueada</span>`;
  }
  const accion = esYo
    ? ""
    : c.estado === "bloqueado"
      ? boton("aprobado", "Desbloquear", { conPlan: plan, extra: "btn ghost small" })
      : boton("bloqueado", `${icono('<circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/>', 14)} Bloquear`, {
          extra: "adm-bloquear",
        });
  const etiquetas = [
    c.admin && !esYo ? `<i class="adm-et">admin</i>` : "",
    c.prefs && c.prefs.quiere_premium && plan === "gratis" ? `<i class="adm-et quiere">quiere premium</i>` : "",
    c.verificado ? "" : `<i class="adm-et ojo">correo sin verificar</i>`,
  ].join("");
  return `
    <div class="adm-fila nube-cuenta ${esc(clase)}" data-cuenta="${esc(c.id)}">
      <span class="adm-persona">
        <span class="adm-avatar ${plan === "gratis" || c.estado !== "aprobado" ? "" : "con-plan"}" aria-hidden="true">${inicial(c.nombre)}</span>
        <span class="adm-persona-txt">
          <b>${esc(c.nombre)}</b>
          <small>${esc(c.correo)}</small>
          ${etiquetas ? `<span class="adm-ets">${etiquetas}</span>` : ""}
        </span>
      </span>
      <span class="adm-col adm-col-plan" data-rot="Plan">${planes}</span>
      <span class="adm-col" data-rot="Última entrada">
        <span data-ultima>—</span>
        <small>${fecha(c.creado) ? `cuenta desde ${esc(fecha(c.creado))}` : ""}</small>
      </span>
      <span class="adm-col adm-acc">${accion}</span>
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
      return c.estado === "aprobado" && (plan === "premium" || plan === "max");
    case "gratis":
      return c.estado === "aprobado" && plan === "gratis";
    case "pendiente":
    case "bloqueado":
      return c.estado === f;
    case "quiere":
      return !!(c.prefs && c.prefs.quiere_premium) && plan === "gratis";
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


/* La actividad por tramos: días (u horas en «24 h»). De cada tramo, las
   pantallas vistas, los inicios de sesión, las personas y el tiempo: las
   minigráficas de las cifras y la gráfica grande salen de aquí. */
function porTramos(filas) {
  const horas = periodo === 1;
  const n = horas ? 24 : Math.min(periodo, 30);
  const paso = horas ? 3600e3 : 864e5;
  const ahora = new Date();
  const fin = horas
    ? new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), ahora.getHours() + 1).getTime()
    : new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + 1).getTime();
  const tramos = Array.from({ length: n }, (_, i) => ({
    desde: fin - (n - i) * paso, vistas: 0, entradas: 0, segundos: 0, errores: 0, gente: new Set(),
  }));
  for (const f of filas) {
    const i = Math.floor((tiempo(f.creado) - (fin - n * paso)) / paso);
    if (i < 0 || i >= n) continue;
    const t = tramos[i];
    if (f.tipo === "pantalla") {
      t.vistas += Number(f.visitas) || 0;
      t.segundos += Number(f.segundos) || 0;
    }
    if (f.tipo === "entrada") {
      t.entradas += 1;
      if (f.uid) t.gente.add(f.uid);
    }
    if (f.tipo === "error") t.errores += 1;
  }
  const rot = (t) => {
    const d = new Date(t.desde);
    return horas ? `${d.getHours()} h` : d.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
  };
  return { tramos, rot, cada: horas ? 4 : n > 14 ? 5 : n > 7 ? 2 : 1 };
}

/* Una minigráfica: la forma de la serie, sin ejes. */
function chispa(valores, clase = "") {
  const max = Math.max(1, ...valores);
  const n = valores.length;
  if (n < 2) return "";
  const x = (i) => (i / (n - 1)) * 100;
  const y = (v) => 28 - (v / max) * 26;
  const linea = valores.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  return `<svg class="adm-chispa ${clase}" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <polygon points="0,30 ${linea} 100,30"/><polyline points="${linea}" vector-effect="non-scaling-stroke"/></svg>`;
}

/* La gráfica grande: pantallas vistas por tramo, en área, con una guía y su
   cifra al pasar por encima (o al tocar). Una sola serie y un solo eje: los
   inicios de sesión van en la etiqueta, no en otra escala. */
function graficaHTML(filas) {
  const { tramos, rot, cada } = porTramos(filas);
  const valores = tramos.map((t) => t.vistas);
  const max = Math.max(4, ...valores);
  const techo = Math.ceil(max / 4) * 4;
  const n = tramos.length;
  const x = (i) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const y = (v) => 100 - (v / techo) * 100;
  const linea = valores.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  return `
    <figure class="adm-grafica">
      <div class="adm-g-ejes" aria-hidden="true">${[1, 0.5, 0]
        .map((f) => `<span style="top:${(1 - f) * 100}%"><em>${Math.round(techo * f)}</em></span>`)
        .join("")}</div>
      <div class="adm-g-plano">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <polygon class="g-area" points="0,100 ${linea} 100,100"/>
          <polyline class="g-linea" points="${linea}" vector-effect="non-scaling-stroke"/>
        </svg>
        <div class="adm-g-toques" style="--n:${n}">${tramos
          .map(
            (t, i) => `<button type="button" class="adm-g-toque" style="--x:${x(i)}%;--y:${y(t.vistas)}%"
              aria-label="${esc(rot(t))}: ${t.vistas} pantallas vistas, ${t.entradas} inicios de sesión">
              <span class="adm-g-tip"><b>${esc(rot(t))}</b>${t.vistas} pantallas · ${t.entradas} entrada${t.entradas === 1 ? "" : "s"}</span>
            </button>`
          )
          .join("")}</div>
      </div>
      <div class="adm-g-x" aria-hidden="true" style="--n:${n}">${tramos
        .map((t, i) => (i % cada === 0 || i === n - 1 ? `<span style="left:${x(i)}%">${esc(rot(t))}</span>` : ""))
        .join("")}</div>
      <figcaption class="solo-lector">Pantallas vistas por ${periodo === 1 ? "hora" : "día"}</figcaption>
    </figure>`;
}

/* Una lista de barras de un solo color: magnitud por categoría. */
function barrasHTML(filas, clase = "") {
  const max = Math.max(1, ...filas.map((f) => f.valor));
  return `<ol class="adm-barras ${clase}">${filas
    .map(
      (f) => `<li>
        <span class="adm-barra-nom">${esc(f.nombre)}</span>
        <span class="adm-barra"><i style="width:${Math.max(f.valor ? 2 : 0, Math.round((f.valor / max) * 100))}%"></i></span>
        <span class="adm-barra-dato">${f.dato}</span>
      </li>`
    )
    .join("")}</ol>`;
}

const NO_PUBLICADAS = `<div class="adm-alerta">
    <b>La actividad todavía no se puede leer.</b>
    Faltan por publicar las reglas de Firestore (<code>firebase deploy --only firestore</code>). Mientras,
    las cuentas se gestionan igual.
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
  const { tramos } = porTramos(filas);
  const nombre = Object.fromEntries(cuentas.map((c) => [c.id, c.nombre || c.correo]));
  const desde = Date.now() - periodo * 864e5;
  const nuevas = cuentas.filter((c) => tiempo(c.creado) > desde).length;
  const aprobadas = cuentas.filter((c) => c.estado === "aprobado").length;

  const cifra = (valor, rotulo, serie, clase = "") =>
    `<div class="adm-kpi ${clase}"><dt>${rotulo}</dt><dd>${valor}</dd>${chispa(serie, clase)}</div>`;
  const planes = [
    { nombre: "Gratis", valor: nPlan(cuentas, "gratis") },
    { nombre: "Premium", valor: nPlan(cuentas, "premium") },
    { nombre: "Max", valor: nPlan(cuentas, "max") },
    { nombre: "Pendientes", valor: cuentas.filter((c) => c.estado === "pendiente").length },
    { nombre: "Bloqueadas", valor: cuentas.filter((c) => c.estado === "bloqueado").length },
  ]
    .filter((p, i) => i < 3 || p.valor)
    .map((p) => ({ ...p, dato: `${p.valor}${aprobadas && p.nombre !== "Pendientes" && p.nombre !== "Bloqueadas" ? ` · ${Math.round((p.valor / aprobadas) * 100)} %` : ""}` }));

  cuerpo.innerHTML = `
    <dl class="adm-kpis adm-cifras">
      ${cifra(r.personas, "personas han entrado", tramos.map((t) => t.gente.size))}
      ${cifra(r.entradas.length, "inicios de sesión", tramos.map((t) => t.entradas))}
      ${cifra(r.visitas, "pantallas vistas", tramos.map((t) => t.vistas))}
      ${cifra(esc(duracion(r.segundos)), "de uso", tramos.map((t) => t.segundos))}
      ${cifra(r.errores.length, "errores", tramos.map((t) => t.errores), r.errores.length ? "mal" : "")}
    </dl>
    ${
      !filas.length
        ? `<div class="adm-alerta suave"><b>Sin actividad en este periodo.</b> En cuanto alguien abra la web, sale aquí.</div>`
        : ""
    }
    <div class="adm-rejilla">
      <section class="adm-caja adm-ancha">
        <h4>Pantallas vistas ${periodo === 1 ? "por hora" : "por día"}</h4>
        ${graficaHTML(filas)}
      </section>
      <section class="adm-caja" id="admPlanes">
        <h4>Cuentas <small>${cuentas.length}${nuevas ? ` · ${nuevas} nueva${nuevas === 1 ? "" : "s"} en el periodo` : ""}</small></h4>
        ${barrasHTML(planes, "adm-planes-l")}
      </section>
      <section class="adm-caja">
        <h4>Tiempo por pantalla</h4>
        ${
          r.pantallas.length
            ? barrasHTML(
                r.pantallas.slice(0, 8).map((p) => ({
                  nombre: p.pantalla,
                  valor: p.segundos,
                  dato: `${esc(duracion(p.segundos))} · ${p.visitas} visita${p.visitas === 1 ? "" : "s"}`,
                })),
                "adm-pantallas"
              )
            : `<p class="meta">Nada todavía en este periodo.</p>`
        }
      </section>
      <section class="adm-caja adm-ancha">
        <h4>Últimos inicios de sesión</h4>
        ${
          r.entradas.length
            ? `<ul class="adm-lista">${r.entradas
                .slice(0, 12)
                .map(
                  (f) => `<li>
                    <span class="adm-avatar mini" aria-hidden="true">${inicial(nombre[f.uid])}</span>
                    <span><b>${esc(nombre[f.uid] || f.uid || "?")}</b>
                    <small>${esc(METODOS[f.metodo] || f.metodo || "")} · ${esc(f.pantalla)}</small></span>
                    <time>${esc(haceRato(f.creado))}</time></li>`
                )
                .join("")}</ul>${r.entradas.length > 12 ? `<p class="meta">Y ${r.entradas.length - 12} más.</p>` : ""}`
            : `<p class="meta">Nadie ha entrado en este periodo.</p>`
        }
      </section>
    </div>`;

  const nErr = caja.querySelector("#admTabN-errores");
  if (nErr) nErr.textContent = r.tiposError.length ? String(r.tiposError.length) : "";
  if (errCuerpo) {
    const max = Math.max(1, ...r.tiposError.map((e) => e.veces));
    errCuerpo.innerHTML = r.tiposError.length
      ? `<p class="adm-sub">${r.errores.length} error${r.errores.length === 1 ? "" : "es"} de ${r.tiposError.length} tipo${
          r.tiposError.length === 1 ? "" : "s"
        } en el periodo. Toca uno para ver el detalle.</p>
        <ul class="adm-errores">${r.tiposError
          .slice(0, 40)
          .map(
            (e) => `<li><details><summary>
              <b class="adm-veces">${e.veces}×</b>
              <span class="adm-err-txt">${esc(e.mensaje)}<small>${esc(haceRato(e.ultima))} · ${esc([...e.pantallas].join(", "))}</small></span>
              <span class="adm-err-barra" aria-hidden="true"><i style="width:${Math.round((e.veces / max) * 100)}%"></i></span>
              </summary>
              ${e.detalle ? `<pre class="adm-detalle">${esc(e.detalle)}</pre>` : ""}</details></li>`
          )
          .join("")}</ul>`
      : `<p class="meta">Ningún error en este periodo.</p>`;
  }

  // La última entrada de cada cuenta, en su fila.
  caja.querySelectorAll("#nubeCuentas [data-cuenta]").forEach((el) => {
    const hueco = el.querySelector("[data-ultima]");
    const ms = ULTIMA[el.dataset.cuenta];
    if (hueco) hueco.textContent = ms ? `entró ${haceRato(new Date(ms))}` : "—";
  });
  if (alTerminar) alTerminar();
}
