/* tripfinder.js — La puerta de entrada. Las páginas cargan esto y nada más.

   No se parte por página a propósito: `arranque.js` llama a las tres puestas
   en marcha (tablón, búsquedas, seguimientos) y cada una se calla sola si su
   sitio no está en la página, que es como funcionaba el app.js de antes. Un
   entry por página tendría que traerse igual todo el grafo, así que sería
   una separación de mentira. */

import "./arranque.js";
