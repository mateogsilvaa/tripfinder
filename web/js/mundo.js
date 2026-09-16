/* mundo.js — El mapa de dónde has estado.

   Un `<path>` por país, su código ISO y su nombre; marcar uno es un
   `classList.toggle`. Sin librería de mapas, sin peticiones a nadie y sin
   proyectar nada en tiempo real: el SVG ya viene proyectado del repo
   (`tools/mapa.py`), así que lo único que hace este fichero es contar y pintar.

   DÓNDE SE GUARDA. En dos sitios, y por este orden: en `localStorage` con el
   espacio de nombres de la cuenta —inmediato, funciona sin red y sin permisos—
   y en el repositorio, en `data/mundos/<uid>.json`, que es lo que hace que el
   mapa siga siendo tuyo al cambiar de móvil o al limpiar el historial. Antes
   solo estaba lo primero, y un mapa que cuesta un rato marcar se perdía sin
   avisar.

   Y ESO SIGNIFICA PUBLICARLO. No hay término medio: la única base de datos que
   tiene esta web es un repositorio público, y `data/` se copia entero a Pages.
   Guardar el mapa es dejarlo a la vista, que es justo lo que permite mirar el
   de los demás. Así que se dice con esas palabras en la propia pantalla, hay
   un interruptor para no guardarlo —y entonces el fichero se borra de verdad,
   no se queda vacío— y quien lo apaga sigue teniendo su mapa aquí, en su
   navegador, como hasta ahora.

   Cuál manda cuando los dos tienen algo: el más reciente, entero. Un mapa no
   se fusiona —la unión resucitaría un país que acabas de desmarcar en el otro
   dispositivo—, así que cada lado lleva la hora de su último cambio y gana esa.
   */

import { $, esc, fetchJSON, pintarStats, stat } from "./base.js";
import { comoDueno, dispatch, esFaltaDeAcceso, wireEntrar } from "./disparador.js";

const MEMORIA = tfClave("tf_mundo");
/* Que has dicho que NO lo guardas. Va aparte del mapa y no dentro: si viviera
   dentro, «empezar de cero» te volvería a encender el guardado sin que lo
   pidieras. */
const APAGADO = tfClave("tf_mundo_local");

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

const isos = (lista) =>
  new Set((Array.isArray(lista) ? lista : []).filter((x) => /^[A-Z]{2}$/.test(x)));

/* Lo de aquí, con la hora de su último cambio. El formato viejo era la lista a
   secas: se sigue leyendo —si no, el primero que abra esto tras el cambio se
   encuentra el mapa en blanco— y se le pone hora cero, que es lo honesto: no
   se sabe de cuándo es, así que pierde contra cualquier cosa fechada. */
function leer() {
  try {
    const d = JSON.parse(localStorage.getItem(MEMORIA) || "[]");
    if (Array.isArray(d)) return { paises: isos(d), en: 0 };
    return { paises: isos(d && d.p), en: Number(d && d.t) || 0 };
  } catch {
    return { paises: new Set(), en: 0 }; // navegación privada: funciona, no recuerda
  }
}

function guardar(vistos, en = Date.now()) {
  CUANDO = en;
  try {
    localStorage.setItem(MEMORIA, JSON.stringify({ p: [...vistos].sort(), t: en }));
  } catch {
    /* nada que hacer: se avisa abajo, en el pie del mapa */
  }
}

const seGuarda = () => {
  try {
    return localStorage.getItem(APAGADO) !== "si";
  } catch {
    return false; // sin localStorage tampoco hay a quién apuntárselo
  }
};

function marcarApagado(apagado) {
  try {
    if (apagado) localStorage.setItem(APAGADO, "si");
    else localStorage.removeItem(APAGADO);
  } catch {
    /* nada */
  }
}

let VISTOS = new Set();
let CUANDO = 0; // cuándo se tocó por última vez lo que hay en VISTOS
let PAISES = []; // [{iso, nombre, nodo}]
let CON_VUELO = new Set(); // a los que hay vuelo ahora mismo
let SOLO_VUELO = false;
let FILTRO = ""; // lo escrito en el buscador de la lista

/* De quién es el mapa que se está mirando: "" es el tuyo. El de otro se mira y
   no se toca, que es lo único que hace falta decir sobre los permisos: no hay
   forma de escribir en el fichero de nadie más, porque el workflow solo
   escribe en el de la cuenta que manda el encargo. */
