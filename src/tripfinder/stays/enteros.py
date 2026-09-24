"""Si un alojamiento es un sitio entero o una habitacion.

Airbnb ya filtra cuando se le pide (`room_types[]=Entire home/apt`), pero esto
es la segunda llave: otros proveedores no saben filtrar, y un filtro de Airbnb
que un dia cambie de nombre dejaria colarse habitaciones sin que nadie lo note.
Mejor tirar de mas que ensenar una habitacion compartida como la opcion buena.

Lo que se mira es lo que el anuncio dice de si mismo: el `area` de Airbnb va
en la forma «Habitacion privada en Plaka», «Apartamento en Monastiraki».
"""

from __future__ import annotations

import unicodedata

from ..models import StayOffer

# Por donde empieza el `area` de lo que NO es entero. En minusculas y sin
# tildes, que se compara asi.
HABITACION = (
    "habitacion",  # privada, compartida, de hotel
    "room in",
    "private room",
    "shared room",
    "hotel room",
    "cama en",
    "bed in",
)


def _pelado(texto: str) -> str:
    sin = unicodedata.normalize("NFKD", texto or "")
    return "".join(c for c in sin if not unicodedata.combining(c)).strip().lower()


def es_entero(s: StayOffer) -> bool:
    """True si es un sitio entero con precio. Un enlace de busqueda no es un
    alojamiento; un hotel es una habitacion."""
    if s.kind != "stay" or not s.price_total:
        return False
    area = _pelado(s.area)
    return not area.startswith(HABITACION)


def solo_enteros(stays: list[StayOffer]) -> list[StayOffer]:
    """Los enteros, y los enlaces de busqueda detras: esos no compiten por ser
    la opcion elegida, pero sirven para seguir buscando a mano."""
    return [s for s in stays if es_entero(s)] + [s for s in stays if s.kind == "link"]
