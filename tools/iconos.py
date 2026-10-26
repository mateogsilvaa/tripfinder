#!/usr/bin/env python3
"""Los iconos de la aplicacion instalable (#22).

Un icono es lo unico del atlas que no puede ser tipografia y reglas: en el
lanzador de un movil no hay sitio para un toponimo. Lo que queda es la carta
misma —tinta de noche, graticula de marfil y el punto naranja de Madrid—, que es
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

# Los mismos que `styles.css` en el tema oscuro. El icono no cambia con el
# tema —el lanzador del movil no sabe de temas—, asi que se queda con el
# oscuro, que es el que la web abre por defecto.
TINTA = (0x10, 0x0F, 0x0E)   # --paper
MARFIL = (0xF4, 0xF1, 0xE8)  # --ink
NARANJA = (0xFF, 0x5A, 0x22)  # --accent

# El icono "maskable" lo recorta el sistema con la forma que quiera (circulo,
# cuadrado redondeado, gota). La zona segura es el 80 % central, asi que el
# dibujo se encoge y el resto es fondo. Sin esto, Android le come el marco.
SEGURO = 0.8


def _mezcla(fondo: tuple[int, int, int], tinta: tuple[int, int, int], alfa: float):
    """Pinta `tinta` sobre `fondo` con opacidad `alfa`. Sin canal alfa en el PNG:
    el fondo es opaco siempre, asi que se resuelve aqui y pesa menos."""
    return tuple(round(f + (t - f) * alfa) for f, t in zip(fondo, tinta, strict=True))


# La marca: la misma flecha de `iconos/marca.svg` (el favicon), en su lienzo
# de 32. Un solo dibujo para la pestana, el lanzador y la pantalla de inicio.
FLECHA = [(7, 18.5), (25, 7), (19.8, 25), (15.7, 18.9), (12.8, 23.5), (12.2, 18.3)]
FONDO_MARCA = (0x16, 0x15, 0x0F)
SUB = 4  # submuestras por eje: los bordes de la flecha salen suaves


def _dentro(x: float, y: float) -> bool:
    """Par-impar sobre la flecha, en coordenadas del lienzo de 32."""
    si = False
    n = len(FLECHA)
    for i in range(n):
        (x1, y1), (x2, y2) = FLECHA[i], FLECHA[i - 1]
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            si = not si
    return si


def dibujar(lado: int, maskable: bool = False) -> list[list[tuple[int, int, int]]]:
    """La flecha naranja sobre tinta, a sangre: el sistema redondea las esquinas.

    El recortable encoge la flecha a la zona segura para que ninguna mascara la
    muerda."""
    pix = [[FONDO_MARCA] * lado for _ in range(lado)]
    escala = (SEGURO if maskable else 1.0) * 32 / lado
    desvio = 16 - 16 * (SEGURO if maskable else 1.0)
    paso = 1 / SUB
    for py in range(lado):
        for px in range(lado):
            n = 0
            for sy in range(SUB):
                for sx in range(SUB):
                    x = (px + (sx + 0.5) * paso) * escala + desvio
                    y = (py + (sy + 0.5) * paso) * escala + desvio
                    n += _dentro(x, y)
            if n:
                pix[py][px] = _mezcla(FONDO_MARCA, NARANJA, n / SUB**2)
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
