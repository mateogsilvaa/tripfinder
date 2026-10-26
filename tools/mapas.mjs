#!/usr/bin/env node
/* Genera los dos mapas de la web a partir de Natural Earth.

   La web no carga ninguna librería de mapas: los países se proyectan AQUÍ, una
   vez, y lo que se publica son los trazos SVG ya hechos, en dos módulos:

     web/js/mapa-europa.js  Europa para el Interrail, con la posición de cada
                            ciudad de `interrail-datos.js` ya proyectada.
     web/js/mapa-mundo.js   el mundo para elegir países en el feed, con su
                            código ISO y su nombre en español.

   Se vuelve a pasar cuando se añade una ciudad al Interrail (una prueba de
   pytest falla si alguna se queda sin punto). Necesita, solo aquí:

     npm i --no-save world-atlas@2 d3-geo@3 topojson-client@3 i18n-iso-countries@7
     node tools/mapas.mjs
*/
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { geoConicConformal, geoNaturalEarth1, geoPath } = require("d3-geo");
const { feature } = require("topojson-client");
const iso = require("i18n-iso-countries");

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const atlas = (n) => JSON.parse(readFileSync(require.resolve(`world-atlas/countries-${n}.json`), "utf8"));
const nombres = new Intl.DisplayNames(["es"], { type: "region" });

// Un decimal sobra a esta escala y deja los ficheros en la mitad.
const recortar = (d) => (d || "").replace(/(\d+\.\d)\d+/g, "$1");

function paises(topo) {
  return feature(topo, topo.objects.countries).features.map((f) => {
    const a2 = iso.numericToAlpha2(String(f.id).padStart(3, "0")) || "";
    return { f, iso: a2, nombre: (a2 && nombres.of(a2)) || f.properties.name };
  });
}

const cabecera = (que) =>
  `/* ${que} — GENERADO por tools/mapas.mjs a partir de Natural Earth (dominio\n` +
  "   público). No se edita a mano: se vuelve a generar. */\n";

/* ---------------------------------------------------------------- Europa */
const ANCHO_EU = 900;
const ALTO_EU = 820;
const { CIUDADES } = await import(pathToFileURL(join(RAIZ, "web/js/interrail-datos.js")).href);
const europa = paises(atlas("50m"));
const proyEu = geoConicConformal()
  .parallels([40, 60])
  .rotate([-10, 0])
  .fitExtent(
    [
      [60, 50],
      [ANCHO_EU - 60, ALTO_EU - 40],
    ],
    {
      type: "MultiPoint",
      coordinates: Object.values(CIUDADES).map((c) => [c.lon, c.lat]),
    }
  )
  .clipExtent([
    [0, 0],
    [ANCHO_EU, ALTO_EU],
  ]);
const trazoEu = geoPath(proyEu);
const paisesEu = europa
  .map(({ f, iso: a2, nombre }) => ({ iso: a2, nombre, d: recortar(trazoEu(f)) }))
  .filter((p) => p.d && p.d.length > 12);
const puntos = Object.fromEntries(
  Object.entries(CIUDADES).map(([cod, c]) => [cod, proyEu([c.lon, c.lat]).map((v) => Math.round(v * 10) / 10)])
);
writeFileSync(
  join(RAIZ, "web/js/mapa-europa.js"),
  cabecera("mapa-europa.js") +
    `export const ANCHO = ${ANCHO_EU};\nexport const ALTO = ${ALTO_EU};\n` +
    `export const PAISES = ${JSON.stringify(paisesEu)};\n` +
    `export const PUNTOS = ${JSON.stringify(puntos)};\n`
);

/* ---------------------------------------------------------------- el mundo */
const ANCHO_MU = 960;
const ALTO_MU = 480;
const proyMu = geoNaturalEarth1().fitSize([ANCHO_MU, ALTO_MU], { type: "Sphere" });
const trazoMu = geoPath(proyMu);
const mundo = paises(atlas("110m"))
  .filter(({ iso: a2 }) => a2 && a2 !== "AQ")
  .map(({ f, iso: a2, nombre }) => ({ iso: a2, nombre, d: recortar(trazoMu(f)) }));
writeFileSync(
  join(RAIZ, "web/js/mapa-mundo.js"),
  cabecera("mapa-mundo.js") +
    `export const ANCHO = ${ANCHO_MU};\nexport const ALTO = ${ALTO_MU};\n` +
    `export const PAISES = ${JSON.stringify(mundo)};\n`
);
console.log(`Europa: ${paisesEu.length} países, ${Object.keys(puntos).length} ciudades. Mundo: ${mundo.length} países.`);
