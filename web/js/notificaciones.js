/* Los avisos como notificación del aparato, al lado del correo.

   Quien instala la web como app puede pedir que los chollos y los seguimientos
   le lleguen como una notificación normal, en vez de (o además de) por correo.
   Aquí se pide el permiso, se suscribe el navegador al servicio de push y la
   suscripción se guarda en la cuenta (`nubeGuardarAparato`); el barrido la lee
   y manda el aviso cifrado (`src/tripfinder/notify/push.py`).

   Dos sitios lo usan:
     · `preguntarCanal()`: al instalar la app (o al abrirla instalada por
       primera vez con la cuenta dentro), una sola vez, se pregunta por dónde.
     · `atarCanal()`: el «Por dónde» de Mi cuenta, con el estado de este
       aparato y una notificación de prueba.

   En el iPhone, Safari solo deja recibir notificaciones a la app instalada en
   la pantalla de inicio: en una pestaña ni siquiera existe `PushManager`, y
   por eso no se ofrece. */

// La mitad pública del par VAPID. La privada es el secreto VAPID_PRIVATE_KEY
// del repositorio; las dos salen de `tripfinder vapid`. Cambiarla deja muertas
// las suscripciones que haya: cada aparato tendría que volver a activarlas.
export const CLAVE_PUBLICA = "BGkGWXamLdS88WMC8rFkDZhQBHZ1ghI_REI4IVHrFqSyTTv3S7suJtLiHoL_3xgW3UYpuqdiCSiRaEG7ewnSvLs";

const PREGUNTADO = "tf_canal_preguntado";

const esc = (s) => (typeof tfEsc === "function" ? tfEsc(s) : String(s));

export const soporta = () =>
  "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const instalada = () =>
  (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;

function claveBytes(b64) {
  const t = (b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
}

async function registro() {
  // `ready` no termina nunca si no hay service worker (en local, sin
  // registrar): con un tope, se dice que no se puede en vez de colgarse.
  return Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 4000))]);
}

/* Cómo está este aparato: "no" (no se puede), "bloqueado" (dijiste que no al
   permiso), "activo" o "apagado". */
export async function estadoAparato() {
  if (!soporta()) return "no";
  if (Notification.permission === "denied") return "bloqueado";
  const reg = await registro();
  if (!reg) return "no";
  const sub = await reg.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "activo" : "apagado";
}

/* Pide el permiso, suscribe y guarda. Tiene que llamarse desde un clic: el
   navegador no deja pedir permiso por las buenas. */
export async function activarAparato() {
  if (!soporta()) {
    return { ok: false, error: instalada() ? "Este navegador no deja recibir notificaciones." : textoSinSoporte() };
  }
  let permiso = Notification.permission;
  if (permiso === "default") permiso = await Notification.requestPermission();
  if (permiso !== "granted") {
    return { ok: false, error: "Sin permiso no se pueden mandar notificaciones. Se cambia en los ajustes del navegador." };
  }
  const reg = await registro();
  if (!reg) return { ok: false, error: "La app todavía se está instalando. Prueba en un momento." };
  let sub;
  try {
    sub =
      (await reg.pushManager.getSubscription()) ||
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: claveBytes(CLAVE_PUBLICA) }));
  } catch (e) {
    return { ok: false, error: `El navegador no ha dejado suscribirse (${e.message || e}).` };
  }
  return nubeGuardarAparato(sub);
}

export async function apagarAparato() {
  const reg = soporta() ? await registro() : null;
  const sub = reg && (await reg.pushManager.getSubscription());
  if (!sub) return { ok: true };
  await nubeQuitarAparato(sub.endpoint);
  try {
    await sub.unsubscribe();
  } catch {
    /* ya no estaba */
  }
  return { ok: true };
}

/* Una de prueba, desde aquí mismo: dice si el permiso funciona y cómo se ve. */
export async function probar() {
  const reg = await registro();
  if (!reg || Notification.permission !== "granted") return false;
  await reg.showNotification("TripFinder", {
    body: "Así te llegarán los chollos y tus seguimientos.",
    icon: "./iconos/icono-192.png",
    badge: "./iconos/icono-192.png",
    tag: "prueba",
  });
  return true;
}

function textoSinSoporte() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
    ? "En el iPhone, las notificaciones solo llegan a la app instalada: Compartir y «Añadir a pantalla de inicio»."
    : "Este navegador no deja recibir notificaciones.";
}

const TEXTO_ESTADO = {
  no: () => textoSinSoporte(),
  bloqueado: () => "Las notificaciones están bloqueadas en este navegador: se activan en sus ajustes.",
  activo: () => "Este aparato recibe las notificaciones.",
  apagado: () => "Este aparato todavía no recibe notificaciones.",
};

