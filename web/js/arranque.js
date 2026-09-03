/* arranque.js — Lo que se hace al abrir cualquier página.
   Cada módulo se limita a definir; aquí es donde se pone en marcha, y así
   la página elige qué carga sin que un import tenga efectos por sorpresa. */

// El calendario solo se cuelga de sus botones: no exporta nada, y por eso
// nadie lo importaba y no llegaba a cargarse.
import "./calendario.js";
import { candarFormularios } from "./disparador.js";
import {
  pintarListaFavs,
  refrescarAvisoFavs,
  refrescarFavsDeTodo,
} from "./favoritos.js";
import { init } from "./ofertas.js";
import { loadSearches } from "./busqueda.js";
import { cargarWatches } from "./seguimientos.js";

init();
loadSearches();
cargarWatches();
candarFormularios();
pintarListaFavs();
refrescarAvisoFavs();
// Un favorito puede venir de una búsqueda que no está abierta: se repasan
// todas las fuentes al cargar, que es lo que permite avisar sin abrir nada.
refrescarFavsDeTodo();
