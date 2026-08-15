"""Registro de providers de vuelos. Anadir uno = un fichero + @register."""

from __future__ import annotations

import logging
import os
from datetime import date
from typing import Any, Callable

from ..config import Route
from ..models import FlightOffer, Leg

log = logging.getLogger("tripfinder")

REGISTRY: dict[str, type["FlightProvider"]] = {}


def register(name: str) -> Callable[[type], type]:
    def deco(cls: type) -> type:
        cls.name = name
        REGISTRY[name] = cls
        return cls

    return deco


class FlightProvider:
    name: str = ""
    requires: tuple[str, ...] = ()

    def __init__(self, search_cfg: dict[str, Any]):
        self.cfg = search_cfg

    @classmethod
    def available(cls) -> bool:
        """Un provider sin sus secretos se desactiva solo en vez de romper el scan."""
        return all(os.getenv(k) for k in cls.requires)

    def search(self, route: Route) -> list[FlightOffer]:
        raise NotImplementedError

    def search_oneway(
        self,
        route: Route,
        day: "date",
        *,
        inbound: bool = False,
        destinations: list[str] | None = None,
        time_from: str = "00:00",
        time_to: str = "23:59",
    ) -> list[Leg]:
        """Trayectos sueltos de un dia concreto, para combinar aerolineas.

        Un provider que no lo soporte devuelve lista vacia y simplemente no
        participa en las combinaciones.
        """
        return []


def build_providers(names: list[str], search_cfg: dict[str, Any]) -> list[FlightProvider]:
    out: list[FlightProvider] = []
    for n in names:
        cls = REGISTRY.get(n)
        if cls is None:
            log.warning("Provider desconocido en la config: %s", n)
            continue
        if not cls.available():
            log.info("Provider %s desactivado (faltan %s)", n, ", ".join(cls.requires))
            continue
        out.append(cls(search_cfg))
    return out
