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
import { creditoHTML, fotosDe, huecoFoto, ponerFotos } from "./fotos.js";

const $ = (s, raiz = document) => raiz.querySelector(s);
const CADA_CHAT_MS = 4000;
const CADA_PROPUESTAS_MS = 8000;
const PROPUESTA_PENDIENTE = "tf_hop_propuesta";

const VOTOS = [
  ["si", "Me apunto"],
  ["quiza", "Puede"],
  ["no", "Paso"],
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
  const quedan = Math.max(0, Math.ceil((parseISO(hop.fin) - parseISO(hoyISO())) / 864e5));
  const gente =
    miembros.length <= 3
      ? miembros.map((u) => nombres[u] || "?").join(", ")
      : `${miembros.slice(0, 2).map((u) => nombres[u] || "?").join(", ")} y ${miembros.length - 2} más`;
  app.innerHTML = `
    <a class="hop-volver" href="hop">← Tus HOP</a>
    <header class="hopx-portada">
      <div id="hopPortadaFoto" class="hopx-portada-foto" data-de="" aria-hidden="true"></div>
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
    <nav id="hopRail" aria-label="Cómo va el viaje"></nav>

    <div class="hop-pestanas" role="tablist" aria-label="Partes del HOP">
      <button type="button" role="tab" data-vista="props" aria-selected="${estado.vista === "props"}">El viaje</button>
      <button type="button" role="tab" data-vista="chat" aria-selected="${estado.vista === "chat"}">Chat <i id="hopNuevos"></i></button>
    </div>
    <div class="hop-cuerpo" data-vista="${estado.vista}">
      <section class="hop-props hop-plan" aria-label="El viaje">
        <div id="hopResumen"></div>
        <section class="hopx-bloque" id="hopBloqueVuelo" aria-labelledby="hopPasoVueloTit">
          <header class="hopx-bloque-cab">
            <span class="hopx-n" aria-hidden="true">01</span>
            <h3 id="hopPasoVueloTit">¿A dónde vamos?</h3>
            <span class="hopx-estado" id="hopEstadoVuelo"></span>
          </header>
          <div id="hopBuscar"></div>
          <div id="hopVuelos"></div>
        </section>
        <section class="hopx-bloque" id="hopBloqueCama" aria-labelledby="hopPasoCamaTit">
          <header class="hopx-bloque-cab">
            <span class="hopx-n" aria-hidden="true">02</span>
            <h3 id="hopPasoCamaTit">¿Dónde dormimos?</h3>
            <span class="hopx-estado" id="hopEstadoCama"></span>
          </header>
          <div id="hopCamasCab"></div>
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
          <div class="hop-lista-props" id="hopListaProps"></div>
        </details>
      </section>
      <section class="hop-chat" aria-labelledby="hopChatTit">
        <h3 id="hopChatTit">Chat del grupo</h3>
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
              ([v, rot]) =>
                `<button type="button" class="hop-voto v-${v}" data-voto="${v}" aria-pressed="${mio === v}">
                  ${ico(v, 15)} ${rot} <b>${n[v]}</b></button>`
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

/* ===================================================================== EL VIAJE
   El buscador del grupo, las cartas que se votan y el plan que va saliendo.
   Todo se pinta desde `estado` (las propuestas y el HOP) en cada vuelta del
   sondeo, así que lo que vota uno lo ven los demás en segundos.

   Cada trozo se repinta SOLO SI HA CAMBIADO (`pintarSi`): el sondeo pasa cada
   pocos segundos y repintar igual borraría las fotos ya puestas, el foco del
   teclado y lo que estés escribiendo. */
const MAX_VUELOS = 12;
const MAX_CAMAS = 9;
const ESPERA_VUELOS_MS = 8 * 60e3; // lo que suele tardar un barrido
const ESPERA_CAMA_MS = 3 * 60e3;
const CADUCA_BUSQUEDA_MS = 35 * 60e3; // más que esto, algo ha ido mal
const importando = new Set();

const deTipo = (t) => estado.propuestas.filter((p) => p.tipo === t);
const porVotos = (a, b) => nota(b) - nota(a) || (a.precio ?? 1e9) - (b.precio ?? 1e9);
const porPrecio = (a, b) => (a.precio ?? 1e9) - (b.precio ?? 1e9) || nota(b) - nota(a);
const ordenadas = (lista, orden = "votos") => [...lista].sort(orden === "precio" ? porPrecio : porVotos);
const ganadora = (t) => ordenadas(deTipo(t)).find((p) => puntos(p).si > 0) || null;
const personasHop = () => Math.min(8, Math.max(1, (estado.hop.miembros || []).length));
const euros = (n) => `${Math.round(n)} €`;
const sinVotar = (lista) => lista.filter((p) => !(p.votos || {})[yo().uid]);
const enlaceOk = (u) => !!u && escURL(u) !== "#";

function hashCorto(t) {
  let h = 0;
  for (const c of String(t)) h = (h * 33 + c.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

function pintarSi(caja, html) {
  if (!caja) return false;
  const huella = hashCorto(html);
  if (caja.dataset.huella === huella) return false;
  caja.dataset.huella = huella;
  caja.innerHTML = html;
  return true;
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
  ajustes: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
};
const ico = (n, tam = 18) =>
  `<svg class="ico" viewBox="0 0 24 24" width="${tam}" height="${tam}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${TRAZOS[n] || ""}</svg>`;

export function pintarViaje(app) {
  if (!$("#hopResumen", app)) return;
  pintarPortada(app);
  pintarRail(app);
  pintarResumen(app);
  pintarBuscar(app);
  pintarVuelos(app);
  pintarCamas(app);
  ponerFotos(app);
}

/* -------------------------------------------------- la portada y los pasos */
function pintarPortada(app) {
  const hueco = $("#hopPortadaFoto", app);
  if (!hueco) return;
  const v = ganadora("vuelo") || ordenadas(deTipo("vuelo"))[0];
  const clave = v ? `${v.iata}|${v.titulo}` : "";
  if (hueco.dataset.de === clave) return;
  hueco.dataset.de = clave;
  hueco.outerHTML = v
    ? huecoFoto({ iata: v.iata, ciudad: v.titulo, pais: v.pais }, "hopx-portada-foto").replace(
        "<div ",
        `<div id="hopPortadaFoto" data-de="${esc(clave)}" `
      )
    : `<div id="hopPortadaFoto" class="hopx-portada-foto" data-de="" aria-hidden="true"></div>`;
}

function pintarRail(app) {
  const vuelos = deTipo("vuelo").length > 0;
  const v = !!ganadora("vuelo");
  const camas = deTipo("cama").length > 0;
  const c = !!ganadora("cama");
  const pasos = [
    ["Buscar", vuelos, "#hopBloqueVuelo"],
    ["Votar destino", v, "#hopVuelos"],
    ["Dónde dormir", camas, "#hopBloqueCama"],
    ["Plan cerrado", c, "#hopResumen"],
  ];
  const actual = pasos.findIndex(([, hecho]) => !hecho);
  const hechos = pasos.filter(([, h]) => h).length;
  pintarSi(
    $("#hopRail", app),
    `<ol class="hopx-rail" style="--hecho:${hechos / (pasos.length - 1)}">${pasos
      .map(
        ([t, hecho, ancla], i) =>
          `<li class="${hecho ? "hecho" : ""}${i === actual ? " actual" : ""}">
            <a href="${ancla}"><span class="hopx-rail-n">${hecho ? ico("si", 14) : i + 1}</span><span>${t}</span></a>
          </li>`
      )
      .join("")}</ol>`
  );
}

/* --------------------------------------------------------------- el plan */
function pintarResumen(app) {
  const caja = $("#hopResumen", app);
  const v = ganadora("vuelo");
  if (!v) {
    pintarSi(caja, "");
    return;
  }
  const c = ganadora("cama");
  const n = (estado.hop.miembros || []).length;
  const nombres = estado.hop.nombres || {};
  const nv = puntos(v);
  const faltan = (estado.hop.miembros || []).filter((u) => !(v.votos || {})[u]);
  const precioCama = c && Number.isFinite(c.precio) ? c.precio : null;
  const total = (Number.isFinite(v.precio) ? v.precio : 0) + (precioCama || 0);
  const dias = noches(v.ida, v.vuelta);
  pintarSi(
    caja,
    `<article class="hopx-plan">
      ${huecoFoto({ iata: v.iata, ciudad: v.titulo, pais: v.pais }, `hopx-plan-foto ${tono(v.iata || v.titulo)}`)}
      <div class="hopx-plan-velo">
        <p class="hopx-kicker">${c ? "El plan" : "El plan, de momento"}</p>
        <h3>${esc(v.titulo)}</h3>
        <p class="hopx-plan-pais">${esc(v.pais || "")}${v.iata ? ` · ${esc(v.iata)}` : ""}</p>
      </div>
      <div class="hopx-plan-datos">
        <dl class="hopx-plan-dl">
          <div><dt>Ida</dt><dd>${esc(fmtDate(v.ida, true))}</dd></div>
          <div><dt>Vuelta</dt><dd>${esc(fmtDate(v.vuelta, true))}</dd></div>
          <div><dt>Noches</dt><dd>${dias || "—"}</dd></div>
          <div><dt>Vuelo</dt><dd>${esc(v.compania || "—")}</dd></div>
          <div class="ancho"><dt>Dormir</dt><dd>${
            c ? esc(c.titulo) : `<a href="#hopBloqueCama" class="hopx-falta">sin elegir todavía</a>`
          }</dd></div>
        </dl>
        <div class="hopx-plan-total">
          <span>por cabeza</span>
          <b>${euros(total)}</b>
          <small>vuelo ${Number.isFinite(v.precio) ? euros(v.precio) : "—"}${
            precioCama !== null ? ` + dormir ${euros(precioCama)}` : ""
          }</small>
        </div>
        <p class="hopx-plan-apoyo">${ico("si", 16)} <b>${nv.si} de ${n}</b> se apuntan${
          faltan.length ? ` · falta${faltan.length === 1 ? "" : "n"} ${esc(faltan.map((u) => nombres[u] || "?").join(", "))}` : ""
        }</p>
        <div class="hopx-plan-acc">
          ${enlaceOk(v.url) ? `<a class="btn primary small" href="${escURL(v.url)}" target="_blank" rel="noopener">Reservar el vuelo ${ico("fuera", 14)}</a>` : ""}
          ${c && enlaceOk(c.url) ? `<a class="btn ghost small" href="${escURL(c.url)}" target="_blank" rel="noopener">Ver el alojamiento ${ico("fuera", 14)}</a>` : ""}
        </div>
      </div>
    </article>`
  );
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
  return `<div class="hop-buscando hopx-buscando">
      <div class="hopx-radar" aria-hidden="true"><i></i><i></i><i></i><span>${ico(que === "vuelos" ? "avion" : "cama", 22)}</span></div>
      <div class="hopx-buscando-txt">
        <p><b>Buscando ${que} para el grupo…</b></p>
        <p class="hop-letra">Lo lanzó ${esc(b.nombre || "alguien")} hace ${min} min · ${
          quedan ? `suele tardar unos ${quedan} min más` : "está al caer"
        }</p>
        <div class="hop-barra-progreso" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"
          aria-label="Progreso de la búsqueda"><i style="width:${pct}%"></i></div>
        <p class="hop-letra">${esc(b.texto || "")}</p>
        <p class="hop-letra">Podéis cerrar la página: los resultados entran solos y os esperan aquí.</p>
      </div>
    </div>`;
}

function pintarBuscar(app) {
  const caja = $("#hopBuscar", app);
  const estadoTxt = $("#hopEstadoVuelo", app);
  const b = enMarcha("busqueda");
  const vuelos = deTipo("vuelo");
  if (b && b.pasado < CADUCA_BUSQUEDA_MS) {
    estadoTxt.textContent = "buscando…";
    pintarSi(caja, progresoHTML(b, ESPERA_VUELOS_MS, "vuelos"));
    return;
  }
  const v = ganadora("vuelo");
  estadoTxt.textContent = v ? `va ganando ${v.titulo}` : vuelos.length ? `${vuelos.length} destinos para votar` : "";
  const ultima = estado.hop.busqueda;
  if (vuelos.length && !estado.buscar) {
    if (
      pintarSi(
        caja,
        `<div class="hopx-plegado">
          <span>${ico("lupa", 16)} ${
            b
              ? "La última búsqueda tardó demasiado."
              : ultima && ultima.estado === "vacia"
                ? "La última búsqueda no encontró nada."
                : esc((ultima && ultima.texto) || "")
          }</span>
          <button class="btn ghost small" type="button" data-hop-abrir-buscar>Buscar otra cosa</button>
        </div>`
      )
    ) {
      caja.querySelector("[data-hop-abrir-buscar]").addEventListener("click", () => {
        estado.buscar = true;
        pintarBuscar(app);
      });
    }
    return;
  }
  if (caja.querySelector("#hopBuscarForm")) return; // no se repinta un formulario a medio rellenar
  caja.dataset.huella = "";
  caja.innerHTML = formBuscar(b, ultima);
  montarFormBuscar(app, caja);
}

const manana = () => sumarDiasISO(hoyISO(), 1);
function sumarDiasISO(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const TOPES = [50, 80, 100, 150, 200, 300, 500, 800];

/* El buscador es UNA FRASE: «Salimos de Madrid hacia cualquier sitio un finde,
   sin pasar de 150 € por cabeza. Somos 4.» Cada trozo subrayado se toca y se
   cambia. Se lee de un vistazo qué se va a buscar, que en un grupo es lo que
   importa: el que lo lanza no tiene que explicarlo en el chat. */
function formBuscar(atascada, ultima) {
  const fin = estado.hop.fin;
  const n = personasHop();
  const sel = (nombre, opciones, elegida, etiqueta) =>
    `<select class="hopx-pieza" name="${nombre}" aria-label="${etiqueta}">${opciones
      .map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(elegida) ? " selected" : ""}>${esc(t)}</option>`)
      .join("")}</select>`;
  const fecha = (nombre, etiqueta, valor = "") =>
    `<input class="hopx-pieza" type="date" name="${nombre}" aria-label="${etiqueta}" min="${manana()}" max="${esc(fin)}" value="${esc(valor)}">`;
  return `<form class="hopx-buscar" id="hopBuscarForm" novalidate>
      ${
        atascada
          ? `<div class="hop-aviso error">La última búsqueda tardó demasiado y no llegó nada. Probad otra vez.</div>`
          : ultima && ultima.estado === "vacia"
            ? `<div class="hop-aviso">La última búsqueda no encontró nada dentro del tope. Probad con más presupuesto
                u otras fechas.</div>`
            : ""
      }
      <p class="hopx-frase">
        Salimos de ${sel("origen", ORIGENES.map(([c, nom]) => [c, nom]), "MAD", "De dónde salís")}
        hacia ${sel("donde", [["any", "cualquier sitio"], ["one", "un sitio concreto…"]], "any", "A dónde")}
        ${sel(
          "cuando",
          [["findes", "un finde"], ["fechas", "en unas fechas"], ["tramo", "unos días"]],
          "findes",
          "Cuándo"
        )}<span class="hopx-trozo" data-para="fechas" hidden>: del ${fecha("ida", "Ida")} al ${fecha("vuelta", "Vuelta")}</span><span
          class="hopx-trozo" data-para="tramo" hidden> (${sel("noches", [2, 3, 4, 5, 7].map((x) => [x, `${x} noches`]), 3, "Noches")})
          entre el ${fecha("desde", "Desde")} y el ${fecha("hasta", "Hasta", fin)}</span><span class="hopx-trozo" data-para="findes"> antes del ${esc(
            fmtDate(fin)
          )}</span>,
        sin pasar de ${sel("tope", TOPES.map((x) => [x, `${x} €`]), 150, "Tope por persona")} por cabeza.
        Somos ${sel("personas", [1, 2, 3, 4, 5, 6, 7, 8].map((x) => [x, String(x)]), n, "Cuántos sois")}.
      </p>
      <input type="hidden" id="hopDest">
      <div class="hop-horas" id="hopHorasWrap"><input type="hidden" id="hopHoras"></div>
      <div class="hopx-buscar-pie">
        <button class="btn primary hopx-lanzar" type="submit">${ico("lupa")} Buscar para el grupo</button>
        <span class="hop-letra">Miramos todas las compañías. Tarda unos minutos y os llega a todos.</span>
        ${deTipo("vuelo").length ? `<button class="btn ghost small" type="button" data-hop-cerrar-buscar>Cancelar</button>` : ""}
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
    form.querySelectorAll("[data-para]").forEach((x) => (x.hidden = x.dataset.para !== f.cuando.value));
  };
  sincronizar();
  f.cuando.addEventListener("change", sincronizar);
  f.donde.addEventListener("change", () => {
    if (f.donde.value === "one") abrirDestinos("hopDest");
  });
  destino.addEventListener("change", () => {
    const v = destino.value.trim();
    opcionUna.textContent = v || "un sitio concreto…";
    f.donde.value = v ? "one" : "any";
  });
  montarHoras($("#hopHorasWrap", form), $("#hopHoras", form));
  form.querySelector("[data-hop-cerrar-buscar]")?.addEventListener("click", () => {
    estado.buscar = false;
    pintarBuscar(app);
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
    let weekend = "si";
    let nights = "2-3";
    let cuandoTxt = `un finde antes del ${fmtDate(estado.hop.fin)}`;
    if (f.cuando.value === "findes") {
      viaje.desde = manana();
      viaje.hasta = estado.hop.fin;
    } else if (f.cuando.value === "fechas") {
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
    viaje.hop = estado.id;
    const personas = Number(f.personas.value) || personasHop();
    const texto = [
      `${dest || "Cualquier sitio"}${f.origen.value !== "MAD" ? ` desde ${f.origen.value}` : ""}`,
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
    caja.dataset.huella = "";
    pintarViaje(app);
    nubeHopApuntar(estado.id, "busqueda", apunte);
    if (typeof tfAnunciar === "function") tfAnunciar("Búsqueda lanzada para el grupo. Tarda unos minutos.");
  });
}

/* Lo que está en marcha: se mira si ya ha llegado y, si sí, entra como cartas.
   Lo hace el primero del grupo que lo ve; si lo ven dos a la vez, las cartas
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
          tfAnunciar(n ? `Han llegado ${n} destinos para votar.` : "La búsqueda no encontró vuelos dentro del tope.");
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
  const pax = Math.max(1, Number(((estado.hop.cama && estado.hop.cama.texto) || "").match(/(\d+) pers/)?.[1]) || personasHop());
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
          c.rating ? `nota ${c.rating}${c.reviews ? ` (${c.reviews})` : ""}` : "",
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

/* ------------------------------------------------------------ las cartas */
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
  const falta = (estado.hop.miembros || []).filter((u) => !(p.votos || {})[u]).length;
  return falta ? `falta${falta === 1 ? "" : "n"} ${falta}` : "han votado todos";
}

