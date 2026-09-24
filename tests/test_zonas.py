"""En qué zona de la ciudad conviene dormir.

EL DATO YA ESTABA. Airbnb devuelve por anuncio un `area` con la forma
«Apartamento en Monastiraki», y el barrio es lo de después del «en». Se
guardaba entero y solo salía como texto suelto de la ficha, así que la pregunta
que de verdad se hace al organizar un viaje —«¿en qué zona me quedo?»— no la
contestaba nadie.

Los casos de aquí salen de `data/stays/*.json`: Monastiraki y Plaka en Atenas,
«Apartamento en Oslo» estando en Oslo, «Marrakech Medina» en Marrakech.
"""

from __future__ import annotations

import pytest

from tripfinder.stays.zonas import MINIMO, barrio, recomendar


def casa(area: str, precio: float, km: float | None = None) -> dict:
    return {"area": area, "price_total": precio, "km_centro": km}


# ------------------------------------------------------------------ el barrio
@pytest.mark.parametrize(
    ("area", "ciudad", "esperado"),
    [
        ("Apartamento en Monastiraki", "Atenas", "Monastiraki"),
        ("Habitación compartida en Kerameikos", "Atenas", "Kerameikos"),
        ("Hotel boutique en Plaka", "Atenas", "Plaka"),
        ("Habitación de hotel en Marrakech Medina", "Marrakech", "Marrakech Medina"),
        ("Apartamento en Centro de la ciudad", "Varsovia", "Centro de la ciudad"),
    ],
)
def test_el_barrio_sale_de_lo_de_despues_del_en(area, ciudad, esperado):
    assert barrio(area, ciudad) == esperado


def test_el_nombre_de_la_ciudad_no_es_un_barrio():
    """«Apartamento en Oslo», estando en Oslo, no dice dónde."""
    assert barrio("Apartamento en Oslo", "Oslo") == ""
    assert barrio("Oslo", "Oslo") == ""
    # Con tilde o sin ella: el scraper escribe «Bérgamo» y el vuelo «Bergamo».
    assert barrio("Apartamento en Bérgamo", "Bergamo") == ""


def test_sin_en_no_hay_barrio():
    """Holidu pone en `area` solo el tipo. Tomarlo por barrio metía la ciudad
    entera en una zona llamada «Apartamento»."""
    assert barrio("Apartamento", "Ámsterdam") == ""
    assert barrio("Alojamiento y desayuno", "Ámsterdam") == ""


def test_un_area_vacia_no_da_barrio():
    assert barrio("", "Atenas") == ""
    assert barrio(None, "Atenas") == ""


# ------------------------------------------------------------- la recomendación
def test_gana_la_que_junta_barato_y_centro():
    """Ni la más barata ni la más céntrica: las dos cosas, que es el mismo
    criterio con el que ya se ordena la lista."""
    stays = [
        # Lejísimos y baratísimo: en una escapada de dos noches, eso es otro viaje.
        casa("Piso en Periferia", 80, 12.0),
        casa("Piso en Periferia", 85, 12.5),
        # Céntrico y no muy caro: esta.
        casa("Piso en Centro", 120, 0.5),
        casa("Piso en Centro", 130, 0.6),
        # Céntrico y carísimo.
        casa("Piso en Lujo", 400, 0.4),
        casa("Piso en Lujo", 420, 0.5),
    ]
    r = recomendar(stays, "Atenas")
    assert r["zona"] == "Centro"
    assert r["de"] == 3
    assert r["cuantos"] == 2
    assert r["desde"] == 120


def test_un_solo_anuncio_no_es_un_barrio():
    """Con uno, lo que se recomienda es ese piso, no la zona."""
    assert recomendar([casa("Piso en Monastiraki", 100, 0.5)], "Atenas") is None
    assert MINIMO == 2


def test_donde_no_hay_zona_no_se_inventa_ninguna():
    """En ciudades pequeñas todos los anuncios dicen el nombre de la ciudad."""
    stays = [casa("Apartamento en Bergamo", 90), casa("Habitación en Bergamo", 70)]
    assert recomendar(stays, "Bergamo") is None


def test_los_enlaces_de_comparador_no_cuentan():
    """No traen precio ni sitio: son enlaces con las fechas puestas."""
    stays = [
        {"area": "Piso en Centro", "price_total": None},
        {"area": "Piso en Centro", "price_total": None},
    ]
    assert recomendar(stays, "Atenas") is None


def test_sin_distancias_sigue_recomendando_por_precio():
    """`km_centro` se sabe a veces: sin ella se decide con lo que hay."""
    stays = [
        casa("Piso en Caro", 300), casa("Piso en Caro", 320),
        casa("Piso en Justo", 120), casa("Piso en Justo", 140),
    ]
    r = recomendar(stays, "Oslo")
    assert r["zona"] == "Justo"
    assert r["km"] is None


def test_dice_con_cuantas_zonas_se_ha_comparado():
    """Una recomendación entre dos barrios no es lo mismo que entre diez, y
    quien la lee tiene derecho a saberlo."""
    stays = [casa("Piso en A", 100, 1.0), casa("Piso en A", 110, 1.1)]
    assert recomendar(stays, "X")["de"] == 1


def test_acepta_objetos_y_diccionarios():
    """El backend le pasa `StayOffer`; un fichero ya guardado, diccionarios."""
    from tripfinder.models import StayOffer

    stays = [
        StayOffer(provider="airbnb", name="a", url="u", area="Piso en Centro",
                  price_total=100, km_centro=0.5),
        StayOffer(provider="airbnb", name="b", url="u", area="Piso en Centro",
                  price_total=110, km_centro=0.6),
    ]
    assert recomendar(stays, "Atenas")["zona"] == "Centro"


def test_una_lista_vacia_no_revienta():
    assert recomendar([], "Atenas") is None
