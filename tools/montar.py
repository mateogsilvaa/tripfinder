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

La version de los assets (el `?v=` y el `build N` del pie) sale de un solo
sitio. En el repo vale "dev"; la de verdad la pone `pages.yml` al publicar:

    python tools/montar.py --version a1b2c3d

Asi no hay que acordarse de subir un numero a mano en doce sitios, y dos
paginas no pueden acabar enseñando builds distintos.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
WEB = RAIZ / "web"
PARTES = WEB / "partes"

# La version de los assets: el `?v=` de los cuatro HTML y el `build N` del pie.
#
# En el repo vale "dev" a proposito. La de verdad la pone `pages.yml` al montar
# el sitio, con el hash corto del commit que se esta publicando —`montar.py
# --version <sha>`—, asi que publicar un cambio de CSS ya no es acordarse de
# subir un numero a mano en doce sitios. Y como sale de un unico sustituto,
# dos paginas no pueden acabar enseñando builds distintos.
#
# "dev" es un valor valido en una query string, asi que abrir los HTML a doble
# clic sigue funcionando igual.
BUILD = "dev"

# Donde se publica el sitio. Solo lo usa la 404: Pages la sirve para CUALQUIER
# ruta que no exista, asi que desde `/tripfinder/lo/que/sea` los enlaces
# relativos apuntarian a `/tripfinder/lo/que/styles.css` y la pagina saldria
# en blanco. Si el repositorio cambia de nombre, se toca aqui.
SITIO = "/tripfinder/"

# El arreglo va condicionado a proposito. Un `<base>` fijo dejaria la 404
# inservible en cualquier sitio que no sea esa ruta exacta: abierta a doble
# clic, en una vista previa local o en un fork con otro nombre, todos los
# enlaces apuntarian a un `/tripfinder/` que ahi no existe. Asi solo se pone
# cuando de verdad estamos colgando de esa raiz y ademas mas hondo que ella,
# que es el unico caso en que los enlaces relativos fallan. Va en un <script>
# ANTES del primer <link>: lo que se inserta ahi afecta a lo que el parser lee
# despues.
ARREGLO_BASE = """<script>
/* Pages sirve esta pagina para cualquier direccion que no exista. Desde una
   ruta honda los enlaces relativos apuntarian al sitio equivocado. */
(function () {
  try {
    // En github.io cuelga de __RAIZ__; con dominio propio, de la raíz.
    var raiz = location.pathname.indexOf("__RAIZ__") === 0 ? "__RAIZ__" : "/";
    var aqui = location.pathname;
    if (aqui.indexOf(raiz) !== 0 || aqui.slice(raiz.length).indexOf("/") < 0) return;
    var b = document.createElement("base");
    b.href = raiz;
    document.head.appendChild(b);
  } catch (e) { /* sin arreglo: la pagina se ve sin estilos, pero se lee */ }
})();
</script>
""".replace("__RAIZ__", SITIO)  # el bloque lleva llaves de JS: nada de format

# Cada zona hace una cosa distinta y la descripcion tiene que decir CUAL. La
# misma frase en las tres no ayuda a nadie: ni al que la lee en un resultado de
# busqueda, ni al que comparte el enlace de "en observacion" —donde no se esta
# mirando lo que ha caido hoy, sino lo que vigilas tu—.
DESCRIPCIONES = {
    "index.html": (
        "Escapadas de fin de semana desde Madrid por debajo de lo que cuesta "
        "habitualmente ese mismo viaje. Se revisa cada doce horas."
    ),
    "buscar.html": (
        "Dile a donde quieres ir y se recorre finde a finde hasta el año que viene, "
        "preguntando a todas las companias y no solo a las low cost."
    ),
    "seguimientos.html": (
        "Los viajes que tienes apuntados, revisados cada manana. Te escribe cuando "
        "el precio se mueve o cae dentro de tu tope."
    ),
    "privacidad.html": (
        "Qué guarda TripFinder de ti, dónde, y qué se ve públicamente. "
        "Sin anuncios ni rastreadores."
    ),
    "condiciones.html": (
        "Las condiciones de uso de TripFinder: qué es, qué no es y qué se pide al usarlo."
    ),
    "planes.html": (
        "Gratis para ver chollos y recibirlos por correo. Premium para buscar, seguir "
        "viajes, alojamiento e Interrail."
    ),
    "interrail.html": (
        "Monta tu Interrail: las ciudades por las que quieres pasar, los trenes, "
        "los vuelos de ida y vuelta y pisos enteros en el centro, con el total."
    ),
}

