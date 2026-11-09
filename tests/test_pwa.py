"""La aplicación instalable y las ofertas en frío (#22).

Lo que más importa aquí no es que funcione sin red: es que **no mienta** cuando
funciona sin red. Un service worker que sirve la tanda de anteayer con el mismo
aspecto que la de esta mañana es peor que no tener service worker.
"""

import json
import re
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
WEB = RAIZ / "web"
SW = (WEB / "sw.js").read_text(encoding="utf-8")
MANIFIESTO = json.loads((WEB / "manifest.webmanifest").read_text(encoding="utf-8"))


# ------------------------------------------------------------------ manifiesto
def test_el_manifiesto_lleva_lo_que_pide_un_instalable():
    for clave in ("name", "short_name", "start_url", "display", "icons", "theme_color"):
        assert MANIFIESTO.get(clave), clave
    assert MANIFIESTO["display"] == "standalone"


@pytest.mark.parametrize("icono", MANIFIESTO["icons"], ids=lambda i: i["src"])
def test_los_iconos_del_manifiesto_existen(icono):
    """Un icono que da 404 no rompe la web, pero deja la instalación sin icono
    y no lo dice: el navegador se lo calla."""
    assert (WEB / icono["src"]).exists(), icono["src"]


def test_hay_un_icono_recortable():
    """Sin `maskable`, Android recorta el icono con la forma que le da la gana y
    se come el marco de la carta."""
    assert any("maskable" in i.get("purpose", "") for i in MANIFIESTO["icons"])


def test_los_iconos_se_regeneran_igual():
    """Salen de `tools/iconos.py`, no de un editor: si la paleta cambia, se
    regeneran, y esto avisa si alguien los tocó a mano."""
    import subprocess
    import sys

    r = subprocess.run(
        [sys.executable, str(RAIZ / "tools" / "iconos.py"), "--check"],
        capture_output=True, text=True,
    )
    assert r.returncode == 0, r.stderr


def test_safari_tiene_su_icono():
    """Safari no lee el manifest para la pantalla de inicio: quiere su link."""
    assert (WEB / "iconos" / "apple-touch-icon.png").exists()
    assert 'rel="apple-touch-icon"' in (WEB / "index.html").read_text(encoding="utf-8")


# ------------------------------------------------------- donde se instala y donde no
def test_solo_las_paginas_publicas_son_instalables():
    """El panel escribe en el repo con un token y la 404 no es un sitio: ni uno
    ni otro ganan nada con una copia en disco, y un `scope` que los incluyera
    metería al service worker donde no pinta nada."""
    for pagina in ("index.html", "buscar.html", "seguimientos.html"):
        assert 'rel="manifest"' in (WEB / pagina).read_text(encoding="utf-8"), pagina
    for pagina in ("404.html", "admin.html"):
        assert 'rel="manifest"' not in (WEB / pagina).read_text(encoding="utf-8"), pagina


def test_el_registro_solo_va_donde_hay_manifiesto():
    log = (WEB / "log.js").read_text(encoding="utf-8")
    assert 'document.querySelector(\'link[rel="manifest"]\')' in log
    assert "window.isSecureContext" in log


# ------------------------------------------------------------- el service worker
def test_los_datos_van_a_la_red_primero():
    """El criterio que decide si esto vale o no: con red, gana la red."""
    # El bloque de datos hace `fetch` antes de mirar la caché.
    bloque = SW[SW.index("if (esDato)") : SW.index("// El armazón")]
    assert bloque.index("await fetch(req)") < bloque.index("caches.match")


def test_lo_servido_de_la_caja_va_marcado():
    """Se ve claramente cuándo lo que se está viendo es de la caché: el worker
    mete una cabecera, `fetchJSON` la lee y el pie lo dice."""
    assert 'cabeceras.set("X-TF-Cache", "1")' in SW
    assert 'r.headers.get("X-TF-Cache")' in (WEB / "js" / "base.js").read_text(encoding="utf-8")
    # El renglón del pie vive en su propio módulo (`frescura.js`).
    frescura = (WEB / "js" / "frescura.js").read_text(encoding="utf-8")
    assert "sin conexión" in frescura


