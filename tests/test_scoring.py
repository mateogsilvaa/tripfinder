from tripfinder.config import Route
from tripfinder.models import FlightOffer
from tripfinder.scoring import (
    baseline_for,
    is_deal,
    score_offer,
    should_notify,
    weekend_fit,
)


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
    base = {
        "provider": "ryanair", "origin": "MAD", "destination": "FCO",
        "depart_date": "2026-09-11", "return_date": "2026-09-13",  # viernes -> domingo
        "depart_time": "19:05", "return_time": "21:30", "price": 40.0,
    }
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


def test_horas_utiles_descuentan_el_sueno_y_los_vuelos_nocturnos():
    from tripfinder.scoring import useful_hours

    tarde = weekend_offer(nights=2, depart_time="16:30", arrive_time="18:40", return_time="21:30")
    noche = weekend_offer(nights=2, depart_time="21:40", arrive_time="23:55", return_time="07:10")
    assert useful_hours(tarde) > 30
    assert useful_hours(noche) < 20
    # Mismo precio y mismas fechas: gana el que deja más viaje aprovechable.
    assert score_offer(tarde, {}, ROUTE).score > score_offer(noche, {}, ROUTE).score


def test_sin_horario_no_se_inventan_horas():
    from tripfinder.scoring import useful_hours

    # Ensenar "36 h de viaje" sin saber el horario es peor que no ensenar nada:
    # parece un dato y no lo es.
    assert useful_hours(weekend_offer(nights=2, arrive_time="", return_time="")) == 0.0


def test_un_vuelo_que_aterriza_pasada_medianoche_no_regala_un_dia():
    from tripfinder.scoring import useful_hours

    nocturno = weekend_offer(nights=2, depart_time="21:55", arrive_time="00:05", return_time="16:45")
    assert 20 < useful_hours(nocturno) < 30


# -- lo mas barato que se ha visto nunca ----------------------------------
def _serie(dias: int, precio: float = 100.0, desde: int = 0):
    from datetime import date, timedelta

    hoy = date.today()
    return [
        {"d": (hoy - timedelta(days=desde + i)).isoformat(), "p": precio + i}
        for i in range(dias)
    ]


def test_un_precio_por_debajo_de_todo_lo_visto_se_marca():
    from tripfinder.scoring import marcar_minimo

    o = offer(90.0)
    marcar_minimo(o, {"MAD-FCO": _serie(20)})
    assert o.minimo_historico
    assert o.minimo_anterior == 100.0


def test_con_poco_historico_no_se_dice_que_es_un_record():
    """«Nunca ha estado tan barato» con cinco tarifas de dos días no significa
    nada. Hacen falta DIAS_PARA_MINIMO días distintos."""
    from tripfinder.scoring import DIAS_PARA_MINIMO, marcar_minimo

    o = offer(10.0)
    marcar_minimo(o, {"MAD-FCO": _serie(DIAS_PARA_MINIMO - 1)})
    assert not o.minimo_historico


def test_igualar_el_minimo_no_es_un_record():
    """Si no, una ruta parada en su suelo anunciaría un récord cada barrido."""
    from tripfinder.scoring import marcar_minimo

    o = offer(100.0)
    marcar_minimo(o, {"MAD-FCO": _serie(20)})
    assert not o.minimo_historico


def test_lo_de_hoy_tambien_cuenta():
    """El barrido corre dos veces al día: si por la mañana estaba a 50, la tarde
    a 55 no puede anunciarse como el precio más bajo de la historia."""
    from tripfinder.scoring import marcar_minimo

    historia = _serie(20, 100.0)
    historia.append({"d": historia[0]["d"], "p": 50.0})  # el barrido de la mañana
    o = offer(55.0)
    marcar_minimo(o, historia and {"MAD-FCO": historia})
    assert not o.minimo_historico


def test_el_historico_se_compara_por_persona():
    """`price` es el total del grupo y el histórico va por persona. Sin esto una
    búsqueda para dos daba 240 € contra un histórico de 120 y nunca salía ni
    descuento ni mínimo: el sello no significaba nada para quien busca en
    pareja, que es el caso normal."""
    from tripfinder.scoring import marcar_minimo

    dos = offer(180.0)
    dos.adults = 2  # 90 € por persona
    marcar_minimo(dos, {"MAD-FCO": _serie(20)})
    assert dos.minimo_historico

    caro = offer(400.0)
    caro.adults = 2  # 200 € por persona
    marcar_minimo(caro, {"MAD-FCO": _serie(20)})
    assert not caro.minimo_historico


def test_el_descuento_tambien_se_mide_por_persona():
    o = offer(100.0)
    o.adults = 2  # 50 € por persona contra un histórico de 100
    score_offer(o, {"MAD-FCO": _serie(20)}, ROUTE)
    assert o.discount_pct > 40


def test_el_historico_se_graba_por_persona(tmp_path):
    """Lo que se graba tiene que poder compararse con lo grabado ayer."""
    from tripfinder.store import Store

    o = offer(240.0)
    o.adults = 2
    historia = Store(tmp_path).record_prices([o])
    assert historia[o.history_key][-1]["p"] == 120.0
