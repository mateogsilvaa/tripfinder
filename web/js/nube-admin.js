/* nube-admin.js — El panel cuando hay Firebase: aprobar a quien pide entrar.

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
  const lede = $("#lede");
  if (lede) lede.textContent = "Aquí apruebas las cuentas que piden entrar en la web y ves quién hay.";

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
  $("#stats").innerHTML =
    `<div><dd>${cuentas.length}</dd><dt>cuentas</dt></div>` +
    `<div><dd class="${cuenta("pendiente") ? "hot" : ""}">${cuenta("pendiente")}</dd><dt>pendientes</dt></div>` +
    `<div><dd>${cuenta("aprobado")}</dd><dt>aprobadas</dt></div>` +
    (cuenta("bloqueado") ? `<div><dd>${cuenta("bloqueado")}</dd><dt>bloqueadas</dt></div>` : "") +
    (sinVincular.length
      ? `<div><dd class="hot">${sinVincular.length}</dd><dt>cuentas de antes sin vincular</dt></div>`
      : "");

  const ordenadas = [...cuentas].sort(
    (a, b) =>
      (ORDEN[a.estado] ?? 3) - (ORDEN[b.estado] ?? 3) ||
      (b.creado instanceof Date ? b.creado.getTime() : 0) - (a.creado instanceof Date ? a.creado.getTime() : 0)
  );

  caja.innerHTML = `
    <section class="controls" style="margin-top:26px">
      <button class="btn ghost" type="button" id="nubeRecargar">Recargar</button>
      <button class="btn ghost" type="button" id="nubeAdminSalir">Salir</button>
      <a class="btn ghost" href="./">← Volver a la web</a>
    </section>
    <div class="hint" id="nubeAviso" role="status">${esc(aviso)}</div>
    <section class="rows" id="nubeCuentas">${
      ordenadas.length
        ? ordenadas.map((c) => fila(c, yo, sinVincular)).join("")
        : `<p class="meta">Todavía no se ha registrado nadie.</p>`
    }</section>`;

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
          ? `${b.dataset.nombre}: aprobada y vinculada con «${vieja.nombre || vieja.usuario}». Ya tiene lo de antes.`
          : `No se pudo: ${r.error}`
      );
    })
  );
  caja.querySelectorAll("[data-estado]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (b.disabled) return;
      document.querySelectorAll("[data-vincular], [data-estado]").forEach((x) => (x.disabled = true));
      const r = await nubeCambiarEstado(b.dataset.uid, b.dataset.estado);
      lista(
        caja,
        yo,
        r.ok ? `${b.dataset.nombre}: ${ESTADOS[b.dataset.estado][1].toLowerCase()}.` : `No se pudo: ${r.error}`
      );
    })
  );
}

function fila(c, yo, sinVincular = []) {
  const [clase, texto] = ESTADOS[c.estado] || ["pendiente", c.estado || "Sin estado"];
  const esYo = c.id === yo.uid;
  const boton = (estado, rotulo, primario) =>
    `<button class="btn ${primario ? "primary" : "ghost"} small" type="button" data-estado="${estado}"
      data-uid="${esc(c.id)}" data-nombre="${esc(c.nombre)}">${rotulo}</button>`;
  const acciones = esYo
    ? `<span class="meta">tú</span>`
    : c.estado === "pendiente"
      ? boton("aprobado", "Aprobar", true) + boton("bloqueado", "Bloquear")
      : c.estado === "aprobado"
        ? boton("bloqueado", "Bloquear")
        : boton("aprobado", "Aprobar", true);
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
             data-nombre="${esc(c.nombre)}">Aprobar y vincular</button>
         </span>
         ${mismo ? `<span class="meta">Su correo coincide con una cuenta de antes.</span>` : ""}`
      : `<span class="meta">Para vincularla con una cuenta de antes, antes tiene que verificar su correo.</span>`;
  }
  const etiquetaVerif = c.verificado
    ? ` · correo verificado`
    : ` · <span class="ojo">correo sin verificar</span>`;
  return `
    <div class="brow cuenta-row nube-cuenta ${esc(clase)}" data-cuenta="${esc(c.id)}">
      <span class="iata">${esc(String(c.nombre || "?").slice(0, 3).toUpperCase())}</span>
      <span class="dest-cell">
        <span class="city">${esc(c.nombre)}${c.admin ? " · admin" : ""}</span>
        <span class="country">${esc(c.correo)}<br>${esc(texto)}${etiquetaVerif}${
          fecha(c.creado) ? ` · desde ${esc(fecha(c.creado))}` : ""
        }${c.legado ? " · vinculada con una cuenta de antes" : ""}</span>
        ${vincular}
      </span>
      <span class="peticion-acc">${acciones}</span>
    </div>`;
}
