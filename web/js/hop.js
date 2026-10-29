/* hop.js — El modo HOP: decidir un viaje en grupo.

   Un HOP es un grupo con una fecha de caducidad. Dentro, cada cual propone
   fechas («el puente de mayo») o viajes concretos («Roma, 12-15 may, 89 €») y
   todos votan cada propuesta: me encaja, puede o no puedo. La que más encaja
   sube arriba. Al lado, un chat para discutirlo.

   · Crear un HOP es de premium (uno activo a la vez) y de Max (sin límite).
     Unirse es de cualquier cuenta: basta el enlace, que lleva el id de el HOP.
   · Cuando pasa la fecha del viaje se borra entera, con sus propuestas y su
     chat (`tripfinder hops-limpiar`, en el cron de los encargos).
   · No hay tiempo real: Firebase va por REST, sin SDK. El chat se pregunta
     cada pocos segundos mientras la pestaña está a la vista, y las propuestas
     cada poco más. Es lo que ya hace el resto de la web con sus búsquedas.

   Las reglas de Firestore son las que mandan (quién ve y escribe qué); esto
   solo lo enseña. */
import { esc, escURL, fmtDate, parseISO } from "./base.js";

const $ = (s, raiz = document) => raiz.querySelector(s);
const CADA_CHAT_MS = 4000;
const CADA_PROPUESTAS_MS = 12000;
const PROPUESTA_PENDIENTE = "tf_hop_propuesta";

const VOTOS = [
  ["si", "Me encaja", "👍"],
  ["quiza", "Puede", "🤔"],
  ["no", "No puedo", "👎"],
];

let estado = { id: "", hop: null, propuestas: [], mensajes: [], filtro: "todas", vista: "props" };
let relojes = [];

const yo = () => (typeof tfSesion === "function" ? tfSesion() : null);
const inicial = (n) => esc(String(n || "?").trim().slice(0, 1).toUpperCase() || "?");
const tono = (uid) => {
  let h = 0;
  for (const c of String(uid)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `t${h % 6}`;
};
const avatar = (uid, nombre, extra = "") =>
  `<span class="hop-av ${tono(uid)} ${extra}" title="${esc(nombre)}" aria-hidden="true">${inicial(nombre)}</span>`;
const instante = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : 0);

