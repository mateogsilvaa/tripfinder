"""Adapter de Airbnb (best-effort).

Airbnb no publica API abierta, asi que se lee el estado JSON que la propia pagina
de resultados embebe en el HTML (`<script id="data-deferred-state-0">`). Es la via
menos invasiva -una sola peticion, sin navegador headless- pero tambien la mas
fragil: si cambian el markup este provider devuelve lista vacia y el circuito
sigue funcionando gracias a `deeplinks`, que siempre deja un enlace usable.

Forma del dato (agosto 2026): dentro del estado hay listas `searchResults` con
objetos `StaySearchResult`; el id real del anuncio viene en base64 dentro de
`demandStayListing.id` como "DemandStayListing:<id>".
"""

from __future__ import annotations

import base64
import binascii
import json
import logging
import re
from collections.abc import Iterator
from typing import Any
from urllib.parse import quote

from ..models import StayOffer
from ..util import get_text
from .base import StayProvider, StayRequest, register

log = logging.getLogger("tripfinder")

SEARCH = "https://www.airbnb.es/s/{place}/homes"

# Airbnb no es solo pisos: tiene hoteles listados con precio y sin pedir clave
# de nadie. Se pregunta dos veces —lo de siempre y solo habitaciones de hotel—
# porque en una busqueda normal los hoteles se pierden entre cien apartamentos y
# no llegan a las dieciocho primeras. Es la unica via de tener hoteles con
# precio real sin credenciales: la de Amadeus las pide y hoy no las hay.
PASADAS = (
    ("stay", {}),
    ("hotel", {"room_types[]": "Hotel room"}),
)
STATE_RE = re.compile(r'id="data-deferred-state-0"[^>]*>(\{.*?\})</script>', re.DOTALL)
NUM_RE = re.compile(r"(\d[\d.,]*)")
NIGHTS_RE = re.compile(r"(\d+)\s*noche", re.IGNORECASE)
MAX_RESULTS = 18


def _walk(node: Any) -> Iterator[dict]:
    if isinstance(node, dict):
        yield node
        for v in node.values():
            yield from _walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from _walk(v)


def _to_number(text: str | None) -> float | None:
    """'1.234,56 €' -> 1234.56 (formato es-ES)."""
    m = NUM_RE.search(text or "")
    if not m:
        return None
    raw = m.group(1).rstrip(".,").replace(".", "").replace(",", ".")
    try:
        return float(raw)
    except ValueError:
        return None


def _listing_id(item: dict) -> str:
    raw = (item.get("demandStayListing") or {}).get("id") or ""
    try:
        decoded = base64.b64decode(raw + "==").decode("utf-8", "replace")
    except (binascii.Error, ValueError):
        return ""
    return decoded.split(":")[-1] if ":" in decoded else ""


def _prices(item: dict, nights: int) -> tuple[float | None, float | None]:
    """Devuelve (total, por_noche).

    Solo se lee el TOTAL de la caja de precio y el por-noche se divide aqui.
    El desglose de Airbnb mezcla tarifas con y sin descuento y daba numeros
    absurdos (180 EUR de total con "23 EUR/noche" en un viaje de 3 noches).
    """
    block = item.get("structuredDisplayPrice") or {}
    primary = block.get("primaryLine") or {}
    total = None

    # El componente con descuento manda sobre el precio original tachado.
    for comp in primary.get("orderedComponents") or []:
        tipo = comp.get("__typename", "")
        valor = _to_number(comp.get("discountedPrice") or comp.get("price"))
        if valor is None:
            continue
        if tipo.startswith("Discounted"):
            total = valor
            break
        if total is None:
            total = valor

    label = primary.get("accessibilityLabel") or ""
    if total is None:
        total = _to_number(label)
    if total is None:
        return None, None

    # Si la etiqueta no dice "total", Airbnb esta mostrando el precio por noche.
    if "total" not in label.lower():
        return round(total * nights, 2), round(total, 2)
    return round(total, 2), round(total / max(1, nights), 2)


def _coordenadas(item: dict) -> tuple[float | None, float | None]:
    """Donde esta el anuncio, si el estado lo trae.

    Se busca en profundidad y no por una ruta fija a proposito: Airbnb ha movido
    esta pareja de sitio mas de una vez, y aqui no se puede comprobar contra la
    pagina real. Sin coordenadas la cama se ordena solo por precio, que es lo
    que se hacia antes de existir esto.
    """
    for nodo in _walk(item):
        lat, lon = nodo.get("latitude"), nodo.get("longitude")
        if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
            return float(lat), float(lon)
    return None, None


# Cuantas fotos se guardan por alojamiento. Airbnb devuelve entre cinco y
# veinte; con seis el carrusel ya cuenta la casa y el fichero no se dispara.
MAX_FOTOS = 6


def _fotos(item: dict) -> list[str]:
    """Las fotos del anuncio, en orden y sin repetir.

    Estaban ahi desde el principio: el codigo cogia `contextualPictures[0]` y
    tiraba el resto, asi que el panel ensenaba una lista de texto de algo que
    se elige mirando.
    """
    fotos: list[str] = []
    for pic in item.get("contextualPictures") or []:
        if not isinstance(pic, dict):
            continue
        url = str(pic.get("picture") or "").strip()
        # Solo https: una foto por http en una pagina https no la pinta el
        # navegador y ademas avisa de contenido mixto.
        if url.startswith("https://") and url not in fotos:
            fotos.append(url)
        if len(fotos) >= MAX_FOTOS:
            break
    return fotos


