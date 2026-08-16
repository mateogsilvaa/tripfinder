from . import amadeus, google_flights, ryanair, wizzair  # noqa: F401  (importarlos es lo que los registra)
from .base import REGISTRY, FlightProvider, build_providers, register

__all__ = ["REGISTRY", "FlightProvider", "build_providers", "register"]
