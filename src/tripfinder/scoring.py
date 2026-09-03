"""Decide que es un chollo.

score = 70 * (descuento vs. baseline)  +  30 * (holgura respecto al presupuesto)
El baseline es la mediana del historico de la ruta; si hay menos de MIN_SAMPLES
puntos, se usa el baseline_price declarado en el YAML (evita falsos positivos
en rutas nuevas, donde cualquier precio pareceria un chollo).
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from statistics import median
from typing import Any

from .config import Route
from .models import FlightOffer

MIN_SAMPLES = 5

# Horas de sueño que no cuentan como viaje. Un vuelo que aterriza a las 23:25 es
# barato y es un mal viaje: esto es lo que ningun comparador te dice.
SLEEP_HOURS = 8
# A partir de aqui la escapada ya no mejora por ser mas larga (2 dias completos).
FULL_TRIP_HOURS = 32.0


def useful_hours(offer: FlightOffer) -> float:
    """Horas despierto en destino: de aterrizar a despegar, menos las de dormir.

    Sin horario del vuelo se estima en 12 h por noche, que es lo que da un dia
    normal de viaje; asi una oferta sin datos no gana ni pierde por defecto.
    """
    nights = offer.nights or 0
    llegada, salida = offer.arrive_time or offer.depart_time, offer.return_time
    if not (offer.return_date and llegada and salida):
        # Sin horario no se estima nada: poner "36 h" donde no hay dato es
        # peor que dejarlo vacio, porque parece informacion y no lo es.
        return 0.0

    try:
        inicio = datetime.fromisoformat(f"{offer.depart_date}T{llegada}")
        fin = datetime.fromisoformat(f"{offer.return_date}T{salida}")
    except ValueError:
        return round(nights * 12.0, 1)

    # Un vuelo que sale a las 21:55 aterriza al dia siguiente: sin esto, la
    # llegada se fecha 24 h antes y el viaje parece un dia mas largo.
    if offer.depart_time and llegada < offer.depart_time:
        inicio += timedelta(days=1)

    total = (fin - inicio) / timedelta(hours=1)
    return round(max(0.0, total - SLEEP_HOURS * nights), 1)

# Escapada tipica: salir el viernes por la tarde y volver el domingo por la tarde.
WEEKEND_DEFAULTS = {
    "mode": "prefer",
    "outbound_weekday": 4,  # 0 = lunes
    "outbound_after": "15:00",
    "outbound_before": "22:00",  # un vuelo a las 23:40 no es una tarde de viernes
    "inbound_weekday": 6,
    "inbound_after": "15:00",
    "inbound_before": "23:59",
    "bonus": 15,
}


def weekend_fit(offer: FlightOffer, cfg: dict[str, Any] | None) -> bool:
    """True si el vuelo encaja con la escapada de fin de semana configurada.

    Si el proveedor no da la hora, basta con que cuadren los dias: mejor un
    falso positivo ocasional que descartar un chollo por falta de dato.
    """
    c = {**WEEKEND_DEFAULTS, **(cfg or {})}
    if not offer.return_date:
        return False

    ida = date.fromisoformat(offer.depart_date)
    vuelta = date.fromisoformat(offer.return_date)
    if ida.weekday() != int(c["outbound_weekday"]) or vuelta.weekday() != int(c["inbound_weekday"]):
        return False
    if offer.depart_time and not str(c["outbound_after"]) <= offer.depart_time <= str(c["outbound_before"]):
        return False
    if offer.return_time and not str(c["inbound_after"]) <= offer.return_time <= str(c["inbound_before"]):
        return False
    return True


def baseline_for(route_key: str, history: dict[str, list[dict]], fallback: float) -> float:
    series = history.get(route_key, [])
    prices = [e["p"] for e in series]
    if len(prices) < MIN_SAMPLES:
        return float(fallback)
    return float(median(prices))


def score_offer(
    offer: FlightOffer,
    history: dict[str, list[dict]],
    route: Route,
    weekend_cfg: dict[str, Any] | None = None,
) -> FlightOffer:
    # El encaje de finde se decide antes: cambia contra que precios se compara.
    offer.weekend = weekend_fit(offer, weekend_cfg)

    baseline = baseline_for(offer.history_key, history, route.baseline_for(offer.weekend))
    offer.baseline = round(baseline, 2)

    discount = 0.0 if baseline <= 0 else (baseline - offer.price) / baseline * 100
    offer.discount_pct = round(max(0.0, discount), 1)

    # Componente descuento: un 50% de rebaja ya satura sus puntos.
    discount_pts = min(offer.discount_pct, 50.0) / 50.0 * 55.0

    # Componente presupuesto: cuanto mas lejos por debajo del maximo, mejor.
    max_price = route.max_for(offer.weekend)
    budget_pts = 0.0
    if max_price > 0 and offer.price <= max_price:
        budget_pts = (max_price - offer.price) / max_price * 20.0

    # Componente aprovechamiento: entre dos vuelos al mismo precio, gana el que
    # te deja mas horas de viaje utiles.
    offer.useful_hours = useful_hours(offer)
    offer.price_per_hour = round(offer.price / offer.useful_hours, 2) if offer.useful_hours else 0.0
    hours_pts = min(offer.useful_hours, FULL_TRIP_HOURS) / FULL_TRIP_HOURS * 20.0

    # Bonus de escapada: dos ofertas iguales, gana la que sale viernes tarde.
    weekend_pts = float((weekend_cfg or WEEKEND_DEFAULTS).get("bonus", 15)) if offer.weekend else 0.0

    offer.score = round(min(100.0, discount_pts + budget_pts + weekend_pts + hours_pts))
    return offer


def is_deal(
    offer: FlightOffer,
    route: Route,
    min_score: int,
    weekend_mode: str = "prefer",
) -> bool:
    if offer.price > route.max_for(offer.weekend):
        return False
    if weekend_mode == "only" and not offer.weekend:
        return False
    return offer.score >= min_score


def should_notify(offer: FlightOffer, state: dict, renotify_drop_pct: float) -> bool:
    """Evita spam: solo se re-avisa si el precio baja otro renotify_drop_pct."""
    prev = state.get("notified", {}).get(offer.id)
    if prev is None:
        return True
    prev_price = float(prev.get("price", 0) or 0)
    if prev_price <= 0:
        return True
    drop = (prev_price - offer.price) / prev_price * 100
    return drop >= renotify_drop_pct