let MIRANDO = "";
let MIO = new Set(); // el tuyo, aparcado mientras miras el de otro
let DE_OTROS = []; // el índice: [{o, n, c, u}]

/* ------------------------------------------------------- guardar de verdad

   El encargo lleva el mapa ENTERO, no lo que acabas de tocar: así dos pestañas
   o dos móviles no tienen que ponerse de acuerdo sobre un diff, y el último
   que escriba deja el fichero como está su mapa. Cada encargo es un workflow y
   un commit, así que los clics se juntan durante un momento y sale UNO solo:
   marcar veinte países de una sentada no son veinte despliegues.

   Este es el mismo truco que ya usa el borrado de búsquedas por lotes, y por
   el mismo motivo. */
const ESPERA_MS = 2500;
let timer = null;
let subiendo = false;

function avisar(txt) {
  const caja = $("#mundoNota");
  if (caja) caja.textContent = txt;
}

/* Lo que dice la línea de debajo del interruptor. Nunca promete más de lo que
   hay: guardar aquí es publicar, y eso se dice antes y no después. */
function notaDeGuardado(estado = "") {
  if (!seGuarda()) {
    avisar(
      "Guardado solo en este navegador: si limpias el historial o entras desde otro sitio, no estará. " +
        "Nadie más puede verlo."
    );
    return;
  }
  avisar(
    (estado ? `${estado} ` : "") +
      "Se guarda en tu cuenta, dentro del repositorio: por eso lo tienes en cualquier dispositivo y " +
      "por eso los demás pueden verlo. Esta web no tiene otro sitio donde guardarlo."
  );
}

/* SIEMPRE EL TUYO, nunca el que estés mirando. `VISTOS` es lo que se pinta, y
   mirando el mapa de otro eso es el de otro: subirlo escribiría su mapa en tu
   fichero y el tuyo se perdería sin que nadie lo hubiera pedido. */
const mapaMio = () => (MIRANDO ? MIO : VISTOS);

function encargar(accion) {
  const { owner, owner_name } = comoDueno();
  if (!owner) return Promise.resolve({ ok: false, reason: "sin-cuenta" });
  return dispatch("mundo", {
    accion,
    owner,
    owner_name,
    paises: [...mapaMio()].sort().join(","),
  });
}

async function subirAhora(accion = "set") {
  if (subiendo) return;
  subiendo = true;
  const r = await encargar(accion);
  subiendo = false;
  if (r.ok) {
    notaDeGuardado(accion === "clear" ? "Quitado de la web." : "Guardado.");
    return;
  }
  // Que no se haya podido guardar FUERA no es que se haya perdido: aquí sigue.
  // Decirlo importa, porque el mapa se ve igual de bien en los dos casos.
  avisar(
    esFaltaDeAcceso(r)
      ? "No se ha podido guardar en tu cuenta: hace falta entrar con una cuenta con acceso. " +
          "Lo marcado sigue en este navegador."
      : `No se ha podido guardar en tu cuenta (${r.reason || "fallo"}). Lo marcado sigue en este navegador.`
  );
}

function subirMapa(accion = "set") {
  if (MIRANDO) return; // el mapa de otro no se toca, así que no hay nada que subir
  if (!seGuarda() && accion !== "clear") return;
  clearTimeout(timer);
  timer = setTimeout(() => subirAhora(accion), ESPERA_MS);
}

/* Y si te vas antes de que salte el temporizador, sale ya. Sin esto, marcar un
   país y cerrar la pestaña pierde justo ese último cambio. */
function soltarPendiente() {
  if (!timer) return;
  clearTimeout(timer);
  timer = null;
  subirAhora("set");
}

/* --------------------------------------------------------- traerlo de vuelta

   Al abrir: lo que hay guardado en la cuenta contra lo que hay en este
   navegador, y gana el más reciente ENTERO. Un mapa no se fusiona: la unión
   resucitaría el país que acabas de desmarcar en el otro dispositivo, y quien
   lo desmarcó lo vería volver solo. */
