"""Decide que es un chollo.

score = 70 * (descuento vs. baseline)  +  30 * (holgura respecto al presupuesto)
El baseline es la mediana del historico de la ruta; si hay menos de MIN_SAMPLES
puntos, se usa el baseline_price declarado en el YAML (evita falsos positivos
en rutas nuevas, donde cualquier precio pareceria un chollo).
"""

from __future__ import annotations

from statistics import median

from .config import Route
from .models import FlightOffer

MIN_SAMPLES = 5


def baseline_for(route_key: str, history: dict[str, list[dict]], fallback: float) -> float:
    series = history.get(route_key, [])
    prices = [e["p"] for e in series]
    if len(prices) < MIN_SAMPLES:
        return float(fallback)
    return float(median(prices))


def score_offer(offer: FlightOffer, history: dict[str, list[dict]], route: Route) -> FlightOffer:
    baseline = baseline_for(offer.route_key, history, route.baseline_price)
    offer.baseline = round(baseline, 2)

    discount = 0.0 if baseline <= 0 else (baseline - offer.price) / baseline * 100
    offer.discount_pct = round(max(0.0, discount), 1)

    # Componente descuento: un 50% de rebaja ya satura los 70 puntos.
    discount_pts = min(offer.discount_pct, 50.0) / 50.0 * 70.0

    # Componente presupuesto: cuanto mas lejos por debajo del maximo, mejor.
    max_price = float(route.max_price or 0)
    budget_pts = 0.0
    if max_price > 0 and offer.price <= max_price:
        budget_pts = (max_price - offer.price) / max_price * 30.0

    offer.score = int(round(min(100.0, discount_pts + budget_pts)))
    return offer


def is_deal(offer: FlightOffer, route: Route, min_score: int) -> bool:
    if route.max_price and offer.price > route.max_price:
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