function cartaVuelo(p, puesto, lider) {
  const dias = noches(p.ida, p.vuelta);
  return `<article class="hopx-carta${lider ? " lider" : ""}" data-prop="${esc(p.id)}">
      <div class="hopx-carta-foto">
        ${huecoFoto({ iata: p.iata, ciudad: p.titulo, pais: p.pais }, tono(p.iata || p.titulo))}
        <span class="hopx-marca" aria-hidden="true">${esc(p.iata || "")}</span>
        ${lider ? `<span class="hopx-lider">${ico("corona", 14)} va ganando</span>` : `<span class="hopx-puesto">${puesto}</span>`}
        <span class="hopx-precio">${Number.isFinite(p.precio) ? euros(p.precio) : "—"}<small>por cabeza</small></span>
        <div class="hopx-carta-nombre"><b>${esc(p.titulo)}</b><small>${esc(p.pais || p.destino || "")}</small></div>
      </div>
      <div class="hopx-carta-cuerpo">
        <p class="hopx-fechas">${ico("calendario", 15)} ${esc(fmtDate(p.ida, true))} – ${esc(fmtDate(p.vuelta, true))}${
          dias ? ` · <b>${dias} noche${dias === 1 ? "" : "s"}</b>` : ""
        }</p>
        <p class="hopx-dato">${ico("avion", 15)} <span>${esc([p.horario, p.compania].filter(Boolean).join(" · "))}${
          enlaceOk(p.url) ? ` · <a href="${escURL(p.url)}" target="_blank" rel="noopener">ver</a>` : ""
        }</span></p>
        ${medidorHTML(p)}
        ${votarHTML(p)}
        <div class="hopx-carta-pie">${quienesHTML(p)}<span class="hop-letra">${faltanTxt(p)}</span></div>
      </div>
    </article>`;
}

