"""Provider Wizz Air, atacando su propia API.

Es la compania que mas se te escapaba: Google no la devuelve de forma fiable y
en rutas como Bucarest o Sofia es justo la que tiene el precio bueno.

Como funciona, que es lo interesante:

* Wizz publica la version de su API dentro del HTML de su web
  (`https://be.wizzair.com/<version>/Api`). Esa version cambia cada pocas
  semanas, asi que se descubre en cada ejecucion en vez de dejarla fija.
* `asset/map` da el mapa de rutas: que destinos vuela de verdad desde Madrid.
  Sin eso se preguntaria por rutas que no existen.
* `search/timetable` devuelve el precio mas barato de cada dia en una ventana,
  que es exactamente lo que hace falta para buscar chollos.

La peticion va con curl_cffi imitando el TLS de Chrome (via Scrapling): con
`requests` pelado responde 403.
"""

from __future__ import annotations

import logging
import re
from datetime import date, timedelta

from ..config import Route
from ..models import FlightOffer
from ..util import get_text, throttle
from .base import FlightProvider, register

log = logging.getLogger("tripfinder")

HOME = "https://www.wizzair.com/en-gb"
VERSION_RE = re.compile(r"(\d+\.\d+\.\d+)/Api")
RESERVA = "https://www.wizzair.com/en-gb/booking/select-flight"

_cache: dict[str, object] = {}


def _sesion():
    """Sesion con huella de Chrome. Sin esto Wizz contesta 403."""
    from curl_cffi import requests as cr

    if "s" not in _cache:
        _cache["s"] = cr.Session(impersonate="chrome")
    return _cache["s"]


def _base_url() -> str:
    """Descubre la version viva de la API leyendola de su propia web."""
    if _cache.get("base"):
        return str(_cache["base"])
    html = get_text(HOME, stealth=True, timeout=30)
    version = VERSION_RE.search(html)
    if not version:
        raise RuntimeError("no se encontro la version de la API de Wizz")
    _cache["base"] = f"https://be.wizzair.com/{version.group(1)}/Api"
    log.info("Wizz: API %s", _cache["base"])
    return str(_cache["base"])


def _cabeceras() -> dict[str, str]:
    return {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Origin": "https://www.wizzair.com",
        "Referer": "https://www.wizzair.com/",
    }


def destinos_desde(origen: str) -> list[str]:
    """Que destinos vuela Wizz desde ese aeropuerto, segun su mapa de rutas."""
    clave = f"map-{origen}"
    if clave in _cache:
        return list(_cache[clave])  # type: ignore[arg-type]
    r = _sesion().get(f"{_base_url()}/asset/map?languageCode=en-gb", headers=_cabeceras(), timeout=30)
    r.raise_for_status()
    datos = r.json()
    ciudades = datos.get("cities", datos if isinstance(datos, list) else [])
    for c in ciudades:
        if c.get("iata") == origen:
            destinos = [x["iata"] for x in c.get("connections", []) if x.get("iata")]
            _cache[clave] = destinos
            log.info("Wizz: %d destinos desde %s", len(destinos), origen)
            return destinos
    _cache[clave] = []
    return []


