"""Dónde está el centro de una ciudad, para poder ordenar por cercanía.

EL PROBLEMA. La lista de camas salía ordenada por precio y nada más, así que el
primero podía ser un estudio a doce kilómetros del centro y el segundo, por diez
euros más, estar en la plaza mayor. En una escapada de dos noches eso no es un
detalle: son dos horas de transporte y el dinero del billete.

DE DÓNDE SALE. De Nominatim (OpenStreetMap), que es gratis y no pide clave. Su
política pide un `User-Agent` de verdad y como mucho una petición por segundo;
las dos cosas se cumplen aquí, y además cada ciudad se pregunta UNA VEZ en la
vida: lo que sale se guarda en `data/centros.json` y se commitea con el resto.
El centro de Roma no se mueve.
"""

from __future__ import annotations

import json
import logging
import math
from pathlib import Path

from ..util import get_json

log = logging.getLogger("tripfinder")

FICHERO = "centros.json"
URL = "https://nominatim.openstreetmap.org/search"


def _ruta() -> Path:
    from ..config import DATA_DIR

    return Path(DATA_DIR) / FICHERO


def _leer() -> dict[str, list[float]]:
    p = _ruta()
    if not p.exists():
        return {}
    try:
        crudo = json.loads(p.read_text(encoding="utf-8"))
        return crudo.get("centros", {}) if isinstance(crudo, dict) else {}
    except Exception as exc:  # noqa: BLE001 - sin el fichero se sigue, solo sin ordenar por centro
        log.warning("No se pudo leer %s (%s)", p, exc)
        return {}


def _guardar(centros: dict[str, list[float]]) -> None:
    p = _ruta()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(
        json.dumps({"centros": dict(sorted(centros.items()))}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _clave(ciudad: str, pais: str) -> str:
    return f"{(ciudad or '').strip().lower()}|{(pais or '').strip().lower()}"


def coordenadas(ciudad: str, pais: str = "") -> tuple[float, float] | None:
    """(lat, lon) del centro, o None si no se sabe.

    None NO es un fallo: significa que esa cama se ordena solo por precio, que
    es exactamente lo que se hacía antes de existir esto.
    """
    if not ciudad:
        return None
    centros = _leer()
    clave = _clave(ciudad, pais)
    if clave in centros:
        lat, lon = centros[clave]
        return float(lat), float(lon)

    consulta = f"{ciudad}, {pais}" if pais else ciudad
    try:
        datos = get_json(
            URL,
            params={"q": consulta, "format": "json", "limit": 1},
            # Nominatim rechaza a quien no se identifica, y con razón: es un
            # servicio gratuito pagado por donaciones.
            headers={"User-Agent": "tripfinder/0.1 (https://github.com/mateogsilvaa/tripfinder)"},
            throttle_key="nominatim",
            min_interval=1.1,  # su política: como mucho una por segundo
            retries=2,
        )
    except Exception as exc:  # noqa: BLE001 - sin centro se ordena solo por precio
        log.info("Nominatim no contestó por %s (%s)", consulta, exc)
        return None

    if not isinstance(datos, list) or not datos:
        log.info("Nominatim no conoce %s", consulta)
        return None
    try:
        lat, lon = float(datos[0]["lat"]), float(datos[0]["lon"])
    except (KeyError, TypeError, ValueError):
        return None

    centros[clave] = [round(lat, 5), round(lon, 5)]
    _guardar(centros)
    log.info("Centro de %s: %.4f, %.4f (guardado)", consulta, lat, lon)
    return lat, lon


def km_entre(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Distancia en kilómetros por la superficie (haversine).

    En línea recta y no andando, que es lo honesto: no sabemos si hay un río en
    medio. Para decidir entre «a 600 m» y «a 9 km» sobra.
    """
    r = 6371.0
    lat1, lon1, lat2, lon2 = (math.radians(x) for x in (*a, *b))
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return round(2 * r * math.asin(math.sqrt(h)), 2)
