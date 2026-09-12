/* mundo.js — El mapa de dónde has estado.

   Un `<path>` por país, su código ISO y su nombre; marcar uno es un
   `classList.toggle`. Sin librería de mapas, sin peticiones a nadie y sin
   proyectar nada en tiempo real: el SVG ya viene proyectado del repo
   (`tools/mapa.py`), así que lo único que hace este fichero es contar y pintar.

   DÓNDE SE GUARDA, y por qué no en la cuenta. Va en `localStorage` con el
   espacio de nombres de la cuenta, igual que los favoritos. Se podría mandar a
   `users.json` con un `user_prefs` y así seguirte de un móvil a otro, pero ese
   fichero SE PUBLICA ENTERO en Pages: cualquiera que abriera
   `…/data/users.json` vería los países de cada cuenta. Un mapa de por dónde has
   viajado no es un secreto, pero tampoco es de quien pase por ahí. Se dice en
   la propia pantalla, para que nadie descubra tarde que se le perdió al cambiar
   de navegador. */

import { $, esc, fetchJSON } from "./base.js";
import { wireEntrar } from "./disparador.js";

const MEMORIA = tfClave("tf_mundo");

/* Lo que el scraper escribe como país no siempre coincide con el nombre del
   mapa: unos vienen en inglés y otros sin tildes. Se comparan normalizados, y
   los cuatro que ni así cuadran van a mano. */
const ALIAS = {
  singapore: "SG",
  "south korea": "KR",
  "north macedonia": "MK",
  "czech republic": "CZ",
};

const pelado = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

function leer() {
  try {
    const d = JSON.parse(localStorage.getItem(MEMORIA) || "[]");
    return new Set(Array.isArray(d) ? d.filter((x) => /^[A-Z]{2}$/.test(x)) : []);
  } catch {
    return new Set(); // navegación privada: el mapa funciona, solo que no recuerda
  }
}

function guardar(vistos) {
  try {
    localStorage.setItem(MEMORIA, JSON.stringify([...vistos].sort()));
  } catch {
    /* nada que hacer: se avisa abajo, en el pie del mapa */
  }
}

let VISTOS = new Set();
let PAISES = []; // [{iso, nombre, nodo}]
let CON_VUELO = new Set(); // a los que hay vuelo ahora mismo
let SOLO_VUELO = false;
let FILTRO = ""; // lo escrito en el buscador de la lista

/* ------------------------------------------------------------------ pintar */

function pintar() {
  PAISES.forEach(({ iso, nodo }) => {
    nodo.classList.toggle("visitado", VISTOS.has(iso));
    nodo.classList.toggle("con-vuelo", SOLO_VUELO && CON_VUELO.has(iso));
  });
  contar();
  pintarLista(FILTRO);
}

function contar() {
  const total = PAISES.length;
  const n = PAISES.filter((p) => VISTOS.has(p.iso)).length;
  const pct = total ? Math.round((n / total) * 100) : 0;
  $("#mundoCifra").textContent = String(n);
  $("#mundoDe").textContent = `de ${total} países y territorios · ${pct} %`;
  const barra = $("#mundoBarra");
  if (barra) {
    barra.style.setProperty("--pct", `${pct}%`);
    barra.setAttribute("aria-valuenow", String(pct));
  }

  // El dato que solo puede dar esta web: de los sitios a los que hay vuelo hoy,
  // en cuántos has estado. Es lo que convierte el mapa en algo que mirar antes
  // de elegir destino, y no en un álbum de cromos.
  const conVuelo = [...CON_VUELO];
  const hechos = conVuelo.filter((i) => VISTOS.has(i)).length;
  const caja = $("#mundoVuelos");
  if (caja) {
    caja.hidden = !conVuelo.length;
    $("#mundoVuelosTxt").innerHTML = conVuelo.length
      ? `De los <b>${conVuelo.length}</b> países a los que hay vuelo ahora mismo, ` +
        `has estado en <b>${hechos}</b>. Quedan <b>${conVuelo.length - hechos}</b>.`
      : "";
  }
}

/* La lista es la otra mitad del mapa, no un extra: Malta, Andorra o Singapur
   son tres píxeles y con el dedo no se aciertan. Aquí se buscan por nombre. */
function pintarLista(filtro = "") {
  const caja = $("#mundoLista");
  if (!caja) return;
  // Quien marca con el teclado esta DENTRO de la lista: si se repinta a pelo,
  // el foco se cae al `body` y hay que volver a bajar hasta donde estaba.
  const tenia = caja.contains(document.activeElement) ? document.activeElement.dataset.ir : null;
  const q = pelado(filtro);
  const hay = PAISES.filter((p) => !q || pelado(p.nombre).includes(q));
  caja.innerHTML = hay.length
    ? hay
        .map(
          (p) => `<button type="button" class="pais-chip${VISTOS.has(p.iso) ? " on" : ""}"
            data-ir="${esc(p.iso)}" aria-pressed="${VISTOS.has(p.iso)}">${esc(p.nombre)}</button>`
        )
        .join("")
    : '<p class="vacio">Ningún país con ese nombre.</p>';
  if (tenia) {
    const vuelve = caja.querySelector(`[data-ir="${CSS.escape(tenia)}"]`);
    if (vuelve) vuelve.focus();
  }
}

