"""Tests de parseo: fijan el contrato con las respuestas de cada API."""

from tripfinder.config import Route
from tripfinder.providers.ryanair import RyanairProvider
from tripfinder.stays.base import StayRequest
from tripfinder.stays.deeplinks import DeepLinksProvider

FARE = {
    "outbound": {
        "departureAirport": {"iataCode": "MAD", "city": {"name": "Madrid"}},
        "arrivalAirport": {
            "iataCode": "FCO",
            "city": {"name": "Roma"},
            "country": {"name": "Italia"},
        },
        "departureDate": "2026-09-10T06:35:00",
        "price": {"value": 18.99, "currencyCode": "EUR"},
    },
    "inbound": {
        "departureDate": "2026-09-14T21:10:00",
        "price": {"value": 21.0, "currencyCode": "EUR"},
    },
    "summary": {"price": {"value": 39.99, "currencyCode": "EUR"}},
}


def test_ryanair_parsea_una_tarifa_de_ida_y_vuelta():
    o = RyanairProvider._parse(FARE, Route(origin="MAD", origin_name="Madrid"), "EUR")
    assert o is not None
    assert (o.origin, o.destination) == ("MAD", "FCO")
    assert o.destination_name == "Roma"
    assert o.price == 39.99
    assert o.depart_date == "2026-09-10"
    assert o.return_date == "2026-09-14"
    assert o.nights == 4
    assert "originIata=MAD" in o.deep_link and "isReturn=true" in o.deep_link


def test_ryanair_descarta_tarifas_incompletas():
    assert RyanairProvider._parse({"outbound": {}}, Route(origin="MAD"), "EUR") is None


def test_ryanair_suma_los_tramos_si_falta_el_total():
    fare = {**FARE, "summary": {}}
    o = RyanairProvider._parse(fare, Route(origin="MAD"), "EUR")
    assert o.price == 39.99


def test_deeplinks_siempre_devuelve_enlaces_con_las_fechas():
    req = StayRequest(city="Roma", iata="FCO", checkin="2026-09-10", checkout="2026-09-14")
    stays = DeepLinksProvider().search(req)
    assert req.nights == 4
    assert len(stays) >= 4
    assert all(s.kind == "link" for s in stays)
    assert any("booking.com" in s.url for s in stays)
    assert all("2026-09-10" in s.url or "checkin_monthday=10" in s.url for s in stays)