/* El «Por dónde» de Mi cuenta. Al elegir notificaciones se activa este aparato;
   si no se puede, se vuelve al correo y se dice por qué. `alCambiar` guarda. */
export async function atarCanal(caja, p, alCambiar) {
  const grupo = caja.querySelector(`#${p}Canal`);
  const linea = caja.querySelector(`#${p}Aparato`);
  if (!grupo || !linea) return;
  const elegir = (v) =>
    grupo.querySelectorAll("[data-canal]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.canal === v)));
  const elegido = () => grupo.querySelector('[aria-checked="true"]')?.dataset.canal || "correo";

  const pintar = async (aviso = "") => {
    const est = await estadoAparato();
    const quiere = elegido() !== "correo";
    linea.innerHTML = `${esc(aviso || (quiere || est === "activo" ? TEXTO_ESTADO[est]() : ""))}${
      est === "activo" ? ` <button type="button" class="enlace" id="${p}Probar">Mandar una de prueba</button>` : ""
    }${
      quiere && est === "apagado" ? ` <button type="button" class="enlace" id="${p}Activar">Activar aquí</button>` : ""
    }`;
    linea.querySelector(`#${p}Probar`)?.addEventListener("click", probar);
    linea.querySelector(`#${p}Activar`)?.addEventListener("click", async () => {
      const r = await activarAparato();
      pintar(r.ok ? "" : r.error);
    });
  };

  grupo.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-canal]");
    if (!b || b.getAttribute("aria-checked") === "true") return;
    const antes = elegido();
    elegir(b.dataset.canal);
    if (b.dataset.canal !== "correo" && (await estadoAparato()) !== "activo") {
      linea.textContent = "Activando…";
      const r = await activarAparato();
      if (!r.ok) {
        elegir(antes);
        pintar(r.error);
        return;
      }
    }
    alCambiar();
    pintar();
  });
  pintar();
}

/* LA PREGUNTA AL INSTALAR. Una vez por aparato, con la cuenta dentro y solo si
   el aparato puede recibir notificaciones. «Solo correo» también cuenta como
   respuesta: no se vuelve a preguntar (queda el «Por dónde» de Mi cuenta). */
export async function preguntarCanal({ forzar = false } = {}) {
  if (typeof tfSesion !== "function" || !tfSesion()) return;
  if (typeof nubeActiva !== "function" || !nubeActiva()) return;
  if (!soporta() || Notification.permission === "denied") return;
  try {
    if (!forzar && localStorage.getItem(PREGUNTADO)) return;
  } catch {
    return;
  }
  if (document.getElementById("tfModal") && !document.getElementById("tfModal").hidden) return;
  const marcar = () => {
    try {
      localStorage.setItem(PREGUNTADO, String(Date.now()));
    } catch {
      /* navegación privada */
    }
  };
  const caja = tfModal(`
    <header class="modal-head">
      <div>
        <p class="kicker">app instalada</p>
        <h2>¿Cómo quieres los avisos?</h2>
      </div>
      <button type="button" data-cerrar aria-label="Cerrar">cerrar</button>
    </header>
    <p class="canal-intro">Ahora que tienes TripFinder instalada, los chollos y tus seguimientos
      pueden llegarte como una notificación normal en vez de por correo.</p>
    <div class="canal-opciones" id="canalOpciones">
      <button type="button" class="canal-opcion" data-canal="app">
        <b>Notificaciones</b><span>En vez del correo</span></button>
      <button type="button" class="canal-opcion" data-canal="ambos">
        <b>Las dos</b><span>Notificación y correo</span></button>
      <button type="button" class="canal-opcion" data-canal="correo">
        <b>Solo correo</b><span>Como hasta ahora</span></button>
    </div>
    <p class="token-status" id="canalMsg" role="status"></p>`);
  marcar();
  const msg = caja.querySelector("#canalMsg");
  caja.querySelector("#canalOpciones").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-canal]");
    if (!b) return;
    const canal = b.dataset.canal;
    const s = tfSesion();
    if (canal === "correo") {
      tfCerrarModal();
      return;
    }
    caja.querySelectorAll("[data-canal]").forEach((x) => (x.disabled = true));
    msg.textContent = "Pidiendo permiso…";
    const r = await activarAparato();
    if (!r.ok) {
      msg.textContent = r.error;
      caja.querySelectorAll("[data-canal]").forEach((x) => (x.disabled = false));
      return;
    }
    // Elegir notificaciones es querer avisos: se encienden si estaban apagados.
    const g = await nubeGuardarPerfil(s.name, { ...(s.prefs || {}), avisos: true, canal });
    if (!g.ok) {
      msg.textContent = g.error;
      return;
    }
    msg.textContent = "Hecho. Qué avisos y cada cuánto, en Mi cuenta.";
    probar();
    setTimeout(() => tfCerrarModal(), 1800);
  });
}
