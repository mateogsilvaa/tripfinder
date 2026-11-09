/* arranque.js — Lo que se hace al abrir cualquier página.
   Cada módulo se limita a definir; aquí es donde se pone en marcha, y así
   la página elige qué carga sin que un import tenga efectos por sorpresa.

   Y ELIGE DE VERDAD: antes esto importaba todo —el feed, el HOP, el Interrail,
   el test, los mapas— en las diez páginas, y cada una se bajaba y compilaba
   unos 800 KB de JavaScript de los que usaba una quinta parte. Ahora se mira
   qué hay en la página y solo se pide lo que hace falta; lo demás (el test, los
   mapas, la hoja de alojamiento) espera a que se abra. */

import "./calendario.js";
import { montarPestanas } from "./pestanas.js";
import { montarAtajos } from "./atajos.js";
import { marcarFlap, refrescarObservacion } from "./insignias.js";
import { iniciarSincronia } from "./sincronia.js";

const hay = (sel) => !!document.querySelector(sel);

/* El feed: las tres páginas con herramientas (portada, buscar y seguimientos)
   comparten formularios, listas y datos, así que se piden juntos. */
const CON_FEED = "#offers, #searches, #watches, #finderForm, #watchForm";

/* El test se abre desde el botón de la barra, que está en todas las páginas:
   el botón es lo único que hace falta siempre; el test, solo al pulsarlo. */
function enlazarTest() {
  const flap = document.getElementById("tfDescubrir");
  if (!flap) return;
  flap.addEventListener(
    "click",
    () => import("./quiz.js").then((m) => m.abrirQuiz()),
    { once: true }
  );
}

/* Cuando el barrido publica precios nuevos y el navegador ya había pintado los
   de antes, se avisa sin tocar nada: quien quiera, los trae con un clic. */
function avisarDeDatosNuevos() {
  if (!("serviceWorker" in navigator) || !hay("#offers")) return;
  navigator.serviceWorker.addEventListener("message", (ev) => {
    if (!ev.data || ev.data.tipo !== "datos-nuevos" || !/data\/offers\.json$/.test(ev.data.ruta || "")) return;
    import("./avisos.js").then((m) =>
      m.avisar("Hay precios nuevos", { boton: "Ver", alPulsar: () => location.reload(), ms: 12000 })
    );
  });
}

async function arrancar() {
  // Antes que nada: lo que la página guarde al arrancar ya cuenta para el otro aparato.
  iniciarSincronia();
  // El botón del test responde desde el primer momento, aunque el resto aún cargue.
  enlazarTest();
  montarPestanas();
  montarAtajos();
  const conFeed = hay(CON_FEED);

  if (conFeed) {
    const [disp, favs, ofertas, busqueda, seguimientos] = await Promise.all([
      import("./disparador.js"),
      import("./favoritos.js"),
      import("./ofertas.js"),
      import("./busqueda.js"),
      import("./seguimientos.js"),
    ]);
    ofertas.init();
    busqueda.loadSearches();
    seguimientos.cargarWatches();
    disp.candarFormularios();
    // Y los "Entrar" que van dentro del texto de los dos paneles. `candarFormularios`
    // solo los engancha cuando NO hay sesión —porque es cuando pone los suyos—, y
    // estos son de la página, así que se enganchan igual siempre.
    disp.wireEntrar();
    favs.pintarListaFavs();
    favs.refrescarAvisoFavs();
    // Un favorito puede venir de una búsqueda que no está abierta: se repasan
    // todas las fuentes, pero no en cada página: con una vez cada 15 minutos
    // se avisa igual y no se piden dieciséis ficheros en cada clic.
    favs.refrescarFavsDeTodo({ cadaMin: 15 });
    avisarDeDatosNuevos();
    refrescarObservacion();
    marcarFlap();
    // Lo último: si se viene de la portada con una herramienta a medio usar, se
    // rellena y se lanza. Va al final porque necesita los formularios ya
    // enganchados (#ampliar).
    busqueda.recogerBusqueda();
    seguimientos.recogerSeguimiento();
    return;
  }

  // Las demás páginas: lo suyo, y nada del feed.
  refrescarObservacion();
  marcarFlap();
  import("./frescura.js").then((m) => m.frescuraSola());
  import("./disparador.js").then((m) => {
    m.candarFormularios();
    m.wireEntrar();
  });
  if (hay("#irForm")) import("./interrail.js").then((m) => m.montarInterrail());
  if (hay("#hopApp")) import("./hop.js").then((m) => m.montarHop());
}

arrancar();
