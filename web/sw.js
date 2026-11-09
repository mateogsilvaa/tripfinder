/* sw.js — Que la web abra sin cobertura, sin enseñar precios viejos como si
   fueran de hoy (#22).

   Esto se consulta desde el móvil, casi siempre en el metro o en la calle, y a
   veces sin línea. Un service worker mal puesto es peor que ninguno: enseña la
   tanda de anteayer con el mismo aspecto que la de esta mañana, y en precios de
   vuelo eso es mentir. Así que hay dos reglas y no se mezclan.

     · EL ARMAZÓN (html, css, js, iconos) se guarda al instalar y se sirve de la
       caché. Cambia cuando cambia la versión, y la versión la sella `pages.yml`
       con el hash del commit, así que un despliegue trae caché nueva entera.

     · LOS DATOS (todo lo de data/) tienen dos tratos, según de quién sean.

         - Lo DEL BARRIDO (`offers.json`, los tablones, el histórico, los mapas
           de aeropuertos…) cambia dos veces al día. Se sirve de la caché al
           momento y se vuelve a pedir DETRÁS: «sirve ya, actualiza después».
           Si lo guardado tiene menos de `VIDA` minutos ni se pregunta. Cuando
           lo de detrás trae datos distintos, se avisa a las páginas abiertas
           (`datos-nuevos`) y la web ofrece traerlos con un clic: nunca se
           cambia la pantalla por debajo de quien está mirando.

         - Lo DE CADA CUENTA (sus búsquedas, seguimientos, alojamientos) va a
           la red primero, como siempre: es lo que alguien acaba de pedir y
           espera ver, y mostrarle la versión de hace un rato sería mentirle.
           También va a la red todo lo que `fetchJSON` pide con `fresco`
           (`cache: no-store`).

       En los dos casos, si la red falla se sirve lo guardado, y entonces la
       respuesta lleva una cabecera que la delata para que la web lo diga en
       voz alta: lo de ayer nunca se enseña como si fuera de hoy.

   Lo que NO se cachea: nada de api.github.com. Son escrituras y respuestas con
   token de por medio; guardar eso en disco sería regalarlo. */

const VERSION = "dev";
const ARMAZON = `tf-armazon-${VERSION}`;
const DATOS = `tf-datos-${VERSION}`;

/* El armazón. Rutas relativas al scope, que es donde vive el sitio: así funciona
   igual en /tripfinder/ que en la raíz de un fork. */
const PIEZAS = [
  "./",
  "./index.html",
  "./buscar.html",
  "./seguimientos.html",
  "./interrail.html",
  "./hop.html",
  "./404.html",
  "./privacidad.html",
  "./planes.html",
  "./condiciones.html",
  "./styles.css",
  "./log.js",
  "./auth.js",
  "./nube.js",
  "./js/tripfinder.js",
  "./js/arranque.js",
  "./js/base.js",
  "./js/precios.js",
  "./js/compartir.js",
  "./js/favoritos.js",
  "./js/historia.js",
  "./js/disparador.js",
  "./js/cuenta.js",
  "./js/nube-ui.js",
  "./js/nube-admin.js",
  "./js/ofertas.js",
  "./js/paises.js",
  "./js/interrail.js",
  "./js/interrail-datos.js",
  "./js/hop.js",
  "./js/fotos.js",
  "./js/insignias.js",
  "./js/camas-ficha.js",
  "./js/frescura.js",
  "./js/avisos.js",
  "./js/sincronia.js",
  "./js/mapa-nombres.js",
  "./js/borrar.js",
  "./js/filtro-destinos.js",
  "./js/notificaciones.js",
  "./js/propuesta-vuelo.js",
  "./js/admin-ilustraciones.js",
  "./js/alojamiento.js",
  "./js/busqueda.js",
  "./js/destinos.js",
  "./js/seguimientos.js",
  "./js/semana.js",
  "./js/horas.js",
  "./js/opciones.js",
  "./js/calendario.js",
  "./js/quiz.js",
  "./js/planes.js",
  "./js/pestanas.js",
  "./js/atajos.js",
  "./js/mundo.js",
  "./js/mapa-mundo.js",
  "./js/mapa-europa.js",
  "./js/mapa-hop.js",
  "./js/ampliar.js",
  "./js/motor.js",
  "./perfiles.json",
  "./manifest.webmanifest",
  "./iconos/icono-192.png",
  "./iconos/icono-512.png",
  "./iconos/marca.svg",
];

/* `PIEZAS` son rutas relativas al scope; esto las compara con la ruta pelada
   de una petición, que es absoluta. */
