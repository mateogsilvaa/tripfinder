#!/usr/bin/env python3
"""mapa.py — El mapamundi de «dónde has estado», de TopoJSON a un SVG del repo.

El mapa no se pide a ninguna API ni se dibuja con una librería de 200 KB: es un
SVG estático con un `<path>` por país, su código ISO y su nombre en español.
Así se pinta sin JavaScript, se colorea con los tokens del CSS —y por tanto
cambia con el tema— y se marca un país con un `classList.toggle`.

LAS FUENTES, y por qué no están en el repo:

  · La geometría sale de `world-atlas` (npm), que es TopoJSON pre-construido de
    Natural Earth. Natural Earth es dominio público y el empaquetado va con
    licencia ISC, así que lo derivado se puede publicar sin problema.
  · Los códigos ISO y los nombres en español salen de `i18n-iso-countries`
    (npm, MIT). Un nombre de país y su código son hechos, no contenido.

Las dos son de MOMENTO DE GENERAR, no de ejecución: lo que se publica es el SVG
ya hecho, que es lo único que baja el navegador. Regenerarlo hace falta solo si
cambian las fronteras, y entonces:

    npm pack world-atlas@2 i18n-iso-countries
    tar xzf world-atlas-*.tgz && mv package atlas
    tar xzf i18n-iso-countries-*.tgz && mv package iso
    python tools/mapa.py --generar .            # busca atlas/ e iso/ ahí dentro

En CI no hay npm, así que allí solo corre `--check`, que no mira las fuentes:
comprueba que el SVG publicado es coherente consigo mismo (que cada país tiene
código y nombre, que no hay códigos repetidos y que los trazos parsean).
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
SALIDA = RAIZ / "web" / "mapa.svg"

# El ancho en unidades del `viewBox`. Con coordenadas ENTERAS esto es también la
# precisión: 1000 unidades de ancho son ~1 px de error en una pantalla de 1000,
# y el mapa nunca se enseña más grande que eso. A cambio, los trazos ocupan diez
# veces menos que con un decimal (110 KB en vez de 1,1 MB), que en un móvil es
# la diferencia entre que cargue y que no.
ANCHO = 1000.0

# Robinson. Ni la más fiel ni la más exacta: la que mejor se lee de un vistazo,
# que es lo único que se le pide a esto. La tabla es la del propio Robinson, con
# interpolación lineal entre los tramos de cinco grados.
_LAT = [i * 5 for i in range(19)]
_X = [1, .9986, .9954, .99, .9822, .973, .96, .9427, .9216, .8962,
      .8679, .835, .7986, .7597, .7186, .6732, .6213, .5722, .5322]
_Y = [0, .062, .124, .186, .248, .31, .372, .434, .4958, .5571,
      .6176, .6769, .7346, .7903, .8435, .8936, .9394, .9761, 1]


def robinson(lon: float, lat: float) -> tuple[float, float]:
    signo = 1 if lat >= 0 else -1
    grados = min(abs(lat), 90.0)
    i = min(int(grados // 5), 17)
    t = (grados - _LAT[i]) / 5
    x = _X[i] + (_X[i + 1] - _X[i]) * t
    y = _Y[i] + (_Y[i + 1] - _Y[i]) * t
    return 0.8487 * x * math.radians(lon), 1.3523 * y * signo


def _arcos(topo: dict) -> list[list[tuple[float, float]]]:
    """Los arcos del TopoJSON, ya en grados: vienen cuantizados y en deltas."""
    escala = topo["transform"]["scale"]
    mueve = topo["transform"]["translate"]
    fuera = []
    for arco in topo["arcs"]:
        x = y = 0
        puntos = []
        for dx, dy in arco:
            x += dx
            y += dy
            puntos.append((x * escala[0] + mueve[0], y * escala[1] + mueve[1]))
        fuera.append(puntos)
    return fuera


def _anillo(arcos: list, indices: list[int]) -> list[tuple[float, float]]:
    """Un anillo se cose a partir de varios arcos; el negativo va del revés."""
    puntos: list[tuple[float, float]] = []
    for i in indices:
        trozo = arcos[~i][::-1] if i < 0 else arcos[i]
        puntos.extend(trozo[1:] if puntos else trozo)
    return puntos


def _partir(puntos: list[tuple[float, float]]) -> list[list[tuple[float, float]]]:
    """Corta un anillo por donde cruza el antimeridiano.

    Rusia tiene tierra al este del meridiano 180 (Chukotka, Wrangel), y en el
    fichero eso viene como longitud -179 y pico: el anillo salta de +179 a -179
    y, pintado tal cual, cruza el mapa entero de lado a lado con una raya. Lo
    mismo les pasa a Fiji, Kiribati y Nueva Zelanda.

    Un salto de más de 180 grados entre dos puntos seguidos de una costa no
    existe: es siempre la vuelta al mundo. Ahí se parte, y cada trozo se cierra
    por su cuenta contra el borde del mapa, que es donde de verdad está.
    """
    trozos: list[list[tuple[float, float]]] = [[]]
    for punto in puntos:
        anterior = trozos[-1][-1] if trozos[-1] else None
        if anterior and abs(punto[0] - anterior[0]) > 180:
            # Cada trozo se lleva hasta el borde en vez de cerrarse por donde
            # le pille: si no, los dos cabos se unen en diagonal y sale un aspa
            # sobre el Pacífico (se veía en Kamchatka y las Kuriles).
            a, b = anterior[0], punto[0]
            destapado = b - 360 if b - a > 180 else b + 360
            # `a` y `b` pueden ser el MISMO meridiano escrito de las dos formas
            # (-180 y 180): ahí no hay nada que cortar, es el mismo sitio.
            if destapado != a:
                t = (math.copysign(180, a) - a) / (destapado - a)
                corte = anterior[1] + (punto[1] - anterior[1]) * t
                trozos[-1].append((math.copysign(180, a), corte))
                trozos.append([(math.copysign(180, b), corte)])
            else:
                trozos.append([])
        trozos[-1].append(punto)

    # Un anillo es CERRADO: acaba donde empieza. Si el corte lo ha partido, el
    # último trozo y el primero son en realidad el mismo, solo que el anillo
    # venía escrito empezando a mitad de camino. Sin volver a unirlos, cada uno
    # se cierra por su cuenta y la línea de cierre cruza el país en diagonal
    # (salía un aspa enorme sobre Kamchatka).
    if len(trozos) > 1 and puntos and puntos[0] == puntos[-1]:
        trozos[0] = trozos[-1] + trozos[0]
        trozos.pop()
    return [t for t in trozos if len(t) >= 3]


def _trazo(anillos: list, caja: tuple[float, float, float, float]) -> str:
    """Los anillos de un país, en un solo atributo `d`.

    Enteros y comandos RELATIVOS (`l`, `h`, `v`): la mayoría de los saltos entre
    dos puntos de una costa caben en uno o dos caracteres, y de ahí sale casi
    toda la diferencia de tamaño.
    """
    minx, maxy, k, _ = caja
    partes = []
    for anillo in anillos:
        for puntos in _partir(anillo):
            enteros: list[tuple[int, int]] = []
            for lon, lat in puntos:
                x, y = robinson(lon, lat)
                p = (round((x - minx) * k), round((maxy - y) * k))
                if not enteros or p != enteros[-1]:
                    enteros.append(p)
            if len(enteros) < 3:
                continue  # un trozo más pequeño que la precisión del mapa
            trozos = [f"M{enteros[0][0]} {enteros[0][1]}"]
            px, py = enteros[0]
            for x, y in enteros[1:]:
                dx, dy = x - px, y - py
                if dx == 0 and dy == 0:
                    continue
                trozos.append(f"h{dx}" if dy == 0 else f"v{dy}" if dx == 0 else f"l{dx} {dy}")
                px, py = x, y
            partes.append("".join(trozos) + "z")
    return "".join(partes)


def generar(fuentes: Path) -> str:
    atlas = json.loads((fuentes / "atlas" / "countries-50m.json").read_text())
    codigos = json.loads((fuentes / "iso" / "codes.json").read_text())
    espanol = json.loads((fuentes / "iso" / "langs" / "es.json").read_text())["countries"]

    # ISO numérico -> alfa-2. El numérico es lo que trae Natural Earth; el
    # alfa-2 es lo que se guarda y lo que se lee en una URL.
    por_numero = {n.lstrip("0"): a2 for a2, _a3, n, *_ in codigos}

    arcos = _arcos(atlas)
    paises = []
    for g in atlas["objects"]["countries"]["geometries"]:
        anillos = g["arcs"] if g["type"] == "Polygon" else [r for p in g["arcs"] for r in p]
        puntos = [_anillo(arcos, a) for a in anillos]
        numero = str(g.get("id", "")).lstrip("0")
        iso = por_numero.get(numero, "")
        nombre = espanol.get(iso) or g["properties"]["name"]
        if isinstance(nombre, list):  # algunos traen variantes; manda la primera
            nombre = nombre[0]
        paises.append((iso, nombre, puntos))

    # La caja de todo el mundo, para que el `viewBox` no deje aire alrededor.
    xs, ys = [], []
    for _iso, _n, anillos in paises:
        for pts in anillos:
            for lon, lat in pts:
                x, y = robinson(lon, lat)
                xs.append(x)
                ys.append(y)
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    k = ANCHO / (maxx - minx)
    alto = round((maxy - miny) * k)
    caja = (minx, maxy, k, alto)

    filas = []
    for iso, nombre, anillos in sorted(paises, key=lambda p: p[1]):
        d = _trazo(anillos, caja)
        if not d:
            continue
        if iso:
            # `data-n` lo lee el JS para el rótulo; el `<title>` es lo que dice
            # un lector de pantalla y lo que sale al dejar el ratón quieto.
            filas.append(
                f'<path class="pais" data-iso="{iso}" data-n="{_esc(nombre)}" '
                f'd="{d}"><title>{_esc(nombre)}</title></path>'
            )
        else:
            # Sin código ISO: territorios en disputa y trozos sin país. Se
            # dibujan —si no, el mapa tendría agujeros— pero no se marcan.
            filas.append(f'<path class="pais sin-codigo" d="{d}"></path>')

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {ANCHO:.0f} {alto}" '
        f'class="mundo" role="img" aria-label="Mapa del mundo por países">\n'
        + "\n".join(filas)
        + "\n</svg>\n"
    )


def _esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace('"', "&quot;")


def comprobar() -> int:
    """Que el SVG publicado se sostiene solo. No mira las fuentes: en CI no hay."""
    if not SALIDA.exists():
        print(f"No existe {SALIDA.relative_to(RAIZ)}. Regenéralo: mira la cabecera de este fichero.")
        return 1
    svg = SALIDA.read_text(encoding="utf-8")
    paths = re.findall(r"<path\b[^>]*>", svg)
    if not paths:
        print("El mapa no tiene ni un país.")
        return 1

    isos, fallos = [], []
    for p in paths:
        iso = re.search(r'data-iso="([^"]*)"', p)
        nombre = re.search(r'data-n="([^"]*)"', p)
        d = re.search(r' d="([^"]*)"', p)
        if not d or not d.group(1):
            fallos.append("un país sin trazo")
            continue
        if "sin-codigo" in p:
            continue
        if not iso or not re.fullmatch(r"[A-Z]{2}", iso.group(1)):
            fallos.append(f"código raro: {p[:70]}")
            continue
        if not nombre or not nombre.group(1).strip():
            fallos.append(f"{iso.group(1)} sin nombre")
        isos.append(iso.group(1))

    repes = {i for i in isos if isos.count(i) > 1}
    if repes:
        fallos.append(f"códigos repetidos: {sorted(repes)}")
    # Si esto baja mucho es que la generación se ha comido medio mundo.
    if len(isos) < 180:
        fallos.append(f"solo {len(isos)} países con código; esperaba 180 o más")
    if "ES" not in isos:
        fallos.append("no está España, que es de donde salen todos los vuelos")

    if fallos:
        for f in fallos:
            print(f"  {f}")
        return 1
    print(f"Mapa: {len(isos)} países con código, {len(svg) // 1024} KB.")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--generar", metavar="DIR", help="carpeta con atlas/ e iso/ descomprimidos")
    p.add_argument("--check", action="store_true", help="comprobar el SVG publicado")
    args = p.parse_args(argv)

    if args.generar:
        svg = generar(Path(args.generar))
        SALIDA.write_text(svg, encoding="utf-8")
        print(f"Escrito {SALIDA.relative_to(RAIZ)} ({len(svg) // 1024} KB).")
        return 0
    return comprobar()


if __name__ == "__main__":
    sys.exit(main())
