/* favoritos.js — Los viajes apuntados: marcarlos, seguir el precio y avisar de los cambios. */

import { SEARCH_OFFERS, esc, escURL, fetchJSON, fmtDate } from "./base.js";
import { conGrupo, pax, porPersona } from "./precios.js";
import { esMio } from "./disparador.js";
import { OFFERS } from "./ofertas.js";

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
export const BORRANDO_KEY = tfClave("tf_borrando");

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
export function favBtn(o) {
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
  refrescarObservacion();
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

export function wireFavs(raiz = document) {
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
export function sincronizarFavs(ofertas) {
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
export function deltaHTML(o) {
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

export function refrescarAvisoFavs() {
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
export function sparkline(historia, ancho = 108, alto = 30) {
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

export function pintarListaFavs() {
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
export async function refrescarFavsDeTodo() {
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





/* El contador de la portada. No es la lista —esa vive en `seguimientos.html`—:
   es la línea que dice cuántos hay y qué se hace con ellos, para que el
   cuadratín de cada fila signifique algo desde la primera vez que se pulsa. */
export function refrescarObservacion() {
  const num = document.getElementById("obsCuenta");
  const txt = document.getElementById("obsTexto");
  if (!num || !txt) return;
  const n = Object.keys(favLeer()).length;
  num.textContent = n === 0 ? "—" : String(n);
  txt.textContent =
    n === 0
      ? "Todavía no has apuntado ningún viaje. Marca el cuadratín de cualquier " +
        "entrada y aquí verás si sube o baja de precio cada vez que se actualicen los datos."
      : n === 1
        ? "1 viaje apuntado. Se revisa cada 12 h y te avisamos si sube o baja de precio."
        : `${n} viajes apuntados. Se revisan cada 12 h y te avisamos si suben o bajan de precio.`;
}
