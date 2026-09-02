/* TripFinder — frontend estatico. Lee los JSON que commitea GitHub Actions. */

const REPO = "mateogsilvaa/tripfinder";
const POLL_EVERY_MS = 20000;
// 45 vueltas x 20 s = 15 min, de sobra para una busqueda de las largas.
const MAX_VUELTAS = 45;
const POLL_MAX_MS = 15 * 60 * 1000;

const $ = (sel) => document.querySelector(sel);
/* La web esta partida en tres zonas y cada pagina solo tiene su parte, asi que
   engancharse a un elemento que no existe no puede tumbar el resto. */
const on = (sel, evento, fn) => {
  const el = document.querySelector(sel);
  if (el) el.addEventListener(evento, fn);
};
const existe = (sel) => !!document.querySelector(sel);
const fmtEUR = (n) => `${Math.round(n)} €`;
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

function parseISO(iso) {
  const [y, m, d] = (iso || "").split("-").map(Number);
  return y ? new Date(y, m - 1, d) : null;
}

function fmtDate(iso, withDay = false) {
  const d = parseISO(iso);
  if (!d) return "";
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return withDay ? `${DAYS[d.getDay()]} ${base}` : base;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

/* Una URL que viene de los datos, lista para meter en un href o un src.

   `esc()` escapa caracteres, que esta bien y hace falta, pero escapar no
   impide un `javascript:`: sobreviviria intacto dentro del atributo y se
   ejecutaria al hacer clic. Hoy estos campos los generan nuestros propios
   providers, asi que esto es endurecer, no tapar un agujero abierto — pero el
   dia que un scraper se trague HTML de un tercero, esta es la linea que hay
   que tener ya puesta.

   Lo que pasa: http, https y mailto. Lo demas sale como "#" y se apunta en el
   registro, que si un provider empieza a devolver basura interesa saberlo. */
const ESQUEMAS_OK = new Set(["http:", "https:", "mailto:"]);

function escURL(valor) {
  const crudo = String(valor || "").trim();
  if (!crudo) return "";
  let esquema;
  try {
    // `location.href` como base para que las relativas ("buscar.html") sigan
    // valiendo: sin base, el constructor las rechaza y perderiamos enlaces
    // buenos por el camino.
    esquema = new URL(crudo, location.href).protocol;
  } catch {
    if (typeof tfApuntar === "function") tfApuntar("url", "URL que no se puede leer", crudo.slice(0, 120));
    return "#";
  }
  if (!ESQUEMAS_OK.has(esquema)) {
    if (typeof tfApuntar === "function") {
      tfApuntar("url", `esquema no permitido: ${esquema}`, crudo.slice(0, 120));
    }
    return "#";
  }
  return esc(crudo);
}

/* Cache-buster: Pages sirve los JSON con cache agresiva y aqui siempre queremos lo ultimo. */
const fetchJSON = (path) =>
  fetch(`${path}${path.includes("?") ? "&" : "?"}t=${Date.now()}`, { cache: "no-store" }).then((r) => {
    if (!r.ok) throw new Error(r.status);
    return r.json();
  });

let OFFERS = [];
let CONTINENTES = {}; // IATA -> continente, para filtrar
const SEARCH_OFFERS = {}; // ofertas de busquedas guardadas, por id

/* ------------------------------------------------------------------ precios
   Cada oferta lleva a cuanta gente cubre su precio (`adults`). El scan diario
   busca para una persona; una busqueda o un seguimiento, para los que hayas
   dicho. Sin distinguirlo, "240 €" tanto puede ser lo que pagas tu como lo que
   pagais los cuatro, que es justo la duda que hace perder un chollo.

   Regla: si va mas de uno, manda el TOTAL (es lo que sale de la cuenta) y el
   por persona va debajo. Si va uno solo, no hay nada que repartir. */
const pax = (o) => Math.max(1, Number(o?.adults) || 1);
const porPersona = (o) =>
  Number.isFinite(Number(o?.price_per_person)) && Number(o.price_per_person) > 0
    ? Number(o.price_per_person)
    : o.price / pax(o);

/* Estimacion para la portada: el scan guarda el precio de una persona y multi-
   plicarlo es una aproximacion honesta mientras no se busque para el grupo.
   Va marcada con "≈" a proposito: las tarifas van por cupos y las ultimas
   plazas de un vuelo no valen lo mismo que las primeras. */
/* Cada cuenta tiene su cajon en este navegador: "tf_grupo:u-1a2b". Sin sesion
   se usa la clave de siempre, que es donde ya estaba lo tuyo. */
const GRUPO_KEY = tfClave("tf_grupo");
let GRUPO = Math.min(8, Math.max(1, Number(localStorage.getItem(GRUPO_KEY)) || 1));

/* Cuanta gente cubre de verdad el precio que se va a ensenar, y si el total es
   una cuenta nuestra o el numero que devolvio la aerolinea. */
function reparto(o) {
  const propios = pax(o);
  if (propios > 1) return { gente: propios, unidad: porPersona(o), estimado: false };
  return { gente: GRUPO, unidad: porPersona(o), estimado: GRUPO > 1 };
}

/* El bloque de precio, igual en el billete grande, en el panel de salidas y en
   las filas de una busqueda guardada. */
function precioHTML(o, { grande = false } = {}) {
  const { gente, unidad, estimado } = reparto(o);
  const total = unidad * gente;
  const clase = grande ? "amount" : "cifra";
  if (gente <= 1) {
    return `<span class="${clase}">${Math.round(unidad)}<span>€</span></span>
      <span class="pax-nota">por persona</span>`;
  }
  return `<span class="${clase}">${estimado ? "≈" : ""}${Math.round(total)}<span>€</span></span>
    <span class="pax-nota">${Math.round(unidad)} € × ${gente} pers.${
      estimado ? " · estimado" : ""
    }</span>`;
}

/* Las búsquedas y los seguimientos guardan a cuánta gente se buscó en su
   cabecera, pero los ficheros escritos antes de que las ofertas llevaran su
   propio `adults` no lo tienen dentro de cada vuelo. Sin esto, una búsqueda
   para cuatro seguía enseñando el precio como si fuera de uno. */
function conGrupo(ofertas, cuantos) {
  const n = Math.max(1, Number(cuantos) || 1);
  (ofertas || []).forEach((o) => {
    if (!Number(o.adults)) o.adults = n;
  });
  return ofertas || [];
}

/* Version de una linea, para las filas del panel de salidas. */
function precioCorto(o) {
  const { gente, unidad, estimado } = reparto(o);
  if (gente <= 1) {
    return `<span class="cifra">${fmtEUR(unidad)}</span><small>por persona</small>`;
  }
  return `<span class="cifra">${estimado ? "≈" : ""}${fmtEUR(
    unidad * gente
  )}</span><small>${Math.round(unidad)} €/persona</small>`;
}

/* Comparadores que valen la pena abrir con la ruta ya puesta. eDreams va
   aparte porque con una cuenta Prime los precios que ves tu no son los que ve
   nadie mas: no hay forma de scrapearlos desde aqui (harian falta tus claves),
   pero el enlace se abre en TU navegador, ya con tu sesion, y ahi si sale tu
   tarifa de socio. Es la unica manera honesta de aprovecharlo. */
function edreamsURL(o) {
  const ida = (o.depart_date || "").slice(0, 10);
  if (!ida) return "";
  const vuelta = (o.return_date || "").slice(0, 10);
  const gente = Math.max(1, pax(o) > 1 ? pax(o) : GRUPO);
  const partes = [
    `type=${vuelta ? "R" : "O"}`,
    `from=${o.origin || "MAD"}`,
    `to=${o.destination}`,
    `dep=${ida}`,
    vuelta ? `ret=${vuelta}` : "",
    `adults=${gente}`,
  ].filter(Boolean);
  return `https://www.edreams.es/travel/#/results/${partes.join(";")}`;
}

/* ---------------------------------------------------------------- favoritos
   Marcar un vuelo con la estrella lo guarda en ESTE navegador junto con el
   precio que tenia al marcarlo. Cada vez que la web vuelve a ver ese mismo
   vuelo (en los chollos del dia, dentro de una busqueda guardada o en lo que
   devuelve un seguimiento) compara el precio de ahora con el ultimo visto y,
   si ha cambiado, lo apunta y lo canta arriba del todo.

   No hace falta servidor: el precio ya viaja en los JSON que publica Actions,
   asi que lo unico que faltaba era acordarse de lo que valia la ultima vez. */
const FAV_KEY = tfClave("tf_favoritos");
/* Busquedas que se han mandado borrar y todavia no han desaparecido del indice. */
const BORRANDO_KEY = tfClave("tf_borrando");

function favLeer() {
  try {
    const crudo = JSON.parse(localStorage.getItem(FAV_KEY) || "{}");
    return crudo && typeof crudo === "object" && !Array.isArray(crudo) ? crudo : {};
  } catch {
    return {};
  }
}

function favGuardar(mapa) {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(mapa));
  } catch {
    /* navegacion privada o cuota llena: los favoritos duran la sesion */
  }
}

let FAVS = favLeer();
const esFav = (id) => Object.prototype.hasOwnProperty.call(FAVS, id);

/* Lo minimo para poder pintar el favorito aunque la oferta ya no este en
   ningun JSON (una busqueda borrada, un chollo que se agoto). */
function favResumen(o) {
  return {
    id: o.id,
    origin: o.origin || "MAD",
    destination: o.destination,
    destination_name: o.destination_name || o.destination,
    destination_country: o.destination_country || "",
    depart_date: o.depart_date,
    return_date: o.return_date || "",
    nights: o.nights || null,
    airline: o.airline || o.provider || "",
    adults: pax(o),
    deep_link: o.deep_link || "",
    airline_link: o.airline_link || "",
    airline_link_label: o.airline_link_label || "",
  };
}

/* Marcar una entrada no es una estrella de favorito: es la anotacion al margen
   de un indice, un cuadratin que se rellena de rojo. La palabra la pone el
   aria-label; el dibujo, el CSS. */
function favBtn(o) {
  const activo = esFav(o.id);
  const que = activo ? "Dejar de seguir este viaje" : "Poner este viaje en observación";
  return `<button class="fav${activo ? " on" : ""}" type="button" data-fav="${esc(o.id)}"
    aria-pressed="${activo}" aria-label="${que}" title="${que}"><span aria-hidden="true"></span></button>`;
}

function alternar(o) {
  if (esFav(o.id)) {
    delete FAVS[o.id];
  } else {
    const unidad = redondea(porPersona(o));
    FAVS[o.id] = {
      ...favResumen(o),
      desde: Date.now(),
      precio_inicial: unidad,
      precio_visto: unidad,
      visto_en: hoyISO(),
      historia: [{ d: hoyISO(), p: unidad }],
      // Nace sin aviso a proposito: interesa lo que cambie a partir de ahora.
      cambio: null,
    };
  }
  favGuardar(FAVS);
  pintarFavs();
  refrescarAvisoFavs();
  pintarListaFavs();
}

const hoyISO = () => new Date().toISOString().slice(0, 10);
const redondea = (n) => Math.round(Number(n) * 100) / 100;

/* Repinta solo las estrellas, sin volver a montar la lista entera. */
function pintarFavs(raiz = document) {
  raiz.querySelectorAll("[data-fav]").forEach((b) => {
    const activo = esFav(b.dataset.fav);
    b.classList.toggle("on", activo);
    b.setAttribute("aria-pressed", String(activo));
    const que = activo ? "Dejar de seguir este viaje" : "Poner este viaje en observación";
    b.setAttribute("aria-label", que);
    b.title = que;
  });
}