function haceRato(d) {
  const ms = Date.now() - instante(d);
  const min = Math.round(ms / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const dias = Math.round(h / 24);
  return `hace ${dias} día${dias === 1 ? "" : "s"}`;
}

function horaDe(d) {
  const t = instante(d);
  if (!t) return "";
  const f = new Date(t);
  const hoy = new Date();
  const hh = `${String(f.getHours()).padStart(2, "0")}:${String(f.getMinutes()).padStart(2, "0")}`;
  return f.toDateString() === hoy.toDateString()
    ? hh
    : `${f.toLocaleDateString("es-ES", { day: "numeric", month: "short" })} ${hh}`;
}

const noches = (ida, vuelta) => {
  const a = parseISO(ida);
  const b = parseISO(vuelta);
  return a && b && b > a ? Math.round((b - a) / 864e5) : 0;
};

const hoyISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function parar() {
  relojes.forEach(clearInterval);
  relojes = [];
}

const enlaceHop = (id) => `${location.origin}${location.pathname}?j=${encodeURIComponent(id)}`;

/* Lo que llega desde el feed («proponer este viaje en un HOP») se guarda
   mientras eliges a qué HOP va. */
function leerPendiente() {
  const q = new URLSearchParams(location.search);
  if (q.get("proponer") === "1") {
    const p = {};
    for (const k of ["titulo", "destino", "ida", "vuelta", "precio", "url"]) if (q.get(k)) p[k] = q.get(k);
    try {
      sessionStorage.setItem(PROPUESTA_PENDIENTE, JSON.stringify(p));
    } catch {
      /* sin almacenamiento, se pierde y ya */
    }
    q.delete("proponer");
    ["titulo", "destino", "ida", "vuelta", "precio", "url"].forEach((k) => q.delete(k));
    try {
      history.replaceState(null, "", `${location.pathname}${q.toString() ? `?${q}` : ""}`);
    } catch {
      /* file:// */
    }
  }
  try {
    return JSON.parse(sessionStorage.getItem(PROPUESTA_PENDIENTE) || "null");
  } catch {
    return null;
  }
}

function olvidarPendiente() {
  try {
    sessionStorage.removeItem(PROPUESTA_PENDIENTE);
  } catch {
    /* nada */
  }
}

/* ------------------------------------------------------------- la puesta */
export async function montarHop() {
  const app = $("#hopApp");
  if (!app) return;
  parar();
  const pendiente = leerPendiente();
  if (typeof nubeActiva !== "function" || !nubeActiva()) {
    app.innerHTML = `<div class="hop-vacio"><b>El modo HOP necesita las cuentas de la web.</b>
      Todavía no están encendidas aquí.</div>`;
    return;
  }
  if (!yo() || !yo().nube) return vistaSinCuenta(app);
  // La ficha de ahora: quizá te acaban de hacer premium o Max.
  if (typeof nubeSincronizar === "function") await nubeSincronizar().catch(() => null);
  const id = new URLSearchParams(location.search).get("j");
  if (id) return vistaHop(app, id, pendiente);
  return vistaLista(app, pendiente);
}

function vistaSinCuenta(app) {
  app.innerHTML = `
    <section class="hop-hero">
      <div>
        <h2>Decidid el viaje entre todos</h2>
        <p>Crea un grupo, invita a los tuyos con un enlace y proponed fechas y viajes. Cada uno vota lo
          que le encaja, se habla en el chat y la mejor opción sube sola arriba.</p>
        <p class="hop-letra">Para entrar en un HOP hace falta una cuenta (gratis). Para crearlo, premium.</p>
        <div class="hop-acc">
          <button class="btn primary" type="button" data-hop-entrar>Entrar o crear cuenta</button>
          <a class="btn ghost" href="planes">Ver planes</a>
        </div>
      </div>
      ${ilustracion()}
    </section>`;
  app.querySelector("[data-hop-entrar]").addEventListener("click", () => {
    if (typeof tfAbrirLogin === "function") tfAbrirLogin();
  });
}

function ilustracion() {
  return `<div class="hop-ilus" aria-hidden="true">
      <div class="hop-ilus-tarjeta"><b>Puente de mayo</b><span>👍 4 · 🤔 1</span></div>
      <div class="hop-ilus-tarjeta dos"><b>Roma · 89 €</b><span>👍 3 · 👎 2</span></div>
      <div class="hop-ilus-burbuja">¿Roma o Lisboa? 🍝</div>
    </div>`;
}

/* --------------------------------------------------------------- la lista */
async function vistaLista(app, pendiente) {
  app.innerHTML = `<p class="meta"><span class="spin"></span>Leyendo tus HOP…</p>`;
  const s = yo();
  let hops = [];
  let fallo = "";
  try {
    hops = await nubeMisHops();
  } catch (e) {
    fallo = e.message || "No se pudieron leer.";
  }
  const ahora = Date.now();
  hops = hops
    .filter((j) => instante(j.caduca) > ahora)
    .sort((a, b) => String(a.fin).localeCompare(String(b.fin)));
  const premium = nubeEsPremium(s);
  const max = nubeEsMax(s);
  const mias = hops.filter((j) => j.creador === s.uid).length;
  const puede = premium && (max || mias === 0);

  app.innerHTML = `
    ${
      pendiente
        ? `<div class="hop-aviso">Elige en qué HOP propones <b>${esc(pendiente.titulo || pendiente.destino || "el viaje")}</b>.
            <button class="quitar" type="button" data-hop-olvidar>no proponer</button></div>`
        : ""
    }
    <div class="hop-cab">
      <h2>Tus HOP</h2>
      ${
        premium
          ? `<span class="hop-cupo">${max ? "Max · sin límite" : `Premium · ${mias} de 1 activa`}</span>`
          : ""
      }
    </div>
    ${fallo ? `<div class="hop-aviso error">${esc(fallo)}</div>` : ""}
    <div class="hop-lista">
      ${
        hops.length
          ? hops.map((j) => tarjetaHop(j, s)).join("")
          : `<div class="hop-vacio"><b>Todavía no estás en ningún HOP.</b>
               ${premium ? "Crea la primera aquí abajo." : "Pide a quien la organice el enlace para unirte."}</div>`
      }
    </div>
    <section class="hop-crear" aria-labelledby="hopCrearTit">
      <h3 id="hopCrearTit">Crear un HOP</h3>
      ${
        !premium
          ? `<div class="hop-aviso"><b>Crear un HOP es de premium.</b> Unirte a uno, no: con el enlace que te
               pasen, entras gratis. <a href="planes">Ver planes</a></div>`
          : !puede
            ? `<div class="hop-aviso"><b>Ya tienes un HOP activo.</b> En premium es uno a la vez: cuando pase su
                 fecha, o si lo borras, puedes crear otro. Con <b>Max</b>, los que quieras.
                 <a href="planes">Ver planes</a></div>`
            : formCrear()
      }
    </section>`;

  app.querySelector("[data-hop-olvidar]")?.addEventListener("click", () => {
    olvidarPendiente();
    vistaLista(app, null);
  });
  const form = app.querySelector("#hopCrear");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const boton = form.querySelector("button[type=submit]");
      const msg = form.querySelector(".hop-msg");
      if (boton.disabled) return;
      boton.disabled = true;
      msg.textContent = "Creando…";
      const r = await nubeHopCrear({
        nombre: form.elements.nombre.value,
        descripcion: form.elements.descripcion.value,
        fin: form.elements.fin.value,
      });
      boton.disabled = false;
      if (!r.ok) {
        msg.textContent = r.error;
        return;
      }
      location.href = `${location.pathname}?j=${encodeURIComponent(r.id)}&nueva=1`;
    });
  }
}

