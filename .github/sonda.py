"""Sonda 6: como entiende Airbnb el nombre de la ciudad. Temporal."""

import statistics
import sys
import unicodedata

sys.path.insert(0, "src")

from tripfinder.stays.airbnb import AirbnbProvider  # noqa: E402
from tripfinder.stays.base import StayRequest  # noqa: E402
from tripfinder.stays.centro import coordenadas, km_entre  # noqa: E402


def pelar(s):
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


CIUDADES = [
    ("Ámsterdam", "Países Bajos"),
    ("Múnich", "Alemania"),
    ("Zúrich", "Suiza"),
    ("Bruselas", "Bélgica"),
    ("Cracovia", "Polonia"),
    ("Roma", "Italia"),
]

for ciudad, pais in CIUDADES:
    centro = coordenadas(ciudad, pais)
    variantes = {
        "tal_cual": (ciudad, pais),
        "sin_tildes": (pelar(ciudad), pelar(pais)),
        "solo_ciudad": (ciudad, ""),
    }
    for nombre, (c, p) in variantes.items():
        req = StayRequest(city=c, iata="", checkin="2026-11-06", checkout="2026-11-08", adults=2, country=p, solo_enteros=True)
        try:
            ofertas = AirbnbProvider().search(req)
        except Exception as exc:
            print(ciudad, nombre, "ERROR", exc)
            continue
        kms = [km_entre(centro, (o.lat, o.lon)) for o in ofertas if o.lat and o.lon and centro]
        cerca = sum(1 for k in kms if k <= 40)
        med = round(statistics.median(kms), 1) if kms else None
        print(f"{ciudad:10} {nombre:12} n={len(ofertas):2} cerca={cerca:2} mediana_km={med}")
