"""En que zona de la ciudad conviene dormir.

EL DATO YA ESTABA. Airbnb devuelve por anuncio un `area` con la forma
«Apartamento en Monastiraki», «Hotel boutique en Plaka»: lo de despues del
«en» es el barrio. Se guardaba entero y solo se usaba como texto suelto de la
ficha, asi que la pregunta que de verdad se hace al organizar un viaje —«¿en
que zona me quedo?»— no la contestaba nadie.

COMO SE ELIGE. Ni el mas barato ni el mas centrico: los dos juntos, que es el
mismo criterio que ya usa `ranking.py` para ordenar. Un estudio a doce
kilometros en una escapada de dos noches son dos horas de transporte al dia y
el precio de los billetes; un barrio carisimo en el centro tampoco es la
respuesta.

Y CUANDO NO SE SABE, NO SE DICE. Hace falta que el barrio se repita —un solo
anuncio no es un barrio, es un anuncio— y que no sea el nombre de la ciudad:
«Apartamento en Oslo» no dice donde. Sin eso se devuelve None y el panel no
pinta nada, que es mejor que recomendar una zona inventada.
"""

from __future__ import annotations

import re
import statistics
import unicodedata
from typing import Any

from ..models import StayOffer

# Cuantos anuncios hacen falta en un barrio para poder recomendarlo. Con uno,
# lo que se recomienda es ese piso, no la zona.
MINIMO = 2

# Lo que Airbnb pone delante del barrio: «Apartamento en X», «Habitacion
# compartida en X», «Hotel boutique en X».
EN = re.compile(r"\ben\s+(.+)$", re.IGNORECASE)


def _pelado(texto: str) -> str:
    sin = unicodedata.normalize("NFD", str(texto or ""))
    return "".join(c for c in sin if unicodedata.category(c) != "Mn").strip().lower()


def barrio(area: str, ciudad: str) -> str:
    """El barrio que hay dentro de un `area`, o "" si ahi no hay barrio.

    «Apartamento en Monastiraki» -> «Monastiraki».
    «Apartamento en Oslo», estando en Oslo -> "" (eso no dice donde).
    """
    # Sin «en», no hay barrio. Antes se tomaba el texto entero, y con Airbnb no
    # se notaba porque siempre escribe «X en Y»; pero Holidu pone solo el tipo
    # («Apartamento»), y toda la ciudad acababa en una falsa zona llamada así.
    m = EN.search(str(area or ""))
    if not m:
        return ""
    sitio = m.group(1).strip(" .,")
    if not sitio:
        return ""
    # El nombre de la ciudad no es un barrio. Tampoco «Oslo Centro» cuando la
    # ciudad es Oslo: ahi lo que informa es «Centro», no la ciudad repetida.
    pelado_ciudad = _pelado(ciudad)
    if _pelado(sitio) == pelado_ciudad or not pelado_ciudad:
        return "" if _pelado(sitio) == pelado_ciudad else sitio
    return sitio


def _mediana(valores: list[float]) -> float:
    return float(statistics.median(valores)) if valores else 0.0


def recomendar(stays: list[StayOffer] | list[dict], ciudad: str) -> dict[str, Any] | None:
    """La zona en la que conviene quedarse, con por que.

    Devuelve None cuando no hay con que decirlo, que pasa a menudo: en ciudades
    pequenas todos los anuncios dicen el nombre de la ciudad y ahi no hay zona
    que recomendar.
    """
    grupos: dict[str, list[dict]] = {}
    for s in stays:
        d = s if isinstance(s, dict) else s.to_dict()
        if not d.get("price_total"):
            continue  # los enlaces de comparador no traen precio ni sitio
        nombre = barrio(d.get("area", ""), ciudad)
        if nombre:
            grupos.setdefault(nombre, []).append(d)

    candidatos = {k: v for k, v in grupos.items() if len(v) >= MINIMO}
    if not candidatos:
        return None

    # Lo barato y lo cerca, normalizados entre si: asi un barrio no gana solo
    # por ser el mas barato de la lista ni solo por el mas centrico.
    resumen = {}
    for nombre, casas in candidatos.items():
        precios = [float(c["price_total"]) for c in casas]
        kms = [float(c["km_centro"]) for c in casas if c.get("km_centro") is not None]
        resumen[nombre] = {
            "zona": nombre,
            "cuantos": len(casas),
            "desde": round(min(precios), 2),
            "precio": round(_mediana(precios), 2),
            "km": round(_mediana(kms), 2) if kms else None,
        }

    precios = [r["precio"] for r in resumen.values()]
    kms = [r["km"] for r in resumen.values() if r["km"] is not None]
    p_min, p_max = min(precios), max(precios)
    k_min, k_max = (min(kms), max(kms)) if kms else (0.0, 0.0)

    def nota(r: dict) -> float:
        # 0 es lo peor y 1 lo mejor, en cada eje. Con un solo candidato o con
        # todos iguales, el eje no reparte y vale 1 para todos.
        barato = 1.0 if p_max == p_min else (p_max - r["precio"]) / (p_max - p_min)
        sin_reparto = r["km"] is None or k_max == k_min
        cerca = 1.0 if sin_reparto else (k_max - r["km"]) / (k_max - k_min)
        # La cercania pesa un poco mas: el precio de una noche se compara solo,
        # pero media hora de metro con las maletas no la ve nadie en la lista.
        return 0.45 * barato + 0.55 * cerca

    mejor = max(resumen.values(), key=nota)
    return {
        **mejor,
        # Con qué se ha comparado: una recomendación entre dos barrios no es lo
        # mismo que entre diez, y quien la lee tiene derecho a saberlo.
        "de": len(resumen),
    }