const enLaLista = (p) =>
  PIEZAS.some((pieza) => {
    const limpia = pieza.replace(/^\.\//, "");
    // Las páginas se enlazan sin «.html» (/condiciones): valen las dos formas.
    return limpia ? p.endsWith(`/${limpia}`) || `${p}.html`.endsWith(`/${limpia}`) : p.endsWith("/");
  });

self.addEventListener("install", (ev) => {
  ev.waitUntil(
    (async () => {
      const cache = await caches.open(ARMAZON);
      // `addAll` es todo o nada: si una pieza falla (un 404 por un fichero
      // renombrado) no se instala nada y la web se queda sin caché sin avisar.
      // De una en una, lo que sí esté se guarda y lo que no, no rompe el resto.
      await Promise.all(
        PIEZAS.map((p) => cache.add(new Request(p, { cache: "reload" })).catch(() => {}))
      );
      // Sin esto, la versión nueva espera a que se cierren todas las pestañas.
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil(
    (async () => {
      const viejas = (await caches.keys()).filter(
        (k) => k.startsWith("tf-") && k !== ARMAZON && k !== DATOS
      );
      await Promise.all(viejas.map((k) => caches.delete(k)));
      // Una versión anterior de esto sí guardaba el panel. Si esa copia sigue
      // en la caché de ESTA versión, se tira: si no, quien ya la tenía seguiría
      // con ella y este arreglo tampoco le llegaría.
      const cache = await caches.open(ARMAZON);
      await Promise.all(
        (await cache.keys())
          .filter((r) => esPanel(new URL(r.url).pathname))
          .map((r) => cache.delete(r))
      );
      await self.clients.claim();
    })()
  );
});

/* La marca de que esto salió de la caché. La web la lee en `fetchJSON` y lo
   dice en el pie: enseñar un dato viejo callando es el único fallo que este
   fichero no se puede permitir. */
function marcada(respuesta) {
  const cabeceras = new Headers(respuesta.headers);
  cabeceras.set("X-TF-Cache", "1");
  return new Response(respuesta.body, {
    status: respuesta.status,
    statusText: respuesta.statusText,
    headers: cabeceras,
  });
}

/* Los datos llevan `?t=<ahora>` para saltarse la caché de Pages. Como clave de
   caché eso no vale: cada petición sería una entrada nueva y nunca se
   encontraría la anterior. Se guarda por la ruta pelada. */
const sinReloj = (url) => {
  const u = new URL(url);
  u.search = "";
  return u.toString();
};

/* CUÁNTO VALE LO GUARDADO. Solo lo del barrido, que cambia dos veces al día:
   quince minutos sin preguntar. Lo de cada cuenta no está aquí a propósito: va
   a la red. */
const VIDA = 15 * 60 * 1000;
const DEL_BARRIDO = [
  /\/data\/offers\.json$/,
  /\/data\/frescura\.json$/,
  /\/data\/tablon\//,
  /\/data\/(camas|continentes|regiones|airports_world|history)\.json$/,
  /\/data\/duraciones\.json$/,
];
const vidaDe = (p) => (DEL_BARRIDO.some((r) => r.test(p)) ? VIDA : 0);

/* Se guarda con la hora a la que llegó: las respuestas no dicen cuánto hace. */
async function conHora(respuesta) {
  const cabeceras = new Headers(respuesta.headers);
  cabeceras.set("X-TF-Guardado", String(Date.now()));
  return new Response(await respuesta.blob(), {
    status: respuesta.status,
    statusText: respuesta.statusText,
    headers: cabeceras,
  });
}

/* ¿Lo de ahora es distinto de lo guardado? Por la etiqueta que da el servidor
   (ETag o fecha de modificación); sin ninguna de las dos, no se sabe y no se
   avisa: un aviso de más es peor que uno de menos. */
function cambio(anterior, nueva) {
  const marca = (r) => r.headers.get("etag") || r.headers.get("last-modified") || "";
  const a = marca(anterior);
  const n = marca(nueva);
  return !!a && !!n && a !== n;
}

async function avisarAPaginas(ruta) {
  const paginas = await self.clients.matchAll({ type: "window" });
  paginas.forEach((p) => p.postMessage({ tipo: "datos-nuevos", ruta }));
}

/* El panel NO pasa por aquí. No es una página que se consulte en el metro: es
   la herramienta con la que se dan de alta cuentas y se cambian contraseñas, y
   servirla de la caché significa que quien la abrió una vez se queda con esa
   copia hasta que el worker se renueve. Eso ya pasó: tres despliegues seguidos
   con arreglos del panel y en el navegador seguía corriendo el de la semana
   pasada, sin forma de notarlo desde dentro. Un fallo que hace invisibles los
   arreglos es peor que el fallo que arreglaban. */
const esPanel = (p) => /\/admin(\.html)?$/.test(p);

self.addEventListener("fetch", (ev) => {
  const req = ev.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Otro origen: la API de GitHub y las fuentes de Google. Ni tocarlo.
  if (url.origin !== self.location.origin) return;
  if (esPanel(url.pathname)) return; // a la red, siempre

  const esDato = url.pathname.includes("/data/");

  ev.respondWith(
    (async () => {
      if (esDato) {
        const clave = sinReloj(req.url);
        const vida = vidaDe(url.pathname);
        // `fetchJSON(…, { fresco: true })` pide `no-store`: eso es «de la red».
        const deLaRed = req.cache === "no-store" || req.cache === "reload";

        // Pedirlo a la red y guardarlo (con la hora, para saber su edad).
        const pedir = async () => {
          const r = await fetch(req);
          if (r.ok) {
            const cache = await caches.open(DATOS);
            const anterior = await cache.match(clave);
            await cache.put(clave, await conHora(r.clone()));
            if (anterior && cambio(anterior, r)) avisarAPaginas(url.pathname);
          }
          return r;
        };

        if (vida && !deLaRed) {
          const cache = await caches.open(DATOS);
          const guardado = await cache.match(clave);
          if (guardado) {
            const edad = Date.now() - Number(guardado.headers.get("X-TF-Guardado") || 0);
            // Reciente: ni se pregunta. Viejo: se sirve y se actualiza detrás.
            if (edad >= vida) {
              // Sin línea no hay «detrás»: se dice, como siempre que lo servido
              // sale de la caja y no de la red.
              if (self.navigator && self.navigator.onLine === false) return marcada(guardado);
              ev.waitUntil(pedir().catch(() => {}));
            }
            return guardado;
          }
        }

        // Sin caché (o de la red a propósito): red primero. Si falla, lo de
        // ayer con su etiqueta puesta.
        try {
          return await pedir();
        } catch (err) {
          const guardado = await caches.match(clave);
          if (guardado) return marcada(guardado);
          throw err;
        }
      }

      // El armazón: caché primero, porque no cambia hasta el próximo despliegue
      // y esperar a la red para pintar la misma página es tiempo regalado.
      //
      // Pero SOLO en la caché de ESTA versión. `caches.match` a secas busca en
      // TODAS, y con `ignoreSearch` eso significa que un `styles.css?v=nuevo`
      // encajaba con el `styles.css` que dejó una versión anterior: mientras
      // esa caché siguiera existiendo —hasta que el worker nuevo llegue a
      // activarse— se servía el CSS viejo con el HTML nuevo. Mitad y mitad es
      // peor que viejo entero, porque no se parece a nada que se haya
      // publicado nunca.
      //
      // `ignoreSearch` sigue haciendo falta DENTRO de la caché buena: al
      // instalar se guardan las rutas peladas y las páginas las piden con su
      // `?v=`.
      const cache = await caches.open(ARMAZON);
      // Un `?v=` que no es el de este worker lo pide una página publicada
      // DESPUÉS que él: la caché tiene la versión de antes, y mezclar un
      // `nube.js` viejo con un `nube-ui.js` nuevo rompe la cuenta. A la red.
      const v = url.searchParams.get("v");
      const guardado = v && v !== VERSION ? null : await cache.match(req, { ignoreSearch: true });
      if (guardado) return guardado;
      try {
        const r = await fetch(req);
        // Solo se guarda lo que está en la lista. Guardar CUALQUIER `.html` que
        // pase es como acabó el panel dentro de la caché sin que nadie lo
        // pusiera ahí: una página que no se ha pensado para servirse vieja.
        if (r.ok && enLaLista(url.pathname)) cache.put(req, r.clone());
        return r;
      } catch (err) {
        // Una página que no está guardada y no hay red: la 404 del sitio dice
        // qué ha pasado mucho mejor que el error del navegador.
        if (req.mode === "navigate") {
          const alterna = await caches.match("./404.html");
          if (alterna) return alterna;
        }
        throw err;
      }
    })()
  );
});

/* LAS NOTIFICACIONES. El barrido las manda cifradas (`notify/push.py`) con
   {titulo, cuerpo, url, etiqueta}; aquí se enseñan tal cual. La etiqueta hace
   que un aviso de chollos nuevo sustituya al anterior en vez de apilarse. */
self.addEventListener("push", (ev) => {
  let d = {};
  try {
    d = ev.data ? ev.data.json() : {};
  } catch {
    d = { cuerpo: ev.data ? ev.data.text() : "" };
  }
  ev.waitUntil(
    self.registration.showNotification(d.titulo || "TripFinder", {
      body: d.cuerpo || "",
      tag: d.etiqueta || "tripfinder",
      renotify: true,
      icon: "./iconos/icono-192.png",
      badge: "./iconos/icono-192.png",
      data: { url: d.url || "./" },
    })
  );
});

/* Al tocarla: a la página que diga, en la ventana de la app si ya hay una
   abierta. Solo dentro del sitio: una URL de fuera se cambia por la portada. */
self.addEventListener("notificationclick", (ev) => {
  ev.notification.close();
  const scope = self.registration.scope;
  let destino = new URL((ev.notification.data && ev.notification.data.url) || "./", scope).href;
  if (!destino.startsWith(scope)) destino = scope;
  ev.waitUntil(
    (async () => {
      const ventanas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const suya = ventanas.find((w) => w.url.startsWith(scope));
      if (suya) {
        await suya.focus();
        if ("navigate" in suya) return suya.navigate(destino);
        return null;
      }
      return self.clients.openWindow(destino);
    })()
  );
});