function formCrear() {
  const min = hoyISO();
  return `<form id="hopCrear" class="hop-form" novalidate>
      <label><span>Nombre</span>
        <input name="nombre" maxlength="60" required placeholder="Escapada de primavera"></label>
      <label><span>¿Hasta cuándo puede ser el viaje?</span>
        <input name="fin" type="date" required min="${min}"></label>
      <label class="ancha"><span>Para qué es <i>(opcional)</i></span>
        <input name="descripcion" maxlength="300" placeholder="Algo de 3-4 días, que no pase de 200 € por cabeza"></label>
      <div class="hop-form-pie ancha">
        <button class="btn primary" type="submit">Crear el HOP</button>
        <p class="hop-msg" role="status">Cuando pase esa fecha, el HOP se borra solo con todo lo de dentro.</p>
      </div>
    </form>`;
}

function tarjetaHop(j, s) {
  const miembros = j.miembros || [];
  const nombres = j.nombres || {};
  return `<a class="hop-tarjeta" href="?j=${encodeURIComponent(j.id)}">
      <span class="hop-tarjeta-top">
        <b>${esc(j.nombre)}</b>
        ${j.creador === s.uid ? '<i class="hop-chip">el tuyo</i>' : ""}
      </span>
      ${j.descripcion ? `<span class="hop-tarjeta-desc">${esc(j.descripcion)}</span>` : ""}
      <span class="hop-tarjeta-pie">
        <span class="hop-avs">${miembros
          .slice(0, 5)
          .map((u) => avatar(u, nombres[u] || "?"))
          .join("")}${miembros.length > 5 ? `<span class="hop-av mas">+${miembros.length - 5}</span>` : ""}</span>
        <span class="hop-fin">hasta el ${esc(fmtDate(j.fin))}</span>
      </span>
    </a>`;
}

/* ---------------------------------------------------------------- un HOP */
async function vistaHop(app, id, pendiente) {
  app.innerHTML = `<p class="meta"><span class="spin"></span>Abriendo el HOP…</p>`;
  const s = yo();
  let hop = null;
  try {
    hop = await nubeHop(id);
  } catch {
    hop = null;
  }
  if (!hop || instante(hop.caduca) < Date.now()) {
    app.innerHTML = `<div class="hop-vacio"><b>Este HOP ya no existe.</b> Se borran solos cuando pasa la fecha del
      viaje, o puede que quien lo creó lo haya borrado. <a href="hop">Ver tus HOP</a></div>`;
    return;
  }
  estado = { ...estado, id, hop, propuestas: [], mensajes: [] };
  if (!(hop.miembros || []).includes(s.uid)) return vistaUnirse(app, hop);
  pintarHop(app, pendiente);
  await Promise.all([cargarPropuestas(app), cargarMensajes(app, true)]);
  relojes.push(
    setInterval(() => document.visibilityState === "visible" && cargarMensajes(app), CADA_CHAT_MS),
    setInterval(() => document.visibilityState === "visible" && cargarPropuestas(app), CADA_PROPUESTAS_MS)
  );
}