async function sincronizarMio() {
  const { owner } = comoDueno();
  if (!owner) return;
  let remoto = null;
  try {
    remoto = await fetchJSON(`data/mundos/${owner}.json`);
  } catch {
    remoto = null; // no lo tiene guardado todavía, o no hay red
  }

  const suyo = isos(remoto && remoto.paises);
  const cuando = remoto && remoto.actualizado ? Date.parse(remoto.actualizado) : 0;

  if (remoto && cuando > CUANDO) {
    VISTOS = suyo;
    guardar(VISTOS, cuando);
    notaDeGuardado("Recuperado de tu cuenta.");
    return;
  }

  // Lo de aquí es más nuevo (o no hay nada guardado todavía). Se sube solo si
  // de verdad dice algo distinto: un encargo por nada es un workflow, un commit
  // y un despliegue por nada.
  const igual = suyo.size === VISTOS.size && [...VISTOS].every((p) => suyo.has(p));
  if (!seGuarda() || igual || !VISTOS.size) {
    notaDeGuardado();
    return;
  }
  notaDeGuardado("Guardando lo que tenías aquí…");
  subirMapa("set");
}

/* ------------------------------------------------------ el mapa de los demás

   La otra mitad de tener un mapa: verlo al lado del de otro. Solo salen los que
   lo han guardado —que es lo mismo que decir: los que han aceptado que se vea—
   y lo que se hace con el de otro es mirarlo, nada más. */
async function cargarIndice() {
  try {
    const { mundos } = await fetchJSON("data/mundos/index.json");
    DE_OTROS = (mundos || []).filter((m) => m && m.o);
  } catch {
    DE_OTROS = [];
  }
  const sel = $("#mundoQuien");
  if (!sel) return;
  const yo = comoDueno().owner;
  const otros = DE_OTROS.filter((m) => m.o !== yo);
  sel.innerHTML =
    '<option value="">El mío</option>' +
    otros
      .map(
        (m) =>
          `<option value="${esc(m.o)}">${esc(m.n || "Alguien")} · ${m.c} país${
            m.c === 1 ? "" : "es"
          }</option>`
      )
      .join("");
  // Sin nadie más que mirar, el selector sobra: un desplegable con una sola
  // opción es una pregunta que no se puede contestar.
  sel.parentElement.hidden = !otros.length;
}

/* Lo que escribe en TU mapa no tiene sentido sobre el de otro. */
function apagarControles(ajeno) {
  [$("#mundoGuardar"), $("#mundoBorrar")].forEach((c) => {
    if (c) c.disabled = ajeno;
  });
}

async function verMapaDe(uid) {
  const comparar = $("#mundoComparar");
  if (!uid) {
    // Volver al tuyo: se recupera el que estaba aparcado, sin releer nada.
    MIRANDO = "";
    VISTOS = MIO;
    if (comparar) comparar.hidden = true;
    $("#mundo").classList.remove("ajeno");
    apagarControles(false);
    pintar();
    notaDeGuardado();
    return;
  }

  let datos = null;
  try {
    datos = await fetchJSON(`data/mundos/${uid}.json`);
  } catch {
    avisar("Ese mapa ya no está guardado.");
    $("#mundoQuien").value = "";
    return;
  }
  if (!MIRANDO) MIO = VISTOS; // se aparca el tuyo la primera vez, no cada vez
  MIRANDO = uid;
  VISTOS = isos(datos.paises);
  $("#mundo").classList.add("ajeno");
  apagarControles(true);
  pintar();

  // Lo que de verdad se quiere saber al mirar el mapa de otro no es cuántos
  // lleva, es en cuántos ha estado que tú no.
  const suyos = VISTOS;
  const soloSuyos = [...suyos].filter((p) => !MIO.has(p)).length;
  const comunes = [...suyos].filter((p) => MIO.has(p)).length;
  const quien = datos.owner_name || "Esta cuenta";
  if (comparar) {
    comparar.hidden = false;
    comparar.textContent =
      `${quien} lleva ${suyos.size} país${suyos.size === 1 ? "" : "es"}. ` +
      `${comunes} los tienes tú también` +
      (soloSuyos
        ? `, y ${soloSuyos} no ${soloSuyos === 1 ? "lo tienes" : "los tienes"}.`
        : ". No tiene ninguno que te falte.");
  }
  avisar("Estás mirando el mapa de otra cuenta: se mira, no se marca.");
}

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
  // Las cifras de la cabecera son las de ESTA pagina: cuantos paises llevas y
  // que parte del mundo es. Hasta ahora salian las del tablon de chollos.
  pintarStats(stat("países", String(n)) + stat("del mundo", `${pct} %`, true));

  // El dato que solo puede dar esta web: de los sitios a los que hay vuelo hoy,
  // en cuántos has estado. Es lo que convierte el mapa en algo que mirar antes
  // de elegir destino, y no en un álbum de cromos.
  //
  // Y se dicen los NOMBRES, no solo cuantos son. "De los 6 países a los que hay
  // vuelo has estado en 2" no te deja hacer nada con el dato; "hoy hay vuelo a
  // Italia, Portugal y Albania, y Albania no la tienes" sí.
  const caja = $("#mundoVuelos");
  if (!caja) return;
  const conVuelo = PAISES.filter((p) => CON_VUELO.has(p.iso));
  const faltan = conVuelo.filter((p) => !VISTOS.has(p.iso));
  caja.hidden = !conVuelo.length;
  if (!conVuelo.length) {
    $("#mundoVuelosTxt").innerHTML = "";
    return;
  }
  const lista = enumerar(conVuelo.map((p) => p.nombre));
  const cola = !faltan.length
    ? "Los has pisado todos."
    : faltan.length === conVuelo.length
      ? `Ninguno lo tienes marcado.`
      : `${faltan.length === 1 ? "Uno de ellos no lo tienes" : `${faltan.length} de ellos no los tienes`} marcado${faltan.length === 1 ? "" : "s"}.`;
  $("#mundoVuelosTxt").innerHTML = `Hoy hay vuelo barato a <b>${esc(lista)}</b>. ${esc(cola)}`;
}