function cartaCama(p, puesto, lider) {
  const v = ganadora("vuelo");
  const foto = enlaceOk(p.foto)
    ? `<div class="foto-lugar con-foto" style="background-image:url('${escURL(p.foto)}')" aria-hidden="true"></div>`
    : v
      ? huecoFoto({ iata: v.iata, ciudad: v.titulo, pais: v.pais }, tono(p.titulo))
      : `<div class="foto-lugar ${tono(p.titulo)}" aria-hidden="true"></div>`;
  return `<article class="hopx-carta hopx-cama${lider ? " lider" : ""}" data-prop="${esc(p.id)}">
      <div class="hopx-carta-foto">
        ${foto}
        ${lider ? `<span class="hopx-lider">${ico("corona", 14)} va ganando</span>` : `<span class="hopx-puesto">${puesto}</span>`}
        <span class="hopx-precio">${Number.isFinite(p.precio) ? euros(p.precio) : "—"}<small>por cabeza</small></span>
      </div>
      <div class="hopx-carta-cuerpo">
        <p class="hopx-cama-nombre">${esc(p.titulo)}</p>
        ${p.destino ? `<p class="hopx-dato">${ico("pin", 15)} <span>${esc(p.destino)}</span></p>` : ""}
        ${p.nota || enlaceOk(p.url) ? `<p class="hopx-dato">${ico("cama", 15)} <span>${esc(p.nota || "")}${
          enlaceOk(p.url) ? `${p.nota ? " · " : ""}<a href="${escURL(p.url)}" target="_blank" rel="noopener">ver el sitio</a>` : ""
        }</span></p>` : ""}
        ${medidorHTML(p)}
        ${votarHTML(p)}
        <div class="hopx-carta-pie">${quienesHTML(p)}<span class="hop-letra">${faltanTxt(p)}</span></div>
      </div>
    </article>`;
}

