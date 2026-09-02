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


def test_las_paginas_publicas_llevan_las_hojas_y_el_panel_no():
    """El panel no es una zona publica: ni nav, ni hoja de alojamiento."""
    for fichero, datos in montar.PAGINAS.items():
        html = (WEB / fichero).read_text(encoding="utf-8")
        tiene_nav = "<!-- tf:parte zonas -->" in html
        tiene_hojas = "<!-- tf:parte hojas -->" in html
        assert tiene_nav == bool(datos["zona"]), fichero
        assert tiene_hojas == bool(datos["zona"]), fichero
