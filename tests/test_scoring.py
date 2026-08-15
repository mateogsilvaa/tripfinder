from tripfinder.config import Route
from tripfinder.models import FlightOffer
from tripfinder.scoring import baseline_for, is_deal, score_offer, should_notify


def offer(price: float = 40.0) -> FlightOffer:
    return FlightOffer(
        provider="ryanair",
        origin="MAD",
        destination="FCO",
        depart_date="2026-09-10",
        return_date="2026-09-14",
        price=price,
    )


ROUTE = Route(origin="MAD", max_price=60, baseline_price=100)


def test_id_es_estable_aunque_cambie_el_precio():
    assert offer(40).id == offer(15).id == "ryanair-MAD-FCO-20260910"


def test_baseline_usa_el_yaml_si_hay_pocas_muestras():
    history = {"MAD-FCO": [{"d": "2026-08-01", "p": 20}] * 3}
    assert baseline_for("MAD-FCO", history, 100) == 100


def test_baseline_usa_la_mediana_con_historico_suficiente():
    history = {"MAD-FCO": [{"d": f"2026-08-0{i}", "p": p} for i, p in enumerate([80, 90, 100, 110, 120])]}
    assert baseline_for("MAD-FCO", history, 999) == 100


def test_score_premia_descuento_y_holgura_de_presupuesto():
    barata = score_offer(offer(30), {}, ROUTE)
    cara = score_offer(offer(58), {}, ROUTE)
    assert barata.score > cara.score
    assert barata.discount_pct == 70.0


def test_no_es_chollo_si_supera_el_presupuesto():
    o = score_offer(offer(75), {}, ROUTE)
    assert not is_deal(o, ROUTE, min_score=0)


def test_no_se_reenvia_el_aviso_si_el_precio_no_baja_lo_suficiente():
    state = {"notified": {"ryanair-MAD-FCO-20260910": {"price": 40.0}}}
    assert not should_notify(offer(38), state, renotify_drop_pct=12)
    assert should_notify(offer(30), state, renotify_drop_pct=12)
    assert should_notify(offer(40), {"notified": {}}, renotify_drop_pct=12)
