"""Modelos de datos. Todo lo que se persiste en data/ pasa por aqui."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@dataclass
class Leg:
    """Un trayecto suelto. Es la pieza con la que se combinan aerolineas."""

    provider: str
    airline: str
    origin: str
    destination: str
    date: str  # ISO
    time: str  # HH:MM
    price: float
    currency: str = "EUR"
    destination_name: str = ""
    destination_country: str = ""
    origin_name: str = ""
    deep_link: str = ""


@dataclass
class FlightOffer:
    """Una oferta de vuelo normalizada, venga del provider que venga."""

    provider: str
    origin: str
    destination: str
    depart_date: str  # ISO YYYY-MM-DD
    price: float
    currency: str = "EUR"
    return_date: str | None = None
    origin_name: str = ""
    destination_name: str = ""
    destination_country: str = ""
    airline: str = ""
    airline_back: str = ""  # distinta de airline si el billete combina companias
    deep_link: str = ""
    deep_link_back: str = ""  # los combinados se reservan en dos webs
    found_at: str = field(default_factory=_now)
    nights: int | None = None
    depart_time: str = ""  # HH:MM del vuelo de ida
    return_time: str = ""  # HH:MM del vuelo de vuelta
    weekend: bool = False  # encaja con la escapada viernes tarde -> domingo tarde
    # Mismo viaje con otras companias, para no perderlas al quedarnos con la mas barata
    alternatives: list[dict[str, Any]] = field(default_factory=list)
    # Rellenados por scoring.py
    baseline: float | None = None
    discount_pct: float = 0.0
    score: int = 0

    @property
    def mixed(self) -> bool:
        return bool(self.airline_back and self.airline_back != self.airline)

    @property
    def id(self) -> str:
        """Identificador estable: NO incluye el precio, para poder seguir la ruta en el tiempo."""
        return f"{self.provider}-{self.origin}-{self.destination}-{self.depart_date.replace('-', '')}"

    @property
    def route_key(self) -> str:
        return f"{self.origin}-{self.destination}"

    @property
    def history_key(self) -> str:
        """Series separadas: mezclar findes y dias sueltos falsea las dos medias."""
        return self.route_key + ("|finde" if self.weekend else "")

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["id"] = self.id
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "FlightOffer":
        known = {k: v for k, v in d.items() if k in cls.__dataclass_fields__}
        return cls(**known)


@dataclass
class StayOffer:
    """Un alojamiento (hotel, piso entero, o simplemente un enlace de busqueda)."""

    provider: str
    name: str
    url: str
    kind: str = "stay"  # stay | hotel | link
    price_total: float | None = None
    price_per_night: float | None = None
    currency: str = "EUR"
    rating: float | None = None
    reviews: int | None = None
    area: str = ""
    image: str = ""
    note: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