function wireFavs(raiz = document) {
  raiz.querySelectorAll("[data-fav]").forEach((b) =>
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      // Un favorito es de alguien: guardarlo sin cuenta lo dejaria en un cajon
      // que no es de nadie y que la siguiente persona que entre se encontraria.
      if (!tfUid()) return tfAbrirLogin();
      const id = b.dataset.fav;
      const o = OFFERS.find((x) => x.id === id) || SEARCH_OFFERS[id] || FAVS[id];
      if (o) alternar(o);
    })
  );
}

/* El corazon del asunto: comparar lo que vale hoy con lo ultimo que se vio.
   Se llama desde todos los sitios donde aparecen ofertas, asi que un favorito
   se actualiza tanto si lo ves en los chollos como si abres la busqueda que lo
   encontro o el seguimiento que lo trajo. */
function sincronizarFavs(ofertas) {
  const hoy = hoyISO();
  let tocado = false;

  (ofertas || []).forEach((o) => {
    const f = FAVS[o.id];
    if (!f) return;
    const ahora = redondea(porPersona(o));
    const antes = Number(f.precio_visto);

    // La serie guarda un punto por dia: abrir la pagina diez veces no inventa
    // diez puntos, pero un cambio dentro del mismo dia si actualiza el ultimo.
    f.historia = Array.isArray(f.historia) ? f.historia : [];
    const ultimo = f.historia[f.historia.length - 1];
    if (ultimo && ultimo.d === hoy) ultimo.p = ahora;
    else f.historia.push({ d: hoy, p: ahora });
    f.historia = f.historia.slice(-60);

    Object.assign(f, favResumen(o)); // la oferta puede haber cambiado de compania
    f.precio_visto = ahora;
    f.visto_en = hoy;
    tocado = true;

    // Menos de medio euro es ruido de redondeo, no una bajada.
    if (Number.isFinite(antes) && Math.abs(ahora - antes) >= 0.5) {
      f.cambio = { antes, ahora, cuando: hoy, visto: false };
    }
  });

  if (tocado) favGuardar(FAVS);
  refrescarAvisoFavs();
}

const cambiosPendientes = () => Object.values(FAVS).filter((f) => f.cambio && !f.cambio.visto);

/* La diferencia contra el precio al que lo marcaste, en la propia fila. */
function deltaHTML(o) {
  const f = FAVS[o.id];
  if (!f || !Number.isFinite(Number(f.precio_inicial))) return "";
  const dif = porPersona(o) - Number(f.precio_inicial);
  if (Math.abs(dif) < 1) return "";
  const baja = dif < 0;
  return `<small class="delta ${baja ? "baja" : "sube"}" title="Desde que lo apuntaste">${
    baja ? "−" : "+"
  }${Math.abs(Math.round(dif))} €</small>`;
}

/* El aviso de arriba. Es lo que hace que "la web te avise": vive en las tres
   paginas, porque el barrido de precios ocurre en todas.

   Antes era una lista de renglones monoespaciados donde todo pesaba igual y el
   dato que importa —cuanto ha bajado— iba escondido al final de la frase. Ahora
   cada cambio es una ficha: el precio nuevo grande, el viejo tachado al lado, la
   diferencia en un sello de color y la curva de los ultimos dias detras. Se lee
   de un vistazo y desde lejos, que es justo para lo que sirve un aviso. */
function avisoFicha(f) {
  const { antes, ahora } = f.cambio;
  const baja = ahora < antes;
  const dif = Math.abs(ahora - antes);
  const pct = antes > 0 ? Math.round((dif / antes) * 100) : 0;
  const serie = Array.isArray(f.historia) ? f.historia : [];
  const minimo = serie.length ? Math.min(...serie.map((h) => Number(h.p))) : ahora;
  // "Lo mas barato que has visto" es la unica insignia que se gana sola: dice
  // que ahora mismo esta mejor que cualquier dia desde que lo guardaste.
  const record = baja && ahora <= minimo + 0.01 && serie.length > 2;
  const enlace = f.deep_link || f.airline_link || "";

  return `
    <article class="cambio ${baja ? "baja" : "sube"}">
      <header>
        <h4>${esc(f.destination_name || f.destination)}</h4>
        <p>${esc(f.origin || "MAD")}–${esc(f.destination)} · ${fmtDate(f.depart_date, true)}${
    f.return_date ? ` → ${fmtDate(f.return_date, true)}` : ""
  }${f.airline ? ` · ${esc(f.airline)}` : ""}</p>
      </header>

      <div class="cambio-precio">
        <s>${Math.round(antes)} €</s>
        <b>${Math.round(ahora)}<span>€</span></b>
        <em class="sello-dif">${baja ? "−" : "+"}${Math.round(dif)} €${
    pct ? ` · ${pct}%` : ""
  }</em>
        <span class="cambio-nota">por persona</span>
      </div>

      <div class="cambio-curva">${sparkline(serie, 132, 34)}</div>

      <footer>
        ${record ? '<span class="insignia">lo más barato que has visto</span>' : ""}
        ${
          enlace
            ? `<a class="btn ghost small" href="${escURL(enlace)}" target="_blank" rel="noopener">Ver vuelo</a>`
            : ""
        }
      </footer>
    </article>`;
}

function refrescarAvisoFavs() {
  const caja = document.getElementById("favAviso");
  if (!caja) return;
  const cambios = cambiosPendientes();
  if (!cambios.length) {
    caja.hidden = true;
    caja.innerHTML = "";
    return;
  }
  const bajan = cambios.filter((f) => f.cambio.ahora < f.cambio.antes);
  const suben = cambios.filter((f) => f.cambio.ahora > f.cambio.antes);
  const suma = (lista) =>
    Math.round(lista.reduce((t, f) => t + Math.abs(f.cambio.ahora - f.cambio.antes), 0));

  // El titular dice lo unico que se quiere saber antes de leer nada: cuanto
  // dinero se mueve y en que direccion. Manda lo que baja, que es lo que hace
  // que te levantes a mirar; lo que sube va detras y en pequeño.
  const cuantos = (n) => `${n} viaje${n > 1 ? "s" : ""} apuntado${n > 1 ? "s" : ""}`;
  const titulo = bajan.length ? `Baja ${suma(bajan)} €` : `Sube ${suma(suben)} €`;
  const detalle = bajan.length
    ? `en ${cuantos(bajan.length)}` +
      (suben.length ? ` · ${suben.length > 1 ? "otros" : "otro"} sube${
        suben.length > 1 ? "n" : ""
      } ${suma(suben)} €` : "")
    : `en ${cuantos(suben.length)}`;

  // La banda de arriba se reparte como se reparten los cambios: si todo baja es
  // verde entera, y si hay de todo se ve la proporcion sin contar nada.
  const proporcion = Math.round((bajan.length / cambios.length) * 100);
  caja.style.setProperty("--pbaja", `${proporcion}%`);

  caja.hidden = false;
  caja.innerHTML = `
    <div class="aviso-head">
      <span class="kicker">cambio de precio</span>
      <h3>${esc(titulo)}<small>${esc(detalle)}</small></h3>
      <button class="btn ghost small" id="favVisto">Enterado</button>
    </div>
    <div class="cambios">${bajan.concat(suben).map(avisoFicha).join("")}</div>
    <div class="aviso-pie">
      <a href="seguimientos.html#favoritos">Ver todo lo que sigo</a>
    </div>`;

  const boton = document.getElementById("favVisto");
  if (boton) {
    boton.addEventListener("click", () => {
      Object.values(FAVS).forEach((f) => {
        if (f.cambio) f.cambio.visto = true;
      });
      favGuardar(FAVS);
      refrescarAvisoFavs();
      pintarListaFavs();
    });
  }
}

/* --------------------------------------------------- la lista de favoritos
   Vive en "Lo que sigues", al lado de los seguimientos: un seguimiento es un
   encargo al cron ("avisame si Roma baja de 120"), un favorito es un vuelo
   concreto que ya has visto y quieres no perder de vista. */
function sparkline(historia, ancho = 108, alto = 30) {
  const puntos = (historia || []).filter((h) => Number.isFinite(Number(h.p)));
  if (puntos.length < 2) return "";
  const precios = puntos.map((h) => Number(h.p));
  const min = Math.min(...precios);
  const max = Math.max(...precios);
  const rango = max - min || 1;
  const paso = ancho / (puntos.length - 1);
  const y = (p) => alto - 3 - ((p - min) / rango) * (alto - 6);
  const d = precios.map((p, i) => `${i ? "L" : "M"}${(i * paso).toFixed(1)},${y(p).toFixed(1)}`).join(" ");
  const ultimo = precios[precios.length - 1];
  const baja = ultimo <= precios[0];
  return `<svg class="spark ${baja ? "baja" : "sube"}" viewBox="0 0 ${ancho} ${alto}"
      width="${ancho}" height="${alto}" role="img"
      aria-label="Evolución del precio: de ${Math.round(precios[0])} a ${Math.round(ultimo)} euros">
      <path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6"
            stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${(ancho).toFixed(1)}" cy="${y(ultimo).toFixed(1)}" r="2.4" fill="currentColor"/>
    </svg>`;
}

function favFila(f) {
  const inicial = Number(f.precio_inicial);
  const ahora = Number(f.precio_visto);
  const dif = Number.isFinite(inicial) && Number.isFinite(ahora) ? ahora - inicial : 0;
  const baja = dif < 0;
  const enlace = f.airline_link || f.deep_link;
  return `
    <div class="favrow${f.cambio && !f.cambio.visto ? " nuevo" : ""}">
      <span class="iata">${esc(f.destination)}</span>
      <span class="dest-cell">
        <span class="city">${esc(f.destination_name || f.destination)}</span>
        <span class="country">${esc(f.destination_country || "")}${
          f.airline ? ` · ${esc(f.airline)}` : ""
        }</span>
      </span>
      <span class="when"><b>${fmtDate(f.depart_date, true)}</b>${
        f.return_date ? ` → ${fmtDate(f.return_date, true)}` : ""
      }${f.nights ? `<small>${f.nights} noches</small>` : ""}</span>
      <span class="spark-cell">${sparkline(f.historia)}</span>
      <span class="leader" aria-hidden="true"></span>
      <span class="price">
        <span class="cifra">${Math.round(ahora)} €</span><small>por persona</small>
        ${
          Math.abs(dif) >= 1
            ? `<small class="delta ${baja ? "baja" : "sube"}">${baja ? "−" : "+"}${Math.abs(
                Math.round(dif)
              )} € desde ${Math.round(inicial)} €</small>`
            : `<small class="delta igual">sin cambios</small>`
        }
      </span>
      <span class="favacc">
        ${
          enlace
            ? `<a class="btn ghost small" href="${escURL(enlace)}" target="_blank" rel="noopener">Ver vuelo</a>`
            : ""
        }
        <button class="quitar" type="button" data-desfav="${esc(f.id)}"
          aria-label="Dejar de seguir ${esc(f.destination_name || f.destination)}">quitar</button>
      </span>
    </div>`;
}

