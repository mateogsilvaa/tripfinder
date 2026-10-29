/* hop.js — El modo HOP: decidir un viaje en grupo.

   Un HOP es un grupo con una fecha de caducidad que decide un viaje por fases:
   cuándo, dónde no, buscar (y guardar lo que convence), votar lo guardado y
   el plan del ganador, que se puede retocar. Ver «LAS FASES», más abajo. El
   chat va plegado en un botón.

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
import { creditoHTML, fotosDe, huecoFoto, ponerFotos } from "./fotos.js";
import {
  buscarCiudades,
  codigosDeCiudades,
  codigosDelFiltro,
  montarFiltroDestinos,
  textoFiltro,
} from "./filtro-destinos.js";

const $ = (s, raiz = document) => raiz.querySelector(s);
const CADA_CHAT_MS = 4000;
const CADA_PROPUESTAS_MS = 8000;
const PROPUESTA_PENDIENTE = "tf_hop_propuesta";

const NUEVO = () => ({ propuestas: [], mensajes: [], resultados: null, camas: {}, abierta: "", ver: 0, buscar: false });
let estado = { id: "", hop: null, vista: "props", ...NUEVO() };
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
        <p>Crea un grupo, invita a los tuyos con un enlace y decidid el viaje paso a paso: las fechas, las
          ciudades que no, buscar y guardar lo que os guste, votarlo y el plan final.</p>
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
      <div class="hop-ilus-tarjeta t1"><b>Oporto</b><span>48 € · 4 se apuntan</span><i style="--n:.8"></i></div>
      <div class="hop-ilus-tarjeta dos t4"><b>Roma</b><span>72 € · 2 se apuntan</span><i style="--n:.4"></i></div>
      <div class="hop-ilus-burbuja">¿Oporto o Roma?</div>
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
  estado = { ...estado, ...NUEVO(), id, hop };
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

const puntos = (p) => {
  const v = Object.values(p.votos || {});
  return { si: v.filter((x) => x === "si").length, quiza: v.filter((x) => x === "quiza").length, no: v.filter((x) => x === "no").length };
};
const nota = (p) => {
  const n = puntos(p);
  return n.si * 2 + n.quiza - n.no * 0.5;
};

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
    caja.innerHTML = `<p class="hop-chat-vacio">Aquí se habla del viaje. Di hola.</p>`;
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

/* Los dibujos: trazos de 24 × 24, del color del texto. Nada de emojis, que
   cada sistema pinta a su manera y en una carta de destino se comen la foto. */
const TRAZOS = {
  avion: '<path d="M21 3 3 10.4l7.2 2.4L12.6 20z"/><path d="m10.2 12.8 4.6-4.6"/>',
  cama: '<path d="M3 18.5V8M21 18.5V13a3 3 0 0 0-3-3h-7v5"/><path d="M3 15h18"/><circle cx="7" cy="11.5" r="1.8"/>',
  lupa: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  si: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  no: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  quiza: '<path d="M9 9.2a3.2 3.2 0 1 1 4.6 2.9c-.9.4-1.6 1.2-1.6 2.2v.4"/><path d="M12 18.4v.1"/>',
  cartas: '<rect x="8" y="3" width="12" height="16" rx="2"/><path d="M5.5 6.6 4 7.1a1.6 1.6 0 0 0-1 2l3.5 10.6a1.6 1.6 0 0 0 2 1l5.5-1.8"/>',
  candado: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  calendario: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  corona: '<path d="m3.5 8 4.4 3.8L12 5l4.1 6.8L20.5 8l-1.8 10H5.3z"/>',
  globo: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.7 2.6 14.3 0 17M12 3.5c-2.6 2.7-2.6 14.3 0 17"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  fuera: '<path d="M7 17 17 7M9 7h8v8"/>',
  reloj: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  gente: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0"/><path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.5 19.5a5.5 5.5 0 0 0-3-4.9"/>',
  enlace: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  chat: '<path d="M20 12a7.5 7.5 0 0 1-11 6.6L4 20l1.4-4.4A7.5 7.5 0 1 1 20 12z"/>',
  ajustes: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
};
const ico = (n, tam = 18) =>
  `<svg class="ico" viewBox="0 0 24 24" width="${tam}" height="${tam}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${TRAZOS[n] || ""}</svg>`;

/* ================================================================ LAS FASES
   Un viaje en grupo se decide por partes, y en ese orden:

   1. CUÁNDO. Se proponen fechas, se votan y se fija una (o «nos da igual»).
   2. DÓNDE NO. Cada cual tacha hasta tres ciudades; fuera quedan las que tache
      MÁS DE UN TERCIO del grupo. Uno solo no veta por todos.
   3. BUSCAR. Con las fechas y sin lo tachado. Los resultados los ve todo el
      grupo; lo que convence a alguien se GUARDA (el vuelo, o el vuelo con un
      alojamiento), y solo lo guardado pasa a votarse.
   4. VOTAR entre lo guardado: me apunto, puede o paso, o deslizando.
   5. EL PLAN: el ganador, que se puede retocar (otra hora, otro sitio para
      dormir, una nota) sin volver a empezar.

   La fase es del grupo (`hop.fase`): cualquiera pasa a la siguiente, y
   cualquiera puede mirar las otras (`estado.ver`) sin moverla. El chat va
   plegado en un botón: está para cuando hace falta, no delante de todo. */
const FASES = [
  [1, "Cuándo", "calendario"],
  [2, "Dónde no", "no"],
  [3, "Buscar", "lupa"],
  [4, "Votar", "si"],
  [5, "El plan", "corona"],
];
const ESPERA_VUELOS_MS = 8 * 60e3; // lo que suele tardar un barrido
const ESPERA_CAMA_MS = 3 * 60e3;
const CADUCA_BUSQUEDA_MS = 35 * 60e3; // más que esto, algo ha ido mal
const MAX_RESULTADOS = 30;
const MAX_CAMAS = 6;
const TOPES = [50, 80, 100, 150, 200, 300, 500, 800];

const fase = () => Math.min(5, Math.max(1, Number(estado.hop.fase) || 1));
const deTipo = (t) =>
  t === "guardada" ? guardadas() : estado.propuestas.filter((p) => p.tipo === t);
