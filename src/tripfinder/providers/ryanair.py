"""Provider Ryanair usando su buscador publico de tarifas (no requiere API key).

Endpoint: services-api.ryanair.com/farfnd/v4/roundTripFares
Devuelve las tarifas mas baratas por destino dentro de una ventana de fechas,
que es exactamente el caso de uso de "sorprendeme con un chollo".
"""

from __future__ import annotations

import logging
from datetime import date, timedelta

from ..config import Route
from ..models import FlightOffer
from ..util import get_json
from .base import FlightProvider, register

log = logging.getLogger("tripfinder")

API = "https://services-api.ryanair.com/farfnd/v4/roundTripFares"
BOOKING = "https://www.ryanair.com/es/es/trip/flights/select"

# La API rechaza cualquier limit > 20 con {"code": "InvalidLimit"}; hay que paginar.
PAGE_SIZE = 20


@register("ryanair")
class RyanairProvider(FlightProvider):
    def search(self, route: Route) -> list[FlightOffer]:
        days_ahead = int(self.cfg.get("days_ahead", 120))
        nights_min = int(self.cfg.get("nights_min", 2))
        nights_max = int(self.cfg.get("nights_max", 7))
        currency = self.cfg.get("currency", "EUR")
        interval = float(self.cfg.get("min_interval_seconds", 2))
        max_results = int(self.cfg.get("max_results_per_route", 100))

        today = date.today()
        params = {
            "departureAirportIataCode": route.origin,
            "outboundDepartureDateFrom": (today + timedelta(days=1)).isoformat(),
            "outboundDepartureDateTo": (today + timedelta(days=days_ahead)).isoformat(),
            "inboundDepartureDateFrom": (today + timedelta(days=1 + nights_min)).isoformat(),
            "inboundDepartureDateTo": (today + timedelta(days=days_ahead + nights_max)).isoformat(),
            "durationFrom": nights_min,
            "durationTo": nights_max,
            "currency": currency,
            "market": self.cfg.get("market", "es-es"),
            "adultPaxCount": 1,
            "limit": PAGE_SIZE,
            "offset": 0,
        }
        if route.dest_list:
            params["arrivalAirportIataCodes"] = ",".join(route.dest_list)

        offers: list[FlightOffer] = []
        for offset in range(0, max_results, PAGE_SIZE):
            data = get_json(
                API,
                params={**params, "offset": offset},
                throttle_key="ryanair",
                min_interval=interval,
            )
            fares = data.get("fares", []) if isinstance(data, dict) else []
            for fare in fares:
                offer = self._parse(fare, route, currency)
                if offer is not None:
                    offers.append(offer)
            if len(fares) < PAGE_SIZE:  # ultima pagina
                break

        log.info("Ryanair %s: %d tarifas", route.origin, len(offers))
        return offers

    @staticmethod
    def _parse(fare: dict, route: Route, currency: str) -> FlightOffer | None:
        out = fare.get("outbound") or {}
        back = fare.get("inbound") or {}
        arr = out.get("arrivalAirport") or {}
        dep = out.get("departureAirport") or {}
        if not arr.get("iataCode") or not out.get("departureDate"):
            return None

        summary_price = (fare.get("summary") or {}).get("price") or {}
        price = summary_price.get("value")
        if price is None:
            price = (out.get("price") or {}).get("value", 0) + (back.get("price") or {}).get("value", 0)
        if not price:
            return None

        depart = out["departureDate"][:10]
        ret = (back.get("departureDate") or "")[:10] or None
        nights = (fare.get("summary") or {}).get("tripDurationDays")
        if nights is None and ret:
            nights = (date.fromisoformat(ret) - date.fromisoformat(depart)).days

        is_return = "true" if ret else "false"
        link = (
            f"{BOOKING}?adults=1&teens=0&children=0&infants=0"
            f"&dateOut={depart}&dateIn={ret or ''}"
            f"&originIata={dep.get('iataCode', route.origin)}&destinationIata={arr['iataCode']}"
            f"&isReturn={is_return}&discount=0"
        )

        return FlightOffer(
            provider="ryanair",
            origin=dep.get("iataCode", route.origin),
            destination=arr["iataCode"],
            origin_name=(dep.get("city") or {}).get("name") or route.origin_name,
            destination_name=(arr.get("city") or {}).get("name") or arr["iataCode"],
            destination_country=arr.get("countryName") or (arr.get("country") or {}).get("name", ""),
            depart_date=depart,
            return_date=ret,
            nights=nights,
            price=round(float(price), 2),
            currency=summary_price.get("currencyCode", currency),
            airline="Ryanair",
            deep_link=link,
        )
