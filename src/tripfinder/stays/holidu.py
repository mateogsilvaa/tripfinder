"""Holidu: pisos y casas enteras de varias webs a la vez.

POR QUE HOLIDU. Se probaron once webs de alojamiento desde un runner de GitHub,
que es desde donde corren los scrapers: Booking contesta con un reto de
JavaScript y una pagina vacia; HomeToGo, Interhome, Casamundo, Rentalia y
e-domizil, con el muro de Cloudflare; Novasol, Belvilla y Plum Guide no llegan
ni a la busqueda. Holidu contesta 200 con los anuncios dentro, sin pedir nada.

Y resulta ser la mejor de las once por otra razon: es un comparador. Cada
anuncio dice de que web viene —Vrbo, Booking, agencias locales—, asi que una
sola fuente trae pisos de muchas. Vrbo tambien respondia, pero de forma
irregular (una vez con los anuncios, otra con la pagina vacia) y sus pisos ya
llegan por aqui.

DONDE ESTAN LOS DATOS. En un `<script type="application/json"
data-key="initial-state">`, envuelto en un comentario HTML (`<!--{...}-->`).
Los anuncios cuelgan de `zustand.offersV2.offers`, un objeto indexado por id.
Cada uno trae precio total y por noche, coordenadas, fotos, tipo de
alojamiento, cuantos caben y de quien es.

SOLO SITIOS ENTEROS. Holidu es sobre todo de alquiler vacacional, pero tambien
lista B&B y habitaciones: se descartan aqui, siempre, no solo cuando la
peticion lo pide. Es lo que esta fuente viene a aportar.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any
from urllib.parse import quote

from ..models import StayOffer
from ..util import get_text
from .airbnb import MAX_FOTOS, _limpiar_nombre
from .base import StayProvider, StayRequest, register

log = logging.getLogger("tripfinder")

BASE = "https://www.holidu.es"
ESTADO_RE = re.compile(
    r'<script[^>]*data-key="initial-state"[^>]*>(.*?)</script>', re.DOTALL | re.IGNORECASE
)

# Lo que no es un sitio entero. Por exclusion y no por lista blanca: Holidu
# tiene decenas de tipos (APARTMENT, HOUSE, VILLA, CHALET, HOUSEBOAT…) y uno
# nuevo de piso no tiene por que perderse.
NO_ENTERO = ("ROOM", "BED_AND_BREAKFAST", "HOTEL", "HOSTEL", "GUEST", "PENSION", "SHARED", "DORM")


def estado_inicial(html: str) -> dict:
    """El JSON del `initial-state`, sin el comentario HTML que lo envuelve."""
    m = ESTADO_RE.search(html or "")
    if not m:
        return {}
    crudo = m.group(1).strip()
    crudo = re.sub(r"^<!--", "", crudo)
    crudo = re.sub(r"-->$", "", crudo).strip()
    try:
        datos = json.loads(crudo)
    except json.JSONDecodeError:
        return {}
    return datos if isinstance(datos, dict) else {}


# Y lo mismo mirando el titulo en español, que es lo que se lee: la primera
# prueba de verdad trajo en Montpellier una «Casa de huespedes» —habitaciones—
# con un tipo interno que no lo decia.
NO_ENTERO_TITULO = ("habitaci", "hotel", "hostal", "albergue", "desayuno", "huesped", "huésped", "b&b")

# La etiqueta que se guarda en `area`, fija y en español. NO el titulo que
# trae Holidu: a veces es el subtitulo que el anfitrion se inventa, en su idioma
# («Le Cosy, T3 en Duplex, Centre historique»), y con un «en» dentro
# `zonas.py` tomaria «Duplex…» por un barrio.
ETIQUETAS = {
    "APARTMENT": "Apartamento",
    "STUDIO": "Estudio",
    "LOFT": "Loft",
    "HOUSE": "Casa",
    "HOLIDAY_HOME": "Casa",
    "COTTAGE": "Casa",
    "FARMHOUSE": "Casa rural",
    "VILLA": "Villa",
    "CHALET": "Chalet",
    "BUNGALOW": "Bungalow",
    "CABIN": "Cabaña",
    "HOUSEBOAT": "Casa flotante",
}


def es_entero(tipo: str, titulo: str = "") -> bool:
    tipo = (tipo or "").upper()
    if not tipo or any(t in tipo for t in NO_ENTERO):
        return False
    titulo = (titulo or "").lower()
    return not any(t in titulo for t in NO_ENTERO_TITULO)


# Y el nombre del anuncio, que es lo unico que dice la verdad cuando el tipo y
# el titulo no: la primera busqueda de verdad en Amsterdam colo «Roomwest
# Amsterdam - Double room» y «luxury authentic room at Museumplein». Por
# palabra entera: «bedroom» o «rooftop» son de pisos y tienen que pasar.
HABITACION_EN_NOMBRE = re.compile(
    r"\b(room|rooms|habitaci[oó]n|chambre|zimmer|camera|dorm|hostel|b&b|bed and breakfast)\b",
    re.IGNORECASE,
)


def etiqueta(tipo: str) -> str:
    return ETIQUETAS.get((tipo or "").upper(), "Alojamiento entero")


def _fotos(oferta: dict) -> list[str]:
    fotos: list[str] = []
    for f in oferta.get("photos") or []:
        if not isinstance(f, dict):
            continue
        # De grande a pequena: la tira de la ficha las pinta a 132 px, pero el
        # carrusel las abre mas grandes.
        url = next((f[k] for k in ("l", "m", "hr", "t") if isinstance(f.get(k), str)), "")
        if url.startswith("https://") and url not in fotos:
            fotos.append(url)
        if len(fotos) >= MAX_FOTOS:
            break
    return fotos


def _nota(oferta: dict) -> float | None:
    """La valoracion, si viene y en la escala que venga, a una de 5."""
    r = oferta.get("rating")
    valor = r.get("value") if isinstance(r, dict) else r
    try:
        v = float(valor)
    except (TypeError, ValueError):
        return None
    if v <= 0:
        return None
    # En crudo llega sobre 100 —`{"value": 86, "count": 98}`, visto en Roma—,
    # pero se admite sobre 10 por si alguna fuente la da asi. El resto del
    # proyecto las guarda sobre 5.
    if v > 10:
        v = v / 20
    elif v > 5:
        v = v / 2
    return round(v, 2)


def _resenas(oferta: dict) -> int | None:
    r = oferta.get("rating")
    if isinstance(r, dict):
        for k in ("count", "reviewCount", "numberOfReviews"):
            try:
                return int(r[k])
            except (KeyError, TypeError, ValueError):
                continue
    return None


def a_oferta(oferta: dict, adultos: int = 1) -> StayOffer | None:
    """Un anuncio de Holidu, o None si no vale: sin precio, no disponible, no
    entero, en otra moneda o donde no cabeis."""
    if not isinstance(oferta, dict) or oferta.get("isAvailable") is False:
        return None
    detalles = oferta.get("details") or {}
    if not es_entero(detalles.get("apartmentType", ""), detalles.get("apartmentTypeTitle", "")):
        return None
    if HABITACION_EN_NOMBRE.search(str(detalles.get("name") or "")):
        return None
    try:
        caben = int(detalles.get("guestsCount") or 0)
    except (TypeError, ValueError):
        caben = 0
    if caben and caben < adultos:
        return None

    precio = oferta.get("price") or {}
    if (precio.get("currency") or precio.get("ccy") or "EUR") != "EUR":
        return None
    try:
        total = float(precio.get("total") or 0)
    except (TypeError, ValueError):
        total = 0.0
    if total <= 0:
        return None
    try:
        noche = float(precio.get("daily") or 0) or None
    except (TypeError, ValueError):
        noche = None

    enlace = str(oferta.get("internalLink") or "")
    if not enlace.startswith("/"):
        return None
    lugar = oferta.get("location") or {}
    fotos = _fotos(oferta)
    fuente = (oferta.get("provider") or {}).get("shortName") or ""
    return StayOffer(
        provider="holidu",
        name=_limpiar_nombre(detalles.get("name") or detalles.get("longName") or ""),
        url=f"{BASE}{enlace}",
        kind="stay",
        price_total=round(total, 2),
        price_per_night=round(noche, 2) if noche else None,
        rating=_nota(oferta),
        reviews=_resenas(oferta),
        # Solo el tipo, y sin «en …». La `location.name` de Holidu es la
        # comarca («Costa Holandesa»), no el barrio: si fuera aqui, `zonas.py`
        # agruparia la ciudad entera en una sola «zona».
        area=etiqueta(detalles.get("apartmentType", "")),
        image=fotos[0] if fotos else "",
        images=fotos,
        note=f"vía {fuente}" if fuente else "",
        lat=_num(lugar.get("lat")),
        lon=_num(lugar.get("lng")),
    )


def _num(x: Any) -> float | None:
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def ofertas_de(html: str, adultos: int = 1) -> list[StayOffer]:
    estado = estado_inicial(html)
    crudas = (((estado.get("zustand") or {}).get("offersV2") or {}).get("offers")) or {}
    lista = crudas.values() if isinstance(crudas, dict) else crudas
    out = []
    for o in lista:
        s = a_oferta(o, adultos)
        if s:
            out.append(s)
    return out


@register("holidu")
class HoliduProvider(StayProvider):
    def search(self, req: StayRequest) -> list[StayOffer]:
        html = get_text(
            f"{BASE}/s/{quote(req.city)}",
            params={"checkin": req.checkin, "checkout": req.checkout, "adults": req.adults},
            timeout=40,
            throttle_key="holidu",
            min_interval=3.0,
        )
        ofertas = ofertas_de(html, req.adults)
        log.info("Holidu %s: %d alojamientos enteros", req.city, len(ofertas))
        return ofertas
