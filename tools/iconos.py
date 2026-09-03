#!/usr/bin/env python3
"""Los iconos de la aplicacion instalable (#22).

Un icono es lo unico del atlas que no puede ser tipografia y reglas: en el
lanzador de un movil no hay sitio para un toponimo. Lo que queda es la carta
misma —tinta de noche, graticula de marfil y el punto rojo de Madrid—, que es
exactamente de lo que esta hecho el fondo de la web.

Se generan aqui, y no a mano en un editor, por tres motivos: salen de los
mismos colores que `styles.css` (si la paleta cambia, se regeneran), quedan
reproducibles bit a bit, y un PNG plano de 512 px son ~4 KB escritos con zlib
y struct, sin dependencias que instalar en CI.

    python tools/iconos.py            # los escribe en web/iconos/
    python tools/iconos.py --check    # devuelve 1 si no coinciden con el repo
"""

from __future__ import annotations

import argparse
import struct
import sys
import zlib
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
DESTINO = RAIZ / "web" / "iconos"

# Los mismos de la carta de noche en styles.css. El icono no cambia con el tema
# —el lanzador del movil no sabe de temas—, asi que se queda con el de noche,
# que es el que la web abre por defecto.
TINTA = (0x0B, 0x17, 0x20)
MARFIL = (0xEA, 0xE5, 0xD8)
ROJO = (0xE8, 0x57, 0x4A)

# El icono "maskable" lo recorta el sistema con la forma que quiera (circulo,
# cuadrado redondeado, gota). La zona segura es el 80 % central, asi que el
# dibujo se encoge y el resto es fondo. Sin esto, Android le come el marco.
SEGURO = 0.8


def _mezcla(fondo: tuple[int, int, int], tinta: tuple[int, int, int], alfa: float):
    """Pinta `tinta` sobre `fondo` con opacidad `alfa`. Sin canal alfa en el PNG:
    el fondo es opaco siempre, asi que se resuelve aqui y pesa menos."""
    return tuple(round(f + (t - f) * alfa) for f, t in zip(fondo, tinta, strict=True))


def dibujar(lado: int, maskable: bool = False) -> list[list[tuple[int, int, int]]]:
    """La carta: graticula de marfil sobre tinta y el punto de Madrid.

    Todo se mide en fracciones del lado, no en pixeles, para que 192 y 512
    salgan el mismo dibujo y no dos parecidos."""
    pix = [[TINTA] * lado for _ in range(lado)]
    margen = (1 - SEGURO) / 2 if maskable else 0.0
    dentro = 1 - 2 * margen

    def a_px(f: float) -> float:
        return (margen + f * dentro) * lado

    # El marco (la `.registro` de la web): una linea de marfil por dentro. Va
    # antes que la graticula porque es quien decide donde acaba.
    borde = max(1, round(lado / 64))
    b0, b1 = round(a_px(0.06)), round(a_px(0.94))

    # La graticula: cuatro meridianos y cuatro paralelos, finos y apagados,
    # igual que la capa `.glow` de la web. RECORTADA AL MARCO: una carta tiene
    # los meridianos dentro del neatline, no derramandose por la mesa.
    grosor = max(1, round(lado / 160))
    for i in range(1, 5):
        for j in range(grosor):
            x = round(a_px(i / 5)) + j
            y = round(a_px(i / 5)) + j
            for k in range(b0, b1 + 1):
                if b0 <= x <= b1:
                    pix[k][x] = _mezcla(TINTA, MARFIL, 0.18)
                if b0 <= y <= b1:
                    pix[y][k] = _mezcla(TINTA, MARFIL, 0.18)

    for k in range(b0, b1 + 1):
        for j in range(borde):
            for y, x in ((b0 + j, k), (b1 - j, k), (k, b0 + j), (k, b1 - j)):
                if 0 <= y < lado and 0 <= x < lado:
                    pix[y][x] = _mezcla(TINTA, MARFIL, 0.55)

    # Madrid, en el centro: el unico punto rojo de todo el sistema.
    cx = cy = a_px(0.5)
    r = a_px(0.5) - a_px(0.5 - 0.11)
    for y in range(lado):
        for x in range(lado):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            if d <= r - 1:
                pix[y][x] = ROJO
            elif d <= r:  # un pixel de transicion: sin esto el punto sale dentado
                pix[y][x] = _mezcla(pix[y][x], ROJO, r - d)
    return pix


def png(pix: list[list[tuple[int, int, int]]]) -> bytes:
    """Un PNG RGB de 8 bits. Es todo lo que hace falta y cabe en veinte lineas."""
    lado = len(pix)
    crudo = b"".join(b"\x00" + bytes(v for p in fila for v in p) for fila in pix)

    def trozo(tipo: bytes, datos: bytes) -> bytes:
        return (
            struct.pack(">I", len(datos))
            + tipo
            + datos
            + struct.pack(">I", zlib.crc32(tipo + datos) & 0xFFFFFFFF)
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + trozo(b"IHDR", struct.pack(">IIBBBBB", lado, lado, 8, 2, 0, 0, 0))
        + trozo(b"IDAT", zlib.compress(crudo, 9))
        + trozo(b"IEND", b"")
    )


PIEZAS = {
    "icono-192.png": (192, False),
    "icono-512.png": (512, False),
    # El recortable va aparte: con el mismo dibujo, Android le comeria el marco.
    "icono-512-recortable.png": (512, True),
    # Safari no lee el manifest para el icono de la pantalla de inicio.
    "apple-touch-icon.png": (180, False),
}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="no escribe; 1 si algo no cuadra")
    args = ap.parse_args()

    DESTINO.mkdir(parents=True, exist_ok=True)
    distintos = []
    for nombre, (lado, maskable) in PIEZAS.items():
        datos = png(dibujar(lado, maskable))
        ruta = DESTINO / nombre
        if ruta.exists() and ruta.read_bytes() == datos:
            continue
        distintos.append(nombre)
        if not args.check:
            ruta.write_bytes(datos)

    if args.check and distintos:
        print("Iconos que no cuadran: " + ", ".join(distintos), file=sys.stderr)
        print("Pasa `python tools/iconos.py` y vuelve a commitear.", file=sys.stderr)
        return 1
    print("Iconos: " + (", ".join(distintos) if distintos else "ya estaban todos"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