function barraMazo(tipo, lista) {
  const pendientes = sinVotar(lista).length;
  const orden = estado.orden || "votos";
  return `<div class="hopx-barra">
      <p><b>${lista.length} ${tipo === "cama" ? "sitios" : "destinos"}</b></p>
      <div class="hop-filtro" role="radiogroup" aria-label="Ordenar">
        <button type="button" role="radio" data-orden="votos" aria-checked="${orden === "votos"}">Más votados</button>
        <button type="button" role="radio" data-orden="precio" aria-checked="${orden === "precio"}">Más baratos</button>
      </div>
      ${
        pendientes
          ? `<button class="btn primary small hopx-deslizar" type="button" data-rapido="${tipo}">${ico("cartas", 16)} Votar deslizando <i>${pendientes}</i></button>`
          : `<span class="hop-chip">${ico("si", 14)} ya has votado todo</span>`
      }
    </div>`;
}

function pintarMazo(app, caja, tipo, carta) {
  const lista = ordenadas(deTipo(tipo), estado.orden);
  if (!lista.length) {
    pintarSi(caja, "");
    return;
  }
  const lider = ganadora(tipo);
  if (
    pintarSi(
      caja,
      barraMazo(tipo, lista) +
        `<div class="hopx-mazo">${lista.map((p, i) => carta(p, i + 1, p === lider)).join("")}</div>`
    )
  ) {
    caja.querySelector("[data-rapido]")?.addEventListener("click", () => votarDeslizando(app, tipo));
    caja.querySelectorAll("[data-orden]").forEach((b) =>
      b.addEventListener("click", () => {
        estado.orden = b.dataset.orden;
        pintarViaje(app);
      })
    );
  }
}