function pintarListaFavs() {
  const caja = document.getElementById("favoritos");
  if (!caja) return;
  const lista = Object.values(FAVS).sort((a, b) => (b.desde || 0) - (a.desde || 0));
  if (!lista.length) {
    caja.innerHTML = `
      <h3 class="watch-head">en observación</h3>
      <p class="vacio">Todavía no has apuntado ningún viaje. Marca el cuadratín de cualquier
      entrada y aquí verás si sube o baja de precio cada vez que se actualicen los datos.</p>`;
    return;
  }
  caja.innerHTML =
    `<h3 class="watch-head">en observación · ${lista.length} viaje${
      lista.length > 1 ? "s" : ""
    } apuntado${lista.length > 1 ? "s" : ""}</h3>` + lista.map(favFila).join("");
  caja.querySelectorAll("[data-desfav]").forEach((b) =>
    b.addEventListener("click", () => {
      delete FAVS[b.dataset.desfav];
      favGuardar(FAVS);
      pintarListaFavs();
      pintarFavs();
      refrescarAvisoFavs();
    })
  );
}

/* Un favorito puede venir de una busqueda guardada o de un seguimiento, y esos
   ficheros solo se leen al desplegarlos. Sin esto, un favorito de una busqueda
   no se enteraria de que ha bajado hasta que abrieras esa busqueda a mano. */
async function refrescarFavsDeTodo() {
  if (!Object.keys(FAVS).length) return;
  const fuentes = [];

  fuentes.push(
    fetchJSON("data/offers.json")
      .then((d) => d.offers || [])
      .catch(() => [])
  );

  fuentes.push(
    fetchJSON("data/watch.json")
      .then((d) => (d.watches || []).flatMap((w) => conGrupo(w.last_offers || [], w.adults)))
      .catch(() => [])
  );

  fuentes.push(
    fetchJSON("data/searches/index.json")
      .then((d) =>
        Promise.all(
          // Las tuyas primero: si has guardado veinte, las doce que se miran
          // para refrescar precios mejor que sean de las que te importan.
          (d.searches || [])
            .filter(esMio)
            .slice(0, 12)
            .map((x) =>
              fetchJSON(`data/searches/${x.slug}.json`)
                .then((s) => conGrupo(s.offers || [], (s.request || {}).adults))
                .catch(() => [])
            )
        ).then((listas) => listas.flat())
      )
      .catch(() => [])
  );

  const listas = await Promise.all(fuentes);
  sincronizarFavs(listas.flat());
  pintarListaFavs();
  pintarFavs();
}



/* ------------------------------------------------------- histórico de precios
   `data/history.json` lleva meses acumulando el precio de cada ruta y la web
   no lo miraba: el "−51%" del sello sale del scoring, pero al abrir un vuelo no
   había forma de ver si eso es barato de verdad o es que la referencia estaba
   inflada. Aquí se dibuja la serie de esa ruta y se dice, sin adornos, dónde
   cae el precio de hoy dentro de lo que ha valido históricamente. */
let HISTORIA = null;

async function cargarHistoria() {
  if (HISTORIA) return HISTORIA;
  try {
    HISTORIA = await fetchJSON("data/history.json");
  } catch {
    HISTORIA = {};
  }
  return HISTORIA;
}

/* La serie se guarda separada por finde y no finde: un viernes por la tarde no
   compite contra un martes, y mezclarlos falsea las dos medias. */
function serieDe(o) {
  if (!HISTORIA) return [];
  const ruta = `${o.origin}-${o.destination}`;
  const propia = HISTORIA[ruta + (o.weekend ? "|finde" : "")] || [];
  return (propia.length >= 4 ? propia : HISTORIA[ruta] || propia) || [];
}

const percentil = (ordenados, q) =>
  ordenados[Math.min(ordenados.length - 1, Math.floor(ordenados.length * q))];

/* Un veredicto de una línea, que es lo que de verdad se quiere saber. */
function veredicto(precio, serie) {
  const precios = serie.map((e) => Number(e.p)).filter(Number.isFinite).sort((a, b) => a - b);
  if (precios.length < 5) return null;
  const barato = percentil(precios, 0.25);
  const caro = percentil(precios, 0.75);
  const minimo = precios[0];
  if (precio <= minimo * 1.02)
    return { clase: "chollo", texto: "es lo más barato que se ha visto en esta ruta" };
  if (precio <= barato)
    return { clase: "bien", texto: `barato: normalmente está entre ${Math.round(barato)} y ${Math.round(caro)} €` };
  if (precio >= caro)
    return { clase: "mal", texto: `caro para esta ruta: suele bajar de ${Math.round(barato)} €` };
  return { clase: "normal", texto: `precio normal (lo habitual: ${Math.round(barato)}–${Math.round(caro)} €)` };
}

function historiaHTML(o) {
  const serie = serieDe(o);
  if (serie.length < 5) return "";
  // La serie trae varias tarifas del mismo día (una por vuelo): se resume cada
  // día con la más barata, que es la que se podía comprar ese día.
  const porDia = new Map();
  serie.forEach((e) => {
    const p = Number(e.p);
    if (!Number.isFinite(p)) return;
    const previo = porDia.get(e.d);
    if (previo === undefined || p < previo) porDia.set(e.d, p);
  });
  const dias = [...porDia.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const v = veredicto(porPersona(o), serie);
  if (!dias.length && !v) return "";
  return `
    <div class="historia ${v ? v.clase : ""}">
      ${sparkline(dias.map(([d, p]) => ({ d, p })), 150, 34)}
      <div>
        <b>${Math.round(porPersona(o))} € por persona</b>
        ${v ? `<span>${esc(v.texto)}</span>` : `<span>${dias.length} días de histórico</span>`}
      </div>
    </div>`;
}

/* --------------------------------------------------------------- disparador
   Para lanzar un scraper hace falta que corra algo fuera del navegador. En vez
   de abrir una issue (que era un rodeo horrible), la web llama directamente a
   la API de GitHub con un token que se guarda SOLO en este navegador
   (localStorage) y no viaja a ningun sitio que no sea api.github.com.

   La llamada vive en auth.js porque el panel de administracion tambien la usa
   para dar de alta cuentas, y dos copias de esto acaban diciendo cosas
   distintas el dia que GitHub cambia un codigo de error. */
const dispatch = (evento, payload) => tfDispatch(evento, payload);

/* Lo que va en cada encargo para saber de quien es. Sin sesion va vacio: eso
   es un encargo compartido, como los de antes de que hubiera cuentas. */
const comoDueno = () => ({ owner: tfUid(), owner_name: tfNombre() });

/* Que ves de lo que hay guardado en el repo: lo tuyo y nada mas.
   Lo que no tiene dueño es de cuando la web era de una sola persona. Antes se
   enseñaba a todo el mundo "porque ya se hacia asi", y el resultado fue que la
   primera persona en entrar se encontro los seguimientos y las busquedas de
   otro. Ahora no sale para nadie: desde el panel se le pone dueño y vuelve,
   pero de quien sea. */
const esMio = (x) => !!x && !!x.owner && x.owner === tfUid();

/* Los tres motivos por los que un encargo no sale, y todos se arreglan igual:
   entrando con una cuenta que tenga acceso. */
const esFaltaDeAcceso = (r) =>
  r.reason === "sin-cuenta" || r.reason === "sin-token" || r.reason === "token-invalido";

/* Lo que se enseña cuando no hay nada que enseñar: o no has entrado, o has
   entrado y todavia no tienes nada tuyo. Sin esto la caja se queda en blanco y
   no se distingue "no tienes nada" de "esto esta roto". */
function avisoDeCuenta(que, vacio) {
  if (!tfUid()) {
    return `<p class="meta cuenta-nota">Entra con tu cuenta para ver tus ${que}.
      <button class="btn primary small" type="button" data-entrar>Entrar</button></p>`;
  }
  return `<p class="meta cuenta-nota">${vacio}</p>`;
}

/* Sin cuenta, los formularios que escriben en el repo se quedan a la vista pero
   apagados, con el motivo puesto. Es mas honesto que dejarlos vivos y fallar al
   darle al boton, y ademas se ve de un vistazo que la web tiene cuentas. */
function candarFormularios() {
  if (tfUid()) return;
  [
    ["#finderForm", "buscar"],
    ["#watchForm", "seguir un viaje"],
  ].forEach(([sel, que]) => {
    const form = document.querySelector(sel);
    if (!form) return;
    form.querySelectorAll("input, select, button, textarea").forEach((c) => (c.disabled = true));
    form.classList.add("candado");
    form.insertAdjacentHTML(
      "beforeend",
      `<p class="candado-nota">Para ${que} hace falta una cuenta.
        <button class="btn primary small" type="button" data-entrar>Entrar</button></p>`
    );
  });
  wireEntrar(document);
}

/* Un solo sitio donde enganchar el boton de entrar que sale en esos avisos. */
function wireEntrar(raiz = document) {
  raiz.querySelectorAll("[data-entrar]").forEach((b) =>
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      tfAbrirLogin();
    })
  );
}

/* Lo que se enseña cuando algo no se puede lanzar. Ya no se pide el token a
   nadie: lo pone el administrador una vez en el panel, cifrado, y cada cuenta lo
   abre con su contraseña al entrar. Aquí solo queda decir qué falta. */
function cajaAcceso(r) {
  const sinCuenta = r.reason === "sin-cuenta";
  return {
    html: `
      <div class="token-box">
        <strong>${sinCuenta ? "Hace falta una cuenta." : "Tu cuenta no puede lanzar esto."}</strong>
        ${
          sinCuenta
            ? `Los chollos del día los ve todo el mundo, pero buscar, seguir un viaje
               o pedir alojamiento se guarda a tu nombre. Entra y lo lanzamos.`
            : `No tiene acceso para escribir: pídele al administrador que te ponga
               una contraseña nueva desde el panel y vuelve a entrar.`
        }
        ${sinCuenta ? '<button class="btn primary small" data-entrar type="button">Entrar</button>' : ""}
      </div>`,
    wire: () => wireEntrar(document),
  };
}

/* ------------------------------------------------------------------ ofertas */

/* El esqueleto de carga se quita pase lo que pase: si se queda puesto porque
   los datos fallaron, la pagina se pasa la vida diciendo que esta trabajando. */
function dejarDeCargar(motivo = "") {
  const caja = $("#cargando");
  if (!caja) return;
  if (!motivo) {
    caja.remove();
    return;
  }
  caja.removeAttribute("aria-busy");
  caja.innerHTML = `<p class="vacio">${esc(motivo)}</p>`;
}