function vistaUnirse(app, hop) {
  const nombres = hop.nombres || {};
  const miembros = hop.miembros || [];
  app.innerHTML = `
    <section class="hop-unirse">
      <p class="hop-letra">Te han invitado a un HOP</p>
      <h2>${esc(hop.nombre)}</h2>
      ${hop.descripcion ? `<p>${esc(hop.descripcion)}</p>` : ""}
      <p class="hop-letra">La organiza ${esc(nombres[hop.creador] || "alguien")} · ${miembros.length} persona${
        miembros.length === 1 ? "" : "s"
      } · hasta el ${esc(fmtDate(hop.fin))}</p>
      <div class="hop-avs grande">${miembros.map((u) => avatar(u, nombres[u] || "?")).join("")}</div>
      <div class="hop-acc">
        <button class="btn primary" type="button" id="hopUnirme">Unirme a el HOP</button>
        <a class="btn ghost" href="hop">Ahora no</a>
      </div>
      <p class="hop-msg" role="status"></p>
    </section>`;
  const boton = app.querySelector("#hopUnirme");
  boton.addEventListener("click", async () => {
    if (boton.disabled) return;
    boton.disabled = true;
    const r = await nubeHopUnirse(hop.id);
    if (!r.ok) {
      boton.disabled = false;
      app.querySelector(".hop-msg").textContent =
        (hop.miembros || []).length >= 30 ? "Este HOP ya está lleno (30 personas)." : r.error;
      return;
    }
    vistaHop(app, hop.id, leerPendiente());
  });
}

