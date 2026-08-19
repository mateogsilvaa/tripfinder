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

Y el detalle que lo cambia todo: **hay que tirar las cookies despues de cada
peticion**. Wizz devuelve una cookie de sesion que invalida la siguiente
llamada con `{"handlerError":"InvalidProtocol"}`, asi que reutilizando la
sesion solo contestaba la primera consulta de todo el scan y Wizz aportaba
practicamente nada. Limpiandolas, responden todas.
"""

from __future__ import annotations

import logging
import re
from datetime import date, timedelta

from ..config import Route
from ..models import FlightOffer
from ..util import get_text, throttle
from . import links
from .base import FlightProvider, register

log = logging.getLogger("tripfinder")

HOME = "https://www.wizzair.com/en-gb"
VERSION_RE = re.compile(r"(\d+\.\d+\.\d+)/Api")

# Codigos que no son un aeropuerto sino la ciudad entera.
CODIGOS_CIUDAD = {"LON", "MIL", "ROM", "PAR", "MOW", "NYC", "STO", "VEN", "WSW", "GHV"}

_cache: dict[object, object] = {}


def _nombre(iata: str) -> tuple[str, str]:
    """Ciudad y pais. Wizz solo devuelve el codigo, y "OTP" no le dice nada a nadie."""
    from ..routes import _mundial

    return _mundial(iata)


def _sesion():
    """Sesion con huella de Chrome. Sin esto Wizz contesta 403."""
    from curl_cffi import requests as cr

    if "s" not in _cache:
        _cache["s"] = cr.Session(impersonate="chrome")
    return _cache["s"]


def _post(ruta: str, cuerpo: dict, timeout: int = 35):
    """POST a la API tirando la cookie que Wizz deja puesta.

    Sin el `cookies.clear()` la segunda llamada de la sesion ya responde 400.
    """
    s = _sesion()
    try:
        return s.post(f"{_base_url()}{ruta}", json=cuerpo, headers=_cabeceras(), timeout=timeout)
    finally:
        s.cookies.clear()


def _get(ruta: str, timeout: int = 30):
    s = _sesion()
    try:
        return s.get(f"{_base_url()}{ruta}", headers=_cabeceras(), timeout=timeout)
    finally:
        s.cookies.clear()


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
    r = _get("/asset/map?languageCode=en-gb")
    r.raise_for_status()
    datos = r.json()
    ciudades = datos.get("cities", datos if isinstance(datos, list) else [])
    for c in ciudades:
        if c.get("iata") == origen:
            # El mapa mezcla codigos de ciudad (LON, MIL, ROM, VEN) con los de
            # aeropuerto. Los de ciudad no sirven para pedir precios y ademas
            # salian duplicados en la web ("Milan" y "MIL" como dos destinos).
            destinos = [
                x["iata"]
                for x in c.get("connections", [])
                if x.get("iata") and x["iata"] not in CODIGOS_CIUDAD
            ]
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
        """Precio mas barato de cada dia, en las dos direcciones."""
        clave = (route.origin, destino, desde, hasta, int(self.cfg.get("adults", 1)))
        guardado = _cache.get(clave)
        if guardado is not None:
            return guardado  # type: ignore[return-value]

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

        datos = None
        for intento in range(2):
            throttle("wizz", float(self.cfg.get("min_interval_seconds", 2)))
            try:
                r = _post("/search/timetable", cuerpo)
            except Exception as exc:  # noqa: BLE001 - se reintenta una vez
                log.debug("Wizz %s-%s: %s", route.origin, destino, exc)
                continue
            if r.status_code == 200:
                datos = r.json()
                break
            # 400 = InvalidProtocol, que casi siempre es la cookie envenenada de
            # la peticion anterior. Se descarta la sesion y se vuelve a probar.
            log.debug("Wizz %s-%s %s..%s -> %s (intento %d)",
                      route.origin, destino, desde, hasta, r.status_code, intento + 1)
            _cache.pop("s", None)

        if datos is None:
            _cache[clave] = ({}, {})
            return {}, {}

        salida = (
            {f["departureDate"][:10]: f for f in datos.get("outboundFlights", []) if f.get("price")},
            {f["departureDate"][:10]: f for f in datos.get("returnFlights", []) if f.get("price")},
        )
        _cache[clave] = salida
        return salida

    # -- busqueda por fechas concretas -----------------------------------
    def buscar_fechas(
        self, route: Route, destinos: list[str], pares: list[tuple[date, date]]
    ) -> list[FlightOffer]:
        """Precios de Wizz para pares (ida, vuelta) exactos.

        Lo usa la busqueda personalizada: alli las fechas las pone el usuario,
        no se barre el calendario entero. Una consulta cubre todo un mes, asi
        que varios findes del mismo mes salen de la misma peticion.
        """
        if not pares:
            return []
        try:
            posibles = set(destinos_desde(route.origin))
        except Exception as exc:  # noqa: BLE001
            log.warning("Wizz: sin mapa de rutas (%s)", exc)
            return []
        objetivo = [d for d in destinos if d in posibles] if destinos else sorted(posibles)
        if not objetivo:
            return []

        # Una ventana por mes tocado: Wizz rechaza rangos largos.
        meses = sorted({(d.year, d.month) for par in pares for d in par})
        ofertas: list[FlightOffer] = []
        for destino in objetivo:
            dias_ida: dict[str, dict] = {}
            dias_vuelta: dict[str, dict] = {}
            for anio, mes in meses:
                primero = date(anio, mes, 1)
                ultimo = (primero + timedelta(days=32)).replace(day=1) - timedelta(days=1)
                try:
                    i, v = self._ventana(route, destino, primero.isoformat(), ultimo.isoformat())
                except Exception as exc:  # noqa: BLE001
                    log.debug("Wizz %s %s-%s: %s", destino, anio, mes, exc)
                    continue
                dias_ida.update(i)
                dias_vuelta.update(v)
            for salida, regreso in pares:
                ida = dias_ida.get(salida.isoformat())
                vuelta = dias_vuelta.get(regreso.isoformat())
                if not (ida and vuelta):
                    continue
                oferta = self._oferta(route, destino, salida.isoformat(), regreso.isoformat(),
                                      ida, vuelta, (regreso - salida).days)
                if oferta is not None:
                    ofertas.append(oferta)
        log.info("Wizz %s: %d tarifas en %d destinos", route.origin, len(ofertas), len(objetivo))
        return ofertas

    def _oferta(self, route: Route, destino: str, iso: str, regreso: str,
                ida: dict, vuelta: dict, noches: int) -> FlightOffer | None:
        # OJO: `search/timetable` devuelve el precio POR PERSONA y se rie del
        # `adultCount` que le mandes (comprobado: 1, 2 y 3 pasajeros dan la
        # misma cifra). El resto de providers dan el total del grupo, asi que
        # sin multiplicar aqui Wizz salia a mitad de precio que nadie y se
        # comia las primeras posiciones de la lista.
        adultos = max(1, int(self.cfg.get("adults", 1)))
        precio = ((ida["price"]["amount"] or 0) + (vuelta["price"]["amount"] or 0)) * adultos
        if not precio:
            return None
        ciudad, pais = _nombre(destino)
        return FlightOffer(
            provider="wizzair",
            origin=route.origin,
            origin_name=route.origin_name,
            destination=destino,
            destination_name=ciudad,
            destination_country=pais,
            depart_date=iso,
            return_date=regreso,
            nights=noches,
            price=round(float(precio), 2),
            currency=ida["price"].get("currencyCode", "EUR"),
            airline="Wizz Air",
            stops=0,
            adults=adultos,
            deep_link=links.wizzair(route.origin, destino, iso, regreso, adultos),
        )

    def _casar(self, route: Route, destino: str, idas: dict, vueltas: dict, noches: int) -> list[FlightOffer]:
        weekend = self.cfg.get("weekend", {}) or {}
        dia_ida = int(weekend.get("outbound_weekday", 4))
        adultos = max(1, int(self.cfg.get("adults", 1)))

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
                # Por persona, igual que en _oferta: hay que multiplicar.
                precio = (
                    (ida["price"]["amount"] or 0) + (vuelta["price"]["amount"] or 0)
                ) * adultos
                if not precio:
                    continue
                ofertas.append(
                    FlightOffer(
                        provider="wizzair",
                        origin=route.origin,
                        origin_name=route.origin_name,
                        destination=destino,
                        destination_name=_nombre(destino)[0],
                        destination_country=_nombre(destino)[1],
                        depart_date=iso,
                        return_date=regreso,
                        nights=n,
                        price=round(float(precio), 2),
                        currency=ida["price"].get("currencyCode", "EUR"),
                        airline="Wizz Air",
                        stops=0,
                        adults=adultos,
                        deep_link=links.wizzair(route.origin, destino, iso, regreso, adultos),
                                )
                )
                break  # con la primera duracion que cuadre basta
        # Solo lo mas barato de cada dia de salida, y priorizando los findes.
        ofertas.sort(key=lambda o: (date.fromisoformat(o.depart_date).weekday() != dia_ida, o.price))
        return ofertas[:12]