# La aplicacion instalable (#22). Solo en las tres paginas publicas: instalar el
# panel o la 404 no tiene sentido, y un `scope` que las incluyera haria que el
# service worker se colara donde no pinta nada.
MANIFIESTO = (
    '<link rel="manifest" href="manifest.webmanifest?v={v}">\n'
    '<link rel="apple-touch-icon" href="iconos/apple-touch-icon.png">\n'
    '<meta name="apple-mobile-web-app-title" content="TripFinder">\n'
)

# El punto que late: solo en las paginas publicas, porque es lo que dice que
# los datos son de hoy. En el panel y en la 404 no hay nada que este "en vivo".
# El nav de zonas. Va DENTRO de la barra —en el diseño nuevo es una fila de la
# cabecera pegajosa, no un bloque debajo del titulo— pero no lo llevan todas:
# el panel es una herramienta privada y un "Feed" al lado solo confunde.
#
# Los `{promos}`/`{buscar}`/`{follows}` los rellena `render()` con los atributos
# que devuelve `_zonas`, igual que hace con los guiones y el manifiesto.
# El origen y el cuarto flap: el test de destinos. Las iniciales son
# decoracion —van con `aria-hidden`— y el `?` de al lado es un boton de verdad,
# alcanzable con el tabulador. Solo en las paginas publicas: en el panel y en
# la 404 no hay nada que descubrir.
# Con su icono, una brújula: en el móvil el botón se queda en eso y en «¿Dónde
# ir?», a la misma altura que el tema y la cuenta.
DESCUBRIR = (
    '<button id="tfDescubrir" class="flap flap-boton" type="button"'
    ' aria-label="Descubrir tu destino ideal">'
    '<svg class="barra-ico" viewBox="0 0 24 24" width="16" height="16" fill="none"'
    ' stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'
    ' aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.5"/>'
    '<path d="m15.2 8.8-1.9 4.5-4.5 1.9 1.9-4.5z"/></svg>'
    '<span class="flap-txt flap-txt-largo" aria-hidden="true">Ayúdame a elegir</span>'
    '<span class="flap-txt flap-txt-corto" aria-hidden="true">¿Dónde ir?</span></button>'
)

# Los iconos del nav, dibujados aqui y no sacados de una libreria: cuatro
# trazos a 1.8 que heredan el color del texto. Van con `aria-hidden`: el nombre
# de la zona ya lo dice la palabra de al lado.
ICONOS = {
    "promos": '<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1 1 0 0 1 0 1.4l-7.3 7.3a1 1 0 0 1-1.4 0z"/>'
    '<circle cx="8" cy="8" r="1.4"/>',
    "buscar": '<circle cx="10.8" cy="10.8" r="6.3"/><path d="m20 20-4.6-4.6"/>',
    "follows": '<path d="M6.2 16.5V11a5.8 5.8 0 0 1 11.6 0v5.5l1.4 1.8H4.8z"/>'
    '<path d="M10 20.6a2.1 2.1 0 0 0 4 0"/>',
    "interrail": '<rect x="6" y="3.5" width="12" height="13.5" rx="3.2"/>'
    '<path d="M6 11.2h12M9.3 20.5 8 21.8M14.7 20.5l1.3 1.3"/>'
    '<path d="M9.6 14.3h.01M14.4 14.3h.01" stroke-width="2.4"/>',
}


def _icono(zona: str) -> str:
    return (
        '<svg class="zona-ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"'
        ' stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"'
        f' focusable="false">{ICONOS[zona]}</svg>'
    )


ZONAS_NAV = (
    ("promos", "./", "Chollos"),
    ("buscar", "buscar", "Buscar"),
    ("follows", "seguimientos", "Mis avisos"),
    ("interrail", "interrail", "Interrail"),
)


def _enlaces(sangria: str) -> str:
    return "".join(
        f'{sangria}<a href="{href}"{{{zona}}}>{_icono(zona)}<span>{nombre}</span></a>\n'
        for zona, href, nombre in ZONAS_NAV
    )


NAV = '      <nav class="zonas" aria-label="Zonas">\n' + _enlaces("        ") + "      </nav>\n"

