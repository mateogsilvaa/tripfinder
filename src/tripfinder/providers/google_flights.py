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
from . import links
from .base import FlightProvider, register

log = logging.getLogger("tripfinder")

URL = "https://www.google.com/travel/flights"
# Consentimiento no personalizado. No lleva identificador de usuario.
CONSENT_COOKIE = "SOCS=CAESEwgDEgk0ODE3Nzk3MjQaAmVzIAEaBgiA_LyaBg"

LABEL_RE = re.compile(r'aria-label="([^"]{60,400})"')
CARD_RE = re.compile(r'<li class="pIav2d"[^>]*>(.*?)</li>', re.DOTALL)
TAGS_RE = re.compile(r"<[^>]+>")
CARD_PRICE_RE = re.compile(r"(\d[\d.]*)\s*€")
CARD_TIME_RE = re.compile(r"(\d{1,2}:\d{2})")
CARD_AIRLINE_RE = re.compile(r"\d{1,2}:\d{2} el \w+, \d+ \w+ ([A-Za-zÀ-ÿ][\wÀ-ÿ',.\- ]{2,40}?) \d+\s*h")
PRICE_RE = re.compile(r"A partir de\s+([\d.]+)\s+euros")
# Google alterna varias formas de nombrar la compania y antes solo se cogian
# dos: las etiquetas de "Vuelo de X y Y" o "con X" se quedaban en "Varias", y
# entonces easyJet o Vueling perdian su enlace de reserva propio.
AIRLINE_RE = re.compile(
    r"(?:Vuelos? directos? de|Vuelos? (?:de|con|operados? por|operado por))\s+([^.]+?)\."
)
# "Air France. Operado por HOP!." -> nos quedamos con quien vende el billete.
OPERADO_RE = re.compile(r"\s*Operad[oa]s? por\s+[^.]+\.?$", re.IGNORECASE)
# "Vuelo con 1 escala de British Airways" cuela el numero de escalas dentro del
# nombre de la compania, y entonces no casa con ningun enlace de reserva.
ESCALAS_PREFIJO_RE = re.compile(r"^\s*(?:\d+\s+)?escalas?\s+(?:de|con)\s+", re.IGNORECASE)
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


def _limpia_aerolinea(nombre: str) -> str:
    """"Vuelo con 1 escala de Iberia. Operado por Air Nostrum" -> "Iberia"."""
    limpio = OPERADO_RE.sub("", (nombre or "").strip())
    limpio = ESCALAS_PREFIJO_RE.sub("", limpio)
    return limpio.strip(" .,")[:40] or "Varias"


def _bloqueada(html: str) -> bool:
    """Google contestando con el muro de consentimiento o con un captcha.

    Antes esto se traducia en "no hay vuelos" y parecia que la ruta estaba
    vacia; conviene distinguirlo de un resultado de verdad.
    """
    if len(html) < 20000:
        return True
    return "unusual traffic" in html or "id=\"captcha-form\"" in html


def _tarjetas(html: str) -> list[str]:
    """Trocea la pagina por resultados.

    Cortar en el primer </li> parecia lo natural y era el fallo: las tarjetas
    llevan listas anidadas dentro, asi que se quedaba media tarjeta y el precio
    se perdia (visto en MAD-STR, con 18 vuelos de SWISS y Lufthansa invisibles).
    Se corta por el comienzo del siguiente resultado.
    """
    partes = html.split('<li class="pIav2d"')
    return partes[1:] if len(partes) > 1 else []


