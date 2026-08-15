"""Hoteles via Amadeus Hotel Search (API oficial, plan gratuito)."""

from __future__ import annotations

import logging

from ..models import StayOffer
from ..providers.amadeus import HOST, auth_headers
from ..util import get_json
from .base import StayProvider, StayRequest, register

log = logging.getLogger("tripfinder")


@register("amadeus_hotels")
class AmadeusHotelsProvider(StayProvider):
    requires = ("AMADEUS_CLIENT_ID", "AMADEUS_CLIENT_SECRET")

    def search(self, req: StayRequest) -> list[StayOffer]:
        hotels = get_json(
            f"{HOST}/v1/reference-data/locations/hotels/by-city",
            params={"cityCode": req.iata, "radius": 20, "radiusUnit": "KM"},
            headers=auth_headers(),
            throttle_key="amadeus",
        )
        ids = [h["hotelId"] for h in hotels.get("data", []) if h.get("hotelId")][:20]
        if not ids:
            log.info("Amadeus hoteles: sin hoteles para %s", req.iata)
            return []

        data = get_json(
            f"{HOST}/v3/shopping/hotel-offers",
            params={
                "hotelIds": ",".join(ids),
                "checkInDate": req.checkin,
                "checkOutDate": req.checkout,
                "adults": req.adults,
                "roomQuantity": 1,
                "currency": "EUR",
                "bestRateOnly": "true",
            },
            headers=auth_headers(),
            throttle_key="amadeus",
        )

        offers: list[StayOffer] = []
        for item in data.get("data", []):
            hotel = item.get("hotel") or {}
            price_blocks = item.get("offers") or []
            if not price_blocks:
                continue
            price_info = price_blocks[0].get("price") or {}
            total = float(price_info.get("total", 0) or 0)
            if not total:
                continue
            name = hotel.get("name", "Hotel")
            offers.append(
                StayOffer(
                    provider="amadeus_hotels",
                    name=name,
                    url=(
                        "https://www.google.com/search?q="
                        + f"{name} hotel".replace(" ", "+")
                    ),
                    kind="hotel",
                    price_total=round(total, 2),
                    price_per_night=round(total / req.nights, 2),
                    currency=price_info.get("currency", "EUR"),
                    area=req.city,
                    note=(price_blocks[0].get("room") or {}).get("typeEstimated", {}).get("category", ""),
                )
            )
        log.info("Amadeus hoteles %s: %d ofertas", req.iata, len(offers))
        return offers