def test_solo_se_marca_lo_que_de_verdad_sale_de_la_caja():
    """`marcada()` solo se usa cuando lo servido viene de la caja PORQUE falla
    la red: con red de sobra se serviría 'sin conexión' y nadie lo creería.
    Hay dos caminos: la red caída al pedir, y lo viejo sin línea."""
    assert SW.count("return marcada(") == 2
    respaldo = SW[SW.index("} catch (err) {") : SW.index("// El armazón")]
    assert "return marcada(guardado)" in respaldo
    # Lo viejo solo se marca si el navegador sabe que no hay línea.
    assert "onLine === false" in SW


def test_lo_del_barrido_se_sirve_ya_y_se_actualiza_detras():
    """Los datos del barrido cambian dos veces al día: no hace falta ir a la red
    en cada página. Lo guardado se sirve al momento, y si es viejo se vuelve a
    pedir detrás; lo de cada cuenta va a la red."""
    assert "VIDA = 15 * 60 * 1000" in SW
    assert "ev.waitUntil(pedir()" in SW
    assert "datos-nuevos" in SW
    for de_cuenta in ("searches", "watch", "stays", "users"):
        assert not any(de_cuenta in linea for linea in SW[SW.index("const DEL_BARRIDO") : SW.index("const vidaDe")].splitlines())
    # Y lo pedido con `fresco` (no-store) nunca sale de la caja.
    assert 'req.cache === "no-store"' in SW


def test_el_cache_buster_no_se_usa_como_clave():
    """`fetchJSON` manda `?t=<ahora>`: guardarlo con eso dentro haría una entrada
    nueva por petición y no se encontraría nunca la anterior."""
    assert "sinReloj" in SW
    assert "u.search = \"\"" in SW
    assert "cache.put(clave, await conHora(" in SW
    assert "const clave = sinReloj(req.url)" in SW


def test_no_se_guarda_nada_de_la_api_de_github():
    """Son escrituras con un token de por medio: guardarlas en disco sería
    regalarlo."""
    assert "url.origin !== self.location.origin" in SW
    assert "return;" in SW[SW.index("url.origin !== self.location.origin") :][:80]


def test_solo_se_cachean_peticiones_get():
    """Un POST cacheado es un dispatch que se repite solo."""
    assert 'req.method !== "GET"' in SW


def test_el_armazon_lleva_todos_los_modulos():
    """Si un módulo no está en la lista, la web abre sin red y se queda a
    medias: sin errores, sin datos y sin explicación."""
    en_sw = set(re.findall(r'"\./js/([\w-]+\.js)"', SW))
    en_disco = {p.name for p in (WEB / "js").glob("*.js")}
    assert en_disco - en_sw == set(), f"sin cachear: {sorted(en_disco - en_sw)}"


def test_la_caja_lleva_la_version_en_el_nombre():
    """Y `montar.py --version` la sella: sin eso, un despliegue nuevo seguiría
    sirviendo el CSS del anterior desde disco."""
    assert re.search(r'^const VERSION = "[^"]*";', SW, re.MULTILINE)
    assert "tf-armazon-${VERSION}" in SW
    montar = (RAIZ / "tools" / "montar.py").read_text(encoding="utf-8")
    assert "VERSION_SW" in montar


def test_las_cajas_viejas_se_borran_al_activar():
    """Sin esto, cada despliegue deja una copia entera del sitio en el móvil."""
    assert "caches.keys()" in SW and "caches.delete" in SW


def test_una_pieza_que_falta_no_deja_al_movil_sin_cache():
    """`addAll` es todo o nada: un fichero renombrado dejaría la instalación
    entera sin caché y sin avisar."""
    assert "cache.addAll(" not in SW
    assert "cache.add(" in SW and ".catch(() => {})" in SW
