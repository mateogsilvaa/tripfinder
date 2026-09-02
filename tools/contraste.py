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

# Los tokens que llevan TEXTO. El fondo es uno solo: el atlas no tiene
# tarjetas, todo cae sobre el papel —la hoja de alojamiento y la lamina de
# destinos incluidas, que tambien van con `background: var(--paper)`.
TINTAS = ["ink", "muted", "faint", "azul", "sello", "verde"]
FONDOS = ["paper"]

# El texto que va ENCIMA del acento: el boton primario y el dia elegido del
# calendario. Ahi el fondo es el acento y la tinta es `sobre-acento`.
SOBRE_ACENTO = [("sobre-acento", "azul")]


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

    El oscuro solo redefine lo que cambia, asi que se parte del claro y se
    machaca encima: igual que hace la cascada en el navegador.
    """
    css = CSS.read_text(encoding="utf-8")
    claro = _tokens(css, ":root")
    oscuro = dict(claro)
    oscuro.update(_tokens(css, ':root[data-tema="oscuro"]'))
    return {"claro": claro, "oscuro": oscuro}


def revisar() -> list[tuple[str, str, str, float]]:
    """Todo lo que no llega al minimo, como (tema, tinta, fondo, ratio)."""
    fallos = []
    for tema, p in paletas().items():
        for tinta in TINTAS:
            for fondo in FONDOS:
                if tinta not in p or fondo not in p:
                    continue
                r = contraste(p[tinta], p[fondo])
                if r < AA_NORMAL:
                    fallos.append((tema, tinta, fondo, r))
        for tinta, fondo in SOBRE_ACENTO:
            if tinta in p and fondo in p:
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
            for fondo in FONDOS:
                if fondo not in p:
                    continue
                print(f"  sobre --{fondo} ({p[fondo]})")
                for tinta in TINTAS:
                    if tinta not in p:
                        continue
                    r = contraste(p[tinta], p[fondo])
                    print(f"    --{tinta:12} {p[tinta]}  {r:5.2f}:1  {'ok' if r >= AA_NORMAL else 'FALLA'}")
            for tinta, fondo in SOBRE_ACENTO:
                if tinta in p and fondo in p:
                    r = contraste(p[tinta], p[fondo])
                    print(f"  --{tinta} sobre --{fondo}: {r:5.2f}:1  {'ok' if r >= AA_NORMAL else 'FALLA'}")

    if fallos:
        print(f"\n{len(fallos)} por debajo de {AA_NORMAL}:1", file=sys.stderr)
        for tema, tinta, fondo, r in fallos:
            print(f"  {tema}: --{tinta} sobre --{fondo} = {r:.2f}:1", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