# LA BARRA DE ABAJO, en el movil. Es el mismo nav con otra maquetacion: cuatro
# pestañas al alcance del pulgar, como en una app (y cuando se instala, es una
# app). En escritorio no se ve. Va en el pie y no en la cabecera porque la
# cabecera es pegajosa y un `position: fixed` dentro de ella se coloca contra
# ella, no contra la pantalla.
TABBAR = '<nav class="tabbar" aria-label="Zonas">\n' + _enlaces("  ") + "</nav>\n"

# Antes habia aqui un punto que latia con «en vivo». No decia nada que el pie no
# dijera ya («actualizado …») y era justo el tipo de detalle que hace dudar de si
# esto es una web de verdad: se quito.
VIVO = ""

GUIONES_WEB = (
    '<script src="log.js?v={v}"></script>\n'
    '<script src="auth.js?v={v}"></script>\n'
    '<script src="nube.js?v={v}"></script>\n'
    '<script type="module" src="js/tripfinder.js?v={v}"></script>\n'
)
GUIONES_PANEL = (
    '<script src="log.js?v={v}"></script>\n'
    '<script src="auth.js?v={v}"></script>\n'
    '<script src="nube.js?v={v}"></script>\n'
)
# La 404 no tiene datos que pintar: le basta el tema y el chip de cuenta.
GUIONES_MINIMO = '<script src="log.js?v={v}"></script>\n'

ENLACE_PRIVACIDAD = (
    '  <span class="foot-enlaces"><a class="foot-enlace" href="planes">Planes</a>'
    '<a class="foot-enlace" href="privacidad">Privacidad</a>'
    '<a class="foot-enlace" href="condiciones">Condiciones</a></span>\n'
)

NOTA_404 = (
    '  <span>Los precios vuelan: confirma siempre antes de reservar.</span>\n'
    + ENLACE_PRIVACIDAD
)

NOTA_WEB = (
    '  <span id="frescura">—</span>\n'
    "  <span>Los precios vuelan: confirma siempre antes de reservar.</span>\n"
    + ENLACE_PRIVACIDAD
)
NOTA_PANEL = (
    "  <span>Las contraseñas no se guardan: solo su PBKDF2 con sal, "
    "igual que en el backend.</span>\n"
)