@register("google_flights")
class GoogleFlightsProvider(FlightProvider):
    def __init__(self, search_cfg):
        super().__init__(search_cfg)
        self.gcfg = search_cfg.get("google", {}) or {}
        # El CLI lo rellena con los destinos que ya ha encontrado el resto de
        # providers, para no disparar consultas a ciegas contra todo el mapa.
        self.shortlist: list[tuple[str, date, date]] = []
        self.names: dict[str, tuple[str, str]] = {}  # IATA -> (ciudad, pais)
        # Tope de consultas. El scan automatico usa el del YAML; la busqueda a
        # mano lo sube, porque es una sola tirada y ahi si compensa barrer.
        self.limite: int | None = None
        self.bloqueado = False
        self.paginas_vacias = 0

    def _tope(self) -> int:
        """Cuantas companias distintas se guardan de cada consulta.

        Eran 4 y se quedaban fuera las low cost cuando la ruta la copan tres
        tradicionales: con 6 caben easyJet o Transavia sin disparar el tamano
        del JSON, porque el resto se fusiona luego como alternativa.
        """
        return int(self.gcfg.get("airlines_per_query", 6))

    def search(self, route: Route) -> list[FlightOffer]:
        pairs = self.shortlist
        if not pairs:
            log.info("Google Flights: sin destinos que comprobar para %s", route.origin)
            return []

        max_queries = self.limite or int(self.gcfg.get("max_queries", 20))
        offers: list[FlightOffer] = []
        for dest, out_date, in_date in pairs[:max_queries]:
            try:
                offers += self._one_search(route, dest, out_date, in_date)
            except Exception as exc:  # noqa: BLE001 - una consulta fallida no tumba el scan
                log.warning("Google Flights %s %s: %s", dest, out_date, exc)
        consultas = min(len(pairs), max_queries)
        # Cuantos DESTINOS distintos, no solo cuantas consultas: es lo que
        # separa el barrido de madrugada del diario, y sin verlo en el log no
        # hay forma de saber si de verdad recorrio el mapa entero (#35).
        destinos = len({d for d, _, _ in pairs[:max_queries]})
        log.info(
            "Google Flights %s: %d tarifas en %d consultas sobre %d destinos",
            route.origin, len(offers), consultas, destinos,
        )
        # Paginas vacias en cadena = nos han capado. Es importante que se vea:
        # antes parecia "no hay vuelos" cuando en realidad no nos contestaban.
        if consultas >= 5 and (self.paginas_vacias > consultas * 0.3 or len(offers) < consultas * 0.2):
            log.warning(
                "Google devuelve casi todo vacio (%d/%d): probablemente limite de peticiones",
                len(offers), consultas,
            )
            self.bloqueado = True
        return offers

    def _desde_tarjetas(self, html, route, dest, out_date, in_date, url, nights) -> list[FlightOffer]:
        """Lee el texto visible de cada resultado cuando falta la etiqueta."""
        mejores: dict[str, FlightOffer] = {}
        for card in _tarjetas(html):
            texto = re.sub(r"\s+", " ", TAGS_RE.sub(" ", card)).strip()
            precio = CARD_PRICE_RE.search(texto)
            horas = CARD_TIME_RE.findall(texto)
            if not (precio and horas):
                continue
            aero = CARD_AIRLINE_RE.search(texto)
            escalas_m = re.search(r"(\d+)\s+escalas?", texto)
            aerolinea = _limpia_aerolinea(aero.group(1)) if aero else "Varias"
            adultos = max(1, int(self.cfg.get("adults", 1)))
            enlace_aero, etiqueta_aero = links.por_aerolinea(
                aerolinea, route.origin, dest, out_date.isoformat(), in_date.isoformat(), adultos
            )
            oferta = FlightOffer(
                provider="google",
                origin=route.origin,
                origin_name=route.origin_name,
                destination=dest,
                destination_name=self.names.get(dest, (dest, ""))[0],
                destination_country=self.names.get(dest, ("", ""))[1],
                depart_date=out_date.isoformat(),
                depart_time=horas[0].zfill(5),
                arrive_time=(horas[1].zfill(5) if len(horas) > 1 else ""),
                return_date=in_date.isoformat(),
                nights=nights,
                price=round(float(precio.group(1).replace(".", "")), 2),
                airline=aerolinea,
                stops=int(escalas_m.group(1)) if escalas_m else 0,
                adults=adultos,
                deep_link=url,
                airline_link=enlace_aero,
                airline_link_label=etiqueta_aero,
            )
            previa = mejores.get(aerolinea)
            if previa is None or oferta.price < previa.price:
                mejores[aerolinea] = oferta
        log.info("Google (texto de tarjeta) %s: %d companias", dest, len(mejores))
        return sorted(mejores.values(), key=lambda o: o.price)[: self._tope()]

    def _one_search(self, route: Route, dest: str, out_date: date, in_date: date) -> list[FlightOffer]:
        throttle("google", float(self.gcfg.get("min_interval_seconds", 4)))
        adultos = max(1, int(self.cfg.get("adults", 1)))
        tfs = build_tfs(route.origin, dest, out_date.isoformat(), in_date.isoformat(), adultos)
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

        if _bloqueada(html):
            # Una pagina de 4 kB no es una ruta sin vuelos, es una puerta
            # cerrada. Se cuenta aparte para poder avisar en la web.
            self.paginas_vacias += 1
            log.warning("Google %s %s: pagina vacia o muro de consentimiento", dest, out_date)
            return []

        best_por_aerolinea: dict[str, FlightOffer] = {}
        etiquetas = [e for e in LABEL_RE.findall(html) if "euros" in e and "Sale de" in e]
        if not etiquetas:
            # En algunas rutas Google no pone la etiqueta de accesibilidad con el
            # precio (visto en MAD-STR: 18 vuelos de SWISS y Lufthansa que se
            # perdian enteros). El texto de la tarjeta si lo trae siempre.
            return self._desde_tarjetas(html, route, dest, out_date, in_date, url, nights)

        for label in etiquetas:
            price_m, time_m = PRICE_RE.search(label), TIME_RE.search(label)
            if not (price_m and time_m):
                continue

            hora = time_m.group(1).zfill(5)  # "9:00" -> "09:00"

            airline_m = AIRLINE_RE.search(label)
            airline = _limpia_aerolinea(airline_m.group(1)) if airline_m else "Varias"
            stops_m = STOPS_RE.search(label)
            escalas = 0 if "directo" in label else int(stops_m.group(1)) if stops_m else 0
            # easyJet, Vueling o Transavia salen aqui pero se reservan en su
            # web: el enlace de Google sirve para mirar, no para comprar.
            enlace_aero, etiqueta_aero = links.por_aerolinea(
                airline, route.origin, dest, out_date.isoformat(), in_date.isoformat(), adultos
            )

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
                adults=adultos,
                deep_link=url,
                airline_link=enlace_aero,
                airline_link_label=etiqueta_aero,
            )

            previa = best_por_aerolinea.get(airline)
            if previa is None or offer.price < previa.price:
                best_por_aerolinea[airline] = offer

        return sorted(best_por_aerolinea.values(), key=lambda o: o.price)[: self._tope()]
