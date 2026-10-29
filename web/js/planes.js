/* planes.js — La página de planes: cuál tienes y «me interesa».

   Premium todavía no se cobra (ver TF_PREMIUM_OBLIGATORIO en nube.js). Lo que
   sí se puede hacer ya es saber quién lo querría: «Me interesa» lo apunta en
   tus preferencias (`quiere_premium`) y el panel lo cuenta. Sin cuenta, abre la
   de entrar primero. */
const $ = (s) => document.querySelector(s);
const boton = $("#planQuiero");
const nota = $("#planNota");

function pintar() {
  const s = typeof tfSesion === "function" ? tfSesion() : null;
  document.querySelectorAll(".plan").forEach((p) => p.classList.remove("tuyo"));
  if (!s) return;
  const premium = typeof nubeEsPremium === "function" && nubeEsPremium(s);
  const max = typeof nubeEsMax === "function" && nubeEsMax(s);
  (max ? $("#planMax") : premium ? $("#planPremium") : $("#planGratis"))?.classList.add("tuyo");
  if (premium) {
    boton.hidden = true;
    nota.textContent = "Es tu plan.";
  } else if (s.prefs && s.prefs.quiere_premium) {
    boton.disabled = true;
    boton.textContent = "Apuntado";
    nota.textContent = "Te avisaremos cuando salga.";
  }
}

async function quiero() {
  const s = typeof tfSesion === "function" ? tfSesion() : null;
  if (!s) {
    if (typeof tfAbrirLogin === "function") tfAbrirLogin();
    return;
  }
  if (typeof nubeGuardarPerfil !== "function") return;
  boton.disabled = true;
  const r = await nubeGuardarPerfil(s.name, { ...s.prefs, quiere_premium: true });
  if (!r.ok) {
    boton.disabled = false;
    nota.textContent = r.error;
    return;
  }
  pintar();
}

if (boton) {
  if (typeof TF_PREMIUM_OBLIGATORIO !== "undefined" && TF_PREMIUM_OBLIGATORIO) {
    const estreno = $("#planesEstreno");
    if (estreno) estreno.hidden = true;
  }
  boton.addEventListener("click", quiero);
  pintar();
}
