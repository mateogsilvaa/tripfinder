"""Si un alojamiento es un sitio entero o una habitacion.

Airbnb ya filtra cuando se le pide (`room_types[]=Entire home/apt`), pero esto
es la segunda llave: otros proveedores no saben filtrar, y un filtro de Airbnb
que un dia cambie de nombre dejaria colarse habitaciones sin que nadie lo note.
Mejor tirar de mas que ensenar una habitacion compartida como la opcion buena.

Lo que se mira es lo que el anuncio dice de si mismo: el `area` de Airbnb va
en la forma «Habitacion privada en Plaka», «Apartamento en Monastiraki». Y
tambien el NOMBRE: la primera ruta de verdad trajo en Berlin «Numa | Habitación
estándar con balcón» y en Viena «Habitación de hotel moderna», las dos con un
`area` de «Apartamento en …». Lo que el anfitrion llama habitacion, lo es.

Y dos limpiezas que no son de tipo sino de calidad, vistas en la misma ruta:
el mismo piso dos veces (Holidu lo devolvia en los dos recuadros con un
`searchId` distinto en la direccion) y precios que no pueden ser de un piso
entero (en Amsterdam, «AmicitiA», un barco hotel, a 50 € dos noches cuando la
mediana de la ciudad pasaba de 500).
"""

from __future__ import annotations

import logging
import re
import unicodedata
from statistics import median
from urllib.parse import urlsplit

from ..models import StayOffer

log = logging.getLogger("tripfinder")

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

# En el nombre, por palabra entera: «bedroom», «rooftop» o «Roomy loft» son de
# pisos y tienen que pasar. Sin tildes, que se compara asi.
HABITACION_EN_NOMBRE = re.compile(
    r"\b(room|rooms|habitacion|habitaciones|chambre|zimmer|camera|camere|dorm|dormitorio compartido"
    r"|hostel|hostal|albergue|b&b|bed and breakfast|hotel room|pension)\b",
    re.IGNORECASE,
)

# Por debajo de esta fraccion de la mediana de la ciudad, un «piso entero» no
# es un piso entero: es una cama, un camarote o un precio mal leido.
PRECIO_MINIMO_RELATIVO = 0.3


def _pelado(texto: str) -> str:
    sin = unicodedata.normalize("NFKD", texto or "")
    return "".join(c for c in sin if not unicodedata.combining(c)).strip().lower()


def es_entero(s: StayOffer) -> bool:
    """True si es un sitio entero con precio. Un enlace de busqueda no es un
    alojamiento; un hotel es una habitacion."""
    if s.kind != "stay" or not s.price_total:
        return False
    if _pelado(s.area).startswith(HABITACION):
        return False
    return not HABITACION_EN_NOMBRE.search(_pelado(s.name))


def clave(s: StayOffer) -> str:
    """Lo que identifica un anuncio: la direccion sin la consulta. Holidu mete un
    `searchId` distinto en cada busqueda, y el mismo piso salia dos veces."""
    partes = urlsplit(s.url or "")
    return f"{s.provider}|{partes.netloc}{partes.path}".lower()


def sin_repetir(stays: list[StayOffer]) -> list[StayOffer]:
    vistos: set[str] = set()
    salida = []
    for s in stays:
        k = clave(s)
        if k in vistos:
            continue
        vistos.add(k)
        salida.append(s)
    return salida


def sin_precios_imposibles(stays: list[StayOffer]) -> list[StayOffer]:
    """Fuera lo que cuesta menos de un 30 % de la mediana. Con menos de cuatro
    precios no hay mediana que valga y no se toca nada."""
    precios = [s.price_total for s in stays if s.price_total]
    if len(precios) < 4:
        return stays
    suelo = median(precios) * PRECIO_MINIMO_RELATIVO
    fuera = [s for s in stays if s.price_total and s.price_total < suelo]
    if fuera:
        log.info(
            "%d alojamientos descartados por precio imposible (menos de %.0f EUR): %s",
            len(fuera), suelo, ", ".join(s.name for s in fuera[:4]),
        )
    return [s for s in stays if not (s.price_total and s.price_total < suelo)]


def solo_enteros(stays: list[StayOffer]) -> list[StayOffer]:
    """Los enteros —sin repetir y con precios de verdad—, y los enlaces de
    busqueda detras: esos no compiten por ser la opcion elegida, pero sirven
    para seguir buscando a mano."""
    enteros = sin_precios_imposibles(sin_repetir([s for s in stays if es_entero(s)]))
    return enteros + [s for s in stays if s.kind == "link"]