const guardadas = () => estado.propuestas.filter((p) => p.tipo === "vuelo" || p.tipo === "viaje");
const porVotos = (a, b) => nota(b) - nota(a) || (a.precio ?? 1e9) - (b.precio ?? 1e9);
const ordenadas = (lista) => [...lista].sort(porVotos);
const ganadora = (t) => ordenadas(deTipo(t)).find((p) => puntos(p).si > 0) || null;
const personasHop = () => Math.min(8, Math.max(1, (estado.hop.miembros || []).length));
const euros = (n) => `${Math.round(n)} €`;
const sinVotar = (lista) => lista.filter((p) => !(p.votos || {})[yo().uid]);
const enlaceOk = (u) => !!u && escURL(u) !== "#";
const manana = () => sumarDiasISO(hoyISO(), 1);
function sumarDiasISO(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function hashCorto(t) {
  let h = 0;
  for (const c of String(t)) h = (h * 33 + c.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

/* Repintar SOLO SI HA CAMBIADO: el sondeo pasa cada pocos segundos y repintar
   igual borraría el foco del teclado, las fotos ya puestas y lo que estés
   escribiendo. */
function pintarSi(caja, html) {
  if (!caja) return false;
  const huella = hashCorto(html);
  if (caja.dataset.huella === huella) return false;
  caja.dataset.huella = huella;
  caja.innerHTML = html;
  return true;
}

function pintarHop(app, pendiente) {
  const s = yo();
  const { hop } = estado;
  const nombres = hop.nombres || {};
  const miembros = hop.miembros || [];
  const mia = hop.creador === s.uid;
  const nueva = new URLSearchParams(location.search).get("nueva") === "1";
  const quedan = Math.max(0, Math.ceil((parseISO(hop.fin) - parseISO(hoyISO())) / 864e5));
  const gente =
    miembros.length <= 3
      ? miembros.map((u) => nombres[u] || "?").join(", ")
      : `${miembros.slice(0, 2).map((u) => nombres[u] || "?").join(", ")} y ${miembros.length - 2} más`;
  estado.ver = estado.ver || fase();
  app.innerHTML = `
    <a class="hop-volver" href="hop">← Tus HOP</a>
    <header class="hopx-portada">
      <div class="hopx-portada-velo">
        <p class="hopx-kicker">HOP · ${
          quedan > 0 ? `quedan ${quedan} día${quedan === 1 ? "" : "s"} para decidir` : "hoy es el último día"
        } · hasta el ${esc(fmtDate(hop.fin, true))}</p>
        <h2>${esc(hop.nombre)}</h2>
        ${hop.descripcion ? `<p class="hop-desc">${esc(hop.descripcion)}</p>` : ""}
        <div class="hopx-gente">
          <div class="hop-avs">${miembros
            .slice(0, 8)
            .map((u) => avatar(u, `${nombres[u] || "?"}${u === hop.creador ? " (organiza)" : ""}`))
            .join("")}</div>
          <span>${esc(gente)}</span>
        </div>
      </div>
      <div class="hopx-portada-acc">
        <button class="btn primary small" type="button" id="hopInvitar">${ico("enlace", 16)} Invitar</button>
        ${
          mia
            ? `<button class="btn ghost small" type="button" id="hopEditar">Editar</button>
               <button class="btn ghost small" type="button" id="hopBorrar">Borrar</button>`
            : `<button class="btn ghost small" type="button" id="hopSalir">Salir</button>`
        }
      </div>
    </header>
    <div class="hop-invitacion" id="hopInvitacion" ${nueva ? "" : "hidden"}>
      <span>${nueva ? "<b>HOP creado.</b> Pasa este enlace a los tuyos para que entren:" : "El enlace para entrar:"}</span>
      <code id="hopEnlace">${esc(enlaceHop(hop.id))}</code>
      <button class="btn ghost small" type="button" id="hopCopiar">Copiar</button>
    </div>
    <div class="hop-editar" id="hopEditarCaja" hidden></div>
    <nav class="hopx-fases" id="hopFases" aria-label="Las fases del viaje"></nav>
    <section class="hop-plan hopx-fase" id="hopFase" aria-live="polite"></section>

    <button class="hopx-chat-boton" type="button" id="hopChatBoton" aria-expanded="false" aria-controls="hopChat">
      ${ico("chat", 20)}<span>Chat</span><i id="hopNuevos"></i></button>
    <aside class="hop-chat hopx-chat" id="hopChat" aria-labelledby="hopChatTit" hidden>
      <header class="hopx-chat-cab">
        <h3 id="hopChatTit">Chat del grupo</h3>
        <button type="button" class="hopx-cerrar" data-cerrar-chat aria-label="Cerrar el chat">${ico("no", 18)}</button>
      </header>
      <div class="hop-mensajes" id="hopMensajes" aria-live="polite"></div>
      <form class="hop-escribir" id="hopEscribir">
        <textarea name="texto" rows="1" maxlength="1000" placeholder="Escribe al grupo…" aria-label="Mensaje"></textarea>
        <button class="btn primary small" type="submit">Enviar</button>
      </form>
    </aside>`;

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

  // El chat, plegado: se abre y se cierra con su botón (o con Escape).
  const chat = $("#hopChat", app);
  const botonChat = $("#hopChatBoton", app);
  const abrirChat = (abrir) => {
    chat.hidden = !abrir;
    botonChat.setAttribute("aria-expanded", String(abrir));
    estado.vista = abrir ? "chat" : "props";
    if (abrir) {
      $("#hopNuevos", app).textContent = "";
      bajarChat(app, true);
      chat.querySelector("textarea").focus();
    } else botonChat.focus();
  };
  botonChat.addEventListener("click", () => abrirChat(chat.hidden));
  chat.querySelector("[data-cerrar-chat]").addEventListener("click", () => abrirChat(false));
  chat.addEventListener("keydown", (e) => {
    if (e.key === "Escape") abrirChat(false);
  });

  $("#hopFases", app).addEventListener("click", (e) => {
    const b = e.target.closest("[data-ver-fase]");
    if (!b) return;
    estado.ver = Number(b.dataset.verFase);
    pintarViaje(app);
  });
  $("#hopFase", app).addEventListener("click", (e) => alTocarFase(app, e));
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

  // Lo que llega del feed («proponer este viaje en un HOP») se guarda como idea.
  if (pendiente) {
    estado.ver = 3;
    pintarViaje(app);
    abrirFormProp(app, "viaje", pendiente);
    olvidarPendiente();
  }
}

async function cargarPropuestas(app) {
  try {
    const [props, hop] = await Promise.all([nubePropuestas(estado.id), nubeHop(estado.id).catch(() => null)]);
    estado.propuestas = props;
    if (hop) {
      // Si el grupo ha pasado de fase, se le sigue (salvo que estés mirando otra).
      if (hop.fase !== estado.hop.fase && estado.ver === fase()) estado.ver = Math.min(5, Math.max(1, Number(hop.fase) || 1));
      estado.hop = hop;
    }
  } catch {
    return;
  }
  pintarViaje(app);
  comprobarBusquedas(app);
}

/* ----------------------------------------------------------------- pintar */
export function pintarViaje(app) {
  const caja = $("#hopFase", app);
  if (!caja) return;
  pintarFases(app);
  if (caja.dataset.fase !== String(estado.ver)) {
    caja.dataset.fase = String(estado.ver);
    caja.dataset.huella = "";
    caja.innerHTML = esqueleto(estado.ver);
    montarFase(app, estado.ver);
  }
  [null, pintarFase1, pintarFase2, pintarFase3, pintarFase4, pintarFase5][estado.ver](app);
  ponerFotos(caja);
}

function pintarFases(app) {
  const actual = fase();
  pintarSi(
    $("#hopFases", app),
    `<ol class="hopx-fases-lista" style="--hecho:${(actual - 1) / (FASES.length - 1)}">${FASES.map(
      ([n, t]) => `<li class="${n < actual ? "hecho" : ""}${n === actual ? " actual" : ""}${n === estado.ver ? " viendo" : ""}">
          <button type="button" data-ver-fase="${n}" ${n === estado.ver ? 'aria-current="step"' : ""}>
            <span class="hopx-fases-n">${n < actual ? ico("si", 14) : n}</span><span>${t}</span>
          </button>
        </li>`
    ).join("")}</ol>`
  );
}

function esqueleto(n) {
  const [, titulo] = FASES[n - 1];
  const intro = {
    1: "Proponed fechas y votadlas. Cuando una convenza, se fija y se pasa a lo siguiente.",
    2: `Cada uno puede tachar hasta <b>3 ciudades</b>. Se quitan de la búsqueda las que tache <b>más de un tercio</b>
        del grupo: uno solo no veta por todos.`,
    3: "Buscad vuelos (y dónde dormir). Lo que os convenza, guardadlo: solo lo guardado pasa a votarse.",
    4: "Votad entre lo guardado. Lo que más guste al grupo es el plan.",
    5: "El ganador. Si algo no cuadra (otra hora, otro sitio para dormir), se retoca aquí.",
  }[n];
  const cuerpo = {
    1: `<div id="f1Fijadas"></div><div class="hopx-mazo fechas" id="f1Lista"></div>
        <form class="hopx-proponer" id="f1Form" novalidate>
          <p class="hopx-proponer-tit">Proponer unas fechas</p>
          <label><span>Ida</span><input type="date" name="ida" min="${manana()}" max="${esc(estado.hop.fin)}" required></label>
          <label><span>Vuelta</span><input type="date" name="vuelta" min="${manana()}" max="${esc(estado.hop.fin)}" required></label>
          <label class="ancho"><span>Un nombre <i>(opcional)</i></span><input name="titulo" maxlength="80" placeholder="Puente de diciembre"></label>
          <button class="btn primary small" type="submit">Proponer</button>
          <p class="hop-msg" role="status"></p>
        </form>`,
    2: `<div class="hopx-vetos">
          <div class="hopx-vetos-mios">
            <p class="hopx-sub">Tus tachadas <span id="f2Cuenta"></span></p>
            <div class="hopx-chips" id="f2Mias"></div>
            <label class="filtro-buscar"><span class="solo-lector">Tachar una ciudad</span>
              <input type="search" id="f2Buscar" placeholder="Tachar una ciudad: Londres, Roma…" autocomplete="off"></label>
            <div class="filtro-resultados" id="f2Res"></div>
          </div>
          <div class="hopx-vetos-todos">
            <p class="hopx-sub">Lo que ha tachado el grupo</p>
            <div id="f2Todas"></div>
          </div>
        </div>`,
    3: `<div id="f3Buscar"></div><div id="f3Res"></div>`,
    4: `<div id="f4Lista"></div>`,
    5: `<div id="f5Plan"></div><div id="f5Editar"></div>`,
  }[n];
  return `<header class="hopx-fase-cab">
      <span class="hopx-n" aria-hidden="true">0${n}</span>
      <h3>${titulo}</h3>
      <span class="hopx-estado" id="hopFaseEstado"></span>
    </header>
    <p class="hopx-intro">${intro}</p>
    ${cuerpo}
    <div class="hopx-fase-pie" id="hopFasePie"></div>
    <div id="hopFormProp"></div>`;
}

/* Lo que no se repinta con el sondeo: formularios y buscadores. */
function montarFase(app, n) {
  if (n === 1) {
    const form = $("#f1Form", app);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = form.elements;
      const msg = form.querySelector(".hop-msg");
      if (!f.ida.value || !f.vuelta.value || f.vuelta.value <= f.ida.value) {
        msg.textContent = "Marca la ida y la vuelta (la vuelta, después).";
        return;
      }
      const titulo = f.titulo.value.trim() || `${fmtDate(f.ida.value)} → ${fmtDate(f.vuelta.value)}`;
      const r = await nubeProponer(estado.id, { tipo: "fechas", titulo, ida: f.ida.value, vuelta: f.vuelta.value });
      if (!r.ok) {
        msg.textContent = r.error;
        return;
      }
      form.reset();
      msg.textContent = "";
      cargarPropuestas(app);
    });
  }
  if (n === 2) {
    const input = $("#f2Buscar", app);
    const res = $("#f2Res", app);
    input.addEventListener("input", async () => {
      const q = input.value;
      const lista = await buscarCiudades(q, 6);
      if (input.value !== q) return;
      res.innerHTML = q.trim().length < 2
        ? ""
        : lista.length
          ? lista
              .map(
                (c) => `<button type="button" class="filtro-res" data-tachar="${esc(`${c.k}`)}" data-n="${esc(c.n)}">${ico(
                  "no",
                  14
                )} ${esc(c.n)} <small>${esc(c.pais)}</small></button>`
              )
              .join("")
          : `<p class="filtro-nada">No sale ninguna ciudad con «${esc(q)}».</p>`;
    });
  }
  if (n === 3) {
    $("#f3Buscar", app).dataset.huella = "";
  }
}

/* ------------------------------------------------------- fase 1: cuándo */
function pintarFase1(app) {
  const fechas = ordenadas(deTipo("fechas"));
  const top = ganadora("fechas");
  const fijadas = estado.hop.fechas;
  $("#hopFaseEstado", app).textContent = fijadas
    ? `fijadas: ${fmtDate(fijadas.ida)} → ${fmtDate(fijadas.vuelta)}`
    : fechas.length
      ? `${fechas.length} propuesta${fechas.length === 1 ? "" : "s"}`
      : "";
  pintarSi(
    $("#f1Fijadas", app),
    fijadas
      ? `<div class="hopx-hecho">${ico("si", 18)} <p>Fechas fijadas: <b>${esc(fmtDate(fijadas.ida, true))} → ${esc(
          fmtDate(fijadas.vuelta, true)
        )}</b>. Si cambiáis de idea, fijad otras.</p></div>`
      : ""
  );
  pintarSi(
    $("#f1Lista", app),
    fechas.length
      ? fechas.map((p) => cartaFechas(p, p === top)).join("")
      : `<div class="hop-vacio"><b>Aún no hay fechas.</b> Proponed las que os vengan bien aquí abajo.</div>`
  );
  pintarSi(
    $("#hopFasePie", app),
    `${
      top
        ? `<button class="btn primary" type="button" data-fijar="${esc(top.id)}">Fijar ${esc(top.titulo)} y seguir →</button>`
        : ""
    }
    <button class="btn ghost small" type="button" data-sin-fechas>${fijadas ? "Seguir con estas →" : "Nos da igual la fecha →"}</button>`
  );
}

function cartaFechas(p, lider) {
  const dias = noches(p.ida, p.vuelta);
  return `<article class="hopx-fechas-carta${lider ? " lider" : ""}" data-prop="${esc(p.id)}">
      ${lider ? `<span class="hopx-lider">la más votada</span>` : ""}
      <p class="hopx-fechas-grande">${esc(fmtDate(p.ida, true))}<span>→</span>${esc(fmtDate(p.vuelta, true))}</p>
      <p class="hop-letra">${[
        p.titulo && !p.titulo.startsWith(fmtDate(p.ida)) ? esc(p.titulo) : "",
        dias ? `${dias} noche${dias === 1 ? "" : "s"}` : "",
      ]
        .filter(Boolean)
        .join(" · ")}</p>
      ${medidorHTML(p)}
      ${votarHTML(p)}
      <div class="hopx-carta-pie">${quienesHTML(p)}<span class="hop-letra">${faltanTxt(p)}</span>${borrarHTML(p)}</div>
    </article>`;
}

/* ------------------------------------------------------ fase 2: dónde no */
const nombreCiudad = (k) => String(k).split("|")[0];
function vetos() {
  const todos = estado.hop.vetos || {};
  const miembros = estado.hop.miembros || [];
  const cuenta = new Map();
  for (const u of miembros) for (const k of todos[u] || []) cuenta.set(k, [...(cuenta.get(k) || []), u]);
  const umbral = miembros.length / 3;
  return [...cuenta.entries()]
    .map(([k, quienes]) => ({ k, n: nombreCiudad(k), quienes, fuera: quienes.length > umbral }))
    .sort((a, b) => b.quienes.length - a.quienes.length || a.n.localeCompare(b.n, "es"));
}
const misVetos = () => (estado.hop.vetos || {})[yo().uid] || [];

function pintarFase2(app) {
  const mios = misVetos();
  const todos = vetos();
  const nombres = estado.hop.nombres || {};
  const total = (estado.hop.miembros || []).length;
  const fuera = todos.filter((v) => v.fuera);
  $("#hopFaseEstado", app).textContent = fuera.length ? `${fuera.length} fuera` : "";
  $("#f2Cuenta", app).textContent = `· ${mios.length} de 3`;
  $("#f2Buscar", app).disabled = mios.length >= 3;
  $("#f2Buscar", app).placeholder = mios.length >= 3 ? "Ya has tachado tres" : "Tachar una ciudad: Londres, Roma…";
  pintarSi(
    $("#f2Mias", app),
    mios.length
      ? mios
          .map(
            (k) => `<button type="button" class="filtro-chip no" data-destachar="${esc(k)}" aria-label="Quitar ${esc(
              nombreCiudad(k)
            )}">${esc(nombreCiudad(k))}<span aria-hidden="true">×</span></button>`
          )
          .join("")
      : `<span class="filtro-nada">No has tachado nada.</span>`
  );
  pintarSi(
    $("#f2Todas", app),
    todos.length
      ? `<ul class="hopx-veto-lista">${todos
          .map((v) => {
            const pct = Math.round((v.quienes.length / Math.max(1, total)) * 100);
            return `<li class="${v.fuera ? "fuera" : ""}">
                <div class="hopx-veto-cab"><b>${esc(v.n)}</b>
                  <span>${v.fuera ? "fuera de la búsqueda" : `${v.quienes.length} de ${total}`}</span></div>
                <div class="hopx-veto-barra" aria-hidden="true"><i style="width:${pct}%"></i><em style="left:33.4%"></em></div>
                <p class="hop-letra">${esc(v.quienes.map((u) => nombres[u] || "?").join(", "))}</p>
              </li>`;
          })
          .join("")}</ul>`
      : `<div class="hop-vacio"><b>Nadie ha tachado nada.</b> Si a todos os vale cualquier sitio, seguid.</div>`
  );
  pintarSi(
    $("#hopFasePie", app),
    `<button class="btn primary" type="button" data-ir-fase="3">Seguir a buscar →</button>
     ${fuera.length ? `<span class="hop-letra">No se buscará en: ${esc(fuera.map((v) => v.n).join(", "))}</span>` : ""}`
  );
}

/* ------------------------------------------------------- fase 3: buscar */
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
  return `<div class="hop-buscando hopx-buscando">
      <span class="spin" aria-hidden="true"></span>
      <div class="hopx-buscando-txt">
        <p><b>Buscando ${que} para el grupo…</b></p>
        <p class="hop-letra">Lo lanzó ${esc(b.nombre || "alguien")} hace ${min} min · ${
          quedan ? `suele tardar unos ${quedan} min más` : "está al caer"
        }</p>
        <div class="hop-barra-progreso" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"
          aria-label="Progreso de la búsqueda"><i style="width:${pct}%"></i></div>
        <p class="hop-letra">${esc(b.texto || "")}</p>
        <p class="hop-letra">Podéis cerrar la página: los resultados os esperan aquí.</p>
      </div>
    </div>`;
}

