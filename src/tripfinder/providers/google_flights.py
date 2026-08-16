"""Provider Google Flights: todas las aerolineas, sin clave de API.

Google no publica API, pero su buscador acepta la busqueda codificada en el
parametro `tfs` (un protobuf en base64) y **sirve los resultados ya renderizados
en el HTML**. Cada resultado trae un `aria-label` en texto plano con precio,
aerolinea, hora y escalas, que es justo lo que necesitamos; parsear eso es mucho
mas estable que perseguir nombres de clases CSS ofuscados.

Dos detalles que hacen que funcione:

* Sin cookie de consentimiento, Google devuelve el muro de cookies y la pagina
  llega vacia. Se manda una cookie `SOCS` minima (sin identificador de usuario)
  para recibir la version no personalizada.
* El precio que muestra es el **total de ida y vuelta** de esa opcion de ida.

Es scraping de una pagina publica: va con throttle alto y numero de consultas
acotado. Si Google cambia el formato, el provider devuelve lista vacia y el
scan continua con el resto.
"""

from __future__ import annotations

import base64
import logging
import re
from datetime import date

from ..config import Route
from ..models import FlightOffer
from ..util import get_text, throttle
from .base import FlightProvider, register

log = logging.getLogger("tripfinder")

URL = "https://www.google.com/travel/flights"
# Consentimiento no personalizado. No lleva identificador de usuario.
CONSENT_COOKIE = "SOCS=CAESEwgDEgk0ODE3Nzk3MjQaAmVzIAEaBgiA_LyaBg"

LABEL_RE = re.compile(r'aria-label="([^"]{60,400})"')
PRICE_RE = re.compile(r"A partir de\s+([\d.]+)\s+euros")
AIRLINE_RE = re.compile(r"(?:Vuelo directo de|Vuelos? (?:de|operados? por))\s+([^.]+?)\.")
TIME_RE = re.compile(r"Sale de .*? a las (\d{1,2}:\d{2})")
ARRIVE_RE = re.compile(r"Llega a .*? a las (\d{1,2}:\d{2})")
STOPS_RE = re.compile(r"(\d+)\s+escala")


# --- codificacion del parametro tfs (protobuf a mano, sin dependencias) -----
def _varint(n: int) -> bytes:
    out = b""
    while True:
        byte, n = n & 0x7F, n >> 7
        out += bytes([byte | 0x80]) if n else bytes([byte])
        if not n:
            return out


def _tag(field: int, wire: int) -> bytes:
    return _varint((field << 3) | wire)


def _string(field: int, value: str) -> bytes:
    raw = value.encode()
    return _tag(field, 2) + _varint(len(raw)) + raw


def _message(field: int, payload: bytes) -> bytes:
    return _tag(field, 2) + _varint(len(payload)) + payload


def _int(field: int, value: int) -> bytes:
    return _tag(field, 0) + _varint(value)


def build_tfs(origin: str, destination: str, out_date: str, in_date: str, adults: int = 1) -> str:
    """Codifica la busqueda como espera Google: campo 3 = cada trayecto."""

    def leg(day: str, frm: str, to: str) -> bytes:
        return _string(2, day) + _message(13, _string(2, frm)) + _message(14, _string(2, to))

    body = _message(3, leg(out_date, origin, destination))
    body += _message(3, leg(in_date, destination, origin))
    body += b"".join(_int(8, 1) for _ in range(adults))  # 8 = pasajeros
    body += _int(9, 1)  # 9 = clase turista
    body += _int(19, 1)  # 19 = ida y vuelta
    return base64.b64encode(body).decode().rstrip("=")


@register("google_flights")
class GoogleFlightsProvider(FlightProvider):
    def __init__(self, search_cfg):
        super().__init__(search_cfg)
        self.gcfg = search_cfg.get("google", {}) or {}
        # El CLI lo rellena con los destinos que ya ha encontrado el resto de
        # providers, para no disparar consultas a ciegas contra todo el mapa.
        self.shortlist: list[tuple[str, date, date]] = []
        self.names: dict[str, tuple[str, str]] = {}  # IATA -> (ciudad, pais)

    def search(self, route: Route) -> list[FlightOffer]:
        pairs = self.shortlist
        if not pairs:
            log.info("Google Flights: sin destinos que comprobar para %s", route.origin)
            return []

        max_queries = int(self.gcfg.get("max_queries", 20))
        offers: list[FlightOffer] = []
        for dest, out_date, in_date in pairs[:max_queries]:
            try:
                offers += self._one_search(route, dest, out_date, in_date)
            except Exception as exc:  # noqa: BLE001 - una consulta fallida no tumba el scan
                log.warning("Google Flights %s %s: %s", dest, out_date, exc)
        log.info("Google Flights %s: %d tarifas en %d consultas",
                 route.origin, len(offers), min(len(pairs), max_queries))
        return offers

    def _one_search(self, route: Route, dest: str, out_date: date, in_date: date) -> list[FlightOffer]:
        throttle("google", float(self.gcfg.get("min_interval_seconds", 4)))
        tfs = build_tfs(route.origin, dest, out_date.isoformat(), in_date.isoformat(),
                        int(self.cfg.get("adults", 1)))
        url = f"{URL}?tfs={tfs}&curr=EUR&hl=es&gl=ES"
        html = get_text(
            URL,
            params={"tfs": tfs, "curr": "EUR", "hl": "es", "gl": "ES"},
            headers={"Cookie": CONSENT_COOKIE},
            timeout=40,
        )

        # Aqui NO se filtra por hora a proposito. Aplicar la franja de la
        # escapada (15:00-22:00) descartaba a Iberia, Vueling o TAP solo por
        # volar de mañana, y dejaba a Ryanair ganando siempre por descarte.
        # Que salga en el listado lo decide despues el scoring; aunque no sea
        # la ganadora, la tarifa queda como alternativa de esa ruta y fecha.
        nights = (in_date - out_date).days

        best_por_aerolinea: dict[str, FlightOffer] = {}
        for label in LABEL_RE.findall(html):
            if "euros" not in label or "Sale de" not in label:
                continue
            price_m, time_m = PRICE_RE.search(label), TIME_RE.search(label)
            if not (price_m and time_m):
                continue

            hora = time_m.group(1).zfill(5)  # "9:00" -> "09:00"

            airline_m = AIRLINE_RE.search(label)
            airline = (airline_m.group(1).strip() if airline_m else "Varias")[:40]
            stops_m = STOPS_RE.search(label)
            escalas = 0 if "directo" in label else int(stops_m.group(1)) if stops_m else 0

            offer = FlightOffer(
                provider="google",
                origin=route.origin,
                origin_name=route.origin_name,
                destination=dest,
                destination_name=self.names.get(dest, (dest, ""))[0],
                destination_country=self.names.get(dest, ("", ""))[1],
                depart_date=out_date.isoformat(),
                depart_time=hora,
                arrive_time=(ARRIVE_RE.search(label).group(1).zfill(5)
                             if ARRIVE_RE.search(label) else ""),
                return_date=in_date.isoformat(),
                nights=nights,
                price=round(float(price_m.group(1).replace(".", "")), 2),
                airline=airline,
                stops=escalas,
                deep_link=url,
            )

            previa = best_por_aerolinea.get(airline)
            if previa is None or offer.price < previa.price:
                best_por_aerolinea[airline] = offer

        return sorted(best_por_aerolinea.values(), key=lambda o: o.price)[:4]
