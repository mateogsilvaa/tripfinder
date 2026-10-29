/* hop.js — El modo HOP: decidir un viaje en grupo.

   Un HOP es un grupo con una fecha de caducidad, y dentro, un buscador para el
   grupo. Cualquiera lanza una búsqueda de vuelos (de dónde salís, a dónde,
   cuándo, tope), los resultados entran como tarjetas y cada cual vota: me
   encaja, puede o no puedo. El vuelo que más gusta pasa al resumen, «El
   viaje», y con él se busca dónde dormir, que se vota igual. Así va saliendo
   el viaje entero sin que nadie tenga que pasar enlaces por un chat. Al lado,
   el chat igualmente, y una sección para ideas sueltas (fechas, viajes a mano).

   · Crear un HOP es de premium (uno activo a la vez) y de Max (sin límite).
     Unirse es de cualquier cuenta: basta el enlace, que lleva el id del HOP.
   · Cuando pasa la fecha del viaje se borra entero, con sus propuestas y su
     chat (`tripfinder hops-limpiar`, en el cron de los encargos).
   · No hay tiempo real: Firebase va por REST, sin SDK. El chat se pregunta
     cada pocos segundos mientras la pestaña está a la vista, y las propuestas
     cada poco más. Es lo que ya hace el resto de la web con sus búsquedas.

   Las reglas de Firestore son las que mandan (quién ve y escribe qué); esto
   solo lo enseña. */
import { esc, escURL, fetchJSON, fmtDate, parseISO } from "./base.js";
import { abrirDestinos } from "./destinos.js";
import { cajaAcceso, dispatch, esFaltaDeAcceso } from "./disparador.js";
import { montarHoras, textoHoras } from "./horas.js";
import { ORIGENES } from "./opciones.js";
import { banderaDe } from "./paises.js";

const $ = (s, raiz = document) => raiz.querySelector(s);
const CADA_CHAT_MS = 4000;
const CADA_PROPUESTAS_MS = 8000;
const PROPUESTA_PENDIENTE = "tf_hop_propuesta";

const VOTOS = [
  ["si", "Me encaja", "👍"],
  ["quiza", "Puede", "🤔"],
  ["no", "No puedo", "👎"],
];