function pintarFase3(app) {
  const caja = $("#f3Buscar", app);
  const b = enMarcha("busqueda");
  const res = estado.resultados;
  const n = guardadas().length;
  $("#hopFaseEstado", app).textContent = b ? "buscando…" : n ? `${n} guardada${n === 1 ? "" : "s"}` : "";
  if (b && b.pasado < CADUCA_BUSQUEDA_MS) {
    pintarSi(caja, progresoHTML(b, ESPERA_VUELOS_MS, "vuelos"));
  } else if (res && res.ofertas.length && !estado.buscar) {
    if (
      pintarSi(
        caja,
        `<div class="hopx-plegado"><span>${ico("lupa", 16)} ${esc(res.texto || "")}</span>
          <button class="btn ghost small" type="button" data-hop-abrir-buscar>Buscar otra cosa</button></div>`
      )
    ) {
      caja.querySelector("[data-hop-abrir-buscar]").addEventListener("click", () => {
        estado.buscar = true;
        pintarFase3(app);
      });
    }
  } else if (!caja.querySelector("#hopBuscarForm")) {
    caja.dataset.huella = "";
    caja.innerHTML = formBuscar(b, estado.hop.busqueda);
    montarFormBuscar(app, caja);
  }
  pintarResultados(app);
  pintarSi(
    $("#hopFasePie", app),
    `${n ? `<button class="btn primary" type="button" data-ir-fase="4">Votar entre las ${n} guardadas →</button>` : ""}
     <button class="btn ghost small" type="button" data-idea-mano>+ Guardar una idea a mano</button>`
  );
}

/* El buscador es UNA FRASE: «Salimos de Madrid el 11 dic y volvemos el 13 hacia
   cualquier sitio, sin pasar de 150 € por cabeza. Somos 4.» Cada trozo
   subrayado se toca. Con las fechas fijadas en la fase 1 ya no se preguntan. */
