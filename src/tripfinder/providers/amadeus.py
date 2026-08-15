"""Provider Amadeus Self-Service (plan gratuito).

Cubre el hueco de Ryanair: aerolineas tradicionales y rutas con escala.
Como su API exige origen, destino y fecha concretos, se muestrean fines de semana
dentro de la ventana para no agotar la cuota gratuita.
"""

from __future__ import annotations

import logging
import os
from datetime import date, timedelta

import requests

from ..config import Route
from ..models import FlightOffer
from ..util import USER_AGENT, get_json
from .base import FlightProvider, register

log = logging.getLogger("tripfinder")

HOST = os.getenv("AMADEUS_HOST", "https://test.api.amadeus.com")
_token_cache: dict[str, str] = {}


def get_token() -> str:
    """Token OAuth2 client-credentials, cacheado en memoria durante el proceso."""
    if _token_cache.get("value"):
        return _token_cache["value"]
    r = requests.post(
        f"{HOST}/v1/security/oauth2/token",
        data={
            "grant_type": "client_credentials",
            "client_id": os.environ["AMADEUS_CLIENT_ID"],
            "client_secret": os.environ["AMADEUS_CLIENT_SECRET"],
        },
        headers={"User-Agent": USER_AGENT},
        timeout=25,
    )
    r.raise_for_status()
    _token_cache["value"] = r.json()["access_token"]
    return _token_cache["value"]


def auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {get_token()}"}


def _weekend_dates(days_ahead: int, limit: int) -> list[date]:
    """Viernes dentro de la ventana: el 80% de las escapadas salen ese dia."""
    today = date.today()
    out: list[date] = []
    for i in range(7, days_ahead):
        d = today + timedelta(days=i)
        if d.weekday() == 4:
            out.append(d)
        if len(out) >= limit:
            break
    return out


@register("amadeus")
class AmadeusProvider(FlightProvider):
    requires = ("AMADEUS_CLIENT_ID", "AMADEUS_CLIENT_SECRET")

    def search(self, route: Route) -> list[FlightOffer]:
        dests = route.dest_list
        if not dests:
            # "any" no existe en esta API; se omite la ruta en vez de gastar cuota.
            log.info("Amadeus: ruta %s sin destinos explicitos, se omite", route.origin)
            return []

        cfg = self.cfg
        nights = int(cfg.get("nights_min", 3))
        interval = float(cfg.get("min_interval_seconds", 2))
        max_queries = int(cfg.get("amadeus_max_queries", 12))
        dates = _weekend_dates(int(cfg.get("days_ahead", 120)), max(1, max_queries // len(dests)))

        offers: list[FlightOffer] = []
        queries = 0
        for dest in dests:
            for d in dates:
                if queries >= max_queries:
                    return offers
                queries += 1
                try:
                    data = get_json(
                        f"{HOST}/v2/shopping/flight-offers",
                        params={
                            "originLocationCode": route.origin,
                            "destinationLocationCode": dest,
                            "departureDate": d.isoformat(),
                            "returnDate": (d + timedelta(days=nights)).isoformat(),
                            "adults": 1,
                            "currencyCode": cfg.get("currency", "EUR"),
                            "max": 3,
                        },
                        headers=auth_headers(),
                        throttle_key="amadeus",
                        min_interval=interval,
                    )
                except Exception as exc:  # noqa: BLE001 - un fallo puntual no tumba el scan
                    log.warning("Amadeus %s-%s %s: %s", route.origin, dest, d, exc)
                    continue
                offers.extend(self._parse(data, route, dest, d, nights))
        return offers

    @staticmethod
    def _parse(data: dict, route: Route, dest: str, d: date, nights: int) -> list[FlightOffer]:
        carriers = (data.get("dictionaries") or {}).get("carriers", {})
        out: list[FlightOffer] = []
        for item in data.get("data", []):
            price_block = item.get("price") or {}
            price = float(price_block.get("grandTotal", 0) or 0)
            if not price:
                continue
            code = (item.get("validatingAirlineCodes") or [""])[0]
            query = f"Flights from {route.origin} to {dest} on {d.isoformat()}"
            out.append(
                FlightOffer(
                    provider="amadeus",
                    origin=route.origin,
                    destination=dest,
                    origin_name=route.origin_name,
                    destination_name=dest,
                    depart_date=d.isoformat(),
                    return_date=(d + timedelta(days=nights)).isoformat(),
                    nights=nights,
                    price=round(price, 2),
                    currency=price_block.get("currency", "EUR"),
                    airline=carriers.get(code, code or "Varias"),
                    deep_link="https://www.google.com/travel/flights?q=" + query.replace(" ", "%20"),
                )
            )
        return out