async function init() {
  let payload;
  try {
    payload = await fetchJSON("data/offers.json");
  } catch {
    if (existe("#stats")) $("#stats").innerHTML = statBlock("estado", "sin datos aún");
    dejarDeCargar(
      "No se han podido leer los precios. Puede ser tu conexión, o que el último " +
        "scan no llegara a publicar. Vuelve a cargar en un rato."
    );
    return;
  }
  dejarDeCargar();
  frescura(payload.generated_at);

  OFFERS = payload.offers || [];
  renderStats(payload);
  sincronizarFavs(OFFERS);

  if (payload.errors?.length) {
    const box = $("#errors");
    box.hidden = false;
    box.querySelector("ul").innerHTML = payload.errors.map((e) => `<li>${esc(e)}</li>`).join("");
  }
  if (!OFFERS.length || !existe("#offers")) return;

  const maxPrice = Math.max(60, ...OFFERS.map((o) => o.price));
  const priceInput = $("#price");
  priceInput.max = Math.ceil(maxPrice / 10) * 10;
  priceInput.value = priceInput.max;
  $("#priceOut").textContent = priceInput.value;
  pintarRegla(priceInput);

  // El continente no viene en la oferta: se cruza con el listado de aeropuertos.
  try {
    const aer = await fetchJSON("data/airports_world.json");
    aer.forEach((a) => (CONTINENTES[a.code] = a.cont));
    const presentes = [...new Set(OFFERS.map((o) => CONTINENTES[o.destination]).filter(Boolean))].sort();
    const hayLejos = OFFERS.some((o) => o.long_haul);
    $("#cont").insertAdjacentHTML(
      "beforeend",
      (hayLejos ? '<option value="__lejos__">Otros continentes</option>' : "") +
        presentes.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("")
    );
  } catch {
    $("#cont").parentElement.hidden = true;
  }

  $(".controls").hidden = false;
  ["#q", "#sort", "#price", "#unique", "#onlyWeekend", "#cont"].forEach((s) => $(s).addEventListener("input", render));

  // El scan diario guarda el precio de UNA persona (asi el historico es
  // comparable de un dia para otro). Este selector no vuelve a buscar: solo
  // multiplica lo que ya hay, y por eso las cifras salen con "≈" delante.
  const grupo = $("#grupo");
  if (grupo) {
    grupo.value = String(GRUPO);
    grupo.addEventListener("change", () => {
      GRUPO = Math.min(8, Math.max(1, Number(grupo.value) || 1));
      try {
        localStorage.setItem(GRUPO_KEY, String(GRUPO));
      } catch {
        /* navegacion privada */
      }
      render();
    });
  }
  render();

  const target = new URLSearchParams(location.search).get("offer");
  if (target) {
    ensureVisible(target);
    focusOffer(target);
  }
}

const statBlock = (label, value, hot = false) =>
  `<div><dt>${esc(label)}</dt><dd class="${hot ? "hot" : ""}">${esc(value)}</dd></div>`;

/* Cuanto hace que se actualizo: sin esto no sabes si miras datos de hoy o de
   hace tres dias, que en precios de vuelo es toda la diferencia. */
function frescura(iso) {
  const el = document.getElementById("frescura");
  if (!el) return;
  const d = parseISO(iso);
  if (!d) {
    el.textContent = "sin datos todavía";
    return;
  }
  const horas = Math.round((Date.now() - d.getTime()) / 3600000);
  const texto =
    horas < 1 ? "hace menos de una hora" : horas < 24 ? `hace ${horas} h` : `hace ${Math.round(horas / 24)} días`;
  el.textContent = `levantamiento: ${texto} · se revisa cada 12 h`;
  el.className = horas > 36 ? "viejo" : "";
}

function renderStats(payload) {
  if (!existe("#stats")) return;
  const best = OFFERS.reduce((a, o) => (o.discount_pct > (a?.discount_pct ?? -1) ? o : a), null);
  const findes = OFFERS.filter((o) => o.weekend).length;
  $("#stats").innerHTML =
    statBlock("ofertas vivas", OFFERS.length) +
    (best ? statBlock("mejor descuento", `−${Math.round(best.discount_pct)}%`, true) : "") +
    (best ? statBlock("desde", fmtEUR(Math.min(...OFFERS.map((o) => o.price)))) : "") +
    statBlock("escapadas de finde", findes) +
    statBlock("actualizado", fmtDate(payload.generated_at) || "hoy");
}

function currentList() {
  const q = $("#q").value.trim().toLowerCase();
  const max = Number($("#price").value);
  const sort = $("#sort").value;

  const soloFindes = $("#onlyWeekend").checked;
  const continente = $("#cont").value;
  // Europa y el largo radio no compiten en la misma lista: un vuelo a Bangkok
  // nunca puntuara como un finde a Bergamo, asi que van en secciones aparte.
  const lejos = $("#cont").value === "__lejos__";
  const list = OFFERS.filter(
    (o) =>
      o.price <= max &&
      (!soloFindes || o.weekend) &&
      (lejos ? o.long_haul : !continente || CONTINENTES[o.destination] === continente) &&
      (lejos || !o.long_haul) &&
      (!q ||
        `${o.destination_name} ${o.destination} ${o.destination_country}`.toLowerCase().includes(q))
  );

  const by = {
    score: (a, b) => b.score - a.score || a.price - b.price,
    price: (a, b) => a.price - b.price,
    date: (a, b) => a.depart_date.localeCompare(b.depart_date),
    hours: (a, b) => (a.price_per_hour || 99) - (b.price_per_hour || 99),
  }[sort];
  list.sort(by);

  // El barrido de findes devuelve la misma ciudad una vez por fin de semana:
  // por defecto se muestra solo la mejor de cada destino.
  if ($("#unique").checked) {
    const visto = new Set();
    return list.filter((o) => !visto.has(o.destination) && visto.add(o.destination));
  }
  return list;
}

function escalas(o) {
  if (o.hidden_city) return `te bajas en la escala (billete a ${esc(o.hidden_city_ticket_to)})`;
  return o.stops ? `${o.stops} escala${o.stops > 1 ? "s" : ""}` : "directo";
}

/* El aviso no es decorativo: sin equipaje facturado y sin vuelta, esto sale
   caro si te pilla por sorpresa. */
const AVISO_HIDDEN = `
  <div class="hidden-warn">
    <strong>Te bajas en la escala.</strong> El billete va más lejos y tú te quedas aquí.
    Es legal, pero: <b>solo ida</b> (la aerolínea cancela el resto del billete, así que
    no vale para ida y vuelta), <b>sin equipaje facturado</b> (la maleta sigue al destino
    final) y sin tarjeta de fidelización, que algunas compañías cierran cuentas.
  </div>`;

function leg(label, iso, sale, llega, highlight) {
  if (!iso) return "";
  // Google no publica el horario del vuelo de vuelta en su listado: mejor
  // decirlo que dejar un hueco que parece un fallo.
  const horario = sale
    ? `${esc(sale)}${llega ? ` → ${esc(llega)}` : ""}`
    : "<i>horario en el enlace</i>";
  return `<div><dt>${label}</dt><dd class="${highlight ? "weekend" : ""}">${fmtDate(iso, true)}
    ${horario ? `<span class="hhmm">${horario}</span>` : ""}</dd></div>`;
}

function altsHTML(o) {
  if (!(o.alternatives || []).length) return "";
  const links = o.alternatives
    .map((a) => {
      // La alternativa se busco para la misma gente que la ganadora, asi que
      // su precio se reparte igual y las dos cifras son comparables.
      const gente = Math.max(1, Number(a.adults) || pax(o));
      const uno = Number(a.price_per_person) || a.price / gente;
      const cifra = gente > 1 ? `${fmtEUR(a.price)} (${Math.round(uno)} €/p)` : fmtEUR(a.price);
      return `<a href="${escURL(a.deep_link)}" target="_blank" rel="noopener">${esc(
        a.airline
      )} ${cifra}${a.depart_time ? ` (sale ${esc(a.depart_time)})` : ""}</a>`;
    })
    .join(" · ");
  return `<div class="alts">también ${links}</div>`;
}

/* LA PLANCHA. El destino del dia no es una tarjeta: es la lamina de un atlas.
   Regla mayor arriba con su cuadratin rojo, el toponimo grande en serif ligero,
   la referencia de cuadricula y la cifra en rojo a la derecha, y debajo la
   tabla reglada con los tramos. Sin fondo, sin marco, sin talon, sin troquel:
   lo que la delimita es la regla, igual que en una plancha impresa. */
function heroTicket(o) {
  const sub = [o.destination_country, o.airline, escalas(o), o.weekend ? "escapada de finde" : ""]
    .filter(Boolean)
    .join(" · ");
  const extra = [o.hidden_city ? AVISO_HIDDEN : "", altsHTML(o)].filter(Boolean).join("");
  return `
    <article class="ticket" id="offer-${esc(o.id)}">
      <span class="regla" aria-hidden="true"></span>
      <div class="ticket-top">
        <span class="kicker-tag">hoja del día · ${o.return_date ? "ida y vuelta" : "solo ida"}</span>
        <span class="ticket-ref">
          <span class="codes">${esc(o.origin)} — ${esc(o.destination)}</span>
          ${favBtn(o)}
        </span>
      </div>
      <div class="ticket-cab">
        <h2 class="dest">${esc(o.destination_name || o.destination)}<small>${esc(sub)}</small></h2>
        <div class="ticket-precio">
          ${
            o.discount_pct >= 5
              ? `<span class="stamp">chollo<b>−${Math.round(o.discount_pct)}%</b></span>`
              : ""
          }
          ${precioHTML(o, { grande: true })}
          <span class="ticket-notas">
            ${o.baseline > o.price ? `<s class="was">${fmtEUR(o.baseline)}</s>` : ""}
            <span class="per-person">vuelo completo${o.return_date ? ", ida y vuelta" : ""}</span>
          </span>
        </div>
      </div>
      <dl class="legs">
        ${leg("Ida", o.depart_date, o.depart_time, o.arrive_time, o.weekend)}
        ${leg("Vuelta", o.return_date, o.return_time, o.return_arrive_time, o.weekend)}
        ${o.nights ? `<div><dt>Noches</dt><dd>${o.nights}</dd></div>` : ""}
        ${
          o.useful_hours
            ? `<div><dt>Viaje real</dt><dd class="useful">${Math.round(
                o.useful_hours
              )} h · ${o.price_per_hour} €/h</dd></div>`
            : ""
        }
      </dl>
      ${extra ? `<div class="hero-extra">${extra}</div>` : ""}
      <div class="actions">
        <button class="btn primary" data-stay="${esc(o.id)}">Buscar alojamiento</button>
        <a class="btn ghost" href="${escURL(o.deep_link)}" target="_blank" rel="noopener">Ver vuelo</a>
        ${
          o.airline_link
            ? `<a class="btn ghost" href="${escURL(o.airline_link)}" target="_blank" rel="noopener">
                 Reservar en ${esc(o.airline_link_label || o.airline)}</a>`
            : ""
        }
      </div>
    </article>`;
}

/* El resto, como el panel de salidas de un aeropuerto: una línea por vuelo. */
function boardRow(o, i) {
  // Si ida y vuelta caen en el mismo mes, el mes no se repite: "vie 13 nov → dom 15".
  const mismoMes = o.return_date && o.return_date.slice(0, 7) === o.depart_date.slice(0, 7);
  const vueltaTxt = o.return_date
    ? mismoMes
      ? `${DAYS[parseISO(o.return_date).getDay()]} ${parseISO(o.return_date).getDate()}`
      : fmtDate(o.return_date, true)
    : "";
  const hora = o.depart_time ? ` ${esc(o.depart_time)}` : "";
  const horaVuelta = o.return_time ? ` ${esc(o.return_time)}` : "";
  const vuelta = vueltaTxt
    ? ` → <b>${vueltaTxt}</b>${horaVuelta || " <i>(hora en el enlace)</i>"}`
    : "";
  return `
    <div class="brow" id="offer-${esc(o.id)}" data-open="${esc(o.id)}" role="button" tabindex="0"
         style="animation-delay:${Math.min(i, 14) * 35}ms">
      <span class="iata ${o.hidden_city ? "hidden" : ""}">${esc(o.destination)}</span>
      <span class="dest-cell">
        <span class="city">${esc(o.destination_name || o.destination)}</span>
        <span class="country">${esc(o.destination_country || "")}</span>
      </span>
      <span class="when ${o.weekend ? "weekend" : ""}"><b>${fmtDate(
        o.depart_date,
        true
      )}</b>${hora}${vuelta}${
        o.nights ? `<small>${o.nights} noches</small>` : ""
      }</span>
      <span class="airline">${esc(o.airline || o.provider)}<small>${escalas(o)}${
        o.useful_hours ? ` · ${Math.round(o.useful_hours)} h de viaje` : ""
      }${o.long_haul ? " · larga distancia" : ""}</small></span>
      <span class="leader" aria-hidden="true"></span>
      <span class="price">${precioCorto(o)}${
        o.discount_pct >= 5 ? `<small class="off">−${Math.round(o.discount_pct)}%</small>` : ""
      }${deltaHTML(o)}</span>
      ${favBtn(o)}
      <div class="brow-detail" hidden></div>
    </div>`;
}

