from tripfinder.config import Route
from tripfinder.models import FlightOffer
from tripfinder.scoring import baseline_for, is_deal, score_offer, should_notify, weekend_fit


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


def weekend_offer(**kw) -> FlightOffer:
    base = dict(
        provider="ryanair", origin="MAD", destination="FCO",
        depart_date="2026-09-11", return_date="2026-09-13",  # viernes -> domingo
        depart_time="19:05", return_time="21:30", price=40.0,
    )
    base.update(kw)
    return FlightOffer(**base)


def test_encaja_la_escapada_de_viernes_tarde_a_domingo_tarde():
    assert weekend_fit(weekend_offer(), None)


def test_no_encaja_si_sale_por_la_manana():
    assert not weekend_fit(weekend_offer(depart_time="08:10"), None)


def test_no_encaja_si_vuelve_otro_dia():
    assert not weekend_fit(weekend_offer(return_date="2026-09-14"), None)


def test_sin_hora_basta_con_que_cuadren_los_dias():
    assert weekend_fit(weekend_offer(depart_time="", return_time=""), None)


def test_el_finde_suma_puntos_y_marca_la_oferta():
    finde = score_offer(weekend_offer(), {}, ROUTE, {"bonus": 18})
    entre_semana = score_offer(weekend_offer(depart_date="2026-09-08", return_date="2026-09-10"), {}, ROUTE, {"bonus": 18})
    assert finde.weekend and not entre_semana.weekend
    assert finde.score == entre_semana.score + 18


def test_mode_only_descarta_lo_que_no_es_finde():
    entre_semana = score_offer(weekend_offer(depart_date="2026-09-08", return_date="2026-09-10"), {}, ROUTE)
    assert is_deal(entre_semana, ROUTE, 0, weekend_mode="prefer")
    assert not is_deal(entre_semana, ROUTE, 0, weekend_mode="only")


def test_no_encaja_si_sale_de_madrugada_aunque_sea_viernes():
    assert not weekend_fit(weekend_offer(depart_time="23:40"), None)
