/* admin-ilustraciones.js — Subir la ilustración de una ciudad desde el panel.

   Se elige el país y la ciudad (de los aeropuertos que conoce la web), el
   dibujo de día y el de noche, y por dónde se corta cuando el hueco es más
   apaisado que el dibujo (el chollo del día). Aquí mismo se pasan a WebP de
   1600x1000 —los originales pesan medio mega largo— y se dejan en Firestore
   (`nubeSubirIlustracion`). En unos minutos `tripfinder encargos` lo ve, el
   workflow `ilustraciones.yml` las escribe en `ilustraciones/<país>/<ciudad>/`
   como si se hubieran subido al repo, las convierte y publica la web.

   Para una ciudad que ya tiene, «Cambiar» la carga en el formulario: se puede
   cambiar una sola de las dos, o solo el encuadre. */
import { esc } from "./base.js";

const INDICE = new URL("../ilustraciones/indice.json", import.meta.url);
const AEROPUERTOS = new URL("../data/airports.json", import.meta.url);
const ANCHO = 1600;
const ALTO = 1000;
// Lo que cabe en el documento de Firestore (las reglas cortan en 480 000).
const TOPE = 470000;

const carpeta = (t) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

const leer = (u) =>
  fetch(`${u.href}?t=${Date.now()}`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

/* Un dibujo cualquiera → WebP 1600x1000 recortado al centro, en base64. Si
   pesa de más, se baja la calidad hasta que quepa. */
async function aWebp(fichero) {
  const bmp = await createImageBitmap(fichero);
  const lienzo = document.createElement("canvas");
  lienzo.width = ANCHO;
  lienzo.height = ALTO;
  const k = Math.max(ANCHO / bmp.width, ALTO / bmp.height);
  const w = bmp.width * k;
  const h = bmp.height * k;
  lienzo.getContext("2d").drawImage(bmp, (ANCHO - w) / 2, (ALTO - h) / 2, w, h);
  for (const q of [0.86, 0.78, 0.7, 0.6, 0.5]) {
    const url = lienzo.toDataURL("image/webp", q);
    if (!url.startsWith("data:image/webp")) throw new Error("Este navegador no sabe guardar WebP: prueba con Chrome.");
    const b64 = url.slice(url.indexOf(",") + 1);
    if (b64.length <= TOPE) return { b64, url };
  }
  throw new Error("La imagen pesa demasiado incluso comprimida.");
}

export async function montarIlustraciones(caja) {
  caja.innerHTML = `<p class="meta"><span class="spin"></span>Cargando las ilustraciones…</p>`;
  const [indice, aeropuertos, pendientes] = await Promise.all([
    leer(INDICE),
    leer(AEROPUERTOS),
    typeof nubeIlustracionesPendientes === "function" ? nubeIlustracionesPendientes() : [],
  ]);
  const ciudades = (indice && indice.ciudades) || [];
  const lista = aeropuertos || [];
  const paisDe = Object.fromEntries(lista.map((a) => [a.code, a.country]));

  // Países y, de cada uno, sus ciudades con los aeropuertos que las sirven.
  const paises = new Map();
  for (const a of lista) {
    const p = paises.get(a.country.code) || { nombre: a.country.name, ciudades: new Map() };
    const nombre = String((a.city && a.city.name) || a.name).trim();
    p.ciudades.set(nombre, [...(p.ciudades.get(nombre) || []), a.code]);
    paises.set(a.country.code, p);
  }
  const ordenPaises = [...paises.entries()].sort((a, b) => a[1].nombre.localeCompare(b[1].nombre, "es"));

  // La carpeta de un país: la que ya use alguna ciudad de ese país, o su nombre.
  const carpetaPais = (cc) => {
    const ya = ciudades.find((c) => c.aeropuertos.some((x) => paisDe[x] && paisDe[x].code === cc));
    return ya ? ya.ruta.split("/")[0] : carpeta(paises.get(cc)?.nombre);
  };
  const yaDe = (codigos) => ciudades.find((c) => c.aeropuertos.some((x) => codigos.includes(x)));
  const huella = Object.fromEntries(ciudades.map((c) => [c.ruta, c.h || {}]));
  const urlDe = (ruta, m) =>
    new URL(`../ilustraciones/${ruta}/${m}.webp?h=${(huella[ruta] || {})[m] || ""}`, import.meta.url).href;

  const estado = { dia: null, noche: null, actual: null };

  caja.innerHTML = `
    <div class="adm-rejilla adm-ilu">
      <section class="adm-caja adm-ancha">
        <h4>Subir una ciudad</h4>
        <form id="admIluForm" class="adm-ilu-form">
          <div class="adm-ilu-donde">
            <label>País
              <select id="admIluPais" required>
                <option value="">Elige…</option>
                ${ordenPaises.map(([cc, p]) => `<option value="${esc(cc)}">${esc(p.nombre)}</option>`).join("")}
              </select>
            </label>
            <label>Ciudad
              <select id="admIluCiudad" required disabled><option value="">Primero el país</option></select>
            </label>
          </div>
          <p class="meta" id="admIluRuta"></p>
          <div class="adm-ilu-par">
            ${["dia", "noche"]
              .map(
                (m) => `<label class="adm-ilu-hueco" data-momento="${m}">
                  <span class="adm-ilu-rot">${m === "dia" ? "De día · tema claro" : "De noche · tema oscuro"}</span>
                  <span class="adm-ilu-vista" id="admIluVista-${m}"><span>Elige o arrastra la imagen</span></span>
                  <input type="file" accept="image/png,image/jpeg,image/webp" id="admIluFich-${m}">
                </label>`
              )
              .join("")}
          </div>
          <label class="adm-ilu-encuadre">Por dónde se corta en el chollo del día
            <input type="range" min="0" max="100" step="5" value="65" id="admIluY">
          </label>
          <div class="adm-ilu-franja" id="admIluFranja" aria-hidden="true"></div>
          <p class="token-status" id="admIluMsg" role="status"></p>
          <button class="btn primary" type="submit" id="admIluSubir">Subir</button>
        </form>
      </section>

      ${
        pendientes.length
          ? `<section class="adm-caja adm-ancha" id="admIluPendientes">
              <h4>Esperando a publicarse <small>tarda unos minutos</small></h4>
              <ul class="adm-ilu-pend">${pendientes
                .map((p) => `<li>${esc(p.nombre || p.ciudad)} <small>${esc(p.pais)}/${esc(p.ciudad)}</small></li>`)
                .join("")}</ul>
            </section>`
          : ""
      }

      <section class="adm-caja adm-ancha">
        <h4>En la web <span class="adm-caja-cifra">${ciudades.length}</span></h4>
        <ul class="adm-ilu-lista" id="admIluLista">${ciudades
          .map(
            (c) => `<li>
              <span class="adm-ilu-mini">${["dia", "noche"]
                .map((m) =>
                  c[m]
                    ? `<img src="${esc(urlDe(c.ruta, m))}" alt="" loading="lazy" width="96" height="60">`
                    : `<i class="falta" title="Falta la de ${m === "dia" ? "día" : "noche"}">sin ${m === "dia" ? "día" : "noche"}</i>`
                )
                .join("")}</span>
              <span class="adm-ilu-nombre"><b>${esc(c.nombre)}</b><small>${esc(c.aeropuertos.join(" · ") || "sin aeropuerto")}</small></span>
              <button type="button" class="btn ghost small" data-cambiar="${esc(c.ruta)}">Cambiar</button>
            </li>`
          )
          .join("")}</ul>
      </section>
    </div>`;

  const $ = (s) => caja.querySelector(s);
  const pais = $("#admIluPais");
  const ciudad = $("#admIluCiudad");
  const msg = $("#admIluMsg");
  const y = $("#admIluY");

  const destino = () => {
    const cc = pais.value;
    const p = paises.get(cc);
    if (!p || !ciudad.value) return null;
    const codigos = p.ciudades.get(ciudad.value) || [];
    const ya = yaDe(codigos);
    return {
      pais: ya ? ya.ruta.split("/")[0] : carpetaPais(cc),
      ciudad: ya ? ya.ruta.split("/")[1] : carpeta(ciudad.value),
      nombre: ciudad.value,
      aeropuertos: codigos,
      ya,
    };
  };

  const pintarVistas = () => {
    const d = destino();
    estado.actual = d && d.ya;
    $("#admIluRuta").textContent = d
      ? `${d.ya ? "Ya tiene ilustración: lo que subas la sustituye." : "Ciudad nueva."} Se guarda en ilustraciones/${d.pais}/${d.ciudad}/`
      : "";
    for (const m of ["dia", "noche"]) {
      const caja_ = $(`#admIluVista-${m}`);
      const url = estado[m] ? estado[m].url : estado.actual && estado.actual[m] ? urlDe(estado.actual.ruta, m) : "";
      caja_.style.backgroundImage = url ? `url("${url}")` : "";
      caja_.classList.toggle("con", !!url);
    }
    const franja = $("#admIluFranja");
    const tira = estado.dia || estado.noche;
    const url = tira ? tira.url : estado.actual ? urlDe(estado.actual.ruta, estado.actual.dia ? "dia" : "noche") : "";
    franja.style.backgroundImage = url ? `url("${url}")` : "";
    franja.style.backgroundPosition = `center ${y.value}%`;
    franja.hidden = !url;
  };

  pais.addEventListener("change", () => {
    const p = paises.get(pais.value);
    ciudad.disabled = !p;
    ciudad.innerHTML = p
      ? `<option value="">Elige…</option>${[...p.ciudades.entries()]
          .sort((a, b) => a[0].localeCompare(b[0], "es"))
          .map(([n, cs]) => `<option value="${esc(n)}">${esc(n)} (${esc(cs.join(", "))})</option>`)
          .join("")}`
      : `<option value="">Primero el país</option>`;
    pintarVistas();
  });
  ciudad.addEventListener("change", () => {
    const d = destino();
    if (d && d.ya) y.value = String(Number.isFinite(d.ya.y) ? d.ya.y : 65);
    pintarVistas();
  });
  y.addEventListener("input", pintarVistas);

  for (const m of ["dia", "noche"]) {
    const input = $(`#admIluFich-${m}`);
    input.addEventListener("change", async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      msg.textContent = "Preparando la imagen…";
      try {
        estado[m] = await aWebp(f);
        msg.textContent = "";
      } catch (e) {
        estado[m] = null;
        msg.textContent = e.message || "No se pudo leer esa imagen.";
      }
      pintarVistas();
    });
    const hueco = caja.querySelector(`[data-momento="${m}"]`);
    hueco.addEventListener("dragover", (e) => e.preventDefault());
    hueco.addEventListener("drop", (e) => {
      e.preventDefault();
      if (!e.dataTransfer.files.length) return;
      input.files = e.dataTransfer.files;
      input.dispatchEvent(new Event("change"));
    });
  }

  // «Cambiar» una que ya está: se elige sola en el formulario.
  $("#admIluLista").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cambiar]");
    if (!b) return;
    const c = ciudades.find((x) => x.ruta === b.dataset.cambiar);
    const cc = c && c.aeropuertos.map((x) => paisDe[x] && paisDe[x].code).find(Boolean);
    if (!cc) {
      msg.textContent = "Esa ciudad no está entre los aeropuertos de la web: súbela al repo.";
      return;
    }
    pais.value = cc;
    pais.dispatchEvent(new Event("change"));
    const nombre = [...paises.get(cc).ciudades.entries()].find(([, cs]) => cs.some((x) => c.aeropuertos.includes(x)));
    if (nombre) ciudad.value = nombre[0];
    estado.dia = null;
    estado.noche = null;
    ciudad.dispatchEvent(new Event("change"));
    $("#admIluForm").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  $("#admIluForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = destino();
    if (!d) {
      msg.textContent = "Elige el país y la ciudad.";
      return;
    }
    const encuadre = Number(y.value);
    const cambiaEncuadre = d.ya && encuadre !== (Number.isFinite(d.ya.y) ? d.ya.y : 65);
    if (!estado.dia && !estado.noche && !cambiaEncuadre) {
      msg.textContent = d.ya ? "No has cambiado nada." : "Falta al menos una de las dos imágenes.";
      return;
    }
    const boton = $("#admIluSubir");
    boton.disabled = true;
    msg.textContent = "Subiendo…";
    const r = await nubeSubirIlustracion({
      pais: d.pais,
      ciudad: d.ciudad,
      nombre: d.nombre,
      aeropuertos: d.aeropuertos,
      dia: estado.dia && estado.dia.b64,
      noche: estado.noche && estado.noche.b64,
      encuadre,
    });
    boton.disabled = false;
    if (!r.ok) {
      msg.textContent = r.error;
      return;
    }
    msg.textContent = `Subida ${d.nombre}. Sale en la web en unos minutos, cuando se publique.`;
    estado.dia = null;
    estado.noche = null;
    caja.querySelectorAll("input[type=file]").forEach((i) => (i.value = ""));
    setTimeout(() => montarIlustraciones(caja).then(() => {
      caja.querySelector("#admIluMsg").textContent = `Subida ${d.nombre}. Sale en la web en unos minutos.`;
    }), 600);
  });
}
