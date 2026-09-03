"""Lo que se rompio una vez y no puede volver a romperse sin avisar.

Tres cosas concretas, todas salidas de fallos reales:

* El enlace de Wizz Air con parametros abre la pagina de reserva **sin la
  ruta**: el usuario ve un formulario vacio y parece que el boton no lleva a
  ningun sitio. Solo vale el formato por path.
* El precio no dice a cuanta gente cubre, y "240 EUR" tanto puede ser lo que
  pagas tu como lo que pagais los cuatro.
* Dos busquedas distintas generaban el mismo nombre de fichero y la segunda
  borraba a la primera.
"""

from tripfinder.config import Route
from tripfinder.models import FlightOffer
from tripfinder.providers import links
from tripfinder.providers.ryanair import RyanairProvider
from tripfinder.search import SearchRequest


# --------------------------------------------------------------- enlaces
def test_wizz_va_por_path_y_no_por_parametros():
    url = links.wizzair("MAD", "OTP", "2026-11-06", "2026-11-09", 2)
    assert url.endswith("/booking/select-flight/MAD/OTP/2026-11-06/2026-11-09/2/0/0/null")
    # El formato viejo es justo el que dejaba la reserva en blanco.
    assert "departureStation=" not in url and "?" not in url


def test_wizz_solo_ida_manda_null_en_la_vuelta():
    url = links.wizzair("MAD", "OTP", "2026-11-06", "", 1)
    assert url.endswith("/MAD/OTP/2026-11-06/null/1/0/0/null")


def test_los_enlaces_llevan_a_toda_la_gente_que_viaja():
    # Reservar para uno un precio de cuatro es el clasico chasco al pulsar.
    assert "adults=4" in links.ryanair("MAD", "BGY", "2026-11-06", "2026-11-09", 4)
    assert "/4/0/0/null" in links.wizzair("MAD", "OTP", "2026-11-06", "2026-11-09", 4)


def test_easyjet_apunta_a_su_pagina_de_ruta():
    # Su buscador rechaza a los scripts, pero la pagina de ruta por IATA si abre.
    assert links.easyjet("MAD", "BSL") == "https://www.easyjet.com/es/vuelos-baratos/MAD/BSL"


def test_la_aerolinea_se_reconoce_escrita_como_sea():
    for nombre in ("easyJet", "EASYJET", "easy jet"):
        url, etiqueta = links.por_aerolinea(nombre, "MAD", "BSL", "2026-11-06", "2026-11-09", 2)
        assert "easyjet.com" in url and etiqueta == "easyJet"


def test_una_aerolinea_desconocida_no_inventa_enlace():
    assert links.por_aerolinea("Tarom", "MAD", "OTP", "2026-11-06") == ("", "")


# --------------------------------------------------------------- precios
def _oferta(**extra):
    base = {"provider": "google", "origin": "MAD", "destination": "OTP",
            "depart_date": "2026-11-06", "price": 240.0}
    base.update(extra)
    return FlightOffer(**base)


def test_el_precio_dice_a_cuanta_gente_cubre():
    assert _oferta(adults=4).price_per_person == 60.0
    assert _oferta().adults == 1  # por defecto, una persona


def test_el_por_persona_viaja_en_el_json_que_lee_la_web():
    d = _oferta(adults=2).to_dict()
    assert d["adults"] == 2 and d["price_per_person"] == 120.0


def test_ryanair_marca_para_cuantos_es_la_tarifa():
    fare = {
        "outbound": {
            "departureAirport": {"iataCode": "MAD"},
            "arrivalAirport": {"iataCode": "FCO", "city": {"name": "Roma"}},
            "departureDate": "2026-09-10T06:35:00",
        },
        "summary": {"price": {"value": 160.0, "currencyCode": "EUR"}},
    }
    o = RyanairProvider._parse(fare, Route(origin="MAD"), "EUR", 4)
    assert o is not None
    assert o.adults == 4 and o.price_per_person == 40.0
    assert "adults=4" in o.deep_link


# --------------------------------------------------------------- busquedas
def test_dos_busquedas_distintas_no_se_pisan():
    """Mismo destino y presupuesto pero otras fechas: otro fichero."""
    noviembre = SearchRequest(destination="", max_price=300, depart="2026-11-06",
                              return_date="2026-11-09", adults=2)
    diciembre = SearchRequest(destination="", max_price=300, depart="2026-12-20",
                              return_date="2026-12-23", adults=2)
    assert noviembre.slug != diciembre.slug


def test_el_numero_de_viajeros_tambien_hace_una_busqueda_distinta():
    dos = SearchRequest(destination="FCO", max_price=120, adults=2)
    cuatro = SearchRequest(destination="FCO", max_price=120, adults=4)
    assert dos.slug != cuatro.slug


def test_el_horizonte_y_el_tipo_de_barrido_distinguen_la_busqueda():
    findes = SearchRequest(destination="FCO", max_price=120, months=12, weekend_only=True)
    cualquiera = SearchRequest(destination="FCO", max_price=120, months=12, weekend_only=False)
    seis_meses = SearchRequest(destination="FCO", max_price=120, months=6, weekend_only=True)
    assert len({findes.slug, cualquiera.slug, seis_meses.slug}) == 3


def test_el_slug_sigue_siendo_un_nombre_de_fichero_valido():
    s = SearchRequest(destination="Nueva York", max_price=450, depart="2027-01-02").slug
    assert s.islower()
    assert all(c.isalnum() or c == "-" for c in s)