/* "Italia, Portugal y Albania", no "Italia, Portugal, Albania". Con mas de
   cinco se corta: la frase esta para leerse de un vistazo, y una lista de
   cuarenta paises no se lee, se salta. */
function enumerar(nombres, tope = 6) {
  const lista = nombres.slice(0, tope);
  const resto = nombres.length - lista.length;
  const texto =
    lista.length > 1 ? `${lista.slice(0, -1).join(", ")} y ${lista[lista.length - 1]}` : lista[0] || "";
  return resto > 0 ? `${texto} y ${resto} más` : texto;
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
  // Mirando el de otro no se marca nada: si se dejara, lo marcado se guardaría
  // en TU fichero con el mapa de otro dentro, que es la peor manera posible de
  // perder el tuyo.
  if (MIRANDO) {
    avisar("Esto es el mapa de otra cuenta. Vuelve al tuyo para marcar países.");
    return;
  }
  if (VISTOS.has(iso)) VISTOS.delete(iso);
  else VISTOS.add(iso);
  guardar(VISTOS);
  subirMapa("set");
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

  const guardado = leer();
  VISTOS = guardado.paises;
  CUANDO = guardado.en;
  MIO = VISTOS;

  const interruptor = $("#mundoGuardar");
  if (interruptor) interruptor.checked = seGuarda();

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

  // El interruptor de guardarlo. Apagarlo BORRA el fichero: dejarlo publicado
  // con el guardado apagado sería lo peor de las dos opciones.
  if (interruptor) {
    interruptor.addEventListener("change", async () => {
      marcarApagado(!interruptor.checked);
      notaDeGuardado();
      clearTimeout(timer);
      if (interruptor.checked) await subirAhora("set");
      else await subirAhora("clear");
      cargarIndice();
    });
  }

  const quien = $("#mundoQuien");
  if (quien) quien.addEventListener("change", () => verMapaDe(quien.value));

  // Si te vas con un cambio a medio guardar, se manda antes de cerrar.
  window.addEventListener("pagehide", soltarPendiente);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") soltarPendiente();
  });

  // Lo de fuera va después de pintar: el mapa se ve al momento con lo que hay
  // aquí y la cuenta lo corrige en cuanto conteste, en vez de dejar la pantalla
  // en blanco esperando a la red.
  await sincronizarMio();
  pintar();
  cargarIndice();

  const borrar = $("#mundoBorrar");
  if (borrar) {
    borrar.addEventListener("click", () => {
      if (!VISTOS.size) return;
      if (MIRANDO) return; // no es tuyo: no hay nada que borrar aquí
      if (!confirm(`¿Desmarcar los ${VISTOS.size} países?`)) return;
      VISTOS = new Set();
      MIO = VISTOS;
      guardar(VISTOS);
      // Y fuera también: un mapa vacío aquí y el de ayer publicado es peor que
      // no haberlo borrado, porque desde el móvil volvería entero.
      subirMapa(seGuarda() ? "set" : "clear");
      pintar();
    });
  }
}
