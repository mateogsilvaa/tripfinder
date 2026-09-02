from . import (  # noqa: F401  (importarlos es lo que los registra)
    amadeus,
    google_flights,
    ryanair,
    wizzair,
)
from .base import REGISTRY, FlightProvider, build_providers, register

__all__ = ["REGISTRY", "FlightProvider", "build_providers", "register"]