# Lo que se le quita a un nombre. No es cosmetica: son nombres que llegan con
# espacios colgando y cortados a mitad de palabra por un `[:120]` a pelo.
MAX_NOMBRE = 90


def _limpiar_nombre(crudo: str) -> str:
    """El nombre del anuncio, presentable.

    Tres cosas, todas vistas en `data/stays/*.json`: espacios de sobra (dentro
    y a los lados), entidades HTML que se colaron sin convertir, y el corte a
    lo bruto que dejaba «Apartamento en el centro de Osl».
    """
    import html as _html

    limpio = _html.unescape(str(crudo or ""))
    limpio = re.sub(r"\s+", " ", limpio).strip(" \t\n·-—|")
    if not limpio:
        return "Alojamiento"
    if len(limpio) <= MAX_NOMBRE:
        return limpio
    # Se corta por el ultimo espacio que quepa: una palabra a medias se lee
    # como un error nuestro, y lo es.
    recorte = limpio[: MAX_NOMBRE + 1]
    corte = recorte.rfind(" ")
    return (recorte[:corte] if corte > MAX_NOMBRE // 2 else limpio[:MAX_NOMBRE]).rstrip(" ,.;:-") + "…"


def _rating(item: dict) -> tuple[float | None, int | None]:
    """'4,87 (131)' -> (4.87, 131)."""
    text = item.get("avgRatingLocalized") or ""
    m = re.match(r"\s*([\d.,]+)\s*(?:\((\d+)\))?", text)
    if not m:
        return None, None
    return _to_number(m.group(1)), int(m.group(2)) if m.group(2) else None


@register("airbnb")
class AirbnbProvider(StayProvider):
    def search(self, req: StayRequest) -> list[StayOffer]:
        vistos: set[str] = set()
        todo: list[StayOffer] = []
        for tipo, extra in PASADAS:
            try:
                todo += self._pasada(req, tipo, extra, vistos)
            except Exception as exc:  # noqa: BLE001 - una pasada fallida no tumba la otra
                log.warning("Airbnb (%s) %s: %s", tipo, req.city, exc)
        log.info("Airbnb %s: %d alojamientos", req.city, len(todo))
        return todo

    def _pasada(self, req: StayRequest, tipo: str, extra: dict, vistos: set[str]) -> list[StayOffer]:
        url = SEARCH.format(place=quote(req.slug))
        params = {
            "query": req.query,  # sin esto Airbnb a veces ignora la ciudad de la ruta
            "checkin": req.checkin,
            "checkout": req.checkout,
            "adults": req.adults,
            "source": "structured_search_input_header",
            "search_type": "filter_change",
        }
        if req.max_total:
            params["price_max"] = int(req.max_total)
        params.update(extra)

        html = get_text(url, params=params, stealth=True, timeout=40)
        m = STATE_RE.search(html)
        if not m:
            log.warning("Airbnb: no se encontro el estado embebido (markup cambiado)")
            return []
        try:
            state = json.loads(m.group(1))
        except json.JSONDecodeError:
            log.warning("Airbnb: estado embebido no parseable")
            return []

        items: list[dict] = []
        for node in _walk(state):
            results = node.get("searchResults")
            if isinstance(results, list):
                items.extend(r for r in results if isinstance(r, dict))

        offers: list[StayOffer] = []
        for item in items:
            if item.get("__typename") != "StaySearchResult":
                continue
            lid = _listing_id(item)
            # `vistos` es de las DOS pasadas: un hotel que ya salio en la
            # busqueda normal no se repite por salir tambien en la de hoteles.
            if not lid or lid in vistos:
                continue
            vistos.add(lid)

            name = _limpiar_nombre(
                (item.get("nameLocalized") or {}).get(
                    "localizedStringWithTranslationPreference"
                )
                or item.get("title")
                or ""
            )
            total, per_night = _prices(item, req.nights)
            rating, reviews = _rating(item)
            # TODAS las fotos, no la primera. Airbnb las devuelve en una lista
            # y aqui se cogia `pics[0]` y se tiraba el resto: el carrusel ya
            # venia en la respuesta, solo habia que no perderlo.
            fotos = _fotos(item)
            image = fotos[0] if fotos else ""
            lat, lon = _coordenadas(item)

            offers.append(
                StayOffer(
                    provider="airbnb",
                    name=name,
                    url=(
                        f"https://www.airbnb.es/rooms/{lid}"
                        f"?check_in={req.checkin}&check_out={req.checkout}&adults={req.adults}"
                    ),
                    kind=tipo,
                    price_total=total,
                    price_per_night=per_night,
                    rating=rating,
                    reviews=reviews,
                    area=str(item.get("title") or req.city),
                    image=image,
                    images=fotos,
                    lat=lat,
                    lon=lon,
                )
            )
            if len(offers) >= MAX_RESULTS:
                break
        return offers