# Lo unico que cambia de una pagina a otra. Todo lo demas es comun y vive en
# `web/partes/`. El nav ya no es una parte suya —va dentro de la barra— asi que
# cambiar una entrada se hace en la constante `NAV` de aqui arriba, y aparece
# de golpe en las cuatro paginas que lo llevan.
PAGINAS = {
    "index.html": {
        "base": "",
        "manifiesto": MANIFIESTO,
        "nav": NAV,
        "descubrir": DESCUBRIR,
        "titulo": "TripFinder · escapadas desde Madrid",
        "meta": f'<meta name="description" content="{DESCRIPCIONES["index.html"]}">',
        "vivo": VIVO,
        "zona": "promos",
        "nota": NOTA_WEB,
        "guiones": GUIONES_WEB,
        "tabbar": TABBAR,
    },
    "buscar.html": {
        "base": "",
        "manifiesto": MANIFIESTO,
        "nav": NAV,
        "descubrir": DESCUBRIR,
        "titulo": "TripFinder · trazar un viaje",
        "meta": f'<meta name="description" content="{DESCRIPCIONES["buscar.html"]}">',
        "vivo": VIVO,
        "zona": "buscar",
        "nota": NOTA_WEB,
        "guiones": GUIONES_WEB,
        "tabbar": TABBAR,
    },
    "seguimientos.html": {
        "base": "",
        "manifiesto": MANIFIESTO,
        "nav": NAV,
        "descubrir": DESCUBRIR,
        "titulo": "TripFinder · vuelos que sigues",
        "meta": f'<meta name="description" content="{DESCRIPCIONES["seguimientos.html"]}">',
        "vivo": VIVO,
        "zona": "follows",
        "nota": NOTA_WEB,
        "guiones": GUIONES_WEB,
        "tabbar": TABBAR,
    },
    # El Interrail: la ruta por Europa en tren, con vuelos y alojamiento.
    "interrail.html": {
        "base": "",
        "manifiesto": MANIFIESTO,
        "nav": NAV,
        "descubrir": DESCUBRIR,
        "titulo": "TripFinder · tu Interrail",
        "meta": f'<meta name="description" content="{DESCRIPCIONES["interrail.html"]}">',
        "vivo": "",
        "zona": "interrail",
        "nota": NOTA_WEB,
        "guiones": GUIONES_WEB,
        "tabbar": TABBAR,
    },
    # Que se guarda de cada persona y que se ve en publico. Lleva el nav, para
    # volver, y no se anuncia como una zona.
    "privacidad.html": {
        "manifiesto": "",
        "nav": NAV,
        "descubrir": "",
        "base": "",
        "titulo": "TripFinder · privacidad",
        "meta": f'<meta name="description" content="{DESCRIPCIONES["privacidad.html"]}">',
        "vivo": "",
        "zona": None,
        "nota": NOTA_404,
        "guiones": GUIONES_MINIMO,
        "tabbar": TABBAR,
    },
    # Las condiciones de uso. Igual que la privacidad: nav para volver y nada más.
    "condiciones.html": {
        "manifiesto": "",
        "nav": NAV,
        "descubrir": "",
        "base": "",
        "titulo": "TripFinder · condiciones de uso",
        "meta": f'<meta name="description" content="{DESCRIPCIONES["condiciones.html"]}">',
        "vivo": "",
        "zona": None,
        "nota": NOTA_404,
        "guiones": GUIONES_MINIMO,
        "tabbar": TABBAR,
    },
    # Lo que trae cada plan. Interfaz: premium todavia no se cobra ni se exige.
    "planes.html": {
        "base": "",
        "manifiesto": MANIFIESTO,
        "nav": NAV,
        "descubrir": "",
        "titulo": "TripFinder · planes",
        "meta": f'<meta name="description" content="{DESCRIPCIONES["planes.html"]}">',
        "vivo": "",
        "zona": None,
        "nota": NOTA_404,
        "guiones": GUIONES_PANEL,
        "tabbar": TABBAR,
    },
    # La pagina que sirve Pages cuando la direccion no existe. Lleva el nav
    # (es lo unico util que puedes hacer desde ahi) pero no las hojas de
    # alojamiento, y no se indexa.
    "404.html": {
        "manifiesto": "",
        "nav": NAV,
        "descubrir": "",
        "base": ARREGLO_BASE,
        "titulo": "TripFinder · fuera de la carta",
        "meta": '<meta name="robots" content="noindex">',
        "vivo": "",
        "zona": None,
        "nota": NOTA_404,
        "guiones": GUIONES_MINIMO,
        "tabbar": "",
    },
    # El panel no es una zona publica: no lleva nav, ni las hojas de
    # alojamiento, ni se indexa.
    "admin.html": {
        "manifiesto": "",
        "nav": "",
        "descubrir": "",
        "base": "",
        "titulo": "TripFinder · panel",
        "meta": '<meta name="robots" content="noindex">',
        "vivo": "",
        "zona": None,
        "nota": NOTA_PANEL,
        "guiones": GUIONES_PANEL,
        "tabbar": "",
    },
}

MARCA = re.compile(
    r"(?P<abre><!-- tf:parte (?P<nombre>[a-z-]+) -->\n)"
    r"(?P<cuerpo>.*?)"
    r"(?P<cierra>\n?<!-- /tf:parte -->)",
    re.DOTALL,
)


def _zonas(activa: str | None, clase: str = "zona") -> dict[str, str]:
    """Los atributos de cada enlace del nav, con el activo marcado.

    Cuatro, y las cuatro son PAGINAS. Antes eran cuatro y dos de ellas
    —"buscar" y "seguir"— apuntaban a sendas anclas de la portada: a la
    herramienta entera solo se llegaba rellenando el formulario compacto y
    enviandolo, porque la pagina completa se abria como resultado de usarla.
    Quien solo queria ver sus busquedas guardadas tenia que lanzar una.

    Tambien fueron cuatro con el mapamundi; se fue, y con el la zona "mundo".
    Luego fue "tren" (de Madrid en tren), que se quito: la cuarta es ahora el
    Interrail."""
    salida: dict[str, str] = {}
    for z in ("promos", "buscar", "follows", "interrail"):
        if z == activa:
            salida[z] = f' class="{clase} activa" data-zona="{z}" aria-current="page"'
        else:
            salida[z] = f' class="{clase}" data-zona="{z}"'
    return salida


