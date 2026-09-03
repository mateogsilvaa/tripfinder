/* Sirve la web como la publica Pages, pero con el JSON de ejemplo del repo en
   vez de `data/`. Asi las pruebas no dependen de la red ni del ultimo scan:
   `data/offers.json` cambia dos veces al dia y las pruebas dirian una cosa
   distinta cada vez.

   Tambien imita lo unico que Pages hace y un servidor estatico normal no:
   cualquier direccion que no exista se contesta con 404.html. */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const WEB = path.join(__dirname, "..", "..", "web");
const DATOS = path.join(__dirname, "datos");

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  // Sin esto el navegador rechaza el manifiesto y no hay nada que instalar.
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function resolver(url) {
  let p = decodeURIComponent(new URL(url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  // `..` fuera: esto sirve dos carpetas y nada mas.
  const limpio = path.normalize(p).replace(/^(\.\.[/\\])+/, "");
  if (limpio.startsWith("/data/")) return path.join(DATOS, limpio.slice("/data/".length));
  return path.join(WEB, limpio);
}

/* El interruptor de la cobertura. `context.setOffline` de Playwright no llega a
   las peticiones que hace un service worker —las hace el worker, no la pagina—,
   asi que para probar que la web abre sin red hay que cortarla de verdad, aqui.

   `GET /__corte?on=1` y a partir de ahi todo lo de /data/ muere con la conexion
   cerrada de golpe, que es lo que ve un movil al meterse en el metro. */
let cortado = false;

const servidor = http.createServer((req, res) => {
  if (req.url.startsWith("/__corte")) {
    cortado = new URL(req.url, "http://x").searchParams.get("on") === "1";
    res.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
    res.end(cortado ? "sin cobertura" : "con cobertura");
    return;
  }
  if (cortado && req.url.startsWith("/data/")) {
    // `destroy` sin responder: el navegador lo ve como ERR_CONNECTION_RESET,
    // no como un 500. Un 500 lo serviria el worker igual, y no es el caso.
    req.socket.destroy();
    return;
  }

  const fichero = resolver(req.url);
  fs.readFile(fichero, (err, cuerpo) => {
    if (err) {
      // Lo mismo que hace Pages: la 404 del sitio, con su codigo.
      const cuatro = path.join(WEB, "404.html");
      if (fs.existsSync(cuatro)) {
        res.writeHead(404, { "Content-Type": TIPOS[".html"] });
        res.end(fs.readFileSync(cuatro));
        return;
      }
      res.writeHead(404).end("no está");
      return;
    }
    res.writeHead(200, {
      "Content-Type": TIPOS[path.extname(fichero)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(cuerpo);
  });
});

const PUERTO = Number(process.env.PUERTO || 4173);
servidor.listen(PUERTO, () => console.log(`web de prueba en http://localhost:${PUERTO}`));