function pintarHop(app, pendiente) {
  const s = yo();
  const { hop } = estado;
  const nombres = hop.nombres || {};
  const miembros = hop.miembros || [];
  const mia = hop.creador === s.uid;
  const nueva = new URLSearchParams(location.search).get("nueva") === "1";
  app.innerHTML = `
    <a class="hop-volver" href="hop">← Tus HOP</a>
    <header class="hop-top">
      <div class="hop-top-txt">
        <h2>${esc(hop.nombre)}</h2>
        ${hop.descripcion ? `<p class="hop-desc">${esc(hop.descripcion)}</p>` : ""}
        <p class="hop-letra">Hasta el ${esc(fmtDate(hop.fin, true))} · ${miembros.length} persona${
          miembros.length === 1 ? "" : "s"
        } · se borra solo al pasar la fecha</p>
        <div class="hop-avs">${miembros
          .map((u) => avatar(u, `${nombres[u] || "?"}${u === hop.creador ? " (organiza)" : ""}`))
          .join("")}</div>
      </div>
      <div class="hop-top-acc">
        <button class="btn primary small" type="button" id="hopInvitar">Invitar</button>
        ${
          mia
            ? `<button class="btn ghost small" type="button" id="hopEditar">Editar</button>
               <button class="btn ghost small" type="button" id="hopBorrar">Borrar</button>`
            : `<button class="btn ghost small" type="button" id="hopSalir">Salir</button>`
        }
      </div>
    </header>
    <div class="hop-invitacion" id="hopInvitacion" ${nueva ? "" : "hidden"}>
      <span>${nueva ? "<b>¡HOP creado!</b> Pasa este enlace a los tuyos para que entren:" : "El enlace para entrar:"}</span>
      <code id="hopEnlace">${esc(enlaceHop(hop.id))}</code>
      <button class="btn ghost small" type="button" id="hopCopiar">Copiar</button>
    </div>
    <div class="hop-editar" id="hopEditarCaja" hidden></div>

    <div class="hop-pestanas" role="tablist" aria-label="Partes de el HOP">
      <button type="button" role="tab" data-vista="props" aria-selected="${estado.vista === "props"}">Propuestas</button>
      <button type="button" role="tab" data-vista="chat" aria-selected="${estado.vista === "chat"}">Chat <i id="hopNuevos"></i></button>
    </div>
    <div class="hop-cuerpo" data-vista="${estado.vista}">
      <section class="hop-props" aria-labelledby="hopPropsTit">
        <div class="hop-cab">
          <h3 id="hopPropsTit">Propuestas</h3>
          <div class="hop-filtro" role="radiogroup" aria-label="Qué propuestas">
            ${[
              ["todas", "Todas"],
              ["fechas", "Fechas"],
              ["viaje", "Viajes"],
            ]
              .map(
                ([v, r]) =>
                  `<button type="button" role="radio" data-filtro="${v}" aria-checked="${estado.filtro === v}">${r}</button>`
              )
              .join("")}
          </div>
        </div>
        <div class="hop-proponer">
          <button class="btn ghost small" type="button" data-nueva="fechas">+ Proponer fechas</button>
          <button class="btn ghost small" type="button" data-nueva="viaje">+ Proponer un viaje</button>
        </div>
        <div id="hopFormProp"></div>
        <div class="hop-lista-props" id="hopListaProps"><p class="meta"><span class="spin"></span>Cargando…</p></div>
      </section>
      <section class="hop-chat" aria-labelledby="hopChatTit">
        <h3 id="hopChatTit">Chat</h3>
        <div class="hop-mensajes" id="hopMensajes" aria-live="polite"></div>
        <form class="hop-escribir" id="hopEscribir">
          <textarea name="texto" rows="1" maxlength="1000" placeholder="Escribe al grupo…" aria-label="Mensaje"></textarea>
          <button class="btn primary small" type="submit">Enviar</button>
        </form>
      </section>
    </div>`;

  // Invitar: el menú del sistema donde lo hay; si no, se enseña y se copia.
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(enlaceHop(hop.id));
      $("#hopCopiar", app).textContent = "Copiado";
    } catch {
      $("#hopCopiar", app).textContent = "Selecciónalo y cópialo";
    }
  };
  $("#hopInvitar", app).addEventListener("click", async () => {
    $("#hopInvitacion", app).hidden = false;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: hop.nombre, text: `Únete a el HOP «${hop.nombre}»`, url: enlaceHop(hop.id) });
        return;
      } catch {
        /* cancelado: queda el enlace a la vista */
      }
    }
    copiar();
  });
  $("#hopCopiar", app).addEventListener("click", copiar);

  $("#hopSalir", app)?.addEventListener("click", async () => {
    if (!confirm("¿Salir de este HOP? Para volver hará falta el enlace.")) return;
    const r = await nubeHopSalir(hop.id);
    if (r.ok) location.href = "hop";
    else alert(r.error);
  });
  $("#hopBorrar", app)?.addEventListener("click", async () => {
    if (!confirm("¿Borrar el HOP para todos? Se pierden las propuestas, los votos y el chat.")) return;
    const r = await nubeHopBorrar(hop.id);
    if (r.ok) location.href = "hop";
    else alert(r.error);
  });
  $("#hopEditar", app)?.addEventListener("click", () => abrirEditar(app));

  app.querySelectorAll("[data-vista]").forEach((b) =>
    b.addEventListener("click", () => {
      estado.vista = b.dataset.vista;
      app.querySelector(".hop-cuerpo").dataset.vista = estado.vista;
      app.querySelectorAll("[role=tab][data-vista]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
      if (estado.vista === "chat") {
        $("#hopNuevos", app).textContent = "";
        bajarChat(app, true);
      }
    })
  );
  app.querySelectorAll("[data-filtro]").forEach((b) =>
    b.addEventListener("click", () => {
      estado.filtro = b.dataset.filtro;
      app.querySelectorAll("[data-filtro]").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
      pintarPropuestas(app);
    })
  );
  app.querySelectorAll("[data-nueva]").forEach((b) =>
    b.addEventListener("click", () => abrirFormProp(app, b.dataset.nueva))
  );
  $("#hopListaProps", app).addEventListener("click", (e) => alTocarPropuesta(app, e));

  const escribir = $("#hopEscribir", app);
  const area = escribir.elements.texto;
  area.addEventListener("input", () => {
    area.style.height = "auto";
    area.style.height = `${Math.min(140, area.scrollHeight)}px`;
  });
  area.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      escribir.requestSubmit();
    }
  });
  escribir.addEventListener("submit", async (e) => {
    e.preventDefault();
    const texto = area.value.trim();
    if (!texto) return;
    const boton = escribir.querySelector("button");
    boton.disabled = true;
    area.value = "";
    area.style.height = "auto";
    // Se pinta ya; la siguiente vuelta del sondeo trae el de verdad.
    estado.mensajes.push({ id: `local-${Date.now()}`, autor: s.uid, nombre: s.name, texto, creado: new Date(), local: true });
    pintarMensajes(app, true);
    const r = await nubeMandarMensaje(hop.id, texto);
    boton.disabled = false;
    if (!r.ok) {
      estado.mensajes = estado.mensajes.filter((m) => !m.local);
      area.value = texto;
      pintarMensajes(app);
      alert(r.error);
      return;
    }
    cargarMensajes(app, true);
  });

  if (pendiente) {
    abrirFormProp(app, "viaje", pendiente);
    olvidarPendiente();
  }
}

