"""Buscar desde un sitio que no sea Madrid.

Todo el proyecto daba Madrid por hecho: `Route(origin="MAD")`, el `origin` de
`config/watchlist.yml` y un `origin_name="Madrid"` escrito a pelo. Quien vive
en Barcelona o vuela desde Sevilla no podía usar la web.

Lo que se prueba aquí es lo que hace que dos búsquedas desde sitios distintos
no se pisen, y que un origen que llega de fuera no acabe donde no debe: el
`origin` viene de un `client_payload` y termina siendo parte de un nombre de
fichero.
"""

from __future__ import annotations

import pytest

from tripfinder.search import SearchRequest


def pedir(**kw) -> SearchRequest:
    base = {"destination": "", "max_price": 150}
    base.update(kw)
    return SearchRequest(**base)


# ------------------------------------------------------------- normalizar
@pytest.mark.parametrize(
    ("dado", "esperado"),
    [("BCN", "BCN"), ("bcn", "BCN"), (" agp ", "AGP"), ("Mad", "MAD")],
)
def test_un_origen_valido_se_queda_en_mayusculas(dado, esperado):
    assert pedir(origin=dado).origin == esperado


@pytest.mark.parametrize("malo", ["", "XXXX", "ES", "../etc/passwd", "MA D", None, "12"])
def test_lo_que_no_es_un_aeropuerto_vuelve_a_madrid(malo):
    """Y no revienta la búsqueda: quien la pidió prefiere un resultado desde
    Madrid a un workflow en rojo y ninguna explicación."""
    assert pedir(origin=malo).origin == "MAD"


def test_sin_decir_nada_se_sale_de_madrid():
    assert pedir().origin == "MAD"


# ----------------------------------------------------------------- el fichero
def test_dos_origenes_son_dos_busquedas():
    """Lo mismo desde Madrid y desde Barcelona no puede dar el mismo fichero:
    el segundo pisaría al primero y uno de los dos vería el viaje del otro."""
    assert pedir(origin="MAD").slug != pedir(origin="BCN").slug


def test_el_origen_va_delante_en_el_nombre():
    assert pedir(origin="BCN").slug.startswith("bcn-")


def test_un_origen_de_pega_no_se_cuela_en_el_nombre():
    """La razón de normalizar ANTES del slug: `../` en un nombre de fichero."""
    slug = pedir(origin="../../data/users").slug
    assert "/" not in slug and ".." not in slug
    assert slug.startswith("mad-")


def test_el_origen_viaja_en_lo_que_se_guarda():
    """La web lee `request` para volver a pintar lo que se pidió."""
    assert pedir(origin="AGP").to_dict()["origin"] == "AGP"