/* Cualquier viaje se abre y enseña sus vuelos, no solo el destacado. */
function detalleHTML(o) {
  return `
    ${o.hidden_city ? AVISO_HIDDEN : ""}
    ${historiaHTML(o)}
    <dl class="legs">
      ${leg("Ida", o.depart_date, o.depart_time, o.arrive_time, o.weekend)}
      ${leg("Vuelta", o.return_date, o.return_time, o.return_arrive_time, o.weekend)}
      <div><dt>Vuelo</dt><dd>${escalas(o)}</dd></div>
      ${
        o.useful_hours
          ? `<div><dt>Viaje real</dt><dd class="useful">${Math.round(o.useful_hours)} h · ${
              o.price_per_hour
            } €/h</dd></div>`
          : ""
      }
    </dl>
    ${altsHTML(o)}
    <div class="actions">
      <a class="btn primary" href="${escURL(o.deep_link)}" target="_blank" rel="noopener">Ver vuelo</a>
      ${
        o.airline_link
          ? `<a class="btn ghost" href="${escURL(o.airline_link)}" target="_blank" rel="noopener">
               Reservar en ${esc(o.airline_link_label || o.airline)}</a>`
          : ""
      }
      <button class="btn ghost" data-stay="${esc(o.id)}">Buscar alojamiento</button>
      ${
        edreamsURL(o)
          ? `<a class="btn ghost" href="${escURL(edreamsURL(o))}" target="_blank" rel="noopener"
               title="Se abre con tu sesión: si tienes Prime, verás tu precio de socio"
               >Comparar en eDreams</a>`
          : ""
      }
    </div>`;
}

/* El detalle se pinta dos veces: una al abrirlo y otra cuando llega el
   historico de precios, asi que sus botones se cablean aparte. */
function wireDetalle(caja, o) {
  caja.querySelectorAll("[data-stay]").forEach((b) =>
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (!OFFERS.some((x) => x.id === o.id)) OFFERS.push(o);
      openStays(o.id);
    })
  );
}

function toggleRow(fila) {
  const caja = fila.querySelector(".brow-detail");
  if (!caja) return;
  if (!caja.hidden) {
    caja.hidden = true;
    fila.classList.remove("open");
    return;
  }
  const o = OFFERS.find((x) => x.id === fila.dataset.open) || SEARCH_OFFERS[fila.dataset.open];
  if (!o) return;
  caja.innerHTML = detalleHTML(o);
  caja.hidden = false;
  fila.classList.add("open");
  wireDetalle(caja, o);
  // history.json son 60 kB: se baja una sola vez, la primera fila que se abre
  // lo pide y el detalle se repinta solo cuando llega.
  if (!HISTORIA) {
    cargarHistoria().then(() => {
      if (caja.hidden) return;
      caja.innerHTML = detalleHTML(o);
      wireDetalle(caja, o);
    });
  }
}

function wireRows(raiz = document) {
  wireFavs(raiz);
  raiz.querySelectorAll(".brow[data-open]").forEach((fila) => {
    fila.addEventListener("click", (ev) => {
      if (ev.target.closest("a, button")) return; // los enlaces hacen lo suyo
      toggleRow(fila);
    });
    fila.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        toggleRow(fila);
      }
    });
  });
}

/* El tope es una regla graduada: lo recorrido va en rojo y lo que queda en
   linea fina. El navegador no lo hace solo, asi que la proporcion se calcula
   aqui y la pinta el CSS. */
function pintarRegla(input) {
  if (!input) return;
  const min = Number(input.min) || 0;
  const span = (Number(input.max) || 100) - min || 1;
  const pct = ((Number(input.value) - min) / span) * 100;
  input.style.setProperty("--pct", `${Math.max(0, Math.min(100, pct))}%`);
}

function render() {
  if (!existe("#offers")) return;
  $("#priceOut").textContent = $("#price").value;
  pintarRegla($("#price"));
  const list = currentList();

  $("#hero").innerHTML = list.length ? heroTicket(list[0]) : "";
  $("#hero").hidden = !list.length;
  $("#offers").innerHTML = list.slice(1).map(boardRow).join("");
  $("#boardHead").hidden = list.length < 2;
  $("#empty").hidden = list.length > 0;

  document.querySelectorAll(".hero [data-stay]").forEach((el) =>
    el.addEventListener("click", () => openStays(el.dataset.stay))
  );
  wireFavs($("#hero"));
  wireRows();
}

function focusOffer(id) {
  const el = document.getElementById(`offer-${id}`);
  if (!el) return;
  el.classList.add("target");
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  openStays(id);
}

/* El enlace del email apunta a una oferta concreta: si los filtros la dejarían
   fuera (por precio o por "una por destino"), se relajan para poder enseñarla. */
function ensureVisible(id) {
  if (document.getElementById(`offer-${id}`)) return;
  const o = OFFERS.find((x) => x.id === id);
  if (!o) return;
  if (o.price > Number($("#price").value)) $("#price").value = $("#price").max;
  $("#unique").checked = false;
  $("#q").value = "";
  render();
}

/* ------------------------------------------------------------- alojamiento */
let pollTimer = null;

/* Un solo camino de cierre: se llame desde el boton, desde el velo o desde
   Escape, todo pasa por `tfCerrarDialogo`, que es quien apaga la trampa de
   foco y devuelve el foco a quien abrio. Lo de esconder la hoja va en
   `alCerrar`, que es lo unico propio de este dialogo. */
function abrirPanel() {
  $("#panel").hidden = false;
  $("#backdrop").hidden = false;
  tfAbrirDialogo($("#panel"), {
    etiqueta: "Alojamiento",
    foco: () => $("#panelClose"),
    alCerrar: () => {
      clearInterval(pollTimer);
      $("#panel").hidden = true;
      $("#backdrop").hidden = true;
    },
  });
}
function closePanel() {
  tfCerrarDialogo($("#panel"));
}
on("#panelClose", "click", closePanel);
on("#backdrop", "click", closePanel);

function issueURL(o, adultos) {
  const body = [
    "Busqueda de alojamiento lanzada desde la web. No edites el bloque de abajo.",
    "",
    "```yaml",
    `offer_id: ${o.id}`,
    `city: ${o.destination_name || o.destination}`,
    `iata: ${o.destination}`,
    `country: ${o.destination_country || ""}`,
    `checkin: ${o.depart_date}`,
    `checkout: ${o.return_date || ""}`,
    `adults: ${adultos}`,
    "```",
  ].join("\n");
  return (
    `https://github.com/${REPO}/issues/new` +
    `?title=${encodeURIComponent(`[stay] ${o.id}`)}` +
    `&labels=stay-request&body=${encodeURIComponent(body)}`
  );
}

async function openStays(id) {
  const offer = OFFERS.find((o) => o.id === id) || SEARCH_OFFERS[id];
  if (!offer) return;

  abrirPanel();
  $("#panelTitle").textContent = offer.destination_name || offer.destination;
  $("#panelDates").textContent =
    `${fmtDate(offer.depart_date, true)}${offer.return_date ? ` → ${fmtDate(offer.return_date, true)}` : ""}` +
    `${offer.nights ? ` · ${offer.nights} noches` : ""}`;
  $("#panelBody").innerHTML = '<p class="status">Comprobando si ya hay resultados…</p>';

  let datos = null;
  try {
    datos = await fetchJSON(`data/stays/${id}.json`);
  } catch {
    askForSearch(offer); // todavia no se ha buscado para estas fechas
    return;
  }
  pintarStays(datos, offer);
}

/* Pintar y fallar al pintar son cosas distintas: si el fichero esta y el
   render peta, hay que decirlo, no ofrecer otra busqueda como si no hubiera
   nada. Ese enredo es lo que hacia que "Buscar alojamiento" no diera nunca
   resultados aunque el scraper hubiera funcionado. */
function pintarStays(datos, offer) {
  try {
    renderStays(datos);
  } catch (err) {
    if (typeof tfApuntar === "function") {
      tfApuntar("stays", "no se pudo pintar el alojamiento", (err && err.stack) || String(err));
    }
    const n = (datos && datos.stays ? datos.stays.length : 0);
    $("#panelBody").innerHTML = `
      <div class="status wait">
        <p>Hay ${n} alojamiento${n === 1 ? "" : "s"} guardados para estas fechas, pero algo
        ha fallado al mostrarlos.</p>
        <a class="btn ghost small" href="data/stays/${esc(offer ? offer.id : "")}.json"
           target="_blank" rel="noopener">Ver los datos en crudo</a>
      </div>`;
  }
}

function askForSearch(offer, aviso = "") {
  $("#panelBody").innerHTML = `
    <div class="status wait">
      ${
        aviso ||
        `<p>Todavía no hemos buscado cama para estas fechas. Se lanza un scraper
         (Airbnb, hoteles y comparadores) para <strong>estas fechas exactas</strong>;
         tarda 2–3 minutos y esta página se actualiza sola.</p>`
      }
      <label class="party">
        <span>¿Cuántos viajáis?</span>
        <input type="number" id="party" min="1" max="8" value="${Math.min(
          8,
          Math.max(1, pax(offer) > 1 ? pax(offer) : GRUPO)
        )}" inputmode="numeric">
      </label>
      <button class="btn primary" id="launch">Buscar alojamiento</button>
    </div>`;

  $("#launch").addEventListener("click", async () => {
    // El precio del alojamiento depende de cuántos vais, así que el número
    // viaja en la petición: buscar para 2 y reservar para 4 no vale de nada.
    const adultos = Math.min(8, Math.max(1, Number($("#party").value) || 2));
    const r = await dispatch("stay", {
      offer_id: offer.id,
      city: offer.destination_name || offer.destination,
      country: offer.destination_country || "",
      iata: offer.destination,
      checkin: offer.depart_date,
      checkout: offer.return_date || "",
      adults: String(adultos),
    });
    if (r.ok) {
      startPolling(offer.id);
      return;
    }
    if (esFaltaDeAcceso(r)) {
      const caja = cajaAcceso(r);
      $("#panelBody").insertAdjacentHTML("beforeend", caja.html);
      caja.wire();
      return;
    }
    // Se muestra el motivo y se deja la issue como ultimo recurso.
    $("#panelBody").insertAdjacentHTML(
      "beforeend",
      `<div class="status wait"><p>No se pudo lanzar: ${esc(r.reason)}</p>
       <a class="btn ghost small" href="${issueURL(offer, adultos)}" target="_blank"
          rel="noopener">Lanzarlo por issue</a></div>`
    );
  });
}