function formBuscar(atascada, ultima) {
  const fin = estado.hop.fin;
  const fijadas = estado.hop.fechas;
  const n = personasHop();
  const fuera = vetos().filter((v) => v.fuera);
  const sel = (nombre, opciones, elegida, etiqueta) =>
    `<select class="hopx-pieza" name="${nombre}" aria-label="${etiqueta}">${opciones
      .map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(elegida) ? " selected" : ""}>${esc(t)}</option>`)
      .join("")}</select>`;
  const fecha = (nombre, etiqueta, valor = "") =>
    `<input class="hopx-pieza" type="date" name="${nombre}" aria-label="${etiqueta}" min="${manana()}" max="${esc(fin)}" value="${esc(valor)}">`;
  const cuando = fijadas
    ? `<span class="hopx-fijo">del ${esc(fmtDate(fijadas.ida))} al ${esc(fmtDate(fijadas.vuelta))}</span>`
    : `${sel("cuando", [["findes", "un finde"], ["fechas", "en unas fechas"], ["tramo", "unos días"]], "findes", "Cuándo")}<span
        class="hopx-trozo" data-para="fechas" hidden>: del ${fecha("ida", "Ida")} al ${fecha("vuelta", "Vuelta")}</span><span
        class="hopx-trozo" data-para="tramo" hidden> (${sel("noches", [2, 3, 4, 5, 7].map((x) => [x, `${x} noches`]), 3, "Noches")})
        entre el ${fecha("desde", "Desde")} y el ${fecha("hasta", "Hasta", fin)}</span><span class="hopx-trozo" data-para="findes"> antes del ${esc(
          fmtDate(fin)
        )}</span>`;
  return `<form class="hopx-buscar" id="hopBuscarForm" novalidate>
      ${
        atascada
          ? `<div class="hop-aviso error">La última búsqueda tardó demasiado y no llegó nada. Probad otra vez.</div>`
          : ultima && ultima.estado === "vacia"
            ? `<div class="hop-aviso">La última búsqueda no encontró nada dentro del tope. Probad con más presupuesto.</div>`
            : ""
      }
      <p class="hopx-frase">
        Salimos de ${sel("origen", ORIGENES.map(([c, nom]) => [c, nom]), "MAD", "De dónde salís")}
        ${cuando}
        hacia ${sel("donde", [["any", "cualquier sitio"], ["one", "un sitio concreto…"]], "any", "A dónde")},
        sin pasar de ${sel("tope", TOPES.map((x) => [x, `${x} €`]), 150, "Tope por persona")} por cabeza.
        Somos ${sel("personas", [1, 2, 3, 4, 5, 6, 7, 8].map((x) => [x, String(x)]), n, "Cuántos sois")}.
      </p>
      <input type="hidden" id="hopDest">
      <div class="hopx-afinar">
        <div class="filtro-wrap" id="hopFiltroWrap"><span class="hopx-sub">¿Por dónde?</span><input type="hidden" id="hopFiltro"></div>
        ${
          fuera.length
            ? `<p class="hopx-tachadas">${ico("no", 14)} Sin ${esc(fuera.map((v) => v.n).join(", "))} <small>(lo tachó el grupo)</small></p>`
            : ""
        }
      </div>
      <div class="hop-horas" id="hopHorasWrap"><input type="hidden" id="hopHoras"></div>
      <div class="hopx-buscar-pie">
        <button class="btn primary hopx-lanzar" type="submit">${ico("lupa")} Buscar para el grupo</button>
        <span class="hop-letra">Miramos todas las compañías. Tarda unos minutos y lo veis todos.</span>
        ${estado.resultados ? `<button class="btn ghost small" type="button" data-hop-cerrar-buscar>Cancelar</button>` : ""}
        <p class="hop-msg" role="status"></p>
      </div>
    </form>`;
}

function montarFormBuscar(app, caja) {
  const form = $("#hopBuscarForm", caja);
  const f = form.elements;
  const ultima = estado.hop.busqueda;
  if (ultima && ultima.origen && [...f.origen.options].some((o) => o.value === ultima.origen)) f.origen.value = ultima.origen;
  const destino = $("#hopDest", form);
  const opcionUna = f.donde.querySelector('option[value="one"]');
  const sincronizar = () => {
    const cuando = f.cuando ? f.cuando.value : "";
    form.querySelectorAll("[data-para]").forEach((x) => (x.hidden = x.dataset.para !== cuando));
    $("#hopFiltroWrap", form).hidden = f.donde.value !== "any";
  };
  sincronizar();
  f.cuando?.addEventListener("change", sincronizar);
  f.donde.addEventListener("change", () => {
    if (f.donde.value === "one") abrirDestinos("hopDest");
    sincronizar();
  });
  destino.addEventListener("change", () => {
    const v = destino.value.trim();
    opcionUna.textContent = v || "un sitio concreto…";
    f.donde.value = v ? "one" : "any";
    sincronizar();
  });
  montarFiltroDestinos($("#hopFiltroWrap", form), $("#hopFiltro", form));
  montarHoras($("#hopHorasWrap", form), $("#hopHoras", form));
  form.querySelector("[data-hop-cerrar-buscar]")?.addEventListener("click", () => {
    estado.buscar = false;
    caja.innerHTML = "";
    pintarFase3(app);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = form.querySelector(".hop-msg");
    const dest = f.donde.value === "one" ? destino.value.trim() : "";
    if (f.donde.value === "one" && !dest) {
      abrirDestinos("hopDest");
      return (msg.textContent = "Elegid el destino, o dejad «cualquier sitio».");
    }
    const viaje = { origin: f.origen.value, depart: "", return_date: "", desde: "", hasta: "", camas: "", dias: "" };
    let weekend = "no";
    let nights = "2-3";
    let cuandoTxt = "";
    const fijadas = estado.hop.fechas;
    const cuando = fijadas ? "fijadas" : f.cuando.value;
    if (cuando === "fijadas") {
      viaje.depart = fijadas.ida;
      viaje.return_date = fijadas.vuelta;
      cuandoTxt = `${fmtDate(fijadas.ida)} → ${fmtDate(fijadas.vuelta)}`;
    } else if (cuando === "findes") {
      viaje.desde = manana();
      viaje.hasta = estado.hop.fin;
      weekend = "si";
      cuandoTxt = `un finde antes del ${fmtDate(estado.hop.fin)}`;
    } else if (cuando === "fechas") {
      if (!f.ida.value || !f.vuelta.value || f.vuelta.value <= f.ida.value) {
        return (msg.textContent = "Marcad la ida y la vuelta (la vuelta, después).");
      }
      viaje.depart = f.ida.value;
      viaje.return_date = f.vuelta.value;
      cuandoTxt = `${fmtDate(f.ida.value)} → ${fmtDate(f.vuelta.value)}`;
    } else {
      if (!f.desde.value || !f.hasta.value || f.hasta.value <= f.desde.value) {
        return (msg.textContent = "Marcad desde cuándo y hasta cuándo podéis.");
      }
      viaje.desde = f.desde.value;
      viaje.hasta = f.hasta.value;
      nights = `${f.noches.value}-${f.noches.value}`;
      cuandoTxt = `${f.noches.value} noches entre ${fmtDate(f.desde.value)} y ${fmtDate(f.hasta.value)}`;
    }
    const horas = $("#hopHoras", form).value;
    if (horas) viaje.horas = horas;
    // Lo que el grupo tachó en la fase 2, más lo que se afine aquí.
    const filtro = dest ? "" : $("#hopFiltro", form).value;
    const { solo, sin } = filtro ? await codigosDelFiltro(filtro) : { solo: "", sin: "" };
    const tachadas = await codigosDeCiudades(vetos().filter((v) => v.fuera).map((v) => v.k));
    viaje.solo = solo;
    viaje.sin = [...new Set([...(sin.match(/[A-Z]{3}/g) || []), ...tachadas])].join("");
    const clave = `${estado.id.slice(0, 12).toLowerCase().replace(/[^a-z0-9]/g, "")}-${Date.now().toString(36)}`;
    viaje.clave = clave;
    viaje.hop = estado.id;
    const personas = Number(f.personas.value) || personasHop();
    const texto = [
      `${dest || "Cualquier sitio"}${f.origen.value !== "MAD" ? ` desde ${f.origen.value}` : ""}`,
      cuandoTxt,
      `hasta ${f.tope.value} €`,
      `${personas} pers.`,
      filtro ? textoFiltro(filtro) : "",
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
    caja.dataset.huella = "";
    pintarViaje(app);
    nubeHopApuntar(estado.id, "busqueda", apunte);
    if (typeof tfAnunciar === "function") tfAnunciar("Búsqueda lanzada para el grupo. Tarda unos minutos.");
  });
}

/* Los resultados no se votan: se GUARDAN. Cada vuelo, con su botón, y con
   «dónde dormir» se despliegan los alojamientos de esas fechas, que también se
   guardan, ya juntos con el vuelo. */
const guardadaDe = (pid) => estado.propuestas.find((p) => p.id === pid);
const pidVuelo = (o) => `v-${o.id}`.slice(0, 120);
const pidCombo = (o, c) => `v-${o.id}-c-${hashCorto(c.url || c.name)}`.slice(0, 120);

function pintarResultados(app) {
  const caja = $("#f3Res", app);
  const res = estado.resultados;
  if (!res) {
    pintarSi(caja, "");
    return;
  }
  if (!res.ofertas.length) {
    pintarSi(caja, `<div class="hop-vacio"><b>No salió nada.</b> Probad con más presupuesto u otras fechas.</div>`);
    return;
  }
  const pax = (o) => Math.max(1, Number(o.adults) || 1);
  pintarSi(
    caja,
    `<p class="hopx-sub">${res.ofertas.length} vuelos · del más barato al más caro</p>
    <ul class="hopx-resultados">${res.ofertas
      .map((o) => {
        const guardada = guardadaDe(pidVuelo(o));
        const camas = estado.camas[o.id];
        const abierta = estado.abierta === o.id;
        const ida = [o.depart_time, o.arrive_time].filter(Boolean).join("–");
        const vuelta = [o.return_time, o.return_arrive_time].filter(Boolean).join("–");
        return `<li class="hopx-res${guardada ? " guardada" : ""}">
            <div class="hopx-res-fila">
              <span class="hopx-res-iata">${esc(o.destination)}</span>
              <div class="hopx-res-txt">
                <b>${esc(o.destination_name || o.destination)}</b> <small>${esc(o.destination_country || "")}</small>
                <span>${esc(fmtDate(o.depart_date, true))} → ${esc(fmtDate(o.return_date, true))}${
                  ida ? ` · ida ${esc(ida)}` : ""
                }${vuelta ? ` · vuelta ${esc(vuelta)}` : ""} · ${esc(o.airline || "")}${
                  enlaceOk(o.deep_link) ? ` · <a href="${escURL(o.deep_link)}" target="_blank" rel="noopener">ver</a>` : ""
                }</span>
              </div>
              <b class="hopx-res-precio">${euros((Number(o.price) || 0) / pax(o))}<small>por cabeza</small></b>
              <div class="hopx-res-acc">
                <button type="button" class="btn small ${guardada ? "deep-ghost" : "primary"}" data-guardar="${esc(o.id)}"
                  ${guardada ? "disabled" : ""}>${guardada ? `${ico("si", 14)} Guardada` : "Guardar"}</button>
                <button type="button" class="btn ghost small" data-camas="${esc(o.id)}" aria-expanded="${abierta}">${ico(
                  "cama",
                  14
                )} Dónde dormir</button>
              </div>
            </div>
            ${abierta ? `<div class="hopx-res-camas">${camasHTML(o, camas)}</div>` : ""}
          </li>`;
      })
      .join("")}</ul>`
  );
}

function camasHTML(o, camas) {
  const c = enMarcha("cama");
  if (!camas && c && c.oferta === o.id && c.pasado < CADUCA_BUSQUEDA_MS) return progresoHTML(c, ESPERA_CAMA_MS, "dónde dormir");
  if (!camas) return `<p class="hop-letra">Mirando…</p>`;
  if (!camas.stays.length) return `<p class="hop-letra">No se encontró alojamiento para esas fechas.</p>`;
  return `<ul class="hopx-camas">${camas.stays
    .map((s, i) => {
      const guardada = guardadaDe(pidCombo(o, s));
      const precio = Number.isFinite(Number(s.price_total)) ? Number(s.price_total) / Math.max(1, Number(o.adults) || 1) : null;
      return `<li>
          <div><b>${esc(s.name || "Alojamiento")}</b>
            <span class="hop-letra">${esc([s.area, s.rating ? `nota ${s.rating}` : "", s.provider].filter(Boolean).join(" · "))}${
              enlaceOk(s.url) ? ` · <a href="${escURL(s.url)}" target="_blank" rel="noopener">ver</a>` : ""
            }</span></div>
          <b>${precio !== null ? `${euros(precio)}<small> por cabeza</small>` : "—"}</b>
          <button type="button" class="btn small ${guardada ? "deep-ghost" : "primary"}" data-guardar="${esc(o.id)}" data-cama="${i}"
            ${guardada ? "disabled" : ""}>${guardada ? `${ico("si", 14)} Guardada` : "Guardar con este"}</button>
        </li>`;
    })
    .join("")}</ul>`;
}

async function guardarOferta(app, o, stay) {
  const pax = Math.max(1, Number(o.adults) || 1);
  const ida = [o.depart_time, o.arrive_time].filter(Boolean).join("–");
  const vuelta = [o.return_time, o.return_arrive_time].filter(Boolean).join("–");
  const datos = {
    pid: stay ? pidCombo(o, stay) : pidVuelo(o),
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
    oferta: String(o.id),
  };
  if (stay) {
    datos.cama = String(stay.name || "Alojamiento").slice(0, 120);
    if (enlaceOk(stay.url) && String(stay.url).startsWith("https://")) datos.cama_url = stay.url;
    if (Number.isFinite(Number(stay.price_total))) datos.cama_precio = Number(stay.price_total) / pax;
    const foto = stay.image || (Array.isArray(stay.images) ? stay.images[0] : "");
    if (foto && String(foto).startsWith("https://")) datos.foto = foto;
  }
  const r = await nubeProponer(estado.id, datos);
  if (!r.ok) {
    alert(r.error);
    return;
  }
  if (typeof tfAnunciar === "function") tfAnunciar(`Guardada: ${datos.titulo}. Pasa a votarse.`);
  await cargarPropuestas(app);
}

async function verCamas(app, o) {
  estado.abierta = estado.abierta === o.id ? "" : o.id;
  pintarViaje(app);
  if (!estado.abierta || estado.camas[o.id]) return;
  const ya = typeof nubeResultado === "function" ? await nubeResultado(`stay-${o.id}`) : null;
  if (ya) {
    estado.camas[o.id] = { stays: (ya.stays || []).slice(0, MAX_CAMAS) };
    pintarViaje(app);
    return;
  }
  const c = enMarcha("cama");
  if (c && c.oferta === o.id) return; // ya la está buscando alguien
  const n = Math.max(1, Number(o.adults) || personasHop());
  const r = await dispatch("stay", {
    offer_id: o.id,
    city: o.destination_name || o.destination,
    country: o.destination_country || "",
    iata: o.destination || "",
    checkin: o.depart_date,
    checkout: o.return_date || "",
    adults: String(n),
    hop: estado.id,
  });
  if (!r.ok) {
    estado.camas[o.id] = { stays: [] };
    pintarViaje(app);
    return;
  }
  const s = yo();
  const apunte = {
    oferta: String(o.id),
    texto: `${o.destination_name || o.destination} · ${fmtDate(o.depart_date)} → ${fmtDate(o.return_date)} · ${n} pers.`,
    por: s.uid,
    nombre: String(s.name || "").slice(0, 40),
    lanzada: new Date(),
    estado: "buscando",
  };
  estado.hop.cama = apunte;
  pintarViaje(app);
  nubeHopApuntar(estado.id, "cama", apunte);
}

/* Lo que está en marcha: si ha llegado, se apunta en el HOP y se enseña. */
async function comprobarBusquedas(app) {
  const ultima = estado.hop.busqueda;
  if (ultima && ultima.clave && (!estado.resultados || estado.resultados.clave !== ultima.clave) && !estado.leyendo) {
    estado.leyendo = true;
    try {
      const datos = await resultadoDeBusqueda(ultima);
      if (datos) {
        const ofertas = [...(datos.offers || [])].sort((a, b) => (a.price || 0) - (b.price || 0)).slice(0, MAX_RESULTADOS);
        estado.resultados = { clave: ultima.clave, texto: ultima.texto, ofertas };
        if (ultima.estado === "buscando") {
          await nubeHopApuntar(estado.id, "busqueda", {
            clave: ultima.clave, texto: ultima.texto, por: ultima.por, nombre: ultima.nombre,
            lanzada: new Date(instante(ultima.lanzada) || Date.now()), estado: ofertas.length ? "lista" : "vacia", n: ofertas.length,
          });
          if (typeof tfAnunciar === "function") {
            tfAnunciar(ofertas.length ? `Han llegado ${ofertas.length} vuelos.` : "La búsqueda no encontró vuelos dentro del tope.");
          }
        }
        pintarViaje(app);
      }
    } finally {
      estado.leyendo = false;
    }
  }
  // El alojamiento: se lee también si ya lo trajo otro del grupo («lista»).
  const cama = estado.hop.cama;
  const c = enMarcha("cama");
  const toca = cama && cama.oferta && !estado.camas[cama.oferta] && (cama.estado === "lista" || (c && c.pasado < CADUCA_BUSQUEDA_MS));
  if (toca) {
    const datos = typeof nubeResultado === "function" ? await nubeResultado(`stay-${cama.oferta}`) : null;
    if (datos) {
      const stays = datos.stays || [];
      estado.camas[cama.oferta] = { stays: stays.slice(0, MAX_CAMAS) };
      if (c) {
        const lista = { ...cama, lanzada: new Date(c.desde), estado: stays.length ? "lista" : "vacia", n: stays.length };
        estado.hop.cama = lista;
        await nubeHopApuntar(estado.id, "cama", lista);
      }
      pintarViaje(app);
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
    const dia = new Date(instante(b.lanzada) || Date.now()).toISOString().slice(0, 10);
    const hecha = (indice.searches || []).find(
      (x) => x.label === `HOP ${estado.hop.nombre}: ${b.texto}`.slice(0, 190) && String(x.generated_at || "") >= dia
    );
    return hecha ? await fetchJSON(`data/searches/${hecha.slug}.json`) : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------- fase 4: votar */
const ROTULOS = { si: "Me apunto", quiza: "Puede", no: "Paso" };

function votarHTML(p) {
  const n = puntos(p);
  const mio = (p.votos || {})[yo().uid] || "";
  return `<div class="hopx-votar" role="group" aria-label="Tu voto">
      ${["si", "quiza", "no"]
        .map(
          (v) => `<button type="button" class="hopx-voto v-${v}" data-voto="${v}" aria-pressed="${mio === v}"
              title="${ROTULOS[v]}">${ico(v, 16)}<span>${ROTULOS[v]}</span><b>${n[v]}</b></button>`
        )
        .join("")}
    </div>`;
}

function medidorHTML(p) {
  const n = puntos(p);
  const total = Math.max(1, (estado.hop.miembros || []).length);
  const falta = Math.max(0, total - n.si - n.quiza - n.no);
  return `<div class="hopx-medidor" aria-hidden="true"><i class="m-si" style="flex:${n.si}"></i><i class="m-quiza" style="flex:${n.quiza}"></i><i class="m-no" style="flex:${n.no}"></i><i class="m-falta" style="flex:${falta}"></i></div>`;
}

function quienesHTML(p) {
  const nombres = estado.hop.nombres || {};
  const si = Object.entries(p.votos || {}).filter(([, v]) => v === "si").map(([u]) => u);
  return si.length
    ? `<span class="hop-avs mini" title="Se apuntan: ${esc(si.map((u) => nombres[u] || "?").join(", "))}">${si
        .slice(0, 5)
        .map((u) => avatar(u, nombres[u] || "?"))
        .join("")}</span>`
    : `<span></span>`;
}

function faltanTxt(p) {
  const nombres = estado.hop.nombres || {};
  const faltan = (estado.hop.miembros || []).filter((u) => !(p.votos || {})[u]);
  return faltan.length ? `Falta: ${esc(faltan.map((u) => nombres[u] || "?").join(", "))}` : "Ya han votado todos";
}

const borrarHTML = (p) =>
  p.autor === yo().uid || estado.hop.creador === yo().uid
    ? `<button class="quitar" type="button" data-borrar-prop aria-label="Borrar «${esc(p.titulo)}»">borrar</button>`
    : "";

function cartaGuardada(p, puesto, lider) {
  const dias = noches(p.ida, p.vuelta);
  const total = (Number.isFinite(p.precio) ? p.precio : 0) + (Number.isFinite(p.cama_precio) ? p.cama_precio : 0);
  return `<article class="hopx-carta${lider ? " lider" : ""}" data-prop="${esc(p.id)}">
      <div class="hopx-carta-foto">
        ${huecoFoto({ iata: p.iata, ciudad: p.titulo, pais: p.pais }, tono(p.iata || p.titulo))}
        ${lider ? `<span class="hopx-lider">la más votada</span>` : `<span class="hopx-puesto">${puesto}</span>`}
        <span class="hopx-precio">${total ? euros(total) : "—"}<small>por cabeza</small></span>
        <div class="hopx-carta-nombre"><b>${esc(p.titulo)}</b><small>${esc(p.pais || p.destino || "")}${
          p.iata ? ` · <span class="iata">${esc(p.iata)}</span>` : ""
        }</small></div>
      </div>
      <div class="hopx-carta-cuerpo">
        ${
          p.ida
            ? `<p class="hopx-fechas">${ico("calendario", 15)} ${esc(fmtDate(p.ida, true))} – ${esc(fmtDate(p.vuelta, true))}${
                dias ? ` · <b>${dias} noche${dias === 1 ? "" : "s"}</b>` : ""
              }</p>`
            : ""
        }
        ${
          p.horario || p.compania
            ? `<p class="hopx-dato">${ico("avion", 15)} <span>${esc([p.horario, p.compania].filter(Boolean).join(" · "))}${
                enlaceOk(p.url) ? ` · <a href="${escURL(p.url)}" target="_blank" rel="noopener">ver</a>` : ""
              }</span></p>`
            : ""
        }
        <p class="hopx-dato">${ico("cama", 15)} <span>${
          p.cama
            ? `${esc(p.cama)}${Number.isFinite(p.cama_precio) ? ` · ${euros(p.cama_precio)}` : ""}${
                enlaceOk(p.cama_url) ? ` · <a href="${escURL(p.cama_url)}" target="_blank" rel="noopener">ver</a>` : ""
              }`
            : "sin alojamiento"
        }</span></p>
        ${p.nota ? `<p class="hopx-dato">${esc(p.nota)}</p>` : ""}
        ${medidorHTML(p)}
        ${votarHTML(p)}
        <div class="hopx-carta-pie">${quienesHTML(p)}<span class="hop-letra">${faltanTxt(p)}</span>${borrarHTML(p)}</div>
      </div>
    </article>`;
}

function pintarFase4(app) {
  const lista = ordenadas(guardadas());
  const lider = ganadora("guardada");
  const pendientes = sinVotar(lista).length;
  $("#hopFaseEstado", app).textContent = lider ? `va ganando ${lider.titulo}` : "";
  pintarSi(
    $("#f4Lista", app),
    lista.length
      ? `<div class="hopx-barra">
          <p><b>${lista.length} guardada${lista.length === 1 ? "" : "s"}</b> · ordenadas por lo que más gusta</p>
          ${
            pendientes
              ? `<button class="btn primary small hopx-deslizar" type="button" data-rapido="guardada">${ico("cartas", 16)} Votar deslizando <i>${pendientes}</i></button>`
              : `<span class="hop-chip">${ico("si", 14)} ya has votado todo</span>`
          }
        </div>
        <div class="hopx-mazo">${lista.map((p, i) => cartaGuardada(p, i + 1, p === lider)).join("")}</div>`
      : `<div class="hop-vacio"><b>No hay nada guardado.</b> Buscad en la fase 3 y guardad lo que os guste.
          <button class="btn ghost small" type="button" data-ir-fase="3">Ir a buscar</button></div>`
  );
  pintarSi(
    $("#hopFasePie", app),
    lider
      ? `<button class="btn primary" type="button" data-elegir="${esc(lider.id)}">Quedarnos con ${esc(lider.titulo)} →</button>`
      : ""
  );
}

/* ------------------------------------------------------- fase 5: el plan */
function planDe(p) {
  const s = yo();
  const plan = {
    de: p.id,
    titulo: p.titulo,
    pais: p.pais || p.destino || "",
    iata: p.iata || "",
    ida: p.ida || "",
    vuelta: p.vuelta || "",
    compania: p.compania || "",
    url: enlaceOk(p.url) && String(p.url).startsWith("https://") ? p.url : "",
    cama: p.cama || "",
    cama_url: enlaceOk(p.cama_url) && String(p.cama_url).startsWith("https://") ? p.cama_url : "",
    nota: p.nota || "",
    por: s.uid,
    nombre: String(s.name || "").slice(0, 40),
  };
  if (Number.isFinite(p.precio)) plan.precio = Math.round(p.precio * 100) / 100;
  if (Number.isFinite(p.cama_precio)) plan.cama_precio = Math.round(p.cama_precio * 100) / 100;
  return plan;
}

function pintarFase5(app) {
  const plan = estado.hop.plan;
  $("#hopFaseEstado", app).textContent = plan && plan.nombre ? `retocado por ${plan.nombre}` : "";
  if (!plan) {
    pintarSi(
      $("#f5Plan", app),
      `<div class="hop-vacio"><b>Todavía no hay ganador.</b> Votad entre lo guardado y elegid uno.
        <button class="btn ghost small" type="button" data-ir-fase="4">Ir a votar</button></div>`
    );
    pintarSi($("#hopFasePie", app), "");
    return;
  }
  const dias = noches(plan.ida, plan.vuelta);
  const total = (Number.isFinite(plan.precio) ? plan.precio : 0) + (Number.isFinite(plan.cama_precio) ? plan.cama_precio : 0);
  const de = guardadaDe(plan.de);
  pintarSi(
    $("#f5Plan", app),
    `<article class="hopx-plan">
      ${huecoFoto({ iata: plan.iata, ciudad: plan.titulo, pais: plan.pais }, `hopx-plan-foto ${tono(plan.iata || plan.titulo)}`)}
      <div class="hopx-plan-velo">
        <p class="hopx-kicker">El plan</p>
        <h3>${esc(plan.titulo)}</h3>
        <p class="hopx-plan-pais">${esc(plan.pais || "")}${plan.iata ? ` · ${esc(plan.iata)}` : ""}</p>
      </div>
      <div class="hopx-plan-datos">
        <dl class="hopx-plan-dl">
          <div><dt>Ida</dt><dd>${plan.ida ? esc(fmtDate(plan.ida, true)) : "—"}</dd></div>
          <div><dt>Vuelta</dt><dd>${plan.vuelta ? esc(fmtDate(plan.vuelta, true)) : "—"}</dd></div>
          <div><dt>Noches</dt><dd>${dias || "—"}</dd></div>
          <div><dt>Vuelo</dt><dd>${esc(plan.compania || "—")}</dd></div>
          <div class="ancho"><dt>Dormir</dt><dd>${plan.cama ? esc(plan.cama) : `<span class="hopx-falta">sin elegir</span>`}</dd></div>
          ${plan.nota ? `<div class="ancho"><dt>Nota</dt><dd>${esc(plan.nota)}</dd></div>` : ""}
        </dl>
        <div class="hopx-plan-total">
          <span>por cabeza</span>
          <b>${total ? euros(total) : "—"}</b>
          <small>vuelo ${Number.isFinite(plan.precio) ? euros(plan.precio) : "—"}${
            Number.isFinite(plan.cama_precio) ? ` + dormir ${euros(plan.cama_precio)}` : ""
          }</small>
        </div>
        ${de ? `<p class="hopx-plan-apoyo">${ico("si", 16)} <b>${puntos(de).si} de ${(estado.hop.miembros || []).length}</b> se apuntaron</p>` : ""}
        <div class="hopx-plan-acc">
          ${enlaceOk(plan.url) ? `<a class="btn primary small" href="${escURL(plan.url)}" target="_blank" rel="noopener">Reservar el vuelo ${ico("fuera", 14)}</a>` : ""}
          ${enlaceOk(plan.cama_url) ? `<a class="btn ghost small" href="${escURL(plan.cama_url)}" target="_blank" rel="noopener">Ver el alojamiento ${ico("fuera", 14)}</a>` : ""}
          <button class="btn ghost small" type="button" data-editar-plan>Editar el plan</button>
        </div>
      </div>
    </article>`
  );
  pintarSi($("#hopFasePie", app), `<button class="btn ghost small" type="button" data-ir-fase="4">← Volver a votar</button>`);
}

function abrirEditarPlan(app) {
  const caja = $("#f5Editar", app);
  if (caja.innerHTML) {
    caja.innerHTML = "";
    return;
  }
  const p = estado.hop.plan || {};
  const campo = (nombre, rot, extra = "", valor = p[nombre]) =>
    `<label${extra.includes("ancho") ? ' class="ancho"' : ""}><span>${rot}</span><input name="${nombre}" ${extra.replace("ancho", "")} value="${esc(
      valor ?? ""
    )}"></label>`;
  caja.innerHTML = `<form class="hop-form hopx-editar-plan" id="hopPlanForm" novalidate>
      <p class="hop-form-tit">Retocar el plan</p>
      ${campo("titulo", "Destino", 'maxlength="80"')}
      ${campo("compania", "Compañía", 'maxlength="60"')}
      ${campo("ida", "Ida", 'type="date"')}
      ${campo("vuelta", "Vuelta", 'type="date"')}
      ${campo("precio", "Vuelo, € por cabeza", 'type="number" min="0" step="1"')}
      ${campo("url", "Enlace del vuelo", 'type="url" placeholder="https://…" ancho')}
      ${campo("cama", "Dónde dormimos", 'maxlength="120" ancho')}
      ${campo("cama_precio", "Dormir, € por cabeza", 'type="number" min="0" step="1"')}
      ${campo("cama_url", "Enlace del alojamiento", 'type="url" placeholder="https://…" ancho')}
      ${campo("nota", "Nota", 'maxlength="500" placeholder="Quedamos en la T1 a las 6" ancho')}
      <div class="hop-form-pie ancha">
        <button class="btn primary small" type="submit">Guardar el plan</button>
        <button class="btn ghost small" type="button" data-cerrar-plan>Cancelar</button>
        <p class="hop-msg" role="status"></p>
      </div>
    </form>`;
  const form = caja.querySelector("form");
  form.querySelector("[data-cerrar-plan]").addEventListener("click", () => (caja.innerHTML = ""));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = (k) => form.elements[k].value.trim();
    const msg = form.querySelector(".hop-msg");
    for (const k of ["url", "cama_url"]) {
      if (v(k) && !v(k).startsWith("https://")) return (msg.textContent = "Los enlaces tienen que empezar por https://");
    }
    if (v("ida") && v("vuelta") && v("vuelta") < v("ida")) return (msg.textContent = "La vuelta va después de la ida.");
    const s = yo();
    const plan = {
      ...p,
      titulo: v("titulo") || p.titulo || "El viaje",
      compania: v("compania"),
      ida: v("ida"),
      vuelta: v("vuelta"),
      url: v("url"),
      cama: v("cama"),
      cama_url: v("cama_url"),
      nota: v("nota"),
      por: s.uid,
      nombre: String(s.name || "").slice(0, 40),
    };
    delete plan.precio;
    delete plan.cama_precio;
    if (v("precio") !== "" && Number.isFinite(Number(v("precio")))) plan.precio = Number(v("precio"));
    if (v("cama_precio") !== "" && Number.isFinite(Number(v("cama_precio")))) plan.cama_precio = Number(v("cama_precio"));
    const r = await nubeHopCambiar(estado.id, { plan });
    if (!r.ok) return (msg.textContent = r.error);
    estado.hop.plan = plan;
    caja.innerHTML = "";
    pintarViaje(app);
  });
}

