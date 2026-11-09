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


# -- también en las búsquedas a mano (y en las del HOP y los encargos) --------
def test_una_busqueda_trae_la_ida_de_una_y_la_vuelta_de_otra(monkeypatch):
    from datetime import date, timedelta

    from tripfinder import search as S
    from tripfinder.config import Config

    ida = date.today() + timedelta(days=20)
    vuelta = ida + timedelta(days=2)

    def oferta(provider, airline, out, back):
        return FlightOffer(
            provider=provider, origin="MAD", destination="BUD", depart_date=ida.isoformat(),
            return_date=vuelta.isoformat(), price=out + back, price_out=out, price_back=back, airline=airline,
        )

    class Ryanair:
        name = "ryanair"

        def _base_params(self, route):
            return {}

        def _paginate(self, params, route, n):
            # Ida barata, vuelta cara.
            yield oferta("ryanair", "Ryanair", 20, 60)

    class Wizz:
        name = "wizzair"

        def buscar_fechas(self, route, destinos, pares):
            # Ida cara, vuelta barata.
            return [oferta("wizzair", "Wizz Air", 55, 25)]

    monkeypatch.setattr(S, "build_providers", lambda *a: [Ryanair(), Wizz()])
    monkeypatch.setattr(S.rutas, "destinos", lambda origen, cfg: {"BUD": ("Budapest", "Hungría")})
    req = S.SearchRequest(destination="Budapest", depart=ida.isoformat(), return_date=vuelta.isoformat(),
                          weekend_only=False)
    cfg = Config(raw={"search": {"google": {"max_queries_search": 0}}, "weekend": {}})
    r = S.run_search(req, cfg, {}, max_queries=1)
    mixta = [o for o in r.offers if o.provider == "mixto"]
    assert len(mixta) == 1
    assert (mixta[0].airline, mixta[0].airline_back, mixta[0].price) == ("Ryanair", "Wizz Air", 45.0)
