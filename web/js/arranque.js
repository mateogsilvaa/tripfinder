/* arranque.js — Lo que se hace al abrir cualquier página.
   Cada módulo se limita a definir; aquí es donde se pone en marcha, y así
   la página elige qué carga sin que un import tenga efectos por sorpresa. */

// El calendario solo se cuelga de sus botones: no exporta nada, y por eso
// nadie lo importaba y no llegaba a cargarse.
import "./calendario.js";
import { candarFormularios, wireEntrar } from "./disparador.js";
import {
  pintarListaFavs,
  refrescarAvisoFavs,
  refrescarFavsDeTodo,
  refrescarObservacion,
} from "./favoritos.js";
import { init } from "./ofertas.js";
import { loadSearches, recogerBusqueda } from "./busqueda.js";
import { cargarWatches, recogerSeguimiento } from "./seguimientos.js";
import { marcarFlap } from "./quiz.js";

init();
loadSearches();
cargarWatches();
candarFormularios();
// Y los "Entrar" que van dentro del texto de los dos paneles. `candarFormularios`
// solo los engancha cuando NO hay sesión —porque es cuando pone los suyos—, y
// estos son de la página, así que se enganchan igual siempre.
wireEntrar();
pintarListaFavs();
refrescarAvisoFavs();
// Un favorito puede venir de una búsqueda que no está abierta: se repasan
// todas las fuentes al cargar, que es lo que permite avisar sin abrir nada.
refrescarFavsDeTodo();
refrescarObservacion();
// El punto en el flap cuando hay un test guardado: es lo unico que el test
// hace al cargar, todo lo demas espera a que lo abras (#11).
marcarFlap();
// Lo último: si se viene de la portada con una herramienta a medio usar, se
// rellena y se lanza. Va al final porque necesita los formularios ya
// enganchados (#ampliar).
recogerBusqueda();
recogerSeguimiento();
