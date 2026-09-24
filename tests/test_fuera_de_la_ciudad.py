"""Lo que esta a miles de kilometros no es un alojamiento en esa ciudad.

Visto de verdad el 24 de septiembre: pidiendo «Ámsterdam, Países Bajos»,
Airbnb devolvio dieciocho casas en Brasil y Filipinas, y la mas barata —una
cabaña a 8.800 km— salia la primera con el sello de «el más barato». El
Interrail la habria elegido por defecto como la cama de Ámsterdam.
"""

from __future__ import annotations

from tripfinder.models import StayOffer
from tripfinder.stays import ranking
from tripfinder.stays.base import StayRequest

AMSTERDAM = (52.3731, 4.8925)


def casa(nombre, precio, lat, lon):
    return StayOffer(provider="x", name=nombre, url=f"u/{nombre}", price_total=precio, lat=lat, lon=lon)


def test_lo_de_otro_continente_se_descarta_aunque_sea_lo_mas_barato(monkeypatch):
    monkeypatch.setattr(ranking, "coordenadas", lambda ciudad, pais="": AMSTERDAM)
    req = StayRequest(city="Ámsterdam", iata="AMS", checkin="2026-11-06", checkout="2026-11-08")
    ofertas = [
        casa("Cabaña en El Nido", 107, 11.19, 119.40),  # Filipinas
        casa("Santuario en la selva", 156, -22.28, -42.53),  # Brasil
        casa("Casa flotante", 430, 52.37, 4.90),
        casa("Afueras", 300, 52.30, 4.70),  # ~15 km: sigue siendo Ámsterdam
    ]
    quedan = ranking.ordenar(ofertas, req)
    assert {o.name for o in quedan} == {"Afueras", "Casa flotante"}
    # Y el sello de «el más barato» es para una de verdad.
    assert next(o for o in quedan if o.sello.startswith("el más barato")).name == "Afueras"


def test_sin_coordenadas_no_se_descarta_nada(monkeypatch):
    """Sin saber donde esta, no se puede decir que este lejos."""
    monkeypatch.setattr(ranking, "coordenadas", lambda ciudad, pais="": AMSTERDAM)
    req = StayRequest(city="Ámsterdam", iata="AMS", checkin="2026-11-06", checkout="2026-11-08")
    ofertas = [StayOffer(provider="x", name="sin sitio", url="u", price_total=100)]
    assert [o.name for o in ranking.ordenar(ofertas, req)] == ["sin sitio"]


def test_si_todo_estaba_lejos_quedan_solo_los_enlaces(monkeypatch):
    monkeypatch.setattr(ranking, "coordenadas", lambda ciudad, pais="": AMSTERDAM)
    req = StayRequest(city="Ámsterdam", iata="AMS", checkin="2026-11-06", checkout="2026-11-08")
    enlace = StayOffer(provider="deeplinks", name="Booking", url="b", kind="link")
    quedan = ranking.ordenar([casa("Brasil", 100, -22.3, -42.5), enlace], req)
    assert quedan == [enlace]


def test_no_se_confunde_con_la_nota_de_cercania():
    """Ya habia un LEJOS_KM de 8 km para la nota; el filtro nuevo no lo pisa."""
    assert ranking.LEJOS_KM == 8.0
    assert ranking.FUERA_DE_LA_CIUDAD_KM == 40.0
