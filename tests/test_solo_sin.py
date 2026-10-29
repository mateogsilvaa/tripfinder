"""Afinar el «donde sea»: solo estos destinos, o todos menos estos.

La web pasa países, regiones y grupos de países a sus aeropuertos; aquí se
mira que la búsqueda ni pregunte por lo que sobra (el presupuesto de Google
es corto) ni lo devuelva aunque Ryanair lo traiga."""

from datetime import date, timedelta

from tripfinder import search as S
from tripfinder.config import Config
from tripfinder.models import FlightOffer


def test_los_codigos_se_leen_pegados_o_con_comas():
    assert S.codigos_iata("OPOLIS") == {"OPO", "LIS"}
    assert S.codigos_iata("opo, lis;FAO") == {"OPO", "LIS", "FAO"}
    assert S.codigos_iata("") == set()
    assert S.codigos_iata("OP") == set()


def test_dos_busquedas_con_filtros_distintos_son_dos_ficheros():
    a = S.SearchRequest(destination="", solo="OPOLIS")
    b = S.SearchRequest(destination="", solo="OPO")
    c = S.SearchRequest(destination="", sin="OPO")
    assert len({a.slug, b.slug, c.slug, S.SearchRequest(destination="").slug}) == 4
    # El orden no importa: es el mismo filtro.
    assert S.SearchRequest(destination="", solo="LIS,OPO").slug == a.slug


class Ryanair:
    name = "ryanair"

    def _base_params(self, route):
        return {}

    def _paginate(self, params, route, n):
        ida = params["outboundDepartureDateFrom"]
        for destino, precio in [("OPO", 40), ("LIS", 50), ("STN", 30), ("RAK", 45)]:
            yield FlightOffer(
                provider="ryanair", origin="MAD", destination=destino, depart_date=ida,
                return_date=params["inboundDepartureDateFrom"], price=precio,
            )


class Google:
    name = "google_flights"

    def __init__(self):
        self.names = {}

    def search(self, route):
        return []


def _buscar(monkeypatch, **extra):
    google = Google()
    monkeypatch.setattr(S, "build_providers", lambda *a: [Ryanair(), google])
    monkeypatch.setattr(
        S.rutas,
        "destinos",
        lambda origen, cfg: {c: (c, "x") for c in ["OPO", "LIS", "STN", "RAK", "BCN"]},
    )
    desde = (date.today() + timedelta(days=10)).isoformat()
    hasta = (date.today() + timedelta(days=12)).isoformat()
    req = S.SearchRequest(destination="", desde=desde, hasta=hasta, weekend_only=False, **extra)
    cfg = Config(raw={"search": {"google": {"max_queries_search": 3}}, "weekend": {}})
    return S.run_search(req, cfg, {}, max_queries=1), google


def test_solo_estos(monkeypatch):
    r, google = _buscar(monkeypatch, solo="OPOLIS")
    assert {o.destination for o in r.offers} == {"OPO", "LIS"}
    assert set(google.names) == {"OPO", "LIS"}


def test_todos_menos_estos(monkeypatch):
    r, google = _buscar(monkeypatch, sin="STN,RAK")
    assert {o.destination for o in r.offers} == {"OPO", "LIS"}
    assert set(google.names) == {"OPO", "LIS", "BCN"}


def test_las_dos_cosas_a_la_vez(monkeypatch):
    r, _ = _buscar(monkeypatch, solo="OPOLISRAK", sin="RAK")
    assert {o.destination for o in r.offers} == {"OPO", "LIS"}
