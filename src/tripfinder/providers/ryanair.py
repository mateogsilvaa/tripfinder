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


def _weekdays_ahead(weekday: int, days_ahead: int, limit: int) -> list[date]:
    """Las proximas fechas que caen en ese dia de la semana (0=lunes)."""
    today = date.today()
    first = today + timedelta(days=(weekday - today.weekday()) % 7 or 7)
    out: list[date] = []
    d = first
    while (d - today).days <= days_ahead and len(out) < limit:
        out.append(d)
        d += timedelta(days=7)
    return out


@register("ryanair")
class RyanairProvider(FlightProvider):
    def search(self, route: Route) -> list[FlightOffer]:
        weekend = self.cfg.get("weekend", {}) or {}
        mode = str(weekend.get("mode", "prefer"))

        offers: list[FlightOffer] = []
        if mode in ("prefer", "only"):
            # La busqueda general devuelve la tarifa mas barata por destino, que casi
            # nunca cae en viernes-domingo: hay que preguntar fin de semana a fin de semana.
            offers += self._weekend_sweep(route, weekend)
        if mode != "only":
            offers += self._broad_search(route)

        log.info("Ryanair %s: %d tarifas", route.origin, len(offers))
        return offers

    # -- consultas -------------------------------------------------------
    def _base_params(self, route: Route) -> dict:
        params = {
            "departureAirportIataCode": route.origin,
            "currency": self.cfg.get("currency", "EUR"),
            "market": self.cfg.get("market", "es-es"),
            "adultPaxCount": int(self.cfg.get("adults", 1)),
            "limit": PAGE_SIZE,
            "offset": 0,
        }
        if route.dest_list:
            params["arrivalAirportIataCodes"] = ",".join(route.dest_list)
        return params

    def _broad_search(self, route: Route) -> list[FlightOffer]:
        days_ahead = int(self.cfg.get("days_ahead", 120))
        nights_min = int(self.cfg.get("nights_min", 2))
        nights_max = int(self.cfg.get("nights_max", 7))
        today = date.today()
        params = {
            **self._base_params(route),
            "outboundDepartureDateFrom": (today + timedelta(days=1)).isoformat(),
            "outboundDepartureDateTo": (today + timedelta(days=days_ahead)).isoformat(),
            "inboundDepartureDateFrom": (today + timedelta(days=1 + nights_min)).isoformat(),
            "inboundDepartureDateTo": (today + timedelta(days=days_ahead + nights_max)).isoformat(),
            "durationFrom": nights_min,
            "durationTo": nights_max,
        }
        return self._paginate(params, route, int(self.cfg.get("max_results_per_route", 100)))

    def _weekend_sweep(self, route: Route, weekend: dict) -> list[FlightOffer]:
        """Una consulta por fin de semana, con filtro de hora de salida y regreso."""
        out_day = int(weekend.get("outbound_weekday", 4))
        in_day = int(weekend.get("inbound_weekday", 6))
        max_weeks = int(weekend.get("max_weeks", 16))
        days_ahead = int(self.cfg.get("days_ahead", 120))

        offers: list[FlightOffer] = []
        for out_date in _weekdays_ahead(out_day, days_ahead, max_weeks):
            nights = (in_day - out_day) % 7 or 7
            in_date = out_date + timedelta(days=nights)
            params = {
                **self._base_params(route),
                "outboundDepartureDateFrom": out_date.isoformat(),
                "outboundDepartureDateTo": out_date.isoformat(),
                "inboundDepartureDateFrom": in_date.isoformat(),
                "inboundDepartureDateTo": in_date.isoformat(),
                "durationFrom": nights,
                "durationTo": nights,
                "outboundDepartureTimeFrom": weekend.get("outbound_after", "15:00"),
                "outboundDepartureTimeTo": weekend.get("outbound_before", "22:00"),
                "inboundDepartureTimeFrom": weekend.get("inbound_after", "15:00"),
                "inboundDepartureTimeTo": weekend.get("inbound_before", "23:59"),
            }
            try:
                offers += self._paginate(params, route, PAGE_SIZE)
            except Exception as exc:  # noqa: BLE001 - un finde fallido no tumba el resto
                log.warning("Ryanair finde %s: %s", out_date, exc)
        log.info("Ryanair %s: %d tarifas de finde", route.origin, len(offers))
        return offers

    def _paginate(self, params: dict, route: Route, max_results: int) -> list[FlightOffer]:
        currency = params.get("currency", "EUR")
        interval = float(self.cfg.get("min_interval_seconds", 2))
        offers: list[FlightOffer] = []
        for offset in range(0, max(max_results, PAGE_SIZE), PAGE_SIZE):
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

        depart_raw = out["departureDate"]
        back_raw = back.get("departureDate") or ""
        depart, depart_time = depart_raw[:10], depart_raw[11:16]
        ret = back_raw[:10] or None
        return_time = back_raw[11:16]
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
            depart_time=depart_time,
            return_time=return_time,
            price=round(float(price), 2),
            currency=summary_price.get("currencyCode", currency),
            airline="Ryanair",
            deep_link=link,
        )