function abrirEditar(app) {
  const { hop } = estado;
  const caja = $("#hopEditarCaja", app);
  caja.hidden = !caja.hidden;
  if (caja.hidden) return;
  caja.innerHTML = `<form class="hop-form" id="hopEditarForm">
      <label><span>Nombre</span><input name="nombre" maxlength="60" value="${esc(hop.nombre)}"></label>
      <label><span>¿Hasta cuándo puede ser el viaje?</span>
        <input name="fin" type="date" min="${hoyISO()}" value="${esc(hop.fin)}"></label>
      <label class="ancha"><span>Para qué es</span>
        <input name="descripcion" maxlength="300" value="${esc(hop.descripcion || "")}"></label>
      <div class="hop-form-pie ancha">
        <button class="btn primary small" type="submit">Guardar</button>
        <p class="hop-msg" role="status">Si alargas la fecha, el HOP dura hasta entonces.</p>
      </div>
    </form>`;
  caja.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const r = await nubeHopEditar(hop.id, {
      nombre: f.elements.nombre.value,
      fin: f.elements.fin.value,
      descripcion: f.elements.descripcion.value,
    });
    if (!r.ok) {
      f.querySelector(".hop-msg").textContent = r.error;
      return;
    }
    vistaHop(app, hop.id, null);
  });
}

/* ------------------------------------------------------------ propuestas */
function abrirFormProp(app, tipo, datos = {}) {
  const caja = $("#hopFormProp", app);
  const fechas = tipo === "fechas";
  const min = hoyISO();
  caja.innerHTML = `<form class="hop-form hop-form-prop" id="hopPropForm">
      <p class="hop-form-tit">${fechas ? "Proponer unas fechas" : "Proponer un viaje"}</p>
      <label class="ancha"><span>${fechas ? "Cómo lo llamamos" : "Título"}</span>
        <input name="titulo" maxlength="80" required value="${esc(datos.titulo || "")}"
          placeholder="${fechas ? "Puente de mayo" : "Roma con Ryanair"}"></label>
      ${
        fechas
          ? ""
          : `<label><span>Destino</span><input name="destino" maxlength="80" value="${esc(datos.destino || "")}"
               placeholder="Roma"></label>
             <label><span>Precio por persona (€)</span><input name="precio" type="number" min="0" step="1"
               value="${esc(datos.precio || "")}"></label>`
      }
      <label><span>Ida</span><input name="ida" type="date" min="${min}" max="${esc(estado.hop.fin)}" value="${esc(
        datos.ida || ""
      )}" ${fechas ? "required" : ""}></label>
      <label><span>Vuelta</span><input name="vuelta" type="date" min="${min}" max="${esc(estado.hop.fin)}" value="${esc(
        datos.vuelta || ""
      )}" ${fechas ? "required" : ""}></label>
      ${
        fechas
          ? ""
          : `<label class="ancha"><span>Enlace <i>(opcional)</i></span><input name="url" type="url"
               placeholder="https://…" value="${esc(datos.url || "")}"></label>`
      }
      <label class="ancha"><span>Algo más <i>(opcional)</i></span><input name="nota" maxlength="500"></label>
      <div class="hop-form-pie ancha">
        <button class="btn primary small" type="submit">Proponer</button>
        <button class="btn ghost small" type="button" data-cerrar-prop>Cancelar</button>
        <p class="hop-msg" role="status"></p>
      </div>
    </form>`;
  const form = caja.querySelector("form");
  form.querySelector("[data-cerrar-prop]").addEventListener("click", () => (caja.innerHTML = ""));
  form.elements.titulo.focus();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = (k) => (form.elements[k] ? form.elements[k].value.trim() : "");
    const msg = form.querySelector(".hop-msg");
    if (!v("titulo")) return (msg.textContent = "Ponle un título.");
    if (fechas && !(v("ida") && v("vuelta"))) return (msg.textContent = "Marca la ida y la vuelta.");
    if (v("ida") && v("vuelta") && v("vuelta") < v("ida")) return (msg.textContent = "La vuelta va después de la ida.");
    if (v("url") && !v("url").startsWith("https://")) return (msg.textContent = "El enlace tiene que empezar por https://");
    const boton = form.querySelector("button[type=submit]");
    boton.disabled = true;
    const r = await nubeProponer(estado.id, {
      tipo,
      titulo: v("titulo"),
      destino: v("destino"),
      precio: v("precio"),
      ida: v("ida"),
      vuelta: v("vuelta"),
      url: v("url"),
      nota: v("nota"),
    });
    boton.disabled = false;
    if (!r.ok) return (msg.textContent = r.error);
    caja.innerHTML = "";
    cargarPropuestas(app);
  });
}