/* ------------------------------------------------------------ los toques */
async function irAFase(app, n, extra = {}) {
  const r = await nubeHopCambiar(estado.id, { fase: n, ...extra });
  if (!r.ok) {
    alert(r.error);
    return;
  }
  Object.assign(estado.hop, { fase: n }, extra);
  estado.ver = n;
  pintarViaje(app);
  $("#hopFases", app).scrollIntoView({ behavior: "smooth", block: "start" });
}

async function alTocarFase(app, e) {
  const b = e.target.closest("button");
  if (!b) return;
  const s = yo();
  if (b.dataset.voto) {
    const tarjeta = b.closest("[data-prop]");
    const p = tarjeta && estado.propuestas.find((x) => x.id === tarjeta.dataset.prop);
    if (!p) return;
    const antes = (p.votos || {})[s.uid] || null;
    const nuevo = antes === b.dataset.voto ? null : b.dataset.voto;
    // Se pinta ya: esperar a la red para ver tu propio voto se nota.
    p.votos = { ...p.votos };
    if (nuevo) p.votos[s.uid] = nuevo;
    else delete p.votos[s.uid];
    pintarViaje(app);
    const r = await nubeVotar(estado.id, p.id, nuevo);
    if (!r.ok) {
      if (antes) p.votos[s.uid] = antes;
      else delete p.votos[s.uid];
      pintarViaje(app);
      alert(r.error);
    }
    return;
  }
  if (b.hasAttribute("data-borrar-prop")) {
    const p = estado.propuestas.find((x) => x.id === b.closest("[data-prop]").dataset.prop);
    if (!p || !confirm(`¿Borrar «${p.titulo}» y sus votos?`)) return;
    const r = await nubeBorrarPropuesta(estado.id, p.id);
    if (r.ok) {
      estado.propuestas = estado.propuestas.filter((x) => x.id !== p.id);
      pintarViaje(app);
    } else alert(r.error);
    return;
  }
  if (b.dataset.fijar) {
    const p = estado.propuestas.find((x) => x.id === b.dataset.fijar);
    if (p) irAFase(app, 2, { fechas: { ida: p.ida, vuelta: p.vuelta } });
    return;
  }
  if (b.hasAttribute("data-sin-fechas")) return irAFase(app, 2);
  if (b.dataset.irFase) {
    const n = Number(b.dataset.irFase);
    // Ir hacia delante mueve al grupo; hacia atrás, solo lo que miras.
    if (n > fase()) return irAFase(app, n);
    estado.ver = n;
    return pintarViaje(app);
  }
  if (b.dataset.tachar) {
    const mios = misVetos();
    if (mios.length >= 3 || mios.includes(b.dataset.tachar)) return;
    return vetar(app, [...mios, b.dataset.tachar]);
  }
  if (b.dataset.destachar) return vetar(app, misVetos().filter((k) => k !== b.dataset.destachar));
  if (b.dataset.guardar) {
    const o = (estado.resultados?.ofertas || []).find((x) => String(x.id) === b.dataset.guardar);
    if (!o) return;
    b.disabled = true;
    const stay = b.dataset.cama !== undefined ? estado.camas[o.id]?.stays[Number(b.dataset.cama)] : null;
    return guardarOferta(app, o, stay);
  }
  if (b.dataset.camas) {
    const o = (estado.resultados?.ofertas || []).find((x) => String(x.id) === b.dataset.camas);
    if (o) verCamas(app, o);
    return;
  }
  if (b.hasAttribute("data-idea-mano")) return abrirFormProp(app, "viaje");
  if (b.dataset.rapido) return votarDeslizando(app, "guardada");
  if (b.dataset.elegir) {
    const p = estado.propuestas.find((x) => x.id === b.dataset.elegir);
    if (p) irAFase(app, 5, { plan: planDe(p) });
    return;
  }
  if (b.hasAttribute("data-editar-plan")) abrirEditarPlan(app);
}

