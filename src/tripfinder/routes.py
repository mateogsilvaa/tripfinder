"""Universo de destinos: a donde se puede volar de verdad desde un aeropuerto.

Este fichero arregla el fallo de fondo que tenia el buscador: **quien decidia
los destinos era Ryanair**. La busqueda "donde sea" preguntaba las tarifas de
Ryanair para una fecha, se quedaba con los 12 destinos que contestaba, y solo
esos se contrastaban despues con Google. Todo lo que ese dia Ryanair no volaba
(Pisa, Bucarest, Sofia, Milan, Turin...) no es que saliera caro: es que no
llegaba a existir como candidato.

Aqui se construye la lista al reves. Primero se pregunta *a donde hay rutas*
—cosa que las aerolineas publican gratis y de una sola peticion— y despues se
piden precios de todos esos destinos. Fuentes:

* Ryanair: `views/locate/searchWidget/routes/es/airport/<IATA>` devuelve las 65
  rutas desde Madrid con el nombre de la ciudad y del pais ya en español.
* Wizz Air: su `asset/map`, que es el que trae Bucarest, Sofia o Tirana.
* `city_names` del YAML: los destinos que solo vuelan las de bandera (Iberia,
  Vueling, ITA, Lufthansa...), a los que se llega via Google Flights.

El resultado se cachea en `data/routes/<IATA>.json` con caducidad, porque las
rutas cambian por temporadas, no por horas.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

from .config import DATA_DIR, Config
from .util import get_json

log = logging.getLogger("tripfinder")

RYANAIR_ROUTES = "https://www.ryanair.com/api/views/locate/searchWidget/routes/es/airport/{iata}"
CACHE_DIAS = 14


def _cache_file(origen: str):
    d = DATA_DIR / "routes"
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{origen.upper()}.json"


def _leer_cache(origen: str) -> dict[str, tuple[str, str]] | None:
    f = _cache_file(origen)
    if not f.exists():
        return None
    try:
        crudo = json.loads(f.read_text(encoding="utf-8"))
        cuando = datetime.fromisoformat(crudo["generado"])
    except (json.JSONDecodeError, KeyError, ValueError):
        return None
    if datetime.now(timezone.utc) - cuando > timedelta(days=CACHE_DIAS):
        return None
    return {k: (v[0], v[1]) for k, v in crudo.get("destinos", {}).items()}


def _guardar_cache(origen: str, destinos: dict[str, tuple[str, str]]) -> None:
    _cache_file(origen).write_text(
        json.dumps(
            {
                "origen": origen,
                "generado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "destinos": {k: list(v) for k, v in sorted(destinos.items())},
            },
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )


def rutas_ryanair(origen: str) -> dict[str, tuple[str, str]]:
    """Destinos de Ryanair con ciudad y pais en español."""
    try:
        datos = get_json(
            RYANAIR_ROUTES.format(iata=origen.upper()),
            throttle_key="ryanair",
            min_interval=1,
            retries=2,
        )
    except Exception as exc:  # noqa: BLE001 - sin esto quedan las otras fuentes
        log.warning("Ryanair: no se pudo leer el mapa de rutas de %s (%s)", origen, exc)
        return {}
    salida: dict[str, tuple[str, str]] = {}
    for r in datos if isinstance(datos, list) else []:
        a = r.get("arrivalAirport") or {}
        code = a.get("code")
        if not code:
            continue
        ciudad = (a.get("city") or {}).get("name") or a.get("name") or code
        pais = (a.get("country") or {}).get("name", "")
        salida[code] = (ciudad, pais)
    log.info("Ryanair: %d rutas desde %s", len(salida), origen)
    return salida


def rutas_wizz(origen: str) -> dict[str, tuple[str, str]]:
    from .providers.wizzair import destinos_desde

    try:
        return {d: ("", "") for d in destinos_desde(origen)}
    except Exception as exc:  # noqa: BLE001
        log.warning("Wizz: no se pudo leer el mapa de rutas (%s)", exc)
        return {}


def destinos(origen: str, cfg: Config, *, refrescar: bool = False) -> dict[str, tuple[str, str]]:
    """Todos los destinos alcanzables desde `origen`, con ciudad y pais.

    Es la lista de candidatos de la busqueda "donde sea". Union de las tres
    fuentes: lo que vuela Ryanair, lo que vuela Wizz y lo que hay declarado en
    `city_names` (que es donde estan Iberia, Vueling y compañia).
    """
    origen = origen.upper()
    salida = None if refrescar else _leer_cache(origen)
    de_cache = salida is not None

    if salida is None:
        salida = {}
        salida.update(rutas_ryanair(origen))
        for iata, nombre in rutas_wizz(origen).items():
            salida.setdefault(iata, nombre)
        if salida:  # solo se cachea si alguna fuente ha contestado
            _guardar_cache(origen, salida)

    # Lo declarado a mano se suma SIEMPRE, tambien viniendo de cache: ahi estan
    # Stuttgart, Ginebra o Estambul, donde no vuela ninguna low cost y que solo
    # aparecen preguntando a Google.
    for iata, (ciudad, pais) in cfg.city_names.items():
        salida.setdefault(iata, (ciudad, pais))

    salida = {**salida, **_nombres_yaml(cfg, salida)}
    salida.pop(origen, None)
    log.info(
        "Rutas desde %s: %d destinos%s", origen, len(salida), " (cache)" if de_cache else ""
    )
    return salida


def _nombres_yaml(cfg: Config, base: dict[str, tuple[str, str]]) -> dict[str, tuple[str, str]]:
    """Rellena los nombres que falten con `city_names` y el listado mundial."""
    arreglados: dict[str, tuple[str, str]] = {}
    for iata, (ciudad, pais) in base.items():
        if ciudad and pais:
            continue
        c, p = cfg.city_names.get(iata, ("", ""))
        if not (c and p):
            cm, pm = _mundial(iata)
            c, p = c or cm, p or pm
        arreglados[iata] = (ciudad or c or iata, pais or p)
    return arreglados


_mundial_cache: dict[str, tuple[str, str]] = {}


def _mundial(iata: str) -> tuple[str, str]:
    if not _mundial_cache:
        f = DATA_DIR / "airports_world.json"
        if f.exists():
            try:
                for a in json.loads(f.read_text(encoding="utf-8")):
                    _mundial_cache[a["code"]] = (a.get("ciudad") or a["code"], a.get("pais", ""))
            except (json.JSONDecodeError, KeyError):
                pass
        _mundial_cache.setdefault("", ("", ""))
    return _mundial_cache.get(iata, ("", ""))


def prioridad(iata: str, cfg: Config) -> int:
    """Orden en el que gastar las consultas de Google cuando no llegan a todo.

    Primero los destinos que declara el YAML (los elegidos a mano), despues el
    resto de Europa, y al final lo que ya no es una escapada de finde.
    """
    if iata in cfg.city_names:
        return 0
    return 1
