"""El tablon entero por origen y la tanda que toca en cada pasada."""

from __future__ import annotations

import json
from datetime import date

from tripfinder.cli import _para_portada, _tanda
from tripfinder.models import FlightOffer
from tripfinder.store import Store


def _o(dest, score=50, via=""):
    return FlightOffer(provider="ryanair", origin="MAD", destination=dest,
                       depart_date="2027-03-05", price=40, score=score, via=via)


def test_tablon_guarda_todo_sin_campos_vacios_y_lleva_indice(tmp_path):
    s = Store(tmp_path)
    s.save_tablon("bcn", "Barcelona", [_o("BGY"), _o("STN")])
    datos = json.loads((tmp_path / "tablon" / "BCN.json").read_text())
    assert datos["count"] == 2
    assert "deep_link_back" not in datos["offers"][0]
    assert [o.destination for o in s.load_tablon("BCN")] == ["BGY", "STN"]
    s.save_tablon("MAD", "Madrid", [_o("BGY")])
    assert [x["iata"] for x in s.tablon_index()] == ["MAD", "BCN"]
    # Volver a guardar uno no lo duplica en el indice.
    s.save_tablon("BCN", "Barcelona", [_o("BGY")])
    assert [x["iata"] for x in s.tablon_index()] == ["MAD", "BCN"]
    assert s.tablon_index()[1]["count"] == 1


def test_la_tanda_gira_y_acaba_pasando_por_todos():
    lista = list("ABCDEFG")
    vistos = set()
    for dia in range(10):
        for hora in (6, 18):
            t = _tanda(lista, 2, date(2027, 1, 1 + dia), hora=hora)
            assert len(t) == 2
            vistos |= set(t)
    assert vistos == set(lista)
    assert _tanda(lista, 9) == lista


def test_portada_lleva_lo_directo_y_la_mejor_escala_de_cada_destino():
    todo = [_o("BGY"), _o("TIA", 60, via="BGY"), _o("TIA", 70, via="STN"), _o("RIX", 10, via="BGY")]
    portada = _para_portada(todo, escalas=1)
    assert [(o.destination, o.via) for o in portada] == [("BGY", ""), ("TIA", "STN")]