def render(nombre_parte: str, datos: dict, version: str = BUILD) -> str:
    """Una parte con sus huecos rellenos. Los huecos son `{{nombre}}`."""
    texto = (PARTES / f"{nombre_parte}.html").read_text(encoding="utf-8").rstrip("\n")
    huecos = {**datos, "v": str(version), **_zonas(datos.get("zona"))}
    # Los dos bloques que llevan la version dentro: se rellenan aparte porque
    # son valores, no partes, y `sustituir` solo mira los huecos de la plantilla.
    for clave in ("guiones", "manifiesto"):
        huecos[clave] = str(huecos.get(clave, "")).format(v=version)
    huecos["nav"] = str(huecos.get("nav", "")).format(**_zonas(datos.get("zona")))
    huecos["tabbar"] = str(huecos.get("tabbar", "")).format(**_zonas(datos.get("zona"), "tab"))

    def sustituir(m: re.Match) -> str:
        clave = m.group(1)
        if clave not in huecos:
            raise SystemExit(f"{nombre_parte}.html pide {{{{{clave}}}}} y nadie lo da")
        return str(huecos[clave])

    # rstrip: el bloque de guiones acaba en salto de linea y la marca de
    # cierre trae el suyo; sin esto cada montaje deja una linea en blanco mas.
    return re.sub(r"\{\{(\w+)\}\}", sustituir, texto).rstrip("\n")


def montar_texto(html: str, datos: dict, version: str = BUILD) -> str:
    def sustituir(m: re.Match) -> str:
        cuerpo = render(m.group("nombre"), datos, version)
        return m.group("abre") + cuerpo + m.group("cierra")

    return MARCA.sub(sustituir, html)


# El `?v=` del HTML solo tapa la puerta de entrada: los `import` de dentro de
# `web/js/` van sin sello, y el navegador puede quedarse con un modulo viejo y
# otro nuevo del mismo despliegue (Pages sirve los assets con max-age=600). Al
# publicar se le pega la misma version a cada import relativo, que es lo que
# antes hacia solo el `app.js?v=`.
IMPORT_RELATIVO = re.compile(r'(from |import )("\./[\w-]+\.js)(")')


# El service worker guarda el armazon en una caja con la version en el nombre.
# Sin sellarla, un despliegue nuevo seguiria sirviendo el CSS del anterior desde
# disco y no habria forma de saberlo desde fuera.
VERSION_SW = re.compile(r'^const VERSION = "[^"]*";', re.MULTILINE)


def sellar_modulos(version: str) -> list[str]:
    """Pone `?v=version` en los import relativos de web/js/ y en la caja del
    service worker. Devuelve los ficheros tocados."""
    tocados = []
    for ruta in sorted((WEB / "js").glob("*.js")):
        antes = ruta.read_text(encoding="utf-8")
        despues = IMPORT_RELATIVO.sub(rf"\1\2?v={version}\3", antes)
        if antes != despues:
            ruta.write_text(despues, encoding="utf-8")
            tocados.append(ruta.name)

    sw = WEB / "sw.js"
    if sw.exists():
        antes = sw.read_text(encoding="utf-8")
        despues = VERSION_SW.sub(f'const VERSION = "{version}";', antes, count=1)
        if antes != despues:
            sw.write_text(despues, encoding="utf-8")
            tocados.append(sw.name)
    return tocados


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--check",
        action="store_true",
        help="no escribe; devuelve 1 si algun HTML no esta montado",
    )
    ap.add_argument(
        "--version",
        default=BUILD,
        help=f"la version de los assets (por defecto {BUILD!r}); la pone pages.yml al publicar",
    )
    args = ap.parse_args()
    if args.check and args.version != BUILD:
        ap.error("--check comprueba lo que hay en el repo, que va con la version 'dev'")

    sucios = []
    for fichero, datos in PAGINAS.items():
        ruta = WEB / fichero
        antes = ruta.read_text(encoding="utf-8")
        despues = montar_texto(antes, datos, args.version)
        if antes == despues:
            continue
        sucios.append(fichero)
        if not args.check:
            ruta.write_text(despues, encoding="utf-8")

    if args.check and sucios:
        print("Sin montar: " + ", ".join(sucios), file=sys.stderr)
        print("Pasa `python tools/montar.py` y vuelve a commitear.", file=sys.stderr)
        return 1
    modulos = [] if args.check or args.version == BUILD else sellar_modulos(args.version)
    if modulos:
        print(f"Sellados {len(modulos)} modulos con la version {args.version}")

    if sucios:
        marca = "" if args.version == BUILD else f" (version {args.version})"
        print("Montado: " + ", ".join(sucios) + marca)
    else:
        print("Ya estaba todo montado.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
