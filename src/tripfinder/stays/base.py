"""Registro de providers de alojamiento."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import date
from typing import Any, Callable

from ..models import StayOffer

log = logging.getLogger("tripfinder")

REGISTRY: dict[str, type["StayProvider"]] = {}


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
