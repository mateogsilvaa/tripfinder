"""Las fotos del alojamiento, y el nombre presentable.

LAS FOTOS YA ESTABAN. Airbnb devuelve `contextualPictures`, que es una LISTA, y
el scraper cogía `[0]` y tiraba el resto. Peor todavía: esa única foto se
guardaba en el fichero y el panel no la pintaba en ninguna parte. O sea que se
elegía dónde dormir leyendo una lista de texto mientras las fotos estaban
guardadas al lado.

EL NOMBRE llegaba con espacios colgando y cortado a mitad de palabra por un
`[:120]` a pelo. Los casos de aquí abajo son de `data/stays/*.json`, no
inventados.
"""

from __future__ import annotations

import pytest

from tripfinder.stays.airbnb import MAX_FOTOS, _fotos, _limpiar_nombre


def anuncio(*urls) -> dict:
    return {"contextualPictures": [{"picture": u} for u in urls]}


# ------------------------------------------------------------------ fotos
def test_se_guardan_todas_las_fotos_no_la_primera():
    assert _fotos(anuncio("https://a/1.jpg", "https://a/2.jpg", "https://a/3.jpg")) == [
        "https://a/1.jpg",
        "https://a/2.jpg",
        "https://a/3.jpg",
    ]


def test_no_se_repiten():
    assert _fotos(anuncio("https://a/1.jpg", "https://a/1.jpg")) == ["https://a/1.jpg"]


def test_solo_https():
    """Una foto por http en una página https no la pinta el navegador, y encima
    avisa de contenido mixto."""
    assert _fotos(anuncio("http://a/1.jpg", "https://a/2.jpg")) == ["https://a/2.jpg"]


def test_hay_un_tope():
    """Son hasta dieciocho alojamientos por panel: sin tope, el fichero y la
    conexión se disparan."""
    assert len(_fotos(anuncio(*[f"https://a/{i}.jpg" for i in range(40)]))) == MAX_FOTOS


def test_un_anuncio_raro_no_tumba_el_scraper():
    assert _fotos({}) == []
    assert _fotos({"contextualPictures": None}) == []
    assert _fotos({"contextualPictures": ["no soy un dict", {"picture": ""}, {}]}) == []


# ----------------------------------------------------------------- nombres
@pytest.mark.parametrize(
    ("crudo", "esperado"),
    [
        # Los espacios colgando son de verdad: están en los datos publicados.
        ("Dronningens ", "Dronningens"),
        ("  Gea  ", "Gea"),
        ("Apartamento   con   balcón", "Apartamento con balcón"),
        # Entidades que se colaron sin convertir.
        ("Caba&ntilde;a galardonada &amp; sauna", "Cabaña galardonada & sauna"),
        # Y lo que no hay que tocar.
        ("Connect Studios & Apartments", "Connect Studios & Apartments"),
    ],
)
def test_el_nombre_se_limpia(crudo, esperado):
    assert _limpiar_nombre(crudo) == esperado


def test_un_nombre_larguisimo_se_corta_por_una_palabra_entera():
    """«Apartamento en el centro de Osl» se lee como un error nuestro. Lo es."""
    largo = (
        "Apartamento en el centro de Oslo, a pocos pasos del metro y de la vida "
        "urbana que no se acaba nunca del todo"
    )
    salida = _limpiar_nombre(largo)
    assert salida.endswith("…")
    assert len(salida) <= 92
    # No se corta a mitad de palabra: lo de antes del puntito es una palabra
    # completa del original.
    assert largo.startswith(salida[:-1])
    assert not salida[:-1].endswith(" ")


def test_sin_nombre_se_dice_alojamiento_y_no_se_queda_en_blanco():
    assert _limpiar_nombre("") == "Alojamiento"
    assert _limpiar_nombre("   ") == "Alojamiento"
    assert _limpiar_nombre(None) == "Alojamiento"


def test_un_nombre_corto_se_queda_igual():
    assert _limpiar_nombre("Gea") == "Gea"
