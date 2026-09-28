"""Los vuelos del Interrail, mirando los días de alrededor y a Wizz.

Solo con Ryanair y solo el día exacto, media ruta salía con «Ryanair no vuela
ese día», y un vuelo que un día antes costaba la mitad no se veía. Ahora el
fichero de cada vuelo guarda, además, el más barato de cada día entre tres
antes y tres después, de Ryanair y de Wizz.
"""

from __future__ import annotations

import json
from datetime import date, timedelta

import pytest

from tripfinder import cli
from tripfinder.providers import ryanair, wizzair

MAÑANA = date.today() + timedelta(days=1)
DIA = date.today() + timedelta(days=40)


def v(**extra):
    base = {
        "id": f"ir-vuelo-MAD-BUD-{DIA.isoformat()}-ida",
        "origen": "MAD",
        "aeropuertos": ["BUD"],
        "fecha": DIA.isoformat(),
        "sentido": "ida",
    }
    return cli.vuelos_interrail(json.dumps([{**base, **extra}]))[0]


def vuelo(precio, linea="Ryanair", origen="MAD", destino="BUD"):
    return {"price": precio, "time": "07:00", "origin": origen, "destination": destino, "airline": linea,
            "deep_link": "https://x.test"}


def test_de_cada_dia_se_queda_el_mas_barato_de_las_dos_companias(monkeypatch):
    d = lambda n: (DIA + timedelta(days=n)).isoformat()  # noqa: E731
    monkeypatch.setattr(ryanair, "precios_por_dia", lambda *a, **k: {d(-1): vuelo(60), d(0): vuelo(80)})
    monkeypatch.setattr(wizzair, "precios_por_dia", lambda *a, **k: {d(0): vuelo(45, "Wizz Air"), d(2): vuelo(30, "Wizz Air")})
    dias = cli.calendario_interrail(v(), cli.load_config(None))
    assert {k: (x["price"], x["airline"]) for k, x in dias.items()} == {
        d(-1): (60, "Ryanair"),
        d(0): (45, "Wizz Air"),
        d(2): (30, "Wizz Air"),
    }


def test_la_vuelta_se_pregunta_desde_la_ciudad_hacia_casa(monkeypatch):
    pedidos = []

    def falso(origen, destino, desde, hasta, *a, **k):
        pedidos.append((origen, destino))
        return {}

    monkeypatch.setattr(ryanair, "precios_por_dia", falso)
    monkeypatch.setattr(wizzair, "precios_por_dia", falso)
    cli.calendario_interrail(
        v(id=f"ir-vuelo-MAD-BUD-{DIA.isoformat()}-vuelta", sentido="vuelta"), cli.load_config(None)
    )
    assert set(pedidos) == {("BUD", "MAD")}


def test_nunca_propone_un_dia_que_ya_ha_pasado(monkeypatch):
    rangos = []
    monkeypatch.setattr(ryanair, "precios_por_dia", lambda o, d, desde, hasta, *a, **k: rangos.append(desde) or {})
    monkeypatch.setattr(wizzair, "precios_por_dia", lambda *a, **k: {})
    cli.calendario_interrail(v(id=f"ir-vuelo-MAD-BUD-{MAÑANA.isoformat()}-ida", fecha=MAÑANA.isoformat()),
                             cli.load_config(None))
    assert rangos and all(r >= MAÑANA for r in rangos)


def test_si_wizz_es_mas_barato_el_dia_exacto_entra_como_opcion(monkeypatch):
    class Nada:
        def search_oneway(self, *a, **k):
            return []

    monkeypatch.setattr(cli, "build_providers", lambda nombres, cfg: [Nada()])
    monkeypatch.setattr(cli, "calendario_interrail", lambda vv, cfg: {DIA.isoformat(): vuelo(39, "Wizz Air")})
    res = cli.buscar_vuelo_interrail(v(), cli.load_config(None))
    assert res["legs"][0]["airline"] == "Wizz Air"
    assert res["legs"][0]["price"] == 39
    assert res["dias"][DIA.isoformat()]["price"] == 39


@pytest.mark.parametrize(
    "crudo,esperado",
    [
        ({"day": "2026-11-05", "price": {"value": 29.99}, "departureDate": "2026-11-05T06:15:00"}, 29.99),
        ({"day": "2026-11-06", "price": None, "unavailable": True}, None),
        ({"day": "2026-11-07", "price": {"value": 40}, "soldOut": True}, None),
    ],
)
def test_el_calendario_de_ryanair_se_lee_bien(monkeypatch, crudo, esperado):
    monkeypatch.setattr(ryanair, "get_json", lambda *a, **k: {"outbound": {"fares": [crudo]}})
    dias = ryanair.precios_por_dia("MAD", "BUD", date(2026, 11, 1), date(2026, 11, 30), 0)
    assert (dias.get(crudo["day"]) or {}).get("price") == esperado
    if esperado:
        assert dias[crudo["day"]]["time"] == "06:15"


def test_el_calendario_de_ryanair_pide_un_mes_por_llamada(monkeypatch):
    meses = []
    monkeypatch.setattr(ryanair, "get_json", lambda url, params=None, **k: meses.append(params["outboundMonthOfDate"]) or {})
    ryanair.precios_por_dia("MAD", "BUD", date(2026, 10, 29), date(2026, 11, 4), 0)
    assert meses == ["2026-10-01", "2026-11-01"]


def test_wizz_no_pregunta_por_rutas_que_no_vuela(monkeypatch):
    monkeypatch.setattr(wizzair, "destinos_desde", lambda origen: ["BUD"])
    llamadas = []
    monkeypatch.setattr(wizzair.WizzairProvider, "_ventana", lambda self, *a: llamadas.append(a) or ({}, {}))
    assert wizzair.precios_por_dia("MAD", "EIN", DIA, DIA) == {}
    assert llamadas == []