let estado = { id: "", hop: null, propuestas: [], mensajes: [], filtro: "todas", vista: "props", buscar: false };
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
          ? `<span class="hop-cupo">${max ? "Max · sin límite" : `Premium · ${mias} de 1 activo`}</span>`
          : ""
      }
    </div>
    ${fallo ? `<div class="hop-aviso error">${esc(fallo)}</div>` : ""}
    <div class="hop-lista">
      ${
        hops.length
          ? hops.map((j) => tarjetaHop(j, s)).join("")
          : `<div class="hop-vacio"><b>Todavía no estás en ningún HOP.</b>
               ${premium ? "Crea el primero aquí abajo." : "Pide a quien lo organice el enlace para unirte."}</div>`
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
      <p class="hop-letra">Lo organiza ${esc(nombres[hop.creador] || "alguien")} · ${miembros.length} persona${
        miembros.length === 1 ? "" : "s"
      } · hasta el ${esc(fmtDate(hop.fin))}</p>
      <div class="hop-avs grande">${miembros.map((u) => avatar(u, nombres[u] || "?")).join("")}</div>
      <div class="hop-acc">
        <button class="btn primary" type="button" id="hopUnirme">Unirme al HOP</button>
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

    <div class="hop-pestanas" role="tablist" aria-label="Partes del HOP">
      <button type="button" role="tab" data-vista="props" aria-selected="${estado.vista === "props"}">El viaje</button>
      <button type="button" role="tab" data-vista="chat" aria-selected="${estado.vista === "chat"}">Chat <i id="hopNuevos"></i></button>
    </div>
    <div class="hop-cuerpo" data-vista="${estado.vista}">
      <section class="hop-props hop-plan" aria-label="El viaje">
        <div id="hopResumen"></div>
        <section class="hop-paso" aria-labelledby="hopPasoVueloTit">
          <div class="hop-paso-cab">
            <span class="hop-paso-n" aria-hidden="true">1</span>
            <h3 id="hopPasoVueloTit">El vuelo</h3>
            <span class="hop-paso-estado" id="hopEstadoVuelo"></span>
          </div>
          <div id="hopBuscar"></div>
          <div id="hopVuelos"></div>
        </section>
        <section class="hop-paso" aria-labelledby="hopPasoCamaTit">
          <div class="hop-paso-cab">
            <span class="hop-paso-n" aria-hidden="true">2</span>
            <h3 id="hopPasoCamaTit">Dónde dormir</h3>
            <span class="hop-paso-estado" id="hopEstadoCama"></span>
          </div>
          <div id="hopCamas"></div>
        </section>
        <details class="hop-otras" id="hopOtras">
          <summary>Otras ideas del grupo <span class="hop-letra">fechas y viajes a mano</span> <i id="hopOtrasN"></i></summary>
          <div class="hop-cab">
            <h3 id="hopPropsTit" class="solo-lector">Otras ideas</h3>
            <div class="hop-filtro" role="radiogroup" aria-label="Qué ideas">
              ${[
                ["todas", "Todas"],
                ["fechas", "Fechas"],
                ["viaje", "Viajes"],
              ]
                .map(
                  (
                    [v, r]
                  ) => `<button type="button" role="radio" data-filtro="${v}" aria-checked="${estado.filtro === v}">${r}</button>`
                )
                .join("")}
            </div>
          </div>
          <div class="hop-proponer">
            <button class="btn ghost small" type="button" data-nueva="fechas">+ Proponer fechas</button>
            <button class="btn ghost small" type="button" data-nueva="viaje">+ Proponer un viaje</button>
          </div>
          <div id="hopFormProp"></div>
          <div class="hop-lista-props" id="hopListaProps"></div>
        </details>
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
        await navigator.share({ title: hop.nombre, text: `Únete al HOP «${hop.nombre}»`, url: enlaceHop(hop.id) });
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
  $(".hop-plan", app).addEventListener("click", (e) => alTocarPropuesta(app, e));
  pintarViaje(app);

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
    $("#hopOtras", app).open = true;
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
    const [props, hop] = await Promise.all([nubePropuestas(estado.id), nubeHop(estado.id).catch(() => null)]);
    estado.propuestas = props;
    if (hop) estado.hop = hop;
  } catch {
    return;
  }
  pintarPropuestas(app);
  pintarViaje(app);
  comprobarBusquedas(app);
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
  const sueltas = estado.propuestas.filter((p) => p.tipo === "fechas" || p.tipo === "viaje");
  const cuenta = $("#hopOtrasN", app);
  if (cuenta) cuenta.textContent = sueltas.length ? String(sueltas.length) : "";
  const lista = sueltas
    .filter((p) => estado.filtro === "todas" || p.tipo === estado.filtro)
    .sort((a, b) => nota(b) - nota(a) || instante(a.creado) - instante(b.creado));
  if (!lista.length) {
    caja.innerHTML = `<div class="hop-vacio"><b>${
      sueltas.length ? "Nada de este tipo todavía." : "Aún no hay ideas sueltas."
    }</b> Si a alguien se le ocurren unas fechas o un viaje fuera del buscador, va aquí y se vota igual.</div>`;
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
    pintarViaje(app);
    const r = await nubeVotar(estado.id, pid, nuevo);
    if (!r.ok) {
      if (antes) p.votos[s.uid] = antes;
      else delete p.votos[s.uid];
      pintarPropuestas(app);
      pintarViaje(app);
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
      pintarViaje(app);
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

/* ===================================================================== EL VIAJE
   El buscador del grupo, las tarjetas que se votan y el resumen que va
   saliendo. Todo se pinta desde `estado` (las propuestas y el HOP) en cada
   vuelta del sondeo, así que lo que vota uno lo ven los demás en segundos. */
const MAX_VUELOS = 12;
const MAX_CAMAS = 9;
const ESPERA_VUELOS_MS = 8 * 60e3; // lo que suele tardar un barrido
const ESPERA_CAMA_MS = 3 * 60e3;
const CADUCA_BUSQUEDA_MS = 35 * 60e3; // más que esto, algo ha ido mal
const importando = new Set();

const deTipo = (t) => estado.propuestas.filter((p) => p.tipo === t);
const ordenadas = (lista) =>
  [...lista].sort((a, b) => nota(b) - nota(a) || (a.precio ?? 1e9) - (b.precio ?? 1e9));
const ganadora = (t) => ordenadas(deTipo(t)).find((p) => puntos(p).si > 0) || null;
const personasHop = () => Math.min(8, Math.max(1, (estado.hop.miembros || []).length));
const euros = (n) => `${Math.round(n)} €`;
const sinVotar = (lista) => lista.filter((p) => !(p.votos || {})[yo().uid]);

function hashCorto(t) {
  let h = 0;
  for (const c of String(t)) h = (h * 33 + c.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

export function pintarViaje(app) {
  if (!$("#hopResumen", app)) return;
  pintarResumen(app);
  pintarBuscar(app);
  pintarVuelos(app);
  pintarCamas(app);
}

/* -------------------------------------------------------------- el resumen */
function pintarResumen(app) {
  const caja = $("#hopResumen", app);
  const v = ganadora("vuelo");
  const c = ganadora("cama");
  const n = (estado.hop.miembros || []).length;
  const pasos = [
    ["Buscad vuelos", deTipo("vuelo").length > 0],
    ["Votad el que más os guste", !!v],
    ["Buscad dónde dormir", deTipo("cama").length > 0],
    ["Votad la cama", !!c],
  ];
  if (!v) {
    caja.innerHTML = `<div class="hop-pase hop-pase-vacio">
        <p class="hop-pase-kicker">el viaje</p>
        <h3>Aún sin decidir</h3>
        <p>Se arma solo: buscad vuelos aquí abajo, votad las tarjetas y lo que más guste al grupo sale aquí.</p>
        <ol class="hop-pasitos">${pasos
          .map(([t, hecho], i) => `<li class="${hecho ? "hecho" : ""}"><b>${hecho ? "✓" : i + 1}</b>${t}</li>`)
          .join("")}</ol>
      </div>`;
    return;
  }
  const nv = puntos(v);
  const precioCama = c && Number.isFinite(c.precio) ? c.precio : null;
  const total = (Number.isFinite(v.precio) ? v.precio : 0) + (precioCama || 0);
  const dias = noches(v.ida, v.vuelta);
  caja.innerHTML = `<div class="hop-pase">
      <div class="hop-pase-izq ${tono(v.iata || v.titulo)}">
        <p class="hop-pase-kicker">el viaje · lo que más gusta</p>
        <h3><span class="hop-bandera" aria-hidden="true">${banderaDe(v.pais || "") || "✈"}</span>${esc(v.titulo)}</h3>
        <p class="hop-pase-fechas">${esc(fmtDate(v.ida, true))} → ${esc(fmtDate(v.vuelta, true))}${
          dias ? ` · ${dias} noche${dias === 1 ? "" : "s"}` : ""
        }</p>
        ${v.horario ? `<p class="hop-pase-dato">✈ ${esc(v.horario)}${v.compania ? ` · ${esc(v.compania)}` : ""}</p>` : ""}
        <p class="hop-pase-dato">🛏 ${
          c ? `${esc(c.titulo)}` : `<span class="hop-falta">Falta dónde dormir</span>`
        }</p>
        <p class="hop-pase-votos">👍 ${nv.si} de ${n}${nv.quiza ? ` · 🤔 ${nv.quiza}` : ""}${nv.no ? ` · 👎 ${nv.no}` : ""}</p>
      </div>
      <div class="hop-pase-der">
        <p class="hop-pase-kicker">por persona</p>
        <p class="hop-pase-total">≈ ${euros(total)}</p>
        <p class="hop-pase-desglose">vuelo ${Number.isFinite(v.precio) ? euros(v.precio) : "—"}${
          precioCama !== null ? ` + cama ${euros(precioCama)}` : ""
        }</p>
        <div class="hop-pase-acc">
          ${v.url && escURL(v.url) !== "#" ? `<a class="btn primary small" href="${escURL(v.url)}" target="_blank" rel="noopener">Reservar vuelo ↗</a>` : ""}
          ${c && c.url && escURL(c.url) !== "#" ? `<a class="btn ghost small" href="${escURL(c.url)}" target="_blank" rel="noopener">Ver la cama ↗</a>` : ""}
        </div>
      </div>
    </div>`;
}

/* -------------------------------------------------------------- el buscador */
function enMarcha(campo) {
  const b = estado.hop[campo];
  if (!b || b.estado !== "buscando") return null;
  const desde = instante(b.lanzada);
  return { ...b, desde, pasado: Date.now() - desde };
}

function progresoHTML(b, tipico, que) {
  const pct = Math.min(95, Math.round((b.pasado / tipico) * 100));
  const min = Math.max(1, Math.round(b.pasado / 60000));
  const quedan = Math.max(0, Math.round((tipico - b.pasado) / 60000));
  return `<div class="hop-buscando">
      <div class="hop-avion" aria-hidden="true"><span>✈</span></div>
      <p><b>Buscando ${que} para el grupo…</b> lo lanzó ${esc(b.nombre || "alguien")} hace ${min} min.
        ${quedan ? `Suele tardar unos ${quedan} min más.` : "Está al caer."}</p>
      <div class="hop-barra-progreso" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"
        aria-label="Progreso de la búsqueda"><i style="width:${pct}%"></i></div>
      <p class="hop-letra">${esc(b.texto || "")}</p>
      <p class="hop-letra">Podéis cerrar la página: los resultados entran solos y os esperan aquí.</p>
    </div>`;
}

function pintarBuscar(app) {
  const caja = $("#hopBuscar", app);
  const estadoTxt = $("#hopEstadoVuelo", app);
  const b = enMarcha("busqueda");
  const vuelos = deTipo("vuelo");
  if (b && b.pasado < CADUCA_BUSQUEDA_MS) {
    estadoTxt.textContent = "buscando…";
    if (!caja.querySelector(".hop-buscando")) caja.innerHTML = progresoHTML(b, ESPERA_VUELOS_MS, "vuelos");
    else {
      const nuevo = document.createElement("div");
      nuevo.innerHTML = progresoHTML(b, ESPERA_VUELOS_MS, "vuelos");
      caja.querySelector(".hop-buscando").replaceWith(nuevo.firstElementChild);
    }
    return;
  }
  const v = ganadora("vuelo");
  estadoTxt.textContent = v ? `✓ ${v.titulo}` : vuelos.length ? `${vuelos.length} opciones · a votar` : "";
  const ultima = estado.hop.busqueda;
  if (vuelos.length && !estado.buscar) {
    caja.innerHTML = `<div class="hop-buscar-plegado">
        <span>${
          b
            ? "La última búsqueda tardó demasiado."
            : ultima && ultima.estado === "vacia"
              ? "La última búsqueda no encontró nada."
              : `Última búsqueda: ${esc((ultima && ultima.texto) || "")}`
        }</span>
        <button class="btn ghost small" type="button" data-hop-abrir-buscar>🔎 Nueva búsqueda</button>
      </div>`;
    caja.querySelector("[data-hop-abrir-buscar]").addEventListener("click", () => {
      estado.buscar = true;
      pintarBuscar(app);
    });
    return;
  }
  if (caja.querySelector("#hopBuscarForm")) return; // no se repinta un formulario a medio rellenar
  caja.innerHTML = formBuscar(b, ultima);
  montarFormBuscar(app, caja);
}

const manana = () => sumarDiasISO(hoyISO(), 1);
function sumarDiasISO(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formBuscar(atascada, ultima) {
  const fin = estado.hop.fin;
  const n = personasHop();
  return `<form class="hop-buscar" id="hopBuscarForm" novalidate>
      ${
        atascada
          ? `<div class="hop-aviso error">La última búsqueda tardó demasiado y no llegó nada. Probad otra vez.</div>`
          : ultima && ultima.estado === "vacia"
            ? `<div class="hop-aviso">La última búsqueda no encontró nada dentro del tope. Probad con más presupuesto
                u otras fechas.</div>`
            : `<p class="hop-buscar-lede">Decid de dónde salís y cuándo podéis: buscamos en <b>todas las compañías</b>
                y los resultados os salen aquí para votarlos.</p>`
      }
      <div class="hop-campos">
        <label class="hop-campo"><span>Salís de</span>
          <select name="origen">${ORIGENES.map(([c, nom]) => `<option value="${c}">${esc(nom)} (${c})</option>`).join("")}</select>
        </label>
        <div class="hop-campo"><span>¿A dónde?</span>
          <div class="hop-seg" data-seg="donde" role="radiogroup" aria-label="A dónde">
            <button type="button" role="radio" data-v="any" aria-checked="true">🌍 Donde sea</button>
            <button type="button" role="radio" data-v="one" aria-checked="false">📍 Un sitio</button>
          </div>
          <button type="button" class="hop-dest" id="hopDestBtn" hidden>Elegir destino</button>
          <input type="hidden" id="hopDest">
        </div>
        <div class="hop-campo hop-ancho"><span>¿Cuándo?</span>
          <div class="hop-seg" data-seg="cuando" role="radiogroup" aria-label="Cuándo">
            <button type="button" role="radio" data-v="findes" aria-checked="true">🗓 Un finde</button>
            <button type="button" role="radio" data-v="fechas" aria-checked="false">📅 Unas fechas</button>
            <button type="button" role="radio" data-v="tramo" aria-checked="false">↔ Entre dos fechas</button>
          </div>
          <div class="hop-fechas" data-para="fechas" hidden>
            <label><span>Ida</span><input type="date" name="ida" min="${manana()}" max="${esc(fin)}"></label>
            <label><span>Vuelta</span><input type="date" name="vuelta" min="${manana()}" max="${esc(fin)}"></label>
          </div>
          <div class="hop-fechas" data-para="tramo" hidden>
            <label><span>Desde</span><input type="date" name="desde" min="${manana()}" max="${esc(fin)}"></label>
            <label><span>Hasta</span><input type="date" name="hasta" min="${manana()}" max="${esc(fin)}" value="${esc(fin)}"></label>
            <label><span>Noches</span><select name="noches">${[2, 3, 4, 5, 7]
              .map((x) => `<option value="${x}"${x === 3 ? " selected" : ""}>${x}</option>`)
              .join("")}</select></label>
          </div>
          <small class="hop-letra" data-cuando-nota>Todos los findes de aquí al ${esc(fmtDate(fin))}.</small>
        </div>
        <label class="hop-campo"><span>Tope por persona · <output name="topeVer">150 €</output></span>
          <input type="range" name="tope" min="30" max="800" step="10" value="150">
        </label>
        <div class="hop-campo"><span>Personas</span>
          <div class="hop-stepper">
            <button type="button" data-paso="-1" aria-label="Una persona menos">−</button>
            <output name="personasVer">${n}</output>
            <button type="button" data-paso="1" aria-label="Una persona más">+</button>
          </div>
          <input type="hidden" name="personas" value="${n}">
        </div>
      </div>
      <div class="hop-horas" id="hopHorasWrap"><input type="hidden" id="hopHoras"></div>
      <div class="hop-buscar-pie">
        <button class="btn primary hop-lanzar" type="submit">🔎 Buscar para el grupo</button>
        ${deTipo("vuelo").length ? `<button class="btn ghost small" type="button" data-hop-cerrar-buscar>Cancelar</button>` : ""}
        <p class="hop-msg" role="status"></p>
      </div>
    </form>`;
}

function montarFormBuscar(app, caja) {
  const form = $("#hopBuscarForm", caja);
  const seg = (nombre) => form.querySelector(`[data-seg="${nombre}"] [aria-checked="true"]`)?.dataset.v;
  form.elements.origen.value = (estado.hop.busqueda && estado.hop.busqueda.origen) || "MAD";
  form.querySelectorAll(".hop-seg").forEach((g) =>
    g.addEventListener("click", (e) => {
      const b = e.target.closest("[data-v]");
      if (!b) return;
      g.querySelectorAll("[data-v]").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
      sincronizar();
    })
  );
  const sincronizar = () => {
    const donde = seg("donde");
    const cuando = seg("cuando");
    $("#hopDestBtn", form).hidden = donde !== "one";
    form.querySelectorAll("[data-para]").forEach((x) => (x.hidden = x.dataset.para !== cuando));
    form.querySelector("[data-cuando-nota]").hidden = cuando !== "findes";
  };
  sincronizar();
  $("#hopDestBtn", form).addEventListener("click", () => abrirDestinos("hopDest"));
  $("#hopDest", form).addEventListener("change", (e) => {
    $("#hopDestBtn", form).textContent = e.target.value || "Elegir destino";
  });
  const tope = form.elements.tope;
  tope.addEventListener("input", () => (form.elements.topeVer.value = `${tope.value} €`));
  form.querySelectorAll("[data-paso]").forEach((b) =>
    b.addEventListener("click", () => {
      const n = Math.min(8, Math.max(1, Number(form.elements.personas.value) + Number(b.dataset.paso)));
      form.elements.personas.value = String(n);
      form.elements.personasVer.value = String(n);
    })
  );
  montarHoras($("#hopHorasWrap", form), $("#hopHoras", form));
  form.querySelector("[data-hop-cerrar-buscar]")?.addEventListener("click", () => {
    estado.buscar = false;
    pintarBuscar(app);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = form.querySelector(".hop-msg");
    const donde = seg("donde");
    const cuando = seg("cuando");
    const dest = donde === "one" ? $("#hopDest", form).value.trim() : "";
    if (donde === "one" && !dest) return (msg.textContent = "Elegid el destino, o marcad «Donde sea».");
    const f = form.elements;
    const viaje = { origin: f.origen.value, depart: "", return_date: "", desde: "", hasta: "", camas: "", dias: "" };
    let weekend = "si";
    let nights = "2-3";
    let cuandoTxt = `findes hasta el ${fmtDate(estado.hop.fin)}`;
    if (cuando === "findes") {
      viaje.desde = manana();
      viaje.hasta = estado.hop.fin;
    } else if (cuando === "fechas") {
      if (!f.ida.value || !f.vuelta.value || f.vuelta.value <= f.ida.value) {
        return (msg.textContent = "Marcad la ida y la vuelta (la vuelta, después).");
      }
      viaje.depart = f.ida.value;
      viaje.return_date = f.vuelta.value;
      weekend = "no";
      cuandoTxt = `${fmtDate(f.ida.value)} → ${fmtDate(f.vuelta.value)}`;
    } else {
      if (!f.desde.value || !f.hasta.value || f.hasta.value <= f.desde.value) {
        return (msg.textContent = "Marcad desde cuándo y hasta cuándo podéis.");
      }
      viaje.desde = f.desde.value;
      viaje.hasta = f.hasta.value;
      weekend = "no";
      nights = `${f.noches.value}-${f.noches.value}`;
      cuandoTxt = `${f.noches.value} noches entre ${fmtDate(f.desde.value)} y ${fmtDate(f.hasta.value)}`;
    }
    const horas = $("#hopHoras", form).value;
    if (horas) viaje.horas = horas;
    const clave = `${estado.id.slice(0, 12).toLowerCase().replace(/[^a-z0-9]/g, "")}-${Date.now().toString(36)}`;
    viaje.clave = clave;
    const personas = Number(f.personas.value) || personasHop();
    const texto = [
      `${dest || "Donde sea"}${f.origen.value !== "MAD" ? ` desde ${f.origen.value}` : ""}`,
      cuandoTxt,
      `hasta ${f.tope.value} €`,
      `${personas} pers.`,
      horas ? textoHoras(horas) : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const boton = form.querySelector("button[type=submit]");
    boton.disabled = true;
    msg.textContent = "Lanzando…";
    const r = await dispatch("search", {
      dest,
      label: `HOP ${estado.hop.nombre}: ${texto}`.slice(0, 190),
      owner: tfUid(),
      max_price: f.tope.value,
      nights,
      months: "12",
      adults: String(personas),
      weekend,
      viaje,
    });
    boton.disabled = false;
    if (!r.ok) {
      if (esFaltaDeAcceso(r)) {
        const acceso = cajaAcceso(r);
        msg.innerHTML = acceso.html;
        acceso.wire();
      } else msg.textContent = `No se pudo lanzar: ${r.reason || ""}`;
      return;
    }
    const s = yo();
    const apunte = { clave, texto, por: s.uid, nombre: String(s.name || "").slice(0, 40), lanzada: new Date(), estado: "buscando" };
    estado.hop.busqueda = apunte;
    estado.buscar = false;
    caja.innerHTML = "";
    pintarViaje(app);
    nubeHopApuntar(estado.id, "busqueda", apunte);
    if (typeof tfAnunciar === "function") tfAnunciar("Búsqueda lanzada para el grupo. Tarda unos minutos.");
  });
}

/* Lo que está en marcha: se mira si ya ha llegado y, si sí, entra como tarjetas.
   Lo hace el primero del grupo que lo ve; si lo ven dos a la vez, las tarjetas
   llevan un id fijo y la segunda no duplica nada. */
async function comprobarBusquedas(app) {
  const b = enMarcha("busqueda");
  if (b && b.clave && !importando.has(b.clave) && b.pasado < CADUCA_BUSQUEDA_MS) {
    importando.add(b.clave);
    try {
      const datos = await resultadoDeBusqueda(b);
      if (datos) {
        const n = await importarVuelos(datos.offers || []);
        await nubeHopApuntar(estado.id, "busqueda", {
          clave: b.clave, texto: b.texto, por: b.por, nombre: b.nombre, lanzada: new Date(b.desde),
          estado: n ? "lista" : "vacia", n,
        });
        if (typeof tfAnunciar === "function") {
          tfAnunciar(n ? `Han llegado ${n} vuelos para votar.` : "La búsqueda no encontró vuelos dentro del tope.");
        }
        await cargarPropuestas(app);
      }
    } finally {
      importando.delete(b.clave);
    }
  }
  const c = enMarcha("cama");
  const clave = c && `cama-${c.oferta}`;
  if (c && c.oferta && !importando.has(clave) && c.pasado < CADUCA_BUSQUEDA_MS) {
    importando.add(clave);
    try {
      let datos = typeof nubeResultado === "function" ? await nubeResultado(`stay-${c.oferta}`) : null;
      if (!datos) {
        try {
          datos = await fetchJSON(`data/stays/${c.oferta}.json`);
          if (datos && datos.generated_at && datos.generated_at < new Date(c.desde).toISOString().slice(0, 10)) datos = null;
        } catch {
          datos = null;
        }
      }
      if (datos) {
        const n = await importarCamas(datos.stays || []);
        await nubeHopApuntar(estado.id, "cama", {
          oferta: c.oferta, texto: c.texto, por: c.por, nombre: c.nombre, lanzada: new Date(c.desde),
          estado: n ? "lista" : "vacia", n,
        });
        await cargarPropuestas(app);
      }
    } finally {
      importando.delete(clave);
    }
  }
}

async function resultadoDeBusqueda(b) {
  const rapido = typeof nubeResultado === "function" ? await nubeResultado(`busqueda-${b.clave}`) : null;
  if (rapido) return rapido;
  // Sin Firestore, lo publicado en Pages: la búsqueda con esa misma etiqueta,
  // hecha después de lanzarla.
  try {
    const indice = await fetchJSON("data/searches/index.json");
    const dia = new Date(b.desde).toISOString().slice(0, 10);
    const hecha = (indice.searches || []).find(
      (x) => x.label === `HOP ${estado.hop.nombre}: ${b.texto}`.slice(0, 190) && String(x.generated_at || "") >= dia
    );
    return hecha ? await fetchJSON(`data/searches/${hecha.slug}.json`) : null;
  } catch {
    return null;
  }
}

async function importarVuelos(ofertas) {
  const lista = [...ofertas].sort((a, b) => (a.price || 0) - (b.price || 0)).slice(0, MAX_VUELOS);
  await Promise.all(
    lista.map((o) => {
      const pax = Math.max(1, Number(o.adults) || 1);
      const ida = [o.depart_time, o.arrive_time].filter(Boolean).join("–");
      const vuelta = [o.return_time, o.return_arrive_time].filter(Boolean).join("–");
      return nubeProponer(estado.id, {
        pid: `v-${o.id}`,
        tipo: "vuelo",
        titulo: o.destination_name || o.destination,
        destino: o.destination_country || "",
        pais: o.destination_country || "",
        iata: o.destination || "",
        origen: o.origin || "",
        ida: o.depart_date,
        vuelta: o.return_date || "",
        precio: (Number(o.price) || 0) / pax,
        compania: o.airline_back && o.airline_back !== o.airline ? `${o.airline} + ${o.airline_back}` : o.airline || "",
        horario: [ida && `ida ${ida}`, vuelta && `vuelta ${vuelta}`, o.stops ? `${o.stops} escala${o.stops === 1 ? "" : "s"}` : "directo"]
          .filter(Boolean)
          .join(" · "),
        url: o.airline_link || o.deep_link || "",
        oferta: o.id,
      });
    })
  );
  return lista.length;
}

async function importarCamas(stays) {
  const lista = stays.slice(0, MAX_CAMAS);
  const pax = Math.max(1, Number((estado.hop.cama && estado.hop.cama.texto || "").match(/(\d+) pers/)?.[1]) || personasHop());
  await Promise.all(
    lista.map((c) =>
      nubeProponer(estado.id, {
        pid: `c-${hashCorto(c.url || c.name)}`,
        tipo: "cama",
        titulo: c.name || "Alojamiento",
        destino: c.area || "",
        precio: Number.isFinite(Number(c.price_total)) ? Number(c.price_total) / pax : "",
        url: c.url || "",
        foto: c.image || (Array.isArray(c.images) ? c.images[0] : "") || "",
        nota: [
          Number.isFinite(c.km_centro) ? `${String(c.km_centro).replace(".", ",")} km del centro` : "",
          c.rating ? `★ ${c.rating}${c.reviews ? ` (${c.reviews})` : ""}` : "",
          c.provider ? c.provider : "",
        ]
          .filter(Boolean)
          .join(" · "),
        oferta: estado.hop.cama ? estado.hop.cama.oferta : "",
      })
    )
  );
  return lista.length;
}

/* ----------------------------------------------------- las tarjetas de vuelos */
function votosHTML(p, compacto = false) {
  const n = puntos(p);
  const mio = (p.votos || {})[yo().uid] || "";
  return `<div class="hop-votos${compacto ? " compacto" : ""}" role="group" aria-label="Tu voto">
      ${VOTOS.map(
        ([v, rot, ico]) =>
          `<button type="button" class="hop-voto v-${v}" data-voto="${v}" aria-pressed="${mio === v}" title="${rot}">
            <span aria-hidden="true">${ico}</span><span class="${compacto ? "solo-lector" : ""}">${rot}</span> <b>${n[v]}</b></button>`
      ).join("")}
    </div>`;
}

function quienesHTML(p) {
  const nombres = estado.hop.nombres || {};
  const si = Object.entries(p.votos || {}).filter(([, v]) => v === "si").map(([u]) => u);
  return si.length
    ? `<span class="hop-avs mini">${si.map((u) => avatar(u, nombres[u] || "?")).join("")}</span>`
    : "";
}

function tarjetaVuelo(p, puesto) {
  const dias = noches(p.ida, p.vuelta);
  return `<article class="hop-vuelo${puesto === 1 && puntos(p).si ? " top" : ""}" data-prop="${esc(p.id)}">
      <div class="hop-vuelo-foto ${tono(p.iata || p.titulo)}">
        ${puesto <= 3 && puntos(p).si ? `<span class="hop-puesto">#${puesto}</span>` : ""}
        <span class="hop-bandera" aria-hidden="true">${banderaDe(p.pais || "") || "✈"}</span>
        <b>${esc(p.titulo)}</b>
        <small>${esc(p.pais || p.destino || "")}${p.iata ? ` · ${esc(p.iata)}` : ""}</small>
        <span class="hop-vuelo-precio">${Number.isFinite(p.precio) ? euros(p.precio) : "—"}<small>/pers.</small></span>
      </div>
      <div class="hop-vuelo-cuerpo">
        <p class="hop-vuelo-fechas">${esc(fmtDate(p.ida, true))} → ${esc(fmtDate(p.vuelta, true))}${
          dias ? ` · <b>${dias} noche${dias === 1 ? "" : "s"}</b>` : ""
        }</p>
        ${p.horario ? `<p class="hop-vuelo-dato">${esc(p.horario)}</p>` : ""}
        <p class="hop-vuelo-dato">${esc(p.compania || "")}${
          p.url && escURL(p.url) !== "#" ? ` · <a href="${escURL(p.url)}" target="_blank" rel="noopener">ver ↗</a>` : ""
        }</p>
        ${votosHTML(p, true)}
        <div class="hop-vuelo-pie">${quienesHTML(p)}<span class="hop-letra">${faltanTxt(p)}</span></div>
      </div>
    </article>`;
}

function faltanTxt(p) {
  const falta = (estado.hop.miembros || []).filter((u) => !(p.votos || {})[u]).length;
  return falta ? `falta${falta === 1 ? "" : "n"} ${falta}` : "han votado todos";
}

function pintarVuelos(app) {
  const caja = $("#hopVuelos", app);
  const lista = ordenadas(deTipo("vuelo"));
  if (!lista.length) {
    caja.innerHTML = "";
    return;
  }
  const pendientes = sinVotar(lista).length;
  caja.innerHTML = `<div class="hop-mazo-cab">
      <p><b>${lista.length} vuelos</b> · ordenados por lo que más gusta</p>
      ${
        pendientes
          ? `<button class="btn primary small" type="button" data-rapido="vuelo">⚡ Votar rápido · ${pendientes}</button>`
          : `<span class="hop-chip">✓ ya has votado todos</span>`
      }
    </div>
    <div class="hop-mazo">${lista.map((p, i) => tarjetaVuelo(p, i + 1)).join("")}</div>`;
  caja.querySelector("[data-rapido]")?.addEventListener("click", () => votarRapido(app, "vuelo"));
}

/* ------------------------------------------------------- dónde dormir */
function pintarCamas(app) {
  const caja = $("#hopCamas", app);
  const estadoTxt = $("#hopEstadoCama", app);
  const v = ganadora("vuelo");
  const c = enMarcha("cama");
  const camas = ordenadas(deTipo("cama"));
  const gana = ganadora("cama");
  estadoTxt.textContent = c ? "buscando…" : gana ? `✓ ${gana.titulo}` : camas.length ? `${camas.length} opciones` : "";
  let cabeza = "";
  if (c && c.pasado < CADUCA_BUSQUEDA_MS) {
    cabeza = progresoHTML(c, ESPERA_CAMA_MS, "dónde dormir");
  } else if (!v) {
    cabeza = `<div class="hop-bloqueado">🔒 Primero, el vuelo: en cuanto uno tenga un 👍, se busca cama para esas fechas.</div>`;
  } else if (!(estado.hop.cama && estado.hop.cama.oferta === v.oferta && estado.hop.cama.estado !== "buscando")) {
    cabeza = `<div class="hop-cta">
        <p>El vuelo que más gusta es <b>${esc(v.titulo)}</b>, ${esc(fmtDate(v.ida))} → ${esc(fmtDate(v.vuelta))}.</p>
        <button class="btn primary" type="button" data-hop-cama>🛏 Buscar dónde dormir para ${personasHop()}</button>
        <p class="hop-msg" role="status"></p>
      </div>`;
  }
  caja.innerHTML =
    cabeza +
    (camas.length
      ? `<div class="hop-mazo-cab">
          <p><b>${camas.length} sitios</b> · el precio es por persona</p>
          ${
            sinVotar(camas).length
              ? `<button class="btn primary small" type="button" data-rapido="cama">⚡ Votar rápido · ${sinVotar(camas).length}</button>`
              : ""
          }
        </div>
        <div class="hop-mazo camas">${camas.map((p, i) => tarjetaCama(p, i + 1)).join("")}</div>`
      : "");
  caja.querySelector("[data-rapido]")?.addEventListener("click", () => votarRapido(app, "cama"));
  caja.querySelector("[data-hop-cama]")?.addEventListener("click", (e) => buscarCama(app, v, e.currentTarget));
}

function tarjetaCama(p, puesto) {
  return `<article class="hop-vuelo hop-cama${puesto === 1 && puntos(p).si ? " top" : ""}" data-prop="${esc(p.id)}">
      <div class="hop-vuelo-foto hop-cama-foto ${tono(p.titulo)}"${
        p.foto && escURL(p.foto) !== "#" ? ` style="background-image:url('${escURL(p.foto)}')"` : ""
      }>
        ${puesto <= 3 && puntos(p).si ? `<span class="hop-puesto">#${puesto}</span>` : ""}
        <span class="hop-vuelo-precio">${Number.isFinite(p.precio) ? euros(p.precio) : "—"}<small>/pers.</small></span>
      </div>
      <div class="hop-vuelo-cuerpo">
        <p class="hop-cama-nombre">${esc(p.titulo)}</p>
        ${p.destino ? `<p class="hop-vuelo-dato">${esc(p.destino)}</p>` : ""}
        ${p.nota ? `<p class="hop-vuelo-dato">${esc(p.nota)}</p>` : ""}
        ${p.url && escURL(p.url) !== "#" ? `<p class="hop-vuelo-dato"><a href="${escURL(p.url)}" target="_blank" rel="noopener">ver el sitio ↗</a></p>` : ""}
        ${votosHTML(p, true)}
        <div class="hop-vuelo-pie">${quienesHTML(p)}<span class="hop-letra">${faltanTxt(p)}</span></div>
      </div>
    </article>`;
}

async function buscarCama(app, v, boton) {
  const msg = boton.parentElement.querySelector(".hop-msg");
  boton.disabled = true;
  const n = personasHop();
  const r = await dispatch("stay", {
    offer_id: v.oferta,
    city: v.titulo,
    country: v.pais || "",
    iata: v.iata || "",
    checkin: v.ida,
    checkout: v.vuelta || "",
    adults: String(n),
  });
  boton.disabled = false;
  if (!r.ok) {
    if (esFaltaDeAcceso(r)) {
      const acceso = cajaAcceso(r);
      msg.innerHTML = acceso.html;
      acceso.wire();
    } else msg.textContent = `No se pudo lanzar: ${r.reason || ""}`;
    return;
  }
  const s = yo();
  const apunte = {
    oferta: v.oferta,
    texto: `${v.titulo} · ${fmtDate(v.ida)} → ${fmtDate(v.vuelta)} · ${n} pers.`,
    por: s.uid,
    nombre: String(s.name || "").slice(0, 40),
    lanzada: new Date(),
    estado: "buscando",
  };
  estado.hop.cama = apunte;
  pintarViaje(app);
  nubeHopApuntar(estado.id, "cama", apunte);
}

/* ---------------------------------------------------------- votar rápido
   Una tarjeta grande cada vez, con tres botones (o ← ↓ →): lo que haces con
   el pulgar en cualquier app de citas, para no tener que bajar por doce
   tarjetas buscando cuál te falta. */
function votarRapido(app, tipo) {
  const cola = sinVotar(ordenadas(deTipo(tipo)));
  if (!cola.length) return;
  let i = 0;
  const capa = document.createElement("div");
  capa.className = "hop-rapido";
  capa.setAttribute("role", "dialog");
  capa.setAttribute("aria-modal", "true");
  capa.setAttribute("aria-label", "Votar rápido");
  document.body.appendChild(capa);
  const cerrar = () => {
    document.removeEventListener("keydown", teclas);
    capa.remove();
    pintarViaje(app);
  };
  const pintar = () => {
    const p = cola[i];
    if (!p) {
      capa.innerHTML = `<div class="hop-rapido-caja fin">
          <p class="hop-rapido-emoji" aria-hidden="true">🎉</p>
          <h3>¡Ya está!</h3>
          <p>Has votado todo. Lo que más guste al grupo sube al resumen.</p>
          <button class="btn primary" type="button" data-cerrar-rapido>Volver al viaje</button>
        </div>`;
      capa.querySelector("[data-cerrar-rapido]").addEventListener("click", cerrar);
      capa.querySelector("[data-cerrar-rapido]").focus();
      return;
    }
    capa.innerHTML = `<div class="hop-rapido-caja">
        <div class="hop-rapido-cab"><span>${i + 1} de ${cola.length}</span>
          <button type="button" class="quitar" data-cerrar-rapido aria-label="Cerrar">cerrar</button></div>
        <div class="hop-rapido-tarjeta">${tipo === "cama" ? tarjetaCama(p, 99) : tarjetaVuelo(p, 99)}</div>
        <div class="hop-rapido-botones">
          <button type="button" class="hop-rapido-b no" data-rv="no" aria-label="No puedo">✖<small>No</small></button>
          <button type="button" class="hop-rapido-b quiza" data-rv="quiza" aria-label="Puede">🤔<small>Puede</small></button>
          <button type="button" class="hop-rapido-b si" data-rv="si" aria-label="Me encaja">❤<small>Me encaja</small></button>
        </div>
        <p class="hop-letra hop-rapido-teclas">Con el teclado: ← no · ↓ puede · → me encaja</p>
      </div>`;
    capa.querySelector(".hop-rapido-tarjeta .hop-votos")?.remove();
    capa.querySelector("[data-cerrar-rapido]").addEventListener("click", cerrar);
    capa.querySelectorAll("[data-rv]").forEach((b) => b.addEventListener("click", () => votarYSeguir(b.dataset.rv)));
    capa.querySelector('[data-rv="si"]').focus();
  };
  const votarYSeguir = (voto) => {
    const p = cola[i];
    const tarjeta = capa.querySelector(".hop-rapido-tarjeta");
    if (tarjeta) tarjeta.classList.add(`sale-${voto}`);
    p.votos = { ...p.votos, [yo().uid]: voto };
    nubeVotar(estado.id, p.id, voto).then((r) => {
      if (!r.ok) {
        delete p.votos[yo().uid];
        alert(r.error);
      }
    });
    setTimeout(() => {
      i += 1;
      pintar();
    }, 220);
  };
  const teclas = (e) => {
    if (e.key === "Escape") return cerrar();
    if (!cola[i]) return;
    const voto = { ArrowLeft: "no", ArrowDown: "quiza", ArrowRight: "si" }[e.key];
    if (voto) {
      e.preventDefault();
      votarYSeguir(voto);
    }
  };
  document.addEventListener("keydown", teclas);
  pintar();
}
