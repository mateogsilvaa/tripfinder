"""Unos días de la semana, cualquier semana: «salgo un lunes y vuelvo un jueves».

Es la otra forma de no saber la fecha. No importa qué semana, pero sí qué días,
porque son los que uno puede cogerse libres."""

from datetime import date
from itertools import pairwise

import pytest

from tripfinder import search as S
from tripfinder.models import FlightOffer


def req(**kw):
    return S.SearchRequest(destination="ROM", **kw)


def test_el_par_se_lee_y_lo_raro_no_cuenta():
    assert S.dias_de_la_semana("0-3") == (0, 3)
    assert S.dias_de_la_semana(" 4 - 6 ") == (4, 6)
    for raro in ("", "7-1", "lunes-jueves", "0", None):
        assert S.dias_de_la_semana(raro) is None


def test_las_noches_salen_de_los_dias():
    assert req(dias="0-3").nights_min == 3 == req(dias="0-3").nights_max
    # De viernes a lunes, cruzando la semana: tres noches.
    assert req(dias="4-0").nights_min == 3
    # El mismo día de ida y vuelta es una semana entera.
    assert req(dias="2-2").nights_min == 7
    assert req(dias="0-3").weekend_only is False


def test_cada_semana_un_lunes_y_su_jueves(monkeypatch):
    class Hoy(date):
        @classmethod
        def today(cls):
            return date(2026, 10, 24)  # sábado

    monkeypatch.setattr(S, "date", Hoy)
    fechas = S._candidate_trips(req(dias="0-3", months=2), {})
    assert fechas[0] == (date(2026, 10, 26), date(2026, 10, 29))
    assert all(i.weekday() == 0 and v.weekday() == 3 for i, v in fechas)
    assert all((b[0] - a[0]).days == 7 for a, b in pairwise(fechas))
    assert len(fechas) >= 8


def test_dentro_de_una_ventana_tambien(monkeypatch):
    class Hoy(date):
        @classmethod
        def today(cls):
            return date(2026, 10, 24)

    monkeypatch.setattr(S, "date", Hoy)
    fechas = S._candidate_trips(req(dias="0-3", desde="2026-12-01", hasta="2026-12-31"), {})
    assert [i.day for i, _ in fechas] == [7, 14, 21, 28]
    assert all(v <= date(2026, 12, 31) for _, v in fechas)


def test_el_nombre_del_fichero_distingue_los_dias():
    assert req(dias="0-3").slug != req(dias="1-4").slug != req().slug
    assert "dias03" in req(dias="0-3").slug


def test_solo_valen_los_viajes_de_esos_dias():
    def o(ida, vuelta):
        return FlightOffer(provider="google", origin="MAD", destination="FCO",
                           depart_date=ida, return_date=vuelta, price=50)

    assert S._en_sus_dias(o("2026-10-26", "2026-10-29"), (0, 3))
    assert not S._en_sus_dias(o("2026-10-27", "2026-10-29"), (0, 3))
    assert not S._en_sus_dias(o("2026-10-26", ""), (0, 3))


def test_la_linea_de_ordenes_lo_entiende():
    from tripfinder import cli

    args = cli.build_parser().parse_args(["search", "--dest", "Roma", "--dias", "0-3"])
    assert args.dias == "0-3"


@pytest.mark.parametrize("flujo", [".github/workflows/custom-search.yml"])
def test_el_workflow_lo_pasa(flujo):
    from pathlib import Path

    texto = (Path(__file__).parent.parent / flujo).read_text(encoding="utf-8")
    assert "viaje.dias" in texto and '--dias "$DIAS"' in texto
