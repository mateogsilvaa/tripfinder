"""Modelos de datos. Todo lo que se persiste en data/ pasa por aqui."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from typing import Any


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


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
    # Enlace a la web de la propia compania, cuando sabemos construirlo. El
    # deep_link puede ser un buscador (Google Flights); esto lleva a reservar.
    airline_link: str = ""
    airline_link_label: str = ""
    # A cuanta gente cubre `price`. Sin esto la web no puede decir si 240 EUR es
    # lo que pagas tu o lo que pagais los cuatro, que no es un detalle menor.
    adults: int = 1
    found_at: str = field(default_factory=_now)
    nights: int | None = None
    depart_time: str = ""  # HH:MM de salida de la ida
    arrive_time: str = ""  # HH:MM de llegada al destino
    return_time: str = ""  # HH:MM de salida del vuelo de vuelta
    return_arrive_time: str = ""  # HH:MM de llegada de vuelta a casa
    stops: int = 0  # 0 = directo
    # Skiplagging: el billete va mas lejos y te bajas en la escala
    long_haul: bool = False  # otro continente, se enseña en su propia seccion
    hidden_city: bool = False
    hidden_city_ticket_to: str = ""
    # Horas que de verdad pasas en destino, descontando las de dormir
    useful_hours: float = 0.0
    price_per_hour: float = 0.0
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
    def price_per_person(self) -> float:
        return round(self.price / max(1, self.adults), 2)

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
        d["price_per_person"] = self.price_per_person
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> FlightOffer:
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
