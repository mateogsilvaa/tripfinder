"""Registro de providers de alojamiento."""

from __future__ import annotations

import logging
import os
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from typing import Any

from ..models import StayOffer

log = logging.getLogger("tripfinder")

REGISTRY: dict[str, type[StayProvider]] = {}


@dataclass
class StayRequest:
    """Todo lo que un provider necesita saber para buscar cama."""

    city: str  # nombre legible, p.ej. "Roma"
    iata: str  # IATA del aeropuerto de llegada, p.ej. "FCO"
    checkin: str  # ISO
    checkout: str  # ISO
    adults: int = 2
    max_total: float | None = None
    country: str = ""  # desambigua ciudades homonimas ("Agadir" cae en Canarias sin esto)
    # Solo pisos y casas enteras: nada de habitaciones, ni privadas, ni
    # compartidas, ni de hotel. Lo pide el Interrail, donde se duerme una o dos
    # noches en cada ciudad y lo que se compara es el precio de TENER un sitio.
    solo_enteros: bool = False
    # El centro de la ciudad (lat, lon), cuando se sabe de antemano. Con el, los
    # buscadores miran un recuadro alrededor en vez de la ciudad entera, y lo
    # que quede a mas de `radio_km` se descarta. Lo manda el Interrail: por
    # nombre de ciudad salian pisos a 3 y 4 km, a tres cuartos de hora andando.
    centro: tuple[float, float] | None = None
    radio_km: float | None = None

    @property
    def nights(self) -> int:
        return max(1, (date.fromisoformat(self.checkout) - date.fromisoformat(self.checkin)).days)

    @property
    def slug(self) -> str:
        """Formato canonico de Airbnb: 'Agadir--Marruecos'."""
        parts = [self.city] + ([self.country] if self.country else [])
        return "--".join(p.strip().replace(" ", "-") for p in parts)

    @property
    def query(self) -> str:
        return f"{self.city}, {self.country}" if self.country else self.city


# Los dos recuadros que se miran alrededor del centro. Medido el 24 de
# septiembre desde un runner con Roma, Amsterdam, Praga y Viena: por nombre de
# ciudad la mediana quedaba entre 1,8 y 3,2 km del centro (y en Viena solo 3 de
# 18 pisos a menos de 2,5 km); con el recuadro de 1,5 km, los dieciocho dentro
# y la mediana a 1-1,5 km. El de 2,5 km trae los mas baratos de alrededor.
RECUADROS_KM = (1.5, 2.5)


def recuadro(centro: tuple[float, float], km: float) -> dict[str, float]:
    """Los parametros `ne_lat/ne_lng/sw_lat/sw_lng` de un cuadrado de `km` de
    medio lado. Airbnb y Holidu entienden los mismos nombres."""
    import math

    lat, lon = centro
    dlat = km / 111.0
    dlon = km / (111.0 * max(0.2, math.cos(math.radians(lat))))
    return {
        "ne_lat": round(lat + dlat, 5),
        "ne_lng": round(lon + dlon, 5),
        "sw_lat": round(lat - dlat, 5),
        "sw_lng": round(lon - dlon, 5),
    }


def register(name: str) -> Callable[[type], type]:
    def deco(cls: type) -> type:
        cls.name = name
        REGISTRY[name] = cls
        return cls

    return deco


class StayProvider:
    name: str = ""
    requires: tuple[str, ...] = ()

    def __init__(self, cfg: dict[str, Any] | None = None):
        self.cfg = cfg or {}

    @classmethod
    def available(cls) -> bool:
        return all(os.getenv(k) for k in cls.requires)

    def search(self, req: StayRequest) -> list[StayOffer]:
        raise NotImplementedError


def build_stay_providers(names: list[str], cfg: dict[str, Any] | None = None) -> list[StayProvider]:
    out: list[StayProvider] = []
    for n in names:
        cls = REGISTRY.get(n)
        if cls is None:
            log.warning("Provider de alojamiento desconocido: %s", n)
            continue
        if not cls.available():
            log.info("Provider %s desactivado (faltan %s)", n, ", ".join(cls.requires))
            continue
        out.append(cls(cfg))
    return out