function startPolling(id) {
  clearInterval(pollTimer);
  const started = Date.now();
  $("#panelBody").innerHTML =
    '<div class="status wait"><span class="spin"></span>Buscando… puedes cerrar esta ventana y volver luego.</div>';
  pollTimer = setInterval(async () => {
    if (Date.now() - started > POLL_MAX_MS) {
      clearInterval(pollTimer);
      $("#panelBody").innerHTML =
        '<div class="status wait">Está tardando más de lo normal. Revisa la issue en GitHub.</div>';
      return;
    }
    let data = null;
    try {
      data = await fetchJSON(`data/stays/${id}.json`);
    } catch {
      return; // todavia no esta publicado: se reintenta en la siguiente vuelta
    }
    clearInterval(pollTimer);
    pintarStays(data, OFFERS.find((o) => o.id === id) || SEARCH_OFFERS[id]);
  }, POLL_EVERY_MS);
}

function stayRow(s) {
  const meta = [s.provider, s.rating ? `valoración ${s.rating}` : "", s.note]
    .filter(Boolean)
    .join(" · ");
  const precio = s.price_total
    ? `<div class="amount-s">${fmtEUR(s.price_total)}<small>${
        s.price_per_night ? `${fmtEUR(s.price_per_night)} la noche` : ""
      }</small></div>`
    : `<div class="amount-s link-tag">abrir</div>`;
  return `
    <a class="stay" href="${escURL(s.url)}" target="_blank" rel="noopener">
      ${(() => {
        // Una imagen con un esquema raro no se pinta: `src="#"` haria que el
        // navegador se pidiera la propia pagina como si fuera un JPEG.
        const img = escURL(s.image);
        return img && img !== "#" ? `<img src="${img}" alt="" loading="lazy">` : "";
      })()}
      <div>
        <div class="name">${esc(s.name)}</div>
        <div class="meta">${esc(meta)}</div>
      </div>
      ${precio}
    </a>`;
}

function desde(iso) {
  const dias = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
  if (!Number.isFinite(dias)) return "";
  return dias <= 0 ? "hoy" : dias === 1 ? "ayer" : `hace ${dias} días`;
}

/* El numero que nadie te da: lo que sale la escapada entera, por cabeza.
   Lo calcula scan-stays (vuelos x personas + una cama para todos) y viaja en
   `summary`. Esta funcion se llamaba desde renderStays y no existia, asi que
   en cuanto llegaban resultados de alojamiento el panel reventaba entero con
   "tripTotal is not defined" y no se veia ni un hotel. */
function tripTotal(resumen) {
  if (!resumen || !resumen.total) return "";
  const filas = [
    resumen.flights ? `vuelos ${fmtEUR(resumen.flights)}` : "",
    resumen.stay ? `alojamiento ${fmtEUR(resumen.stay)}` : "",
  ].filter(Boolean);
  return `
    <div class="total">
      <p class="total-head">El viaje completo${
        resumen.party ? ` para ${resumen.party} persona${resumen.party > 1 ? "s" : ""}` : ""
      }</p>
      <p class="total-figure">${fmtEUR(resumen.per_person)}<span>por persona</span></p>
      <p class="total-break">${fmtEUR(resumen.total)} en total${
        filas.length ? ` · ${filas.join(" + ")}` : ""
      }${
        resumen.per_person_night ? ` · ${fmtEUR(resumen.per_person_night)} por persona y noche` : ""
      }${
        resumen.cost_per_useful_hour
          ? ` · ${fmtEUR(resumen.cost_per_useful_hour)} por hora útil en destino`
          : ""
      }</p>
    </div>`;
}

function renderStays(data) {
  const stays = data.stays || [];
  const priced = stays.filter((s) => s.price_total);
  const links = stays.filter((s) => !s.price_total);
  const offer =
    OFFERS.find((o) => o.id === data.offer_id) ||
    SEARCH_OFFERS[data.offer_id] ||
    (data.offer && data.offer.id ? data.offer : null);

  $("#panelBody").innerHTML = `
    ${tripTotal(data.summary)}
    <div class="rescan">
      <span>${priced.length} alojamientos · buscado ${esc(desde(data.generated_at))}${
        data.summary?.party ? ` para ${data.summary.party}` : ""
      }</span>
      <button class="btn ghost small" id="rescan">Volver a buscar</button>
    </div>
    ${priced.map(stayRow).join("")}
    ${links.length ? "<h3>Seguir buscando</h3>" : ""}
    ${links.map(stayRow).join("")}`;

  // Los resultados se quedan guardados hasta que pasa la fecha del viaje;
  // este boton es la unica forma de forzar un scrapeo nuevo.
  if (offer) {
    $("#rescan").addEventListener("click", () =>
      askForSearch(
        offer,
        `<p>Se volverá a buscar y los resultados actuales se reemplazarán.</p>`
      )
    );
  }
}

/* --------------------------------------------------- buscador personalizado */
/* La busqueda ya no pasa por una issue: la web manda un `repository_dispatch`
   directo desde el navegador con el token de la cuenta. El camino por issue
   existio cuando no habia cuentas —abrir una issue era el unico disparador
   gratuito y autenticado que tenia una web estatica—, pero hoy solo servia
   para abrir una issue que nadie lee y que ademas dispara el workflow por
   partida doble (`opened` y `labeled`). Sin cuenta no se busca, y eso ya lo
   dice `candarFormularios` con el motivo puesto.

   El de alojamiento (`issueURL`) SI se queda: ahi es el ultimo recurso que se
   ofrece cuando el dispatch falla con el panel ya abierto.

/* ------------------------------------------------- no repetir lo ya buscado

   La web es estatica: para buscar hay que levantar un workflow, y un barrido
   "donde sea" tarda del orden de ocho minutos. Lo mas barato que se puede
   hacer es no lanzarlo cuando la respuesta ya esta publicada.

   La identidad de una busqueda es su etiqueta: se construye con los mismos
   campos que rellena el usuario (destino, cuando, tope y cuanta gente), asi
   que dos busquedas iguales dan la misma. Es lo que ya usaba `loadSearches`
   para saber que una pendiente habia llegado. */
async function busquedaYaHecha(label) {
  let indice;
  try {
    indice = await fetchJSON("data/searches/index.json");
  } catch {
    return null; // sin indice no se puede saber: que la lance
  }
  return (indice.searches || []).filter(esMio).find((s) => s.label === label) || null;
}

function yaHechaHTML(s) {
  return `
    <div class="saved ya-hecha" data-slug="${esc(s.slug)}">
      <b>${esc(s.label)}</b>
      <span class="meta">ya buscado ${esc(desde(s.generated_at))} · ${s.count} viaje${
        s.count === 1 ? "" : "s"
      }${s.best_price ? ` · desde ${fmtEUR(s.best_price)}` : ""}</span>
      <button class="btn ghost small" type="button" data-repetir
        title="Los precios cambian: esto vuelve a barrer y tarda unos minutos">Buscar otra vez</button>
    </div>`;
}

function wireRepetir() {
  document.querySelectorAll("[data-repetir]").forEach((b) =>
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      b.disabled = true;
      // El mismo submit, pero saltandose la comprobacion de arriba.
      const falso = new Event("submit", { cancelable: true });
      falso.__repetir = true;
      $("#finderForm").dispatchEvent(falso);
    })
  );
}

/* El formulario cambia segun lo que el usuario tenga decidido y lo que no:
   sitio concreto o donde sea, fechas exactas, un finde cualquiera o da igual. */
const HINTS = {
  "any|weekend": "Un fin de semana donde sea: se recorren todos los findes del horizonte.",
  "any|exact": "Ese fin de semana concreto, a cualquier destino que haya.",
  "any|anytime": "Cualquier destino y cualquier fecha: lo más barato del horizonte.",
  "one|weekend": "Ese destino, el finde que salga más barato de aquí a los meses que pongas.",
  "one|exact": "Ese destino en esas fechas exactas.",
  "one|anytime": "Ese destino, cualquier día de la semana.",
};

function syncFinder() {
  if (!existe("#finderForm")) return;
  const donde = $("#fWhere").value;
  const cuando = $("#fWhen").value;
  // Ida y vuelta comparten ya un solo control, asi que #returnWrap no existe.
  $("#destWrap").hidden = donde !== "one";
  $("#departWrap").hidden = cuando !== "exact";
  $("#nightsWrap").hidden = cuando === "exact";
  $("#monthsWrap").hidden = cuando === "exact";
  $("#finderHint").textContent = HINTS[`${donde}|${cuando}`] || "";
  // El calendario solo pinta cuando has dicho "fechas exactas". Esto vivia mas
  // abajo, reasignando `syncFinder` por encima de si misma: el efecto era que
  // el original quedaba enganchado dos veces al `change` y corria dos veces por
  // cada cambio. Aqui dentro se hace una sola vez y se lee de corrido.
  if (existe("#cal") && cuando !== "exact") $("#cal").hidden = true;
}
["#fWhere", "#fWhen"].forEach((s) => on(s, "change", syncFinder));
if (existe("#finderForm")) syncFinder();

on("#finderForm", "submit", async (e) => {
  e.preventDefault();
  const donde = $("#fWhere").value;
  const cuando = $("#fWhen").value;
  const dest = donde === "one" ? $("#fDest").value.trim() : "";
  if (donde === "one" && !dest) {
    $("#fDest").focus();
    return;
  }
  if (cuando === "exact" && !$("#fDepart").value) {
    $("#fDepart").focus();
    return;
  }

  const personas = Number($("#fAdults").value) || 1;
  const cuandoTxt =
    cuando === "exact"
      ? `${fmtDate($("#fDepart").value)}${
          $("#fReturn").value ? ` → ${fmtDate($("#fReturn").value)}` : ""
        }`
      : cuando === "weekend"
      ? `findes · ${$("#fMonths").value || 12} meses`
      : `${$("#fMonths").value || 12} meses`;

  const payload = {
    dest,
    label: [
      dest || "Donde sea",
      cuandoTxt,
      `hasta ${$("#fMax").value} €`,
      personas > 1 ? `${personas} pers.` : "1 pers.",
    ].join(" · "),
    owner: tfUid(),
    max_price: $("#fMax").value,
    nights: $("#fNights").value.trim() || "2-3",
    months: $("#fMonths").value || "12",
    adults: $("#fAdults").value || "2",
    weekend: cuando === "weekend" ? "si" : "no",
    depart: cuando === "exact" ? $("#fDepart").value : "",
    return_date: cuando === "exact" ? $("#fReturn").value : "",
  };

  const aviso = (html) => ($("#searches").innerHTML = html + $("#searches").innerHTML);

  // Antes de levantar nada: si esta misma busqueda ya esta hecha, no hay que
  // volver a lanzarla. Un barrido "donde sea" son ~8 minutos de scraping y una
  // pasada entera por 105 destinos; repetirla porque si es tirar el rato de
  // otro. Se ofrece la que hay y se deja repetir a mano, porque los precios de
  // hace dias ya no son los de hoy: la decision es del que busca, no nuestra.
  if (!e.__repetir) {
    const hecha = await busquedaYaHecha(payload.label);
    if (hecha) {
      $("#searches").innerHTML = yaHechaHTML(hecha) + $("#searches").innerHTML;
      wireRepetir();
      return;
    }
  }

  const r = await dispatch("search", payload);
  if (r.ok) {
    anadirPendiente(payload.label);
    loadSearches();
    return;
  }
  if (esFaltaDeAcceso(r)) {
    const caja = cajaAcceso(r);
    $("#searches").innerHTML = caja.html + $("#searches").innerHTML;
    caja.wire();
    return;
  }
  aviso(`<div class="saved"><span class="meta">No se pudo lanzar: ${esc(r.reason)}</span></div>`);
});

