"""Hidden-city ("skiplagging"): comprar un billete mas lejos y bajarse en la escala.

A veces MAD->Bucarest con escala en Paris cuesta menos que MAD->Paris directo,
porque el precio no lo pone la distancia sino la competencia de cada ruta. Si tu
destino real era Paris, te bajas en la escala y te ahorras la diferencia.

No es ilegal, pero tiene letra pequeña que hay que enseñar SIEMPRE:

* Solo sirve para la ida. Al no presentarte al siguiente tramo, la aerolinea
  cancela automaticamente el resto del billete, incluida la vuelta.
* Sin equipaje facturado: la maleta sigue hasta el destino final del billete.
* Las aerolineas lo persiguen: pueden cerrarte la cuenta de puntos si eres
  reincidente. Nunca lo hagas con tu tarjeta de fidelizacion.

Por eso todo lo que sale de aqui va marcado como `hidden_city` y la web lo
avisa antes de enseñar el precio.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import date

from .config import Config
from .models import FlightOffer
from .providers.google_flights import CONSENT_COOKIE, URL, build_tfs
from .util import get_text, throttle

log = logging.getLogger("tripfinder")

CARD_RE = re.compile(r'<li class="pIav2d"[^>]*>(.*?)</li>', re.DOTALL)
TAGS_RE = re.compile(r"<[^>]+>")
# "1 escala 2 h CDG Aeropuerto de Paris-Charles de Gaulle"
LAYOVER_RE = re.compile(r"(\d+)\s+escalas?\s+(?:\d+\s*h(?:\s*\d+\s*min)?\s+)?([A-Z]{3})")
PRICE_RE = re.compile(r"(\d[\d.]*)\s*€")
TIME_RE = re.compile(r"^(\d{1,2}:\d{2})")
AIRLINE_RE = re.compile(r"nov|dic|ene|feb|mar|abr|may|jun|jul|ago|sep|oct")


@dataclass
class HiddenCity:
    """Un billete a otro sitio del que te bajas en la escala."""

    destination: str  # donde quieres ir de verdad (la escala)
    ticket_to: str  # lo que pone el billete
    depart_date: str
    depart_time: str
    arrive_time: str
    price: float
    airline: str
    layover_hours: str
    deep_link: str

    def to_offer(self, nombre: str = "", pais: str = "") -> FlightOffer:
        o = FlightOffer(
            provider="skiplag",
            origin="MAD",
            origin_name="Madrid",
            destination=self.destination,
            destination_name=nombre or self.destination,
            destination_country=pais,
            depart_date=self.depart_date,
            depart_time=self.depart_time,
            arrive_time=self.arrive_time,
            price=self.price,
            airline=self.airline,
            stops=0,  # para ti es directo: te bajas ahi
            deep_link=self.deep_link,
        )
        o.hidden_city = True
        o.hidden_city_ticket_to = self.ticket_to
        return o


def _card_text(card: str) -> str:
    return re.sub(r"\s+", " ", TAGS_RE.sub(" ", card)).strip()


def _limpia_aerolinea(texto: str) -> str:
    """Descarta capturas que claramente no son un nombre de compania."""
    texto = (texto or "").strip()
    if not texto or "escala" in texto.lower() or re.fullmatch(r"[A-Z]{3}.*", texto):
        return "Varias"
    return texto[:30]


def _parse_cards(html: str, destino: str) -> list[tuple]:
    """Saca (precio, hora_salida, aerolinea, duracion_escala) de cada tarjeta."""
    salida = []
    for card in html.split('<li class="pIav2d"')[1:]:
        texto = _card_text(card)
        lay = LAYOVER_RE.search(texto)
        if not lay or lay.group(2) != destino:
            continue  # la escala no es donde quieres bajarte
        if lay.group(1) != "1":
            continue  # con dos escalas el truco se complica de mas

        precio = PRICE_RE.search(texto)
        horas = re.findall(r"\b(\d{1,2}:\d{2})\b", texto)
        if not (precio and horas):
            continue

        # La compania va entre la fecha de llegada y la duracion total del viaje.
        aero = re.search(r"\d+ \w+ ([A-Za-zÀ-ÿ][\wÀ-ÿ'’.\- ]{2,26}?) \d+\s*h", texto)
        duracion = re.search(r"escalas?\s+(\d+\s*h(?:\s*\d+\s*min)?|\d+\s*min)", texto)
        salida.append(
            (
                float(precio.group(1).replace(".", "")),
                horas[0].zfill(5),
                _limpia_aerolinea(aero.group(1) if aero else ""),
                duracion.group(1) if duracion else "",
            )
        )
    return salida


def find_hidden_city(
    destino: str,
    dia: date,
    cfg: Config,
    precio_directo: float | None = None,
    max_queries: int = 6,
) -> list[HiddenCity]:
    """Busca billetes que hacen escala en `destino` y salen mas baratos."""
    skcfg = cfg.raw.get("skiplagging", {}) or {}
    if not skcfg.get("enabled", True):
        return []

    mas_alla = (skcfg.get("beyond", {}) or {}).get(destino, [])
    if not mas_alla:
        log.info("Skiplagging: %s no es hub conocido, nada que probar", destino)
        return []

    encontrados: list[HiddenCity] = []
    vistos: set[tuple] = set()
    for lejos in mas_alla[:max_queries]:
        throttle("google", float(cfg.search.get("google", {}).get("min_interval_seconds", 4)))
        tfs = build_tfs("MAD", lejos, dia.isoformat(), dia.isoformat())
        try:
            html = get_text(
                URL,
                params={"tfs": tfs, "curr": "EUR", "hl": "es", "gl": "ES"},
                headers={"Cookie": CONSENT_COOKIE},
                timeout=40,
            )
        except Exception as exc:  # noqa: BLE001 - un destino fallido no tumba el resto
            log.warning("Skiplagging MAD-%s: %s", lejos, exc)
            continue

        for precio, sale, aerolinea, duracion in _parse_cards(html, destino):
            if precio_directo and precio >= precio_directo:
                continue  # si no ahorra, no compensa el lio
            # Google repite cada vuelo en "mejores" y en "todos": se deduplica.
            clave = (precio, lejos, sale)
            if clave in vistos:
                continue
            vistos.add(clave)
            encontrados.append(
                HiddenCity(
                    destination=destino,
                    ticket_to=lejos,
                    depart_date=dia.isoformat(),
                    depart_time=sale,
                    # La hora a la que aterrizas en la escala no la da Google en
                    # el listado: se ve al abrir el vuelo, y por eso no se inventa.
                    arrive_time="",
                    price=precio,
                    airline=aerolinea,
                    layover_hours=duracion,
                    deep_link=f"{URL}?tfs={tfs}&curr=EUR&hl=es&gl=ES",
                )
            )

    encontrados.sort(key=lambda h: h.price)
    log.info(
        "Skiplagging %s: %d billetes que paran ahi%s",
        destino,
        len(encontrados),
        f" y bajan de {precio_directo:.0f} EUR" if precio_directo else "",
    )
    return encontrados