async function cargarPropuestas(app) {
  try {
    estado.propuestas = await nubePropuestas(estado.id);
  } catch {
    return;
  }
  pintarPropuestas(app);
}

const puntos = (p) => {
  const v = Object.values(p.votos || {});
  return { si: v.filter((x) => x === "si").length, quiza: v.filter((x) => x === "quiza").length, no: v.filter((x) => x === "no").length };
};
const nota = (p) => {
  const n = puntos(p);
  return n.si * 2 + n.quiza - n.no * 0.5;
};

function pintarPropuestas(app) {
  const caja = $("#hopListaProps", app);
  if (!caja) return;
  const s = yo();
  const { hop } = estado;
  const nombres = hop.nombres || {};
  const lista = estado.propuestas
    .filter((p) => estado.filtro === "todas" || p.tipo === estado.filtro)
    .sort((a, b) => nota(b) - nota(a) || instante(a.creado) - instante(b.creado));
  if (!lista.length) {
    caja.innerHTML = `<div class="hop-vacio"><b>${
      estado.propuestas.length ? "Nada de este tipo todavía." : "Aún no hay propuestas."
    }</b> Proponed unas fechas o un viaje y votad: lo que más encaje sube arriba.</div>`;
    return;
  }
  const mejor = lista.find((p) => puntos(p).si > 0);
  caja.innerHTML = lista
    .map((p) => {
      const n = puntos(p);
      const mio = (p.votos || {})[s.uid] || "";
      const faltan = (hop.miembros || []).filter((u) => !(p.votos || {})[u]);
      const dias = noches(p.ida, p.vuelta);
      const fechas =
        p.ida || p.vuelta
          ? `${esc(fmtDate(p.ida, true))}${p.vuelta ? ` → ${esc(fmtDate(p.vuelta, true))}` : ""}${
              dias ? ` · ${dias} noche${dias === 1 ? "" : "s"}` : ""
            }`
          : "";
      const puedoBorrar = p.autor === s.uid || hop.creador === s.uid;
      return `<article class="hop-prop${p === mejor ? " favorita" : ""}" data-prop="${esc(p.id)}">
          <div class="hop-prop-cab">
            <span class="hop-tipo ${p.tipo}">${p.tipo === "fechas" ? "Fechas" : "Viaje"}</span>
            ${p === mejor ? '<span class="hop-chip fav">★ la que más encaja</span>' : ""}
          </div>
          <h4>${esc(p.titulo)}</h4>
          <p class="hop-prop-datos">${[
            p.destino ? esc(p.destino) : "",
            fechas,
            Number.isFinite(p.precio) ? `<b>${Math.round(p.precio)} €</b> por persona` : "",
          ]
            .filter(Boolean)
            .join(" · ")}</p>
          ${p.nota ? `<p class="hop-prop-nota">${esc(p.nota)}</p>` : ""}
          ${p.url && escURL(p.url) !== "#" ? `<a class="hop-prop-enlace" href="${escURL(p.url)}" target="_blank" rel="noopener">Ver el viaje ↗</a>` : ""}
          <div class="hop-votos" role="group" aria-label="Tu voto">
            ${VOTOS.map(
              ([v, rot, ico]) =>
                `<button type="button" class="hop-voto v-${v}" data-voto="${v}" aria-pressed="${mio === v}">
                  <span aria-hidden="true">${ico}</span> ${rot} <b>${n[v]}</b></button>`
            ).join("")}
          </div>
          <div class="hop-barra" aria-hidden="true">
            <i class="b-si" style="flex:${n.si}"></i><i class="b-quiza" style="flex:${n.quiza}"></i><i class="b-no" style="flex:${n.no}"></i><i class="b-falta" style="flex:${faltan.length}"></i>
          </div>
          <p class="hop-prop-pie">
            <span>Propuesta de ${esc(nombres[p.autor] || p.nombre || "alguien")} · ${esc(haceRato(p.creado))}</span>
            ${faltan.length ? `<span>Falta${faltan.length === 1 ? "" : "n"}: ${faltan.map((u) => esc(nombres[u] || "?")).join(", ")}</span>` : "<span>Ya han votado todos</span>"}
            ${puedoBorrar ? `<button class="quitar" type="button" data-borrar-prop>borrar</button>` : ""}
          </p>
        </article>`;
    })
    .join("");
}

