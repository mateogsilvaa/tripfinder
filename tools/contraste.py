#!/usr/bin/env python3
"""Comprueba el contraste de la paleta contra WCAG 2.1, en los dos temas.

No es una auditoria a ojo: lee los tokens de `web/styles.css`, asi que no
puede quedarse desfasada cuando alguien toque un color. Si un token de texto
baja del minimo sobre alguna de las superficies donde se usa, esto falla.

    python tools/contraste.py            # tabla completa
    python tools/contraste.py --check    # callado si todo pasa; 1 si algo falla

El minimo es 4.5:1, el de AA para texto normal. Los tamaños de esta web son
pequeños a proposito —las versalitas mono van a 9.5px— asi que la excepcion de
"texto grande" (3:1) no aplica a casi nada y no se usa aqui.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CSS = RAIZ / "web" / "styles.css"

AA_NORMAL = 4.5

# Los tokens que llevan TEXTO, y las CUATRO superficies sobre las que caen.
# Aqui si hay tarjetas: el feed y los dos paneles tienen su propio fondo, y el
# mas claro de los cuatro es el que decide. Comprobar solo contra `--paper`
# dejaria pasar un gris que se pierde encima de `--surface`.
TINTAS = ["ink", "muted", "accent-txt", "deep"]
FONDOS = ["paper", "surface", "surface2", "field"]

# La lamina invertida —el chollo del dia y la cabecera del feed— va al reves:
# fondo claro en el tema oscuro y al reves. Tiene sus propios tokens y se
# audita aparte, o no se auditaria nunca.
TINTAS_HERO = ["hero-ink", "hero-muted"]
FONDOS_HERO = ["hero-bg"]

# El texto que va ENCIMA de un relleno de color: el boton primario sobre el
# acento, y el rotulo de la cabecera del feed sobre la banda invertida.
#
# `--accent` y `--accent-txt` son dos a proposito. El naranja del diseño pasa
# de sobra como RELLENO (con tinta oscura encima), pero como TEXTO sobre papel
# claro se queda en 3.6:1. Oscurecerlo hasta 4.5 arreglaba el texto y rompia el
# boton, que es lo que pasa cuando un solo token hace los dos trabajos.
SOBRE_RELLENO = [("sobre-acento", "accent"), ("code-ink", "code-bg"), ("btn-ink", "btn-bg")]


def _luminancia(hexa: str) -> float:
    h = hexa.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    canales = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    lineal = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in canales]
    return 0.2126 * lineal[0] + 0.7152 * lineal[1] + 0.0722 * lineal[2]


def contraste(a: str, b: str) -> float:
    la, lb = _luminancia(a), _luminancia(b)
    alto, bajo = max(la, lb), min(la, lb)
    return (alto + 0.05) / (bajo + 0.05)


HEXES = re.compile(r"--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;")


def _tokens(css: str, selector: str) -> dict[str, str]:
    """Todos los `--x: #hex` de TODOS los bloques con ese selector.

    El tema claro no vive en un solo `:root`: esta repartido en seis (fuentes,
    color, tipografia, espacio, forma, movimiento). Quedarse con el primero
    daba una paleta vacia y una auditoria que no auditaba nada.
    """
    encontrados: dict[str, str] = {}
    for m in re.finditer(re.escape(selector) + r"\s*\{([^}]*)\}", css):
        encontrados.update(dict(HEXES.findall(m.group(1))))
    return encontrados


def paletas() -> dict[str, dict[str, str]]:
    """Los tokens de color de cada tema, sacados del CSS.

    El `:root` a secas es el tema OSCURO: es el que la web abre por defecto y
    el que el diseño trae como base. El claro solo redefine lo que cambia, asi
    que se parte del oscuro y se machaca encima, igual que hace la cascada.
    """
    css = CSS.read_text(encoding="utf-8")
    oscuro = _tokens(css, ":root")
    claro = dict(oscuro)
    claro.update(_tokens(css, ':root[data-tema="claro"]'))
    return {"oscuro": oscuro, "claro": claro}


def _pares(p: dict[str, str]) -> list[tuple[str, str]]:
    """Todas las combinaciones tinta/fondo que de verdad se dan en la web."""
    salida = [(t, f) for t in TINTAS for f in FONDOS]
    salida += [(t, f) for t in TINTAS_HERO for f in FONDOS_HERO]
    salida += SOBRE_RELLENO
    return [(t, f) for t, f in salida if t in p and f in p]


def revisar() -> list[tuple[str, str, str, float]]:
    """Todo lo que no llega al minimo, como (tema, tinta, fondo, ratio)."""
    fallos = []
    for tema, p in paletas().items():
        for tinta, fondo in _pares(p):
            r = contraste(p[tinta], p[fondo])
            if r < AA_NORMAL:
                fallos.append((tema, tinta, fondo, r))
    return fallos


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="callado si pasa; 1 si falla")
    args = ap.parse_args()

    fallos = revisar()

    if not args.check:
        for tema, p in paletas().items():
            print(f"--- {tema} ---")
            for tinta, fondo in _pares(p):
                r = contraste(p[tinta], p[fondo])
                marca = "ok" if r >= AA_NORMAL else "FALLA"
                print(f"  --{tinta:12} sobre --{fondo:10} {p[tinta]}  {r:5.2f}:1  {marca}")

    if fallos:
        print(f"\n{len(fallos)} por debajo de {AA_NORMAL}:1", file=sys.stderr)
        for tema, tinta, fondo, r in fallos:
            print(f"  {tema}: --{tinta} sobre --{fondo} = {r:.2f}:1", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