/* Cuanto se espera a que el workflow termine y publique su fichero.
   Antes se daba por perdido a los 6-7 minutos, que valia cuando una busqueda
   preguntaba a Ryanair y poco mas. Ahora se barren ~105 destinos con una
   consulta a Google cada uno, asi que una busqueda "donde sea" tarda del orden
   de 8 minutos y se rendia justo antes de que llegara el resultado. */
function esperarCambios() {
  if (window.__esperando) return;
  let vueltas = 0;
  window.__esperando = setInterval(async () => {
    vueltas += 1;
    const quedan =
      pendientes().length || JSON.parse(localStorage.getItem(BORRANDO_KEY) || "[]").length;
    if (!quedan || vueltas > MAX_VUELTAS) {
      clearInterval(window.__esperando);
      window.__esperando = null;
      if (!quedan) return;
    }
    // Las dos, pase lo que pase con la otra: cada una se protege sola, pero si
    // una tirara la callback la siguiente no llegaria a correr nunca.
    await Promise.allSettled([loadSearches(), cargarWatches()]);
  }, POLL_EVERY_MS);
}

/* ------------------------------------------------------- borrar de una tacada

   Cada borrado era su propio `repository_dispatch`, y cada dispatch un
   workflow entero: checkout, Python, dependencias y un push, para quitar UN
   fichero. Quitando cinco busquedas seguidas salian cinco runs peleandose por
   el mismo commit —de ahi los reintentos con rebase del workflow— y cinco
   despliegues de los que GitHub cancelaba cuatro.

   Ahora los clics se juntan durante un momento y sale UNA sola llamada con la
   lista entera. El workflow los aplica en un bucle dentro de su reintento, asi
   que el commit tambien es uno. */
const BORRADO_ESPERA_MS = 900;
let borradoPendiente = [];
let borradoTimer = null;

function encolarBorrado(slug, boton) {
  if (!borradoPendiente.includes(slug)) borradoPendiente.push(slug);
  clearTimeout(borradoTimer);
  borradoTimer = setTimeout(() => enviarBorrados(boton), BORRADO_ESPERA_MS);
}

async function enviarBorrados(boton) {
  const ids = borradoPendiente;
  borradoPendiente = [];
  if (!ids.length) return;

  const r = await dispatch("delete_search", {
    // `id` se manda igual para no romper nada que solo mire ese campo.
    id: ids[0],
    ids,
    ...comoDueno(),
  });
  if (r.ok) {
    const cola = JSON.parse(localStorage.getItem(BORRANDO_KEY) || "[]");
    localStorage.setItem(BORRANDO_KEY, JSON.stringify(cola.concat(ids)));
    loadSearches();
    return;
  }
  // Si falla, vuelven a estar borrables: nada se ha ido.
  if (boton) boton.disabled = false;
  document.querySelectorAll("[data-borrar]").forEach((b) => {
    if (ids.includes(b.dataset.borrar)) b.disabled = false;
  });
  alert("No se pudo borrar: " + r.reason);
}

async function loadSearches() {
  // Esta caja solo existe en buscar.html, pero app.js es el mismo en las cuatro
  // paginas. Sin esta linea, en el indice y en seguimientos petaba con
  // "Cannot set properties of null" y, lo importante, se llevaba por delante el
  // resto: en seguimientos.html el refresco automatico hace
  // `await loadSearches(); await cargarWatches();`, asi que al reventar la
  // primera la segunda no llegaba a correr y lo que sigues no se actualizaba.
  if (!$("#searches")) return;
  let indice;
  try {
    indice = await fetchJSON("data/searches/index.json");
  } catch {
    return;
  }
  const guardadas = (indice.searches || []).filter(esMio);

  // Lo que ya esta en el indice deja de estar pendiente.
  const etiquetas = new Set(guardadas.map((s) => s.label));
  let pend = pendientes().filter((p) => !etiquetas.has(p.label));
  guardarPendientes(pend);
  const ahora = Date.now();
  const cabecera = pend
    .map((p) => pendienteHTML(p, ahora - p.desde > MAX_ESPERA_MS))
    .join("");

  if (!guardadas.length && !cabecera) {
    $("#searches").innerHTML = avisoDeCuenta(
      "búsquedas guardadas",
      "Aún no has guardado ninguna búsqueda. Rellena el formulario de arriba y en unos minutos aparece aquí."
    );
    wireEntrar($("#searches"));
    return;
  }

  $("#searches").innerHTML = cabecera + guardadas
    .map(
      (s) => `
      <div class="saved" data-slug="${esc(s.slug)}">
        <b>${esc(s.label)}</b>
        <span class="meta">${s.count} viajes · buscado ${esc(desde(s.generated_at))}</span>
        ${s.best_price ? `<span class="best">desde ${fmtEUR(s.best_price)}</span>` : ""}
        <button class="quitar" type="button" data-borrar="${esc(s.slug)}"
          aria-label="Quitar esta búsqueda">quitar</button>
        <div class="saved-rows" hidden></div>
      </div>`
    )
    .join("");

  // Lo que se ha mandado borrar sigue marcado hasta que desaparece de verdad.
  const borrando = JSON.parse(localStorage.getItem(BORRANDO_KEY) || "[]");
  borrando.forEach((slug) => {
    const fila = $("#searches").querySelector(`[data-slug="${slug}"]`);
    if (fila) {
      fila.style.opacity = 0.45;
      const m = fila.querySelector(".meta");
      if (m) m.innerHTML = '<span class="spin"></span>borrando…';
    }
  });
  const vivas = new Set(guardadas.map((s) => s.slug));
  const siguen = borrando.filter((s) => vivas.has(s));
  localStorage.setItem(BORRANDO_KEY, JSON.stringify(siguen));
  if (siguen.length) esperarCambios();

  $("#searches")
    .querySelectorAll("[data-olvidar]")
    .forEach((b) =>
      b.addEventListener("click", () => {
        guardarPendientes(pendientes().filter((p) => p.label !== b.dataset.olvidar));
        loadSearches();
      })
    );

  if (pend.length) esperarCambios();

  document.querySelectorAll("[data-borrar]").forEach((b) =>
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      b.disabled = true;
      encolarBorrado(b.dataset.borrar, b);
    })
  );

  wireEntrar($("#searches"));

  document.querySelectorAll(".saved[data-slug]").forEach((el) =>
    el.addEventListener("click", (ev) => {
      // Sin esto, abrir un viaje de dentro cerraba la busqueda que lo contiene.
      if (ev.target.closest(".saved-rows") || ev.target.closest("[data-borrar]")) return;
      toggleSearch(el);
    })
  );

  const pedida = new URLSearchParams(location.search).get("search");
  if (pedida) {
    const el = document.querySelector(`.saved[data-slug="${pedida}"]`);
    if (el) {
      toggleSearch(el);
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }
}

async function toggleSearch(el) {
  const caja = el.querySelector(".saved-rows");
  if (!caja.hidden) {
    caja.hidden = true;
    return;
  }
  caja.hidden = false;
  if (caja.dataset.cargado) return;
  caja.innerHTML = '<p class="meta">Cargando…</p>';
  try {
    const data = await fetchJSON(`data/searches/${el.dataset.slug}.json`);
    const ofertas = conGrupo(data.offers || [], (data.request || {}).adults);
    ofertas.forEach((o) => (SEARCH_OFFERS[o.id] = o));
    sincronizarFavs(ofertas);
    caja.innerHTML = ofertas.length
      ? ofertas.map((o, i) => boardRow(o, i)).join("")
      : '<p class="meta">Nada dentro de ese presupuesto. Sube el tope o amplía los meses.</p>';
    caja.dataset.cargado = "1";
    wireRows(caja);
  } catch {
    caja.innerHTML = '<p class="meta">No se pudo cargar.</p>';
  }
}

init();
loadSearches();
cargarWatches();
candarFormularios();
pintarListaFavs();
refrescarAvisoFavs();
// Un favorito puede venir de una búsqueda que no está abierta: se repasan
// todas las fuentes al cargar, que es lo que permite avisar sin abrir nada.
refrescarFavsDeTodo();

/* --------------------------------------------------- selector de destino
   El mapa de puntos quedaba precioso y era inutil: sin costas ni fronteras no
   se sabe que es cada punto. Para ELEGIR funciona mejor una lista que se
   busca escribiendo, agrupada por pais y con el pais entero seleccionable. */
let DESTINOS = null;

/* Las busquedas lanzadas se guardan en el navegador hasta que aparecen en el
   indice. Antes el "buscando..." lo borraba el siguiente refresco de la lista
   y parecia que la busqueda se hubiera esfumado. */
const PEND_KEY = tfClave("tf_pendientes");
const MAX_ESPERA_MS = 18 * 60 * 1000;  // cuando una busqueda pendiente se marca como colgada

const pendientes = () => {
  try {
    return JSON.parse(localStorage.getItem(PEND_KEY) || "[]");
  } catch {
    return [];
  }
};
const guardarPendientes = (lista) => localStorage.setItem(PEND_KEY, JSON.stringify(lista));

function anadirPendiente(label) {
  const lista = pendientes().filter((p) => p.label !== label);
  lista.unshift({ label, desde: Date.now() });
  guardarPendientes(lista);
}

function pendienteHTML(p, caducada) {
  return caducada
    ? `<div class="saved"><b>${esc(p.label)}</b>
         <span class="meta">no llegó a terminar · vuelve a lanzarla</span>
         <button class="quitar" type="button" data-olvidar="${esc(p.label)}"
           aria-label="Olvidar esta búsqueda">olvidar</button></div>`
    : `<div class="saved"><b>${esc(p.label)}</b>
         <span class="meta"><span class="spin"></span>buscando… tarda 2–3 min</span></div>`;
}

async function cargarDestinos() {
  if (DESTINOS) return DESTINOS;
  let lista = [];
  try {
    lista = await fetchJSON("data/airports_world.json");
  } catch {
    return (DESTINOS = []);
  }
  const porPais = {};
  lista.forEach((a) => {
    (porPais[a.pais || "Otros"] ||= []).push({ code: a.code, ciudad: a.ciudad });
  });
  DESTINOS = Object.entries(porPais)
    .map(([pais, aeropuertos]) => ({
      pais,
      aeropuertos: aeropuertos.sort((x, y) => x.ciudad.localeCompare(y.ciudad)),
    }))
    .sort((a, b) => a.pais.localeCompare(b.pais));
  return DESTINOS;
}

function pintarDestinos(filtro = "") {
  const q = filtro.trim().toLowerCase();
  const html = (DESTINOS || [])
    .map((p) => {
      const coincidePais = p.pais.toLowerCase().includes(q);
      const aeropuertos = coincidePais
        ? p.aeropuertos
        : p.aeropuertos.filter(
            (a) => a.ciudad.toLowerCase().includes(q) || a.code.toLowerCase() === q
          );
      if (!aeropuertos.length) return "";
      return `
        <div class="pais">
          <button type="button" class="pais-todo" data-valor="${esc(p.pais)}">
            <span>${esc(p.pais)}</span>
            <em>todo el país · ${p.aeropuertos.length} aeropuertos</em>
          </button>
          <div class="ciudades">
            ${aeropuertos
              .map(
                (a) =>
                  `<button type="button" class="ciudad" data-valor="${esc(a.ciudad)}">
                     ${esc(a.ciudad)} <i>${esc(a.code)}</i></button>`
              )
              .join("")}
          </div>
        </div>`;
    })
    .join("");
  $("#destList").innerHTML = html || '<p class="meta">Nada con ese nombre.</p>';
  $("#destList")
    .querySelectorAll("[data-valor]")
    .forEach((b) => b.addEventListener("click", () => elegirDestino(b.dataset.valor)));
}

