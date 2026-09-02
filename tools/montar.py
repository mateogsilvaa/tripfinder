#!/usr/bin/env python3
"""Monta las partes comunes de la web dentro de los cuatro HTML.

La web es HTML plano a proposito: sin build, sin dependencias, y se abre
haciendo doble clic en el fichero. El precio era que la cabecera, el nav, el
panel de alojamiento, la lamina de destinos y el pie estaban COPIADOS en los
cuatro HTML, y cambiar una entrada del nav eran cuatro ediciones y una
oportunidad de olvidarse de una. (Ejemplo real: `admin.html` se quedo en
`build 27` cuando las otras tres ya iban por la 28.)

Aqui las partes viven una sola vez en `web/partes/` y este script las escribe
DENTRO de los HTML, entre marcas:

    <!-- tf:parte zonas -->
      ...lo que genera este script...
    <!-- /tf:parte -->

Lo importante es que escribe en el propio fichero, no en una copia: los HTML
del repositorio siguen siendo los que se publican y los que se abren en local.
No hay generador de sitios ni paso de compilacion; esto solo sustituye texto.

    python tools/montar.py            # monta y guarda
    python tools/montar.py --check    # no toca nada; falla si algo esta sin montar

`--check` es lo que corre en CI: si alguien edita una region a mano en vez de
tocar la parte, el despliegue se para en vez de publicar cuatro cabeceras
distintas.

Para cambiar el numero de version de los assets (el `?v=` y el `build N` del
pie) se toca BUILD y se vuelve a montar: sale a la vez en los cuatro ficheros.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
WEB = RAIZ / "web"
PARTES = WEB / "partes"

# El unico sitio donde vive el numero de version. Sube uno al cambiar
# styles.css, app.js, auth.js o log.js: es lo que rompe la cache del navegador.
BUILD = 28

DESCRIPCION = (
    "Escapadas de fin de semana desde Madrid por debajo de su precio habitual, "
    "con busqueda de alojamiento bajo demanda."
)

VIVO = '      <span class="board-live"><i></i>en vivo</span>\n'

GUIONES_WEB = (
    '<script src="log.js?v={v}"></script>\n'
    '<script src="auth.js?v={v}"></script>\n'
    '<script src="app.js?v={v}"></script>\n'
)
GUIONES_PANEL = (
    '<script src="log.js?v={v}"></script>\n'
    '<script src="auth.js?v={v}"></script>\n'
)

NOTA_WEB = (
    '  <span id="frescura">—</span>\n'
    "  <span>Los precios vuelan: confirma siempre antes de reservar.</span>\n"
)
NOTA_PANEL = (
    "  <span>Las contraseñas no se guardan: solo su PBKDF2 con sal, "
    "igual que en el backend.</span>\n"
)

# Lo unico que cambia de una pagina a otra. Todo lo demas es comun y vive en
# `web/partes/`. Cambiar una entrada del nav se hace en `partes/zonas.html` y
# aparece en las tres paginas publicas de golpe.
PAGINAS = {
    "index.html": {
        "titulo": "TripFinder · escapadas desde Madrid",
        "meta": f'<meta name="description" content="{DESCRIPCION}">',
        "favicon": "✈️",
        "flaps": '<span class="flap">M</span><span class="flap">A</span><span class="flap">D</span>',
        "rotulo": "índice de escapadas · origen Madrid",
        "vivo": VIVO,
        "zona": "promos",
        "nota": NOTA_WEB,
        "guiones": GUIONES_WEB,
    },
    "buscar.html": {
        "titulo": "TripFinder · trazar un viaje",
        "meta": f'<meta name="description" content="{DESCRIPCION}">',
        "favicon": "✈️",
        "flaps": '<span class="flap">M</span><span class="flap">A</span><span class="flap">D</span>',
        "rotulo": "índice de escapadas · origen Madrid",
        "vivo": VIVO,
        "zona": "buscar",
        "nota": NOTA_WEB,
        "guiones": GUIONES_WEB,
    },
    "seguimientos.html": {
        "titulo": "TripFinder · en observación",
        "meta": f'<meta name="description" content="{DESCRIPCION}">',
        "favicon": "✈️",
        "flaps": '<span class="flap">M</span><span class="flap">A</span><span class="flap">D</span>',
        "rotulo": "índice de escapadas · origen Madrid",
        "vivo": VIVO,
        "zona": "follows",
        "nota": NOTA_WEB,
        "guiones": GUIONES_WEB,
    },
    # El panel no es una zona publica: no lleva nav, ni las hojas de
    # alojamiento, ni se indexa.
    "admin.html": {
        "titulo": "TripFinder · panel",
        "meta": '<meta name="robots" content="noindex">',
        "favicon": "🛠️",
        "flaps": '<span class="flap">A</span><span class="flap">D</span><span class="flap">M</span>',
        "rotulo": "panel · cuentas y registro de errores",
        "vivo": "",
        "zona": None,
        "nota": NOTA_PANEL,
        "guiones": GUIONES_PANEL,
    },
}

MARCA = re.compile(
    r"(?P<abre><!-- tf:parte (?P<nombre>[a-z-]+) -->\n)"
    r"(?P<cuerpo>.*?)"
    r"(?P<cierra>\n?<!-- /tf:parte -->)",
    re.DOTALL,
)


def _zonas(activa: str | None) -> dict[str, str]:
    """El nav marca la zona en la que estas, y solo esa."""
    salida = {}
    for z in ("promos", "buscar", "follows"):
        if z == activa:
            salida[z] = f' class="zona activa" data-zona="{z}" aria-current="page"'
        else:
            salida[z] = f' class="zona" data-zona="{z}"'
    return salida


def render(nombre_parte: str, datos: dict) -> str:
    """Una parte con sus huecos rellenos. Los huecos son `{{nombre}}`."""
    texto = (PARTES / f"{nombre_parte}.html").read_text(encoding="utf-8").rstrip("\n")
    huecos = {**datos, "v": str(BUILD), **_zonas(datos.get("zona"))}
    huecos["guiones"] = str(huecos.get("guiones", "")).format(v=BUILD)

    def sustituir(m: re.Match) -> str:
        clave = m.group(1)
        if clave not in huecos:
            raise SystemExit(f"{nombre_parte}.html pide {{{{{clave}}}}} y nadie lo da")
        return str(huecos[clave])

    # rstrip: el bloque de guiones acaba en salto de linea y la marca de
    # cierre trae el suyo; sin esto cada montaje deja una linea en blanco mas.
    return re.sub(r"\{\{(\w+)\}\}", sustituir, texto).rstrip("\n")


def montar_texto(html: str, datos: dict) -> str:
    def sustituir(m: re.Match) -> str:
        cuerpo = render(m.group("nombre"), datos)
        return m.group("abre") + cuerpo + m.group("cierra")

    return MARCA.sub(sustituir, html)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--check",
        action="store_true",
        help="no escribe; devuelve 1 si algun HTML no esta montado",
    )
    args = ap.parse_args()

    sucios = []
    for fichero, datos in PAGINAS.items():
        ruta = WEB / fichero
        antes = ruta.read_text(encoding="utf-8")
        despues = montar_texto(antes, datos)
        if antes == despues:
            continue
        sucios.append(fichero)
        if not args.check:
            ruta.write_text(despues, encoding="utf-8")

    if args.check and sucios:
        print("Sin montar: " + ", ".join(sucios), file=sys.stderr)
        print("Pasa `python tools/montar.py` y vuelve a commitear.", file=sys.stderr)
        return 1
    if sucios:
        print("Montado: " + ", ".join(sucios))
    else:
        print("Ya estaba todo montado.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
