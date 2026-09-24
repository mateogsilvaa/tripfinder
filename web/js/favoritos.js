/* favoritos.js — Los viajes apuntados: marcarlos, seguir el precio y avisar de los cambios. */

import { SEARCH_OFFERS, esc, escURL, fetchJSON, fmtDate } from "./base.js";
import { conGrupo, pax, porPersona } from "./precios.js";
import { esMio } from "./disparador.js";
import { wireCompartir } from "./compartir.js";
import { OFFERS } from "./ofertas.js";
import { openStays } from "./alojamiento.js";

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

/* Marcar una entrada era un cuadratin de 20 px sin texto: nadie sabia para que
   servia. Ahora es un boton con campana y su palabra. En escritorio manda el
   icono —la columna es estrecha— y en movil sale tambien la palabra, que es
   donde hay sitio y donde mas falta hace. */
const CAMPANA = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
  aria-hidden="true" focusable="false"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"></path
  ><path d="M13.7 21a2 2 0 0 1-3.4 0"></path></svg>`;

const QUE_FAV = (activo) =>
  activo ? "Dejar de seguir este viaje" : "Seguir este viaje y avisarme si baja";

export function favBtn(o) {
  const activo = esFav(o.id);
  const que = QUE_FAV(activo);
  return `<button class="fav${activo ? " on" : ""}" type="button" data-fav="${esc(o.id)}"
    aria-pressed="${activo}" aria-label="${que}" title="${que}">${CAMPANA}<span
    class="fav-txt" aria-hidden="true">${activo ? "Siguiendo" : "Seguir"}</span></button>`;
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
    const que = QUE_FAV(activo);
    b.setAttribute("aria-label", que);
    b.title = que;
    const txt = b.querySelector(".fav-txt");
    if (txt) txt.textContent = activo ? "Siguiendo" : "Seguir";
  });
}

export function wireFavs(raiz = document) {
  /* Una sola vez por boton: el del hero se ataba dos veces (con el feed y
     con el hero) y cada pulsacion hacia dos cosas. */
  raiz.querySelectorAll("[data-fav]:not([data-fav-atado])").forEach((b) => {
    b.dataset.favAtado = "1";
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      // Un favorito es de alguien: guardarlo sin cuenta lo dejaria en un cajon
      // que no es de nadie y que la siguiente persona que entre se encontraria.
      if (!tfUid()) return tfAbrirLogin();
      const id = b.dataset.fav;
      const o = OFFERS.find((x) => x.id === id) || SEARCH_OFFERS[id] || FAVS[id];
      if (o) alternar(o);
    });
  });
}

/* El corazon del asunto: comparar lo que vale hoy con lo ultimo que se vio.
   Se llama desde todos los sitios donde aparecen ofertas, asi que un favorito
   se actualiza tanto si lo ves en los chollos como si abres la busqueda que lo
   encontro o el seguimiento que lo trajo. */
/* El listón de la banda de cambio de precio. Ver el porqué donde se usa. */
export const MIN_AVISO_EUR = 3;
export const MIN_AVISO_PCT = 3;

export function sincronizarFavs(ofertas) {
  const hoy = hoyISO();
  let tocado = false;

  (ofertas || []).forEach((o) => {
    const f = FAVS[o.id];
    if (!f) return;

    /* CADA PAGINA SINCRONIZA CON UNA FUENTE DISTINTA: el feed con el barrido
       diario, "lo que sigues" con los resultados del seguimiento, una busqueda
       guardada con los suyos. Son tres fotos del mismo vuelo hechas a horas
       distintas, y sus precios no tienen por que coincidir.

       Sin mirar CUANDO se hizo cada foto, cambiar de pagina inventaba un cambio
       de precio: dabas a "Enterado" en el feed, ibas a lo que sigues, y la banda
       estaba otra vez ahi con los mismos euros dando tumbos de una foto a la
       otra. Una foto mas vieja que la que ya tenemos no cuenta nada nuevo. */
    const cuando = o.found_at || "";
    if (cuando && f.fuente_en && cuando < f.fuente_en) return;

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
    if (cuando) f.fuente_en = cuando;
    tocado = true;

    // CUANTO TIENE QUE MOVERSE PARA MERECER LA BANDA. Antes bastaba con medio
    // euro, y medio euro sobre 98 es medio por ciento: las tarifas bailan eso
    // solas varias veces al dia, asi que la banda saltaba una y otra vez para
    // decir "baja 1 €" con un titular enorme. Una banda que sale por nada deja
    // de mirarse, y entonces tampoco sirve el dia que de verdad baja 30.
    //
    // Tienen que cumplirse LAS DOS: tres euros y un 3 %. Solo euros y un vuelo
    // de 400 € avisaria por un 0,7 %; solo porcentaje y uno de 20 € avisaria
    // por sesenta centimos.
    const salto = Math.abs(ahora - antes);
    const nuevo =
      Number.isFinite(antes) && salto >= MIN_AVISO_EUR && antes > 0 &&
      (salto / antes) * 100 >= MIN_AVISO_PCT;

    // Y "Enterado" es enterado: `avisado` guarda el precio del que ya te hemos
    // avisado, asi que volver a ese mismo precio no es noticia. Sin esto, un
    // vuelo que baila entre 98 y 104 te daba la banda cada vez que pasaba por
    // un sitio por el que ya habias pasado.
    const yaAvisado =
      Number.isFinite(Number(f.avisado)) &&
      Math.abs(ahora - Number(f.avisado)) < MIN_AVISO_EUR;
    if (nuevo && !yaAvisado) {
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

/* La puerta para volver a lo ya buscado. El unico boton que abria la hoja de
   alojamiento vivia en el tablon de chollos, y el tablon se renueva dos veces al
   dia: al dia siguiente el vuelo ya no estaba, el boton tampoco, y la cama que
   habias esperado tres minutos a que se buscara quedaba inalcanzable. Aqui el
   viaje sigue estando mientras tu lo sigas, que es lo que quieres.

   Va en los dos sitios donde sale un viaje apuntado —la lista y la ficha de la
   banda de cambio de precio—, y se cablea en los dos: un boton pintado y sin
   cablear es peor que no ponerlo. */
function cablearCamas(raiz) {
  if (!raiz) return;
  raiz.querySelectorAll("[data-cama]").forEach((b) => {
    if (b.dataset.cableado) return;
    b.dataset.cableado = "1";
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      // Se pasa la ficha guardada: el vuelo puede no estar ya en ninguna lista,
      // y sin ella la hoja no sabria ni a que ciudad es.
      openStays(b.dataset.cama, FAVS[b.dataset.cama] || null);
    });
  });
}

function avisoFicha(f) {
  const { antes, ahora } = f.cambio;
  const baja = ahora < antes;
  const dif = Math.abs(ahora - antes);
  const serie = Array.isArray(f.historia) ? f.historia : [];
  const enlace = f.deep_link || f.airline_link || "";
  const sitio = esc(f.destination_name || f.destination);

  /* UNA LINEA POR VIAJE, y la curva pegada al vuelo del que habla. Antes cada
     cambio era una ficha con titular, precio a cuerpo de portada, sello,
     tres botones y su propia caja: un cartel para decir que algo baja catorce
     euros. Aqui lo que hay que saber cabe en un renglon —que ha cambiado, cual,
     cuanto y como viene— y lo demas ya esta en la lista de abajo. */
  return `
    <li class="cambio ${baja ? "baja" : "sube"}">
      <span class="cambio-curva" aria-hidden="true">${sparkline(serie, 64, 20)}</span>
      <span class="cambio-sitio">${sitio}</span>
      <span class="cambio-precio">
        <s>${Math.round(antes)} €</s><b>${Math.round(ahora)} €</b>
      </span>
      <span class="cambio-dif">${baja ? "−" : "+"}${Math.round(dif)} €</span>
      ${
        enlace
          ? `<a class="cambio-ver" href="${escURL(enlace)}" target="_blank" rel="noopener"
               aria-label="Ver el vuelo a ${sitio}">ver</a>`
          : "<span></span>"
      }
    </li>`;
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
      <p class="aviso-rotulo">${esc(titulo)} <span>${esc(detalle)}</span></p>
      <button class="quitar" type="button" id="favVisto">Enterado</button>
    </div>
    <ul class="cambios">${bajan.concat(suben).map(avisoFicha).join("")}</ul>`;

  const boton = document.getElementById("favVisto");
  if (boton) {
    boton.addEventListener("click", () => {
      Object.values(FAVS).forEach((f) => {
        if (!f.cambio) return;
        f.cambio.visto = true;
        // Queda apuntado A QUE PRECIO te diste por enterado, que es lo que
        // impide que el mismo cambio vuelva por otra puerta.
        f.avisado = f.cambio.ahora;
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
      <circle cx="${(ancho - 2.4).toFixed(1)}" cy="${y(ultimo).toFixed(1)}" r="2.4" fill="currentColor"/>
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
        <button class="btn ghost small" type="button" data-cama="${esc(f.id)}"
          aria-label="Alojamiento en ${esc(f.destination_name || f.destination)}">Alojamiento</button>
        <button type="button" class="compartir-btn" data-share="${esc(f.id)}"
          aria-label="Compartir ${esc(f.destination_name || f.destination)}">compartir</button>
        <button class="quitar" type="button" data-desfav="${esc(f.id)}"
          aria-label="Dejar de seguir ${esc(f.destination_name || f.destination)}">quitar</button>
      </span>
    </div>`;
}

/* Cuantos viajes hay apuntados. Lo pregunta la cabecera de seguimientos, que
   enseña «siguiendo» y «apuntados» como dos cifras distintas porque son dos
   cosas distintas: un encargo que se revisa solo y un viaje concreto marcado. */
export const cuantosFavs = () => Object.keys(FAVS).length;

/* A quien avisar cuando la lista cambia. Se apunta seguimientos.js para
   refrescar su cifra sin que favoritos.js tenga que saber que existe. */
const OYENTES = [];
export const alCambiarFavs = (fn) => OYENTES.push(fn);
const avisarDelCambio = () => OYENTES.forEach((fn) => fn());

export function pintarListaFavs() {
  const caja = document.getElementById("favoritos");
  if (!caja) return;
  const lista = Object.values(FAVS).sort((a, b) => (b.desde || 0) - (a.desde || 0));
  if (!lista.length) {
    avisarDelCambio();
    caja.innerHTML = `
      <h3 class="watch-head">vuelos que sigues</h3>
      <p class="vacio">Todavía no sigues ningún viaje. Dale a Seguir en cualquier entrada
      del feed y aquí verás si sube o baja de precio cada vez que se actualicen los datos.</p>`;
    return;
  }
  avisarDelCambio();
  caja.innerHTML =
    `<h3 class="watch-head">vuelos que sigues · ${lista.length} viaje${
      lista.length > 1 ? "s" : ""
    } apuntado${lista.length > 1 ? "s" : ""}</h3>` + lista.map(favFila).join("");
  cablearCamas(caja);

  // Compartir uno de los apuntados. Lo guardado lleva `precio_visto` POR
  // PERSONA y la hoja espera el total del grupo, como cualquier oferta: sin
  // esta cuenta, un viaje para dos se compartiria a mitad de precio.
  wireCompartir(caja, (id) => {
    const f = FAVS[id];
    if (!f) return null;
    const gente = Math.max(1, Number(f.adults) || 1);
    return { ...f, price: (f.precio_visto || f.precio_inicial || 0) * gente };
  });
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
   botón de Seguir de cada fila signifique algo desde la primera vez que se pulsa. */
export function refrescarObservacion() {
  const num = document.getElementById("obsCuenta");
  const txt = document.getElementById("obsTexto");
  if (!num || !txt) return;
  const n = Object.keys(favLeer()).length;
  num.textContent = n === 0 ? "—" : String(n);
  txt.textContent =
    n === 0
      ? "Todavía no sigues ningún viaje. Dale a Seguir en cualquier entrada del feed " +
        "y aquí verás si sube o baja de precio cada vez que se actualicen los datos."
      : n === 1
        ? "1 viaje apuntado. Se revisa cada 12 h y te avisamos si sube o baja de precio."
        : `${n} viajes apuntados. Se revisan cada 12 h y te avisamos si suben o bajan de precio.`;
}
