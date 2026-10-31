"""Ida con una compañía y vuelta con otra."""

from __future__ import annotations

from tripfinder.mixtos import mezclar
from tripfinder.models import FlightOffer


def _o(airline, ida, vuelta, d="2027-03-05", r="2027-03-07", dest="BUD", provider=None, **extra):
    return FlightOffer(
        provider=provider or airline.split()[0].lower(), origin="MAD", destination=dest,
        depart_date=d, return_date=r, price=round(ida + vuelta, 2), price_out=ida, price_back=vuelta,
        airline=airline, depart_time="18:00", return_time="20:00", **extra,
    )


def test_ida_de_una_vuelta_de_otra_si_sale_mas_barato():
    ofertas = [_o("Ryanair", 20, 60), _o("Wizz Air", 50, 25)]
    [m] = mezclar(ofertas)
    assert (m.airline, m.airline_back) == ("Ryanair", "Wizz Air")
    assert m.price == 45 and m.provider == "mixto"
    assert "ryanair.com" in m.deep_link and "isReturn=false" in m.deep_link
    assert "wizzair.com" in m.deep_link_back and "/BUD/MAD/" in m.deep_link_back
    assert (m.depart_time, m.return_time) == ("18:00", "20:00")


def test_si_no_ahorra_no_se_publica():
    assert mezclar([_o("Ryanair", 20, 30), _o("Wizz Air", 21, 31)]) == []


def test_cruza_fechas_dentro_de_las_noches():
    ofertas = [_o("Ryanair", 20, 60, r="2027-03-08"), _o("Wizz Air", 50, 25, d="2027-03-04", r="2027-03-07")]
    # Ida de Ryanair el 5 + vuelta de Wizz el 7, y también ida de Wizz el 4 +
    # vuelta de Ryanair el 8: cada una con su fecha.
    por_dia = {m.depart_date: m for m in mezclar(ofertas)}
    m = por_dia["2027-03-05"]
    assert (m.return_date, m.nights, m.price) == ("2027-03-07", 2, 45)


def test_google_y_escalas_no_entran():
    sin_mitades = FlightOffer(provider="google", origin="MAD", destination="BUD",
                              depart_date="2027-03-05", return_date="2027-03-07", price=30, airline="Iberia")
    assert mezclar([sin_mitades, _o("Wizz Air", 50, 25)]) == []
    assert mezclar([_o("Ryanair", 20, 60, via="BGY"), _o("Wizz Air", 50, 25)]) == []