async function vetar(app, lista) {
  const antes = misVetos();
  estado.hop.vetos = { ...estado.hop.vetos, [yo().uid]: lista };
  const input = $("#f2Buscar", app);
  if (input) {
    input.value = "";
    $("#f2Res", app).innerHTML = "";
  }
  pintarViaje(app);
  const r = await nubeHopVetar(estado.id, lista);
  if (!r.ok) {
    estado.hop.vetos = { ...estado.hop.vetos, [yo().uid]: antes };
    pintarViaje(app);
    alert(r.error);
  }
}

/* ---------------------------------------------------------- votar deslizando
   Una carta grande cada vez: a la derecha, me apunto; a la izquierda, paso;
   hacia arriba, puede. Con el dedo, con el ratón, con los tres botones o con
   las flechas. Tocando la foto (a izquierda o derecha) se pasan las fotos del
   sitio, que para decidir un destino valen más que el nombre. */
const UMBRAL = 90;

function votarDeslizando(app, tipo) {
  const cola = sinVotar(ordenadas(deTipo(tipo)));
  if (!cola.length) return;
  let i = 0;
  const capa = document.createElement("div");
  capa.className = "hopx-desliza";
  capa.setAttribute("role", "dialog");
  capa.setAttribute("aria-modal", "true");
  capa.setAttribute("aria-label", "Votar deslizando");
  document.body.appendChild(capa);
  document.documentElement.classList.add("sin-scroll");
  const antesFoco = document.activeElement;
  const cerrar = () => {
    document.removeEventListener("keydown", teclas);
    capa.remove();
    document.documentElement.classList.remove("sin-scroll");
    pintarViaje(app);
    if (antesFoco && antesFoco.isConnected) antesFoco.focus();
  };

  const cartaGrande = (p, atras = false) => {
    const dias = noches(p.ida, p.vuelta);
    const foto =
      tipo === "cama" && enlaceOk(p.foto)
        ? `<div class="foto-lugar con-foto" style="background-image:url('${escURL(p.foto)}')"></div>`
        : `<div class="foto-lugar ${tono(p.iata || p.titulo)}"></div>`;
    return `<div class="hopx-dcarta${atras ? " atras" : ""}" ${atras ? 'aria-hidden="true"' : ""}>
        <div class="hopx-dcarta-foto">
          ${foto}
            <div class="hopx-fotos-barras"></div>
          <span class="hopx-sello s-si">Me apunto</span>
          <span class="hopx-sello s-no">Paso</span>
          <span class="hopx-sello s-quiza">Puede</span>
          <div class="hopx-dcarta-velo">
            <b>${esc(p.titulo)}</b>
            <small>${esc(tipo === "cama" ? p.destino || "" : p.pais || "")}</small>
          </div>
          <span class="hopx-precio">${Number.isFinite(p.precio) ? euros(p.precio) : "—"}<small>por cabeza</small></span>
        </div>
        <div class="hopx-dcarta-datos">
          ${
            tipo === "cama"
              ? `<p>${esc(p.nota || "")}</p>`
              : `<p>${ico("calendario", 15)} ${esc(fmtDate(p.ida, true))} – ${esc(fmtDate(p.vuelta, true))}${
                  dias ? ` · ${dias} noche${dias === 1 ? "" : "s"}` : ""
                }</p>
                 <p>${ico("avion", 15)} ${esc([p.horario, p.compania].filter(Boolean).join(" · "))}</p>
                 ${p.cama ? `<p>${ico("cama", 15)} ${esc(p.cama)}</p>` : ""}`
          }
        </div>
      </div>`;
  };

  const pintar = () => {
    const p = cola[i];
    if (!p) {
      const top = ordenadas(deTipo(tipo)).slice(0, 3);
      capa.innerHTML = `<div class="hopx-desliza-caja fin">
          <span class="hopx-fin-ico">${ico("si", 34)}</span>
          <h3>Votado</h3>
          <p>Así va el grupo:</p>
          <ol class="hopx-podio">${top
            .map((x) => `<li><b>${esc(x.titulo)}</b><span>${puntos(x).si} se apuntan</span></li>`)
            .join("")}</ol>
          <button class="btn primary" type="button" data-cerrar>Volver al viaje</button>
        </div>`;
      capa.querySelector("[data-cerrar]").addEventListener("click", cerrar);
      capa.querySelector("[data-cerrar]").focus();
      return;
    }
    capa.innerHTML = `<div class="hopx-desliza-caja">
        <div class="hopx-desliza-cab">
          <span class="hopx-progreso" aria-label="${i + 1} de ${cola.length}"><span>${i + 1} de ${cola.length}</span>
            <i style="width:${(i / cola.length) * 100}%"></i></span>
          <button type="button" class="hopx-cerrar" data-cerrar aria-label="Cerrar">${ico("no", 18)}</button>
        </div>
        <div class="hopx-pila">
          ${cola[i + 1] ? cartaGrande(cola[i + 1], true) : ""}
          ${cartaGrande(p)}
        </div>
        <div class="hopx-desliza-botones">
          <button type="button" class="hopx-redondo no" data-rv="no" aria-label="Paso">${ico("no", 28)}</button>
          <button type="button" class="hopx-redondo quiza" data-rv="quiza" aria-label="Puede">${ico("quiza", 26)}</button>
          <button type="button" class="hopx-redondo si" data-rv="si" aria-label="Me apunto">${ico("si", 30)}</button>
        </div>
        <p class="hop-letra hopx-teclas">Desliza la carta, o con el teclado: ← paso · ↑ puede · → me apunto</p>
      </div>`;
    capa.querySelector("[data-cerrar]").addEventListener("click", cerrar);
    capa.querySelectorAll("[data-rv]").forEach((b) => b.addEventListener("click", () => votarYSeguir(b.dataset.rv)));
    const carta = capa.querySelector(".hopx-dcarta:not(.atras)");
    if (tipo !== "cama") galeriaEnCarta(carta, p);
    else ponerFotos(carta);
    arrastrable(carta);
    capa.querySelector('[data-rv="si"]').focus({ preventScroll: true });
  };

  // Las fotos del sitio dentro de la carta, con sus rayitas arriba.
  const galeriaEnCarta = (carta, p) => {
    const hueco = carta.querySelector(".foto-lugar");
    const barras = carta.querySelector(".hopx-fotos-barras");
    fotosDe({ iata: p.iata, ciudad: p.titulo, pais: p.pais }, 5).then((fotos) => {
      if (!fotos.length || !carta.isConnected) return;
      let k = 0;
      const poner = () => {
        hueco.style.backgroundImage = `url("${fotos[k].src.replace(/"/g, "%22")}")`;
        hueco.classList.add("con-foto");
        hueco.innerHTML = creditoHTML(fotos[k]);
        barras.innerHTML = fotos.length > 1 ? fotos.map((_, j) => `<i class="${j === k ? "si" : ""}"></i>`).join("") : "";
      };
      poner();
      carta.dataset.fotos = String(fotos.length);
      carta.cambiarFoto = (paso) => {
        k = (k + paso + fotos.length) % fotos.length;
        poner();
      };
    });
  };

  const arrastrable = (carta) => {
    let x0 = 0;
    let y0 = 0;
    let dx = 0;
    let dy = 0;
    let moviendo = false;
    const mover = () => {
      carta.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 14}deg)`;
      const fuerza = (v) => Math.min(1, Math.abs(v) / UMBRAL);
      carta.style.setProperty("--si", dx > 0 ? fuerza(dx) : 0);
      carta.style.setProperty("--no", dx < 0 ? fuerza(dx) : 0);
      carta.style.setProperty("--quiza", dy < 0 && Math.abs(dy) > Math.abs(dx) ? fuerza(dy) : 0);
    };
    carta.addEventListener("pointerdown", (e) => {
      if (e.target.closest("a")) return;
      moviendo = true;
      x0 = e.clientX;
      y0 = e.clientY;
      dx = dy = 0;
      carta.setPointerCapture(e.pointerId);
      carta.classList.add("moviendo");
    });
    carta.addEventListener("pointermove", (e) => {
      if (!moviendo) return;
      dx = e.clientX - x0;
      dy = e.clientY - y0;
      mover();
    });
    const soltar = (e) => {
      if (!moviendo) return;
      moviendo = false;
      carta.classList.remove("moviendo");
      if (dx > UMBRAL) return votarYSeguir("si");
      if (dx < -UMBRAL) return votarYSeguir("no");
      if (dy < -UMBRAL) return votarYSeguir("quiza");
      // Un toque sin arrastrar: en la foto, pasa a la siguiente o la anterior.
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6 && carta.cambiarFoto && e.target.closest(".hopx-dcarta-foto")) {
        const r = carta.getBoundingClientRect();
        carta.cambiarFoto(e.clientX - r.left > r.width / 2 ? 1 : -1);
      }
      dx = dy = 0;
      carta.style.transform = "";
      mover();
    };
    carta.addEventListener("pointerup", soltar);
    carta.addEventListener("pointercancel", soltar);
  };

  let ocupado = false;
  const votarYSeguir = (voto) => {
    if (ocupado || !cola[i]) return;
    ocupado = true;
    const p = cola[i];
    const carta = capa.querySelector(".hopx-dcarta:not(.atras)");
    if (carta) {
      carta.style.transform = "";
      carta.classList.add(`sale-${voto}`);
    }
    p.votos = { ...p.votos, [yo().uid]: voto };
    nubeVotar(estado.id, p.id, voto).then((r) => {
      if (!r.ok) {
        delete p.votos[yo().uid];
        alert(r.error);
      }
    });
    setTimeout(() => {
      i += 1;
      ocupado = false;
      pintar();
    }, 260);
  };
  const teclas = (e) => {
    if (e.key === "Escape") return cerrar();
    if (!cola[i]) return;
    const voto = { ArrowLeft: "no", ArrowUp: "quiza", ArrowDown: "quiza", ArrowRight: "si" }[e.key];
    if (voto) {
      e.preventDefault();
      votarYSeguir(voto);
    }
  };
  document.addEventListener("keydown", teclas);
  pintar();
}