function elegirDestino(valor) {
  if (destinoPara === "wDest") {
    $("#wDest").value = valor;
    $("#wDestBtn").textContent = valor;
  } else {
    $("#fDest").value = valor;
    $("#destBtn").textContent = valor;
  }
  cerrarDestinos();
}

function abrirDestinos() {
  $("#destModal").hidden = false;
  tfAbrirDialogo($("#destModal"), {
    foco: () => $("#destSearch"),
    alCerrar: () => ($("#destModal").hidden = true),
  });
  cargarDestinos().then(() => pintarDestinos($("#destSearch").value));
}

function cerrarDestinos() {
  tfCerrarDialogo($("#destModal"));
}

on("#destBtn", "click", () => {
  destinoPara = "fDest";
  abrirDestinos();
});
on("#destClose", "click", cerrarDestinos);
on("#destModal", "click", (e) => {
  if (e.target.id === "destModal") cerrarDestinos();
});
on("#destSearch", "input", (e) => pintarDestinos(e.target.value));

/* ------------------------------------------------------------ seguimientos
   Cosa aparte de la busqueda: no contesta ahora, se queda apuntado y lo revisa
   el cron cada dia. Avisa si entra en el tope o si baja de su propio minimo. */
let destinoPara = "fDest"; // que campo rellena el selector de destinos

on("#wDestBtn", "click", () => {
  destinoPara = "wDest";
  abrirDestinos();
});

const HINTS_W = {
  "any|weekend": "Cualquier destino, cualquier finde: avisa cuando algo baje del tope.",
  "any|exact": "Cualquier destino, para esas fechas exactas.",
  "any|anytime": "Cualquier destino y cualquier fecha del horizonte.",
  "one|weekend": "Ese destino, el finde que sea.",
  "one|exact": "Ese destino, para esas fechas exactas.",
  "one|anytime": "Ese destino, cualquier día.",
};

function syncWatch() {
  if (!existe("#watchForm")) return;
  const donde = $("#wWhere").value;
  const cuando = $("#wWhen").value;
  $("#wDestWrap").hidden = donde !== "one";
  $("#wDateWrap").hidden = cuando !== "exact";
  $("#wMonthsWrap").hidden = cuando === "exact";
  if (cuando !== "exact") $("#wCal").hidden = true;
  $("#watchHint").textContent = HINTS_W[`${donde}|${cuando}`] || "";
}
["#wWhere", "#wWhen"].forEach((s) => on(s, "change", syncWatch));
if (existe("#watchForm")) syncWatch();

on("#watchForm", "submit", async (e) => {
  e.preventDefault();
  const donde = $("#wWhere").value;
  const cuando = $("#wWhen").value;
  const dest = donde === "one" ? $("#wDest").value.trim() : "";
  const fecha = cuando === "exact" ? $("#wDepart").value : "";
  const vuelta = cuando === "exact" ? $("#wReturn").value : "";
  if (donde === "one" && !dest) return;
  if (cuando === "exact" && !fecha) return;
  const personasW = Number($("#wAdults").value) || 1;
  const etiqueta = [
    dest || "Donde sea",
    fecha ? `${fmtDate(fecha)}${vuelta ? ` → ${fmtDate(vuelta)}` : ""}` : `${$("#wMonths").value || 6} meses`,
    `avisa bajo ${$("#wMax").value} €`,
    personasW > 1 ? `${personasW} pers.` : "1 pers.",
  ].join(" · ");
  const r = await dispatch("watch", {
    ...comoDueno(),
    dest,
    label: etiqueta,
    depart: fecha,
    return_date: vuelta,
    max_price: $("#wMax").value,
    months: $("#wMonths").value || "6",
    adults: $("#wAdults").value || "2",
    weekend: cuando === "weekend" ? "si" : "no",
  });
  if (r.ok) {
    $("#watches").insertAdjacentHTML(
      "afterbegin",
      `<div class="watch"><b>${esc(etiqueta)}</b>
        <span class="meta">apuntado · se revisa cada día</span></div>`
    );
    setTimeout(cargarWatches, 45000);
    return;
  }
  if (esFaltaDeAcceso(r)) {
    const caja = cajaAcceso(r);
    $("#watches").innerHTML = caja.html + $("#watches").innerHTML;
    caja.wire();
    return;
  }
  $("#watches").innerHTML = `<div class="watch"><span class="meta">No se pudo apuntar: ${esc(
    r.reason
  )}</span></div>`;
});

async function cargarWatches() {
  if (!$("#watches")) return;  // solo existe en seguimientos.html
  let datos;
  try {
    datos = await fetchJSON("data/watch.json");
  } catch {
    return;
  }
  const vivos = (datos.watches || []).filter((w) => w.active !== false).filter(esMio);
  vivos.forEach((w) => conGrupo(w.last_offers || [], w.adults));
  sincronizarFavs(vivos.flatMap((w) => w.last_offers || []));
  if (!vivos.length) {
    $("#watches").innerHTML = avisoDeCuenta(
      "seguimientos",
      "Aún no sigues ningún viaje. Apunta uno aquí arriba y se revisa cada día por ti."
    );
    wireEntrar($("#watches"));
    return;
  }
  $("#watches").innerHTML =
    '<h3 class="watch-head">Siguiendo a diario</h3>' +

    vivos
      .map(
        (w) => `
        <div class="watch" data-abrir="${esc(w.id)}">
          <b>${esc(w.label || w.destination || "Donde sea")}</b>
          <span class="meta">${
            w.depart ? esc(w.depart) : `próximos ${w.months} meses`
          }${w.max_price ? ` · hasta ${Math.round(w.max_price)} €` : ""}${
          w.best_price ? ` · mejor visto ${Math.round(w.best_price)} €` : ""
        }${w.last_checked ? ` · revisado ${esc(desde(w.last_checked))}` : ""}${
          (w.last_offers || []).length ? ` · ${w.last_offers.length} resultados` : " · sin resultados aún"
        }</span>
          <button class="quitar" type="button" data-unwatch="${esc(w.id)}"
            aria-label="Dejar de seguir">quitar</button>
          <div class="watch-rows" hidden></div>
        </div>`
      )
      .join("");

  // Cada seguimiento enseña lo ultimo que encontro, sin esperar a que salte
  // un aviso: asi se ve que esta trabajando aunque no haya chollo.
  $("#watches")
    .querySelectorAll(".watch[data-abrir]")
    .forEach((fila) =>
      fila.addEventListener("click", (ev) => {
        if (ev.target.closest("button, a")) return;
        const caja = fila.querySelector(".watch-rows");
        const w = vivos.find((x) => x.id === fila.dataset.abrir);
        if (!caja || !w) return;
        if (!caja.hidden) {
          caja.hidden = true;
          return;
        }
        const ofertas = w.last_offers || [];
        ofertas.forEach((o) => (SEARCH_OFFERS[o.id] = o));
        caja.innerHTML = ofertas.length
          ? ofertas.map((o, i) => boardRow(o, i)).join("")
          : '<p class="meta">Todavía no ha encontrado nada dentro de tu tope.</p>';
        caja.hidden = false;
        wireRows(caja);
      })
    );

  $("#watches")
    .querySelectorAll("[data-unwatch]")
    .forEach((b) =>
      b.addEventListener("click", async () => {
        b.disabled = true;
        const r = await dispatch("unwatch", {
          id: b.dataset.unwatch,
          ...comoDueno(),
        });
        if (r.ok) {
          const fila = b.closest(".watch");
          fila.style.opacity = 0.45;
          fila.querySelector(".meta").innerHTML = '<span class="spin"></span>quitando…';
          esperarCambios();
        } else {
          b.disabled = false;
          alert("No se pudo quitar: " + r.reason);
        }
      })
    );
}

/* ---------------------------------------------------------- calendario
   Un solo calendario reutilizable: el primer clic pone la ida y el segundo la
   vuelta. Lo usan el buscador y los seguimientos, cada uno con sus campos. */
const CALS = {
  buscar: { btn: "#dateBtn", cal: "#cal", ida: "#fDepart", vuelta: "#fReturn", rango: {} },
  seguir: { btn: "#wDateBtn", cal: "#wCal", ida: "#wDepart", vuelta: "#wReturn", rango: {} },
};

function pintarCalendario(clave) {
  const c = CALS[clave];
  if (!existe(c.cal)) return;
  const hoy = new Date();
  const meses = [];
  for (let m = 0; m < 12; m++) {
    const base = new Date(hoy.getFullYear(), hoy.getMonth() + m, 1);
    const primero = (base.getDay() + 6) % 7; // lunes primero
    const dias = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
    let celdas = "";
    for (let i = 0; i < primero; i++) celdas += "<span></span>";
    for (let d = 1; d <= dias; d++) {
      const f = new Date(base.getFullYear(), base.getMonth(), d);
      const iso = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}-${String(
        d
      ).padStart(2, "0")}`;
      const pasado = f < new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
      const extremo = c.rango.ida === iso || c.rango.vuelta === iso;
      const dentro = c.rango.ida && c.rango.vuelta && iso > c.rango.ida && iso < c.rango.vuelta;
      celdas += `<button type="button" class="dia${extremo ? " extremo" : ""}${
        dentro ? " dentro" : ""
      }" data-iso="${iso}"${pasado ? " disabled" : ""}>${d}</button>`;
    }
    meses.push(`
      <div class="mes">
        <h4>${MONTHS[base.getMonth()]} ${base.getFullYear()}</h4>
        <div class="semana"><i>L</i><i>M</i><i>X</i><i>J</i><i>V</i><i>S</i><i>D</i></div>
        <div class="dias">${celdas}</div>
      </div>`);
  }
  $(c.cal).innerHTML = `<div class="meses">${meses.join("")}</div>`;
  $(c.cal)
    .querySelectorAll(".dia:not([disabled])")
    .forEach((b) => b.addEventListener("click", () => elegirDia(clave, b.dataset.iso)));
}

function elegirDia(clave, iso) {
  const c = CALS[clave];
  if (!c.rango.ida || c.rango.vuelta || iso < c.rango.ida) {
    c.rango = { ida: iso, vuelta: null };
  } else {
    c.rango.vuelta = iso;
  }
  $(c.ida).value = c.rango.ida || "";
  $(c.vuelta).value = c.rango.vuelta || "";
  $(c.btn).textContent = c.rango.ida
    ? `${fmtDate(c.rango.ida, true)}${
        c.rango.vuelta ? ` → ${fmtDate(c.rango.vuelta, true)}` : " → elige la vuelta"
      }`
    : "Elegir en el calendario";
  pintarCalendario(clave);
  if (c.rango.ida && c.rango.vuelta) setTimeout(() => ($(c.cal).hidden = true), 250);
}

Object.entries(CALS).forEach(([clave, c]) =>
  on(c.btn, "click", () => {
    const caja = $(c.cal);
    caja.hidden = !caja.hidden;
    if (!caja.hidden) pintarCalendario(clave);
  })
);

/* Lo de esconder el calendario cuando no toca vive dentro de `syncFinder`, que
   ya esta enganchado a los dos selectores mas arriba. */
