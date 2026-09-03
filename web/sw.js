/* sw.js — Que la web abra sin cobertura, sin enseñar precios viejos como si
   fueran de hoy (#22).

   Esto se consulta desde el móvil, casi siempre en el metro o en la calle, y a
   veces sin línea. Un service worker mal puesto es peor que ninguno: enseña la
   tanda de anteayer con el mismo aspecto que la de esta mañana, y en precios de
   vuelo eso es mentir. Así que hay dos reglas y no se mezclan.

     · EL ARMAZÓN (html, css, js, iconos) se guarda al instalar y se sirve de la
       caché. Cambia cuando cambia la versión, y la versión la sella `pages.yml`
       con el hash del commit, así que un despliegue trae caché nueva entera.

     · LOS DATOS (todo lo de data/) van SIEMPRE a la red primero. `fetchJSON`
       pide con `cache: no-store` y un `?t=<ahora>` a propósito, y eso se
       respeta: la caché es un paracaídas, no un atajo. Solo si la red falla se
       sirve lo guardado, y entonces la respuesta lleva una cabecera que la
       delata para que la web lo diga en voz alta.

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
  "./404.html",
  "./styles.css",
  "./log.js",
  "./auth.js",
  "./js/tripfinder.js",
  "./js/arranque.js",
  "./js/base.js",
  "./js/precios.js",
  "./js/favoritos.js",
  "./js/historia.js",
  "./js/disparador.js",
  "./js/ofertas.js",
  "./js/alojamiento.js",
  "./js/busqueda.js",
  "./js/destinos.js",
  "./js/seguimientos.js",
  "./js/calendario.js",
  "./js/quiz.js",
  "./js/ampliar.js",
  "./js/motor.js",
  "./perfiles.json",
  "./manifest.webmanifest",
  "./iconos/icono-192.png",
  "./iconos/icono-512.png",
  "./iconos/marca.svg",
];

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

self.addEventListener("fetch", (ev) => {
  const req = ev.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Otro origen: la API de GitHub y las fuentes de Google. Ni tocarlo.
  if (url.origin !== self.location.origin) return;

  const esDato = url.pathname.includes("/data/");

  ev.respondWith(
    (async () => {
      if (esDato) {
        // Red primero, siempre. Con red, la red gana; sin red, lo de ayer con
        // su etiqueta puesta.
        try {
          const r = await fetch(req);
          if (r.ok) {
            const cache = await caches.open(DATOS);
            cache.put(sinReloj(req.url), r.clone());
          }
          return r;
        } catch (err) {
          const guardado = await caches.match(sinReloj(req.url));
          if (guardado) return marcada(guardado);
          throw err;
        }
      }

      // El armazón: caché primero, porque no cambia hasta el próximo despliegue
      // y esperar a la red para pintar la misma página es tiempo regalado.
      const guardado = await caches.match(req, { ignoreSearch: true });
      if (guardado) return guardado;
      try {
        const r = await fetch(req);
        if (r.ok && (url.pathname.endsWith(".html") || url.pathname.endsWith("/"))) {
          const cache = await caches.open(ARMAZON);
          cache.put(req, r.clone());
        }
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
