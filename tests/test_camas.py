"""Cómo se ordenan las camas: precio Y cercanía, no solo precio.

Antes la lista salía por precio a secas, y con eso el primero podía ser un
estudio a doce kilómetros del centro y el segundo, por diez euros más, estar en
la plaza mayor. En una escapada de dos noches eso son dos horas de transporte
cada día y el precio de los billetes, que no sale en la ficha.
"""

from __future__ import annotations

import pytest

from tripfinder.models import StayOffer
from tripfinder.stays.base import StayRequest
from tripfinder.stays.centro import km_entre
from tripfinder.stays.ranking import a_pie, ordenar

REQ = StayRequest(city="Roma", iata="FCO", checkin="2026-11-13", checkout="2026-11-15", country="Italia")


def cama(nombre: str, precio: float | None, km: float | None = None, tipo: str = "stay") -> StayOffer:
    return StayOffer(
        provider="airbnb", name=nombre, url="https://x", kind=tipo,
        price_total=precio, price_per_night=precio and precio / 2, km_centro=km,
    )


def test_lo_centrico_gana_a_lo_barato_y_lejos():
    """Un sitio barato y lejos no es más barato: es otro viaje."""
    lista = ordenar([cama("lejos", 100, 12), cama("centro", 120, 0.8)], REQ)
    assert [c.name for c in lista] == ["centro", "lejos"]


def test_pero_el_precio_sigue_pesando_mas():
    """Cerca no justifica cualquier precio: 65 % precio, 35 % centro."""
    lista = ordenar([cama("carísimo y céntrico", 400, 0.2), cama("normal", 120, 2.5)], REQ)
    assert lista[0].name == "normal"


def test_sin_coordenadas_se_ordena_por_precio_como_antes():
    lista = ordenar([cama("cara", 200), cama("barata", 90)], REQ)
    assert [c.name for c in lista] == ["barata", "cara"]


def test_una_cama_sin_coordenadas_no_se_castiga():
    """Que no sepamos dónde cae es un fallo nuestro de lectura, no un defecto
    suyo: se le da la nota de la mediana, no la peor."""
    lista = ordenar(
        [cama("sin sitio", 100), cama("centro", 130, 0.5), cama("lejos", 135, 9)], REQ
    )
    assert lista[0].name == "sin sitio"


def test_los_enlaces_sin_precio_van_al_final():
    lista = ordenar([cama("Buscar en Booking", None), cama("piso", 120, 1)], REQ)
    assert lista[0].name == "piso"
    assert lista[-1].name == "Buscar en Booking"


# -- los sellos ------------------------------------------------------------
def test_el_mas_barato_lleva_su_sello():
    lista = ordenar([cama("a", 100, 5), cama("b", 200, 1)], REQ)
    assert next(c for c in lista if c.name == "a").sello == "el más barato"


def test_barato_y_centrico_a_la_vez_se_dice_entero():
    """Dos sellos en la misma cama serían dos motivos y ninguno visible."""
    lista = ordenar([cama("la buena", 100, 0.4), cama("otra", 200, 5)], REQ)
    assert lista[0].sello == "el más barato, y el más céntrico"


def test_un_hotel_se_marca_como_hotel():
    lista = ordenar([cama("piso", 100, 1), cama("hotel", 140, 3, tipo="hotel")], REQ)
    assert next(c for c in lista if c.name == "hotel").sello == "hotel"


def test_no_hay_dos_mas_baratos():
    lista = ordenar([cama("a", 100, 1), cama("b", 100, 2), cama("c", 150, 3)], REQ)
    assert sum(1 for c in lista if "más barato" in c.sello) == 1


# -- la distancia ----------------------------------------------------------
def test_cerca_se_dice_en_minutos_andando():
    assert a_pie(0.8) == "a 10 min andando del centro"


def test_lejos_se_dice_en_kilometros():
    """Doce kilómetros no son «150 minutos andando»: son un taxi."""
    assert a_pie(12.0) == "a 12,0 km del centro"


def test_sin_distancia_no_se_dice_nada():
    assert a_pie(None) == ""


@pytest.mark.parametrize(
    "a, b, esperado",
    [
        ((41.8933, 12.4829), (41.8933, 12.4829), 0.0),   # el mismo sitio
        ((41.8933, 12.4829), (41.7994, 12.5949), 14.0),  # Roma centro -> Ciampino
    ],
)
def test_la_distancia_es_la_de_verdad(a, b, esperado):
    assert km_entre(a, b) == pytest.approx(esperado, abs=0.6)


def test_el_centro_no_se_pide_si_no_hay_ni_una_coordenada(monkeypatch):
    """Nominatim es gratis y lo paga alguien: no se le pregunta por gusto."""
    from tripfinder.stays import ranking

    llamadas = []
    monkeypatch.setattr(ranking, "coordenadas", lambda *a: llamadas.append(a))
    ordenar([cama("a", 100), cama("b", 120)], REQ)
    assert llamadas == []
