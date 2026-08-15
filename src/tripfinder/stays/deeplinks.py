"""Enlaces de busqueda ya montados con ciudad, fechas y huespedes.

Booking.com bloquea el scraping automatizado y sus condiciones lo prohiben, asi que
en lugar de forzarlo se genera el enlace exacto de busqueda. Ademas garantiza que
la vista de alojamiento nunca sale vacia aunque los otros adapters fallen.
"""

from __future__ import annotations

from datetime import date
from urllib.parse import quote_plus

from ..models import StayOffer
from .base import StayProvider, StayRequest, register


@register("deeplinks")
class DeepLinksProvider(StayProvider):
    def search(self, req: StayRequest) -> list[StayOffer]:
        city = quote_plus(req.city)
        place = quote_plus(req.slug)
        ci, co = req.checkin, req.checkout
        y, m, d = (int(x) for x in ci.split("-"))
        y2, m2, d2 = (int(x) for x in co.split("-"))

        links = [
            (
                "Booking.com",
                f"https://www.booking.com/searchresults.es.html?ss={city}"
                f"&checkin_year={y}&checkin_month={m}&checkin_monthday={d}"
                f"&checkout_year={y2}&checkout_month={m2}&checkout_monthday={d2}"
                f"&group_adults={req.adults}&no_rooms=1&order=price",
                "Ordenado por precio",
            ),
            (
                "Airbnb (busqueda completa)",
                f"https://www.airbnb.es/s/{place}/homes?checkin={ci}&checkout={co}&adults={req.adults}",
                "Todos los filtros disponibles",
            ),
            (
                "Kayak",
                f"https://www.kayak.es/hotels/{city}/{ci}/{co}/{req.adults}adults?sort=price_a",
                "Comparador de hoteles",
            ),
            (
                "Google Hotels",
                f"https://www.google.com/travel/hotels/{city}?q={city}%20hotels"
                f"&checkin={ci}&checkout={co}",
                "Vista de mapa y precios",
            ),
            (
                "Hostelworld",
                f"https://www.hostelworld.com/search?search_keywords={city}"
                f"&date_from={ci}&date_to={co}&number_of_guests={req.adults}",
                "Opcion mas barata para hostales",
            ),
        ]

        return [
            StayOffer(provider="deeplinks", name=name, url=url, kind="link", area=req.city, note=note)
            for name, url, note in links
        ]


def nights_between(checkin: str, checkout: str) -> int:
    return max(1, (date.fromisoformat(checkout) - date.fromisoformat(checkin)).days)