/* ------------------------------------------------------------------ marcar */

function alternar(iso) {
  if (!iso) return;
  if (VISTOS.has(iso)) VISTOS.delete(iso);
  else VISTOS.add(iso);
  guardar(VISTOS);
  pintar();
  const p = PAISES.find((x) => x.iso === iso);
  if (p && typeof tfAnunciar === "function") {
    tfAnunciar(`${p.nombre}: ${VISTOS.has(iso) ? "marcado" : "desmarcado"}.`);
  }
}

/* El rótulo que sigue al ratón. En el móvil no hay ratón: ahí lo dice el
   `<title>` del propio trazo y, sobre todo, la lista de abajo. */
function rotulo(nodo, ev) {
  const caja = $("#mundoRotulo");
  if (!caja) return;
  if (!nodo) {
    caja.hidden = true;
    return;
  }
  const marco = $("#mundoMapa").getBoundingClientRect();
  caja.hidden = false;
  caja.textContent = nodo.dataset.n + (VISTOS.has(nodo.dataset.iso) ? " · marcado" : "");
  caja.style.left = `${ev.clientX - marco.left}px`;
  caja.style.top = `${ev.clientY - marco.top}px`;
}

/* ---------------------------------------------------------------- arranque */

export async function montarMundo() {
  const marco = $("#mundoMapa");
  if (!marco) return;

  // Exclusivo de quien tiene cuenta: lo marcado es de ALGUIEN, y sin sesión
  // no hay a quién apuntárselo —se guardaría en un cajón compartido y el
  // siguiente que entrara se encontraría el mapa de otro, que es justo el
  // fallo que las cuentas vinieron a arreglar—. Se enseña la puerta.
  if (!tfUid()) {
    $("#mundoPuerta").hidden = false;
    if (typeof wireEntrar === "function") wireEntrar(document);
    return;
  }
  $("#mundo").hidden = false;

  let svg = "";
  try {
    const r = await fetch("mapa.svg");
    if (!r.ok) throw new Error(String(r.status));
    svg = await r.text();
  } catch {
    marco.innerHTML =
      '<p class="vacio">No se ha podido cargar el mapa. Recarga la página.</p>';
    return;
  }
  marco.insertAdjacentHTML("afterbegin", svg);

  PAISES = [...marco.querySelectorAll("path[data-iso]")]
    .map((nodo) => ({ iso: nodo.dataset.iso, nombre: nodo.dataset.n, nodo }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  VISTOS = leer();

  // A dónde se puede ir hoy. Si falla, el mapa sigue funcionando entero: esto
  // es un extra, no el contenido.
  try {
    const datos = await fetchJSON("data/offers.json");
    const porNombre = new Map(PAISES.map((p) => [pelado(p.nombre), p.iso]));
    (datos.offers || []).forEach((o) => {
      const bruto = pelado(o.destination_country);
      const iso = porNombre.get(bruto) || ALIAS[bruto];
      if (iso) CON_VUELO.add(iso);
    });
  } catch {
    /* sin ofertas no hay cruce, y ya está */
  }

  pintar();

  // Pulsar un país, con el ratón o con el dedo. Se delega en el marco: son
  // doscientos y pico trazos y colgarle un oyente a cada uno no aporta nada.
  marco.addEventListener("click", (ev) => {
    const nodo = ev.target.closest("path[data-iso]");
    if (nodo) alternar(nodo.dataset.iso);
  });
  marco.addEventListener("mousemove", (ev) => {
    const nodo = ev.target.closest("path[data-iso]");
    rotulo(nodo, ev);
  });
  marco.addEventListener("mouseleave", () => rotulo(null));

  // La lista: buscar y marcar.
  const busca = $("#mundoBusca");
  if (busca) {
    busca.addEventListener("input", () => {
      FILTRO = busca.value;
      pintarLista(FILTRO);
    });
  }
  $("#mundoLista").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-ir]");
    if (b) alternar(b.dataset.ir);
  });

  const soloVuelo = $("#mundoSoloVuelo");
  if (soloVuelo) {
    soloVuelo.addEventListener("change", () => {
      SOLO_VUELO = soloVuelo.checked;
      pintar();
    });
  }

  const borrar = $("#mundoBorrar");
  if (borrar) {
    borrar.addEventListener("click", () => {
      if (!VISTOS.size) return;
      if (!confirm(`¿Desmarcar los ${VISTOS.size} países?`)) return;
      VISTOS = new Set();
      guardar(VISTOS);
      pintar();
    });
  }
}