@register("wizzair")
class WizzairProvider(FlightProvider):
    def search(self, route: Route) -> list[FlightOffer]:
        try:
            posibles = destinos_desde(route.origin)
        except Exception as exc:  # noqa: BLE001 - si Wizz cambia algo, el resto sigue
            log.warning("Wizz: no se pudo leer el mapa de rutas (%s)", exc)
            return []

        pedidos = route.dest_list
        destinos = [d for d in posibles if not pedidos or d in pedidos]
        if not destinos:
            return []

        dias = int(self.cfg.get("days_ahead", 300))
        noches = int(self.cfg.get("nights_min", 2))
        max_dest = int(self.cfg.get("wizz_max_destinations", 20))
        hoy = date.today()

        ofertas: list[FlightOffer] = []
        for destino in destinos[:max_dest]:
            try:
                ofertas += self._ruta(route, destino, hoy, dias, noches)
            except Exception as exc:  # noqa: BLE001
                log.debug("Wizz %s-%s: %s", route.origin, destino, exc)
        log.info("Wizz %s: %d tarifas", route.origin, len(ofertas))
        return ofertas

    def _ruta(self, route: Route, destino: str, hoy: date, dias: int, noches: int) -> list[FlightOffer]:
        """Precio mas barato por dia de ida y de vuelta, y se casan entre si."""
        # Wizz rechaza con 400 cualquier ventana larga: acepta mes a mes.
        meses = int(self.cfg.get("wizz_months", 4))
        idas: dict[str, dict] = {}
        vueltas: dict[str, dict] = {}
        for i in range(meses):
            desde_d = hoy + timedelta(days=1 + 30 * i)
            hasta_d = min(desde_d + timedelta(days=29), hoy + timedelta(days=dias))
            if desde_d > hasta_d:
                break
            i_idas, i_vueltas = self._ventana(route, destino, desde_d.isoformat(), hasta_d.isoformat())
            idas.update(i_idas)
            vueltas.update(i_vueltas)

        return self._casar(route, destino, idas, vueltas, noches)

    def _ventana(self, route: Route, destino: str, desde: str, hasta: str) -> tuple[dict, dict]:
        throttle("wizz", float(self.cfg.get("min_interval_seconds", 2)))
        cuerpo = {
            "flightList": [
                {"departureStation": route.origin, "arrivalStation": destino,
                 "from": desde, "to": hasta},
                {"departureStation": destino, "arrivalStation": route.origin,
                 "from": desde, "to": hasta},
            ],
            "priceType": "regular",
            "adultCount": int(self.cfg.get("adults", 1)),
            "childCount": 0,
            "infantCount": 0,
        }
        r = _sesion().post(
            f"{_base_url()}/search/timetable", json=cuerpo, headers=_cabeceras(), timeout=35
        )
        if r.status_code != 200:
            log.debug("Wizz %s-%s %s..%s -> %s", route.origin, destino, desde, hasta, r.status_code)
            return {}, {}
        datos = r.json()
        return (
            {f["departureDate"][:10]: f for f in datos.get("outboundFlights", []) if f.get("price")},
            {f["departureDate"][:10]: f for f in datos.get("returnFlights", []) if f.get("price")},
        )

    def _casar(self, route: Route, destino: str, idas: dict, vueltas: dict, noches: int) -> list[FlightOffer]:
        weekend = self.cfg.get("weekend", {}) or {}
        dia_ida = int(weekend.get("outbound_weekday", 4))

        ofertas: list[FlightOffer] = []
        for iso, ida in idas.items():
            salida = date.fromisoformat(iso)
            # Solo se cierran viajes de la duracion buscada; ademas se prioriza
            # el dia de salida configurado para la escapada.
            for n in range(noches, int(self.cfg.get("nights_max", 4)) + 1):
                regreso = (salida + timedelta(days=n)).isoformat()
                vuelta = vueltas.get(regreso)
                if not vuelta:
                    continue
                precio = (ida["price"]["amount"] or 0) + (vuelta["price"]["amount"] or 0)
                if not precio:
                    continue
                ofertas.append(
                    FlightOffer(
                        provider="wizzair",
                        origin=route.origin,
                        origin_name=route.origin_name,
                        destination=destino,
                        depart_date=iso,
                        return_date=regreso,
                        nights=n,
                        price=round(float(precio), 2),
                        currency=ida["price"].get("currencyCode", "EUR"),
                        airline="Wizz Air",
                        stops=0,
                        deep_link=(
                            f"{RESERVA}?departureStation={route.origin}"
                            f"&arrivalStation={destino}&departureDate={iso}"
                            f"&returnDate={regreso}&adultCount=1"
                        ),
                    )
                )
                break  # con la primera duracion que cuadre basta
        # Solo lo mas barato de cada dia de salida, y priorizando los findes.
        ofertas.sort(key=lambda o: (date.fromisoformat(o.depart_date).weekday() != dia_ida, o.price))
        return ofertas[:12]