async function alTocarPropuesta(app, e) {
  const tarjeta = e.target.closest("[data-prop]");
  if (!tarjeta) return;
  const pid = tarjeta.dataset.prop;
  const p = estado.propuestas.find((x) => x.id === pid);
  if (!p) return;
  const s = yo();
  const voto = e.target.closest("[data-voto]");
  if (voto) {
    const antes = (p.votos || {})[s.uid] || null;
    const nuevo = antes === voto.dataset.voto ? null : voto.dataset.voto;
    // Se pinta ya: esperar a la red para ver tu propio voto se nota.
    p.votos = { ...p.votos };
    if (nuevo) p.votos[s.uid] = nuevo;
    else delete p.votos[s.uid];
    pintarPropuestas(app);
    const r = await nubeVotar(estado.id, pid, nuevo);
    if (!r.ok) {
      if (antes) p.votos[s.uid] = antes;
      else delete p.votos[s.uid];
      pintarPropuestas(app);
      alert(r.error);
    }
    return;
  }
  if (e.target.closest("[data-borrar-prop]")) {
    if (!confirm(`¿Borrar «${p.titulo}» y sus votos?`)) return;
    const r = await nubeBorrarPropuesta(estado.id, pid);
    if (r.ok) {
      estado.propuestas = estado.propuestas.filter((x) => x.id !== pid);
      pintarPropuestas(app);
    } else alert(r.error);
  }
}

/* ------------------------------------------------------------------ el chat */
async function cargarMensajes(app, bajar = false) {
  let mensajes;
  try {
    mensajes = await nubeMensajes(estado.id);
  } catch {
    return;
  }
  const antes = estado.mensajes.filter((m) => !m.local);
  const ultimoAntes = antes.length ? antes[antes.length - 1].id : "";
  const ultimo = mensajes.length ? mensajes[mensajes.length - 1].id : "";
  if (ultimo === ultimoAntes && !estado.mensajes.some((m) => m.local) && !bajar) return;
  const nuevos = ultimoAntes ? mensajes.length - mensajes.findIndex((m) => m.id === ultimoAntes) - 1 : 0;
  estado.mensajes = mensajes;
  pintarMensajes(app, bajar);
  // En el móvil, con la pestaña de propuestas delante, se avisa de lo nuevo.
  if (nuevos > 0 && estado.vista !== "chat") {
    const marca = $("#hopNuevos", app);
    if (marca) marca.textContent = String(Number(marca.textContent || 0) + nuevos);
  }
}

function bajarChat(app, siempre = false) {
  const caja = $("#hopMensajes", app);
  if (!caja) return;
  const cerca = caja.scrollHeight - caja.scrollTop - caja.clientHeight < 120;
  if (siempre || cerca) caja.scrollTop = caja.scrollHeight;
}

function pintarMensajes(app, bajar = false) {
  const caja = $("#hopMensajes", app);
  if (!caja) return;
  const s = yo();
  const estabaAbajo = caja.scrollHeight - caja.scrollTop - caja.clientHeight < 120;
  if (!estado.mensajes.length) {
    caja.innerHTML = `<p class="hop-chat-vacio">Aquí se habla del viaje. Di hola 👋</p>`;
    return;
  }
  let anterior = "";
  caja.innerHTML = estado.mensajes
    .map((m) => {
      const mio = m.autor === s.uid;
      const seguido = anterior === m.autor;
      anterior = m.autor;
      return `<div class="hop-msj${mio ? " mio" : ""}${seguido ? " seguido" : ""}${m.local ? " enviando" : ""}">
          ${mio || seguido ? '<span class="hop-av hueco"></span>' : avatar(m.autor, m.nombre)}
          <div class="hop-burbuja">
            ${mio || seguido ? "" : `<b class="${tono(m.autor)}">${esc(m.nombre)}</b>`}
            <p>${esc(m.texto).replace(/\n/g, "<br>")}</p>
            <time>${esc(horaDe(m.creado))}</time>
          </div>
        </div>`;
    })
    .join("");
  if (bajar || estabaAbajo) caja.scrollTop = caja.scrollHeight;
}
