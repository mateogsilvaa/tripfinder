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
from typing import Any, Iterator
from urllib.parse import quote

from ..models import StayOffer
from ..util import get_text
from .base import StayProvider, StayRequest, register

log = logging.getLogger("tripfinder")

SEARCH = "https://www.airbnb.es/s/{place}/homes"
STATE_RE = re.compile(r'id="data-deferred-state-0"[^>]*>(\{.*?\})</script>', re.S)
NUM_RE = re.compile(r"(\d[\d.,]*)")
NIGHTS_RE = re.compile(r"(\d+)\s*noche", re.I)
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

        seen: set[str] = set()
        offers: list[StayOffer] = []
        for item in items:
            if item.get("__typename") != "StaySearchResult":
                continue
            lid = _listing_id(item)
            if not lid or lid in seen:
                continue
            seen.add(lid)

            name = (item.get("nameLocalized") or {}).get(
                "localizedStringWithTranslationPreference"
            ) or item.get("title") or "Alojamiento"
            total, per_night = _prices(item, req.nights)
            rating, reviews = _rating(item)
            pics = item.get("contextualPictures") or []
            image = pics[0].get("picture", "") if pics and isinstance(pics[0], dict) else ""

            offers.append(
                StayOffer(
                    provider="airbnb",
                    name=str(name)[:120],
                    url=(
                        f"https://www.airbnb.es/rooms/{lid}"
                        f"?check_in={req.checkin}&check_out={req.checkout}&adults={req.adults}"
                    ),
                    kind="stay",
                    price_total=total,
                    price_per_night=per_night,
                    rating=rating,
                    reviews=reviews,
                    area=str(item.get("title") or req.city),
                    image=image,
                )
            )
            if len(offers) >= MAX_RESULTS:
                break

        log.info("Airbnb %s: %d alojamientos", req.city, len(offers))
        return offers