function pintarVuelos(app) {
  pintarMazo(app, $("#hopVuelos", app), "vuelo", cartaVuelo);
}

/* ------------------------------------------------------- dónde dormir */
function pintarCamas(app) {
  const caja = $("#hopCamasCab", app);
  const estadoTxt = $("#hopEstadoCama", app);
  const v = ganadora("vuelo");
  const c = enMarcha("cama");
  const camas = deTipo("cama");
  const gana = ganadora("cama");
  estadoTxt.textContent = c ? "buscando…" : gana ? `va ganando ${gana.titulo}` : camas.length ? `${camas.length} sitios` : "";
  let cabeza = "";
  if (c && c.pasado < CADUCA_BUSQUEDA_MS) {
    cabeza = progresoHTML(c, ESPERA_CAMA_MS, "dónde dormir");
  } else if (!v) {
    cabeza = `<div class="hopx-bloqueado">${ico("candado", 20)}<p><b>Primero, el destino.</b> En cuanto un destino tenga
      un «me apunto», se busca alojamiento para esas fechas.</p></div>`;
  } else if (!(estado.hop.cama && estado.hop.cama.oferta === v.oferta && estado.hop.cama.estado !== "buscando")) {
    cabeza = `<div class="hopx-cta">
        ${huecoFoto({ iata: v.iata, ciudad: v.titulo, pais: v.pais }, `hopx-cta-foto ${tono(v.iata || v.titulo)}`)}
        <div class="hopx-cta-txt">
          <p>Va ganando <b>${esc(v.titulo)}</b>, del ${esc(fmtDate(v.ida))} al ${esc(fmtDate(v.vuelta))}.</p>
          <button class="btn primary" type="button" data-hop-cama>${ico("cama")} Buscar dónde dormir para ${personasHop()}</button>
          <p class="hop-msg" role="status"></p>
        </div>
      </div>`;
  }
  if (pintarSi(caja, cabeza)) {
    caja.querySelector("[data-hop-cama]")?.addEventListener("click", (e) => buscarCama(app, v, e.currentTarget));
  }
  pintarMazo(app, $("#hopCamas", app), "cama", cartaCama);
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
    hop: estado.id,
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
          <span class="hopx-marca" aria-hidden="true">${esc(p.iata || "")}</span>
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
                 <p>${ico("avion", 15)} ${esc([p.horario, p.compania].filter(Boolean).join(" · "))}</p>`
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
    if (tipo === "vuelo") galeriaEnCarta(carta, p);
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
