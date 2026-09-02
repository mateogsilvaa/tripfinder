"""Que la cabecera siga siendo una sola.

La cabecera, el nav, las hojas de alojamiento y el pie viven una vez en
`web/partes/` y `tools/montar.py` los escribe dentro de los cuatro HTML. Si
alguien edita una region a mano en vez de tocar la parte, esto lo caza antes
de que se publiquen cuatro cabeceras distintas —que es justo lo que paso con
el `build 27` del panel mientras las otras tres iban por la 28.
"""

import importlib.util
import re
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
WEB = RAIZ / "web"

_spec = importlib.util.spec_from_file_location("montar", RAIZ / "tools" / "montar.py")
montar = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(montar)


@pytest.mark.parametrize("fichero", sorted(montar.PAGINAS))
def test_el_html_esta_montado(fichero):
    """Lo que hay en el repo es lo que sale de montar. Sin excepciones."""
    datos = montar.PAGINAS[fichero]
    antes = (WEB / fichero).read_text(encoding="utf-8")
    assert antes == montar.montar_texto(antes, datos), (
        f"{fichero} tiene una region editada a mano. "
        "Pasa `python tools/montar.py` y vuelve a commitear."
    )


@pytest.mark.parametrize("fichero", sorted(montar.PAGINAS))
def test_las_marcas_cierran(fichero):
    """Una marca sin cerrar se traga silenciosamente el resto de la pagina."""
    html = (WEB / fichero).read_text(encoding="utf-8")
    abre = len(re.findall(r"<!-- tf:parte [a-z-]+ -->", html))
    cierra = html.count("<!-- /tf:parte -->")
    assert abre == cierra, f"{fichero}: {abre} marcas abiertas y {cierra} cerradas"
    assert abre > 0, f"{fichero} no tiene ninguna parte montada"


def test_una_sola_edicion_cambia_el_nav_de_las_tres_zonas():
    """El criterio de aceptacion, comprobado: se toca la parte, no las paginas."""
    zonas = (WEB / "partes" / "zonas.html").read_text(encoding="utf-8")
    tocada = zonas.replace("en observación", "lo que sigues")

    publicas = [f for f, d in montar.PAGINAS.items() if d["zona"]]
    assert len(publicas) == 3

    original = (WEB / "partes" / "zonas.html")
    try:
        original.write_text(tocada, encoding="utf-8")
        for fichero in publicas:
            html = (WEB / fichero).read_text(encoding="utf-8")
            assert "lo que sigues" in montar.montar_texto(html, montar.PAGINAS[fichero])
    finally:
        original.write_text(zonas, encoding="utf-8")


def test_la_version_de_los_assets_sale_de_un_solo_sitio():
    """El `?v=` y el `build N` del pie no pueden desincronizarse nunca mas."""
    for fichero in montar.PAGINAS:
        html = (WEB / fichero).read_text(encoding="utf-8")
        versiones = set(re.findall(r"\.(?:css|js)\?v=(\d+)", html))
        assert versiones == {str(montar.BUILD)}, f"{fichero}: {versiones}"
        assert f"build {montar.BUILD}" in html, f"{fichero}: el pie va por otra version"


# Que lleva cada pagina. El panel no es una zona publica; la 404 si enseña el
# nav (es lo unico util que puedes hacer desde ahi) pero no busca alojamiento.
LLEVAN = {
    "index.html": {"nav": True, "hojas": True},
    "buscar.html": {"nav": True, "hojas": True},
    "seguimientos.html": {"nav": True, "hojas": True},
    "404.html": {"nav": True, "hojas": False},
    "admin.html": {"nav": False, "hojas": False},
}


@pytest.mark.parametrize("fichero", sorted(LLEVAN))
def test_cada_pagina_lleva_lo_suyo(fichero):
    html = (WEB / fichero).read_text(encoding="utf-8")
    assert ("<!-- tf:parte zonas -->" in html) == LLEVAN[fichero]["nav"], fichero
    assert ("<!-- tf:parte hojas -->" in html) == LLEVAN[fichero]["hojas"], fichero


def test_no_hay_paginas_sin_declarar():
    """Una pagina nueva sin entrada en LLEVAN se cuela sin comprobar nada."""
    assert set(LLEVAN) == set(montar.PAGINAS)


def test_solo_la_404_arregla_la_raiz():
    """Pages sirve la 404 para cualquier direccion; desde una ruta honda los
    enlaces relativos apuntarian al sitio equivocado. Ninguna otra pagina lo
    necesita, y ponerselo les cambiaria las rutas sin motivo."""
    for fichero in montar.PAGINAS:
        html = (WEB / fichero).read_text(encoding="utf-8")
        assert ('createElement("base")' in html) == (fichero == "404.html"), fichero


def test_el_arreglo_de_la_404_va_antes_de_los_enlaces():
    """Un <base> insertado despues del <link> no le aplica: no arregla nada."""
    html = (WEB / "404.html").read_text(encoding="utf-8")
    assert html.index('createElement("base")') < html.index("<link ")


def test_la_404_no_se_rompe_fuera_de_su_raiz():
    """La condicion es lo que la deja abrible a doble clic y en un fork con
    otro nombre: sin ella, un <base> fijo mandaria todos los enlaces a un
    /tripfinder/ que ahi no existe."""
    html = (WEB / "404.html").read_text(encoding="utf-8")
    assert 'aqui.indexOf(raiz) !== 0' in html
    # Y los enlaces del documento siguen siendo relativos, no absolutos.
    assert 'href="styles.css' in html
    assert f'href="{montar.SITIO}styles.css' not in html
