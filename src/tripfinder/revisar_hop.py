"""¿Sigue en pie lo guardado en cada HOP?

Un vuelo se guarda en un HOP con el precio de ese momento, y el grupo puede
tardar días en votar. Mientras, el precio se mueve o el vuelo se llena. Este
paso, que va con el barrido de cada doce horas, vuelve a mirar cada vuelo
guardado (los de Ryanair y Wizz, que dan el precio de un día concreto sin
coste) y apunta en la propia propuesta lo que ha visto:

    vigente = {"estado": "en_pie" | "sube" | "baja" | "agotado" | "pasado",
               "precio": 62.0, "antes": 55.0, "comprobado": <fecha y hora>}

La web lo enseña en la tarjeta: «sigue en pie», «ha subido a 62 €», «ya no
queda a ese precio». Escribe con la cuenta de servicio (las reglas no dejan a
nadie más tocar una propuesta que no sea para votar). Los vuelos de otras
compañías (los que trae Google) no se pueden mirar día a día gratis: se
quedan sin comprobar, y la web no dice nada de ellos.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import UTC, date, datetime
from typing import Any

log = logging.getLogger("tripfinder")

# Lo que se mueve una tarifa sola en un día no es noticia (como la banda de
# cambio de precio de la web): hacen falta las dos cosas.
MIN_EUR = 3
MIN_PCT = 3
MAX_PROPUESTAS = 80  # por pasada: un barrido no puede quedarse aquí

Precio = Callable[[str, str, str, str], float | None]


def estado_de(antes: float | None, ahora: float | None, ida: str, hoy: date | None = None) -> str:
    """Qué ha pasado con un vuelo guardado."""
    hoy = hoy or date.today()
    try:
        if date.fromisoformat(ida) < hoy:
            return "pasado"
    except ValueError:
        pass
    if ahora is None:
        return "agotado"
    if not antes:
        return "en_pie"
    dif = ahora - antes
    if abs(dif) >= MIN_EUR and abs(dif) / antes * 100 >= MIN_PCT:
        return "sube" if dif > 0 else "baja"
    return "en_pie"


def companias(texto: str) -> tuple[str, str]:
    """La compañía de la ida y la de la vuelta («Ryanair + Wizz Air»)."""
    partes = [p.strip() for p in str(texto or "").split("+")]
    ida = partes[0] if partes else ""
    return ida, partes[1] if len(partes) > 1 else ida


def _proveedor(compania: str) -> str:
    c = compania.lower()
    if "ryanair" in c:
        return "ryanair"
    if "wizz" in c:
        return "wizzair"
    return ""


def precio_de_red(proveedor: str, origen: str, destino: str, dia: str) -> float | None:
    """El precio por persona de un vuelo de ida, ese día, en esa compañía."""
    d = date.fromisoformat(dia)
    if proveedor == "ryanair":
        from .providers import ryanair

        tabla = ryanair.precios_por_dia(origen, destino, d, d)
    elif proveedor == "wizzair":
        from .providers import wizzair

        tabla = wizzair.precios_por_dia(origen, destino, d, d)
    else:
        return None
    fila = tabla.get(dia)
    return float(fila["price"]) if fila and fila.get("price") else None


def precio_actual(p: dict[str, Any], precio: Precio = precio_de_red) -> float | str | None:
    """El precio por persona de ida y vuelta de hoy, None si ya no se puede
    volar ese día, o "" si no se sabe mirar (otra compañía o faltan datos)."""
    origen, destino, ida, vuelta = p.get("origen") or "MAD", p.get("iata"), p.get("ida"), p.get("vuelta")
    c_ida, c_vuelta = companias(p.get("compania", ""))
    prov_ida, prov_vuelta = _proveedor(c_ida), _proveedor(c_vuelta)
    if not (destino and ida and prov_ida) or (vuelta and not prov_vuelta):
        return ""
    a = precio(prov_ida, origen, destino, ida)
    if a is None:
        return None
    if not vuelta:
        return round(a, 2)
    b = precio(prov_vuelta, destino, origen, vuelta)
    return None if b is None else round(a + b, 2)


def revisar(
    db: Any, hoy: date | None = None, precio: Callable[..., Any] = precio_de_red, maximo: int = MAX_PROPUESTAS
) -> dict[str, int]:
    """Mira los vuelos guardados de los HOP vivos y apunta `vigente` en cada uno."""
    from google.cloud.firestore_v1.base_query import FieldFilter

    hoy = hoy or date.today()
    ahora = datetime.now(UTC)
    cuenta = {"mirados": 0, "en_pie": 0, "sube": 0, "baja": 0, "agotado": 0, "pasado": 0, "sin_mirar": 0}
    cache: dict[tuple, Any] = {}

    def con_cache(prov: str, o: str, d: str, dia: str):
        k = (prov, o, d, dia)
        if k not in cache:
            try:
                cache[k] = precio(prov, o, d, dia)
            except Exception as exc:  # noqa: BLE001 - una ruta rota no tumba el resto
                log.debug("Revisar HOP %s %s-%s %s: %s", prov, o, d, dia, exc)
                cache[k] = ""
        return cache[k]

    for hop in db.collection("hops").where(filter=FieldFilter("caduca", ">", ahora)).stream():
        propuestas = hop.reference.collection("propuestas")
        for doc in propuestas.where(filter=FieldFilter("tipo", "==", "vuelo")).stream():
            if cuenta["mirados"] >= maximo:
                return cuenta
            p = doc.to_dict() or {}
            if not p.get("ida"):
                continue
            ahora_p = precio_actual(p, con_cache)
            if ahora_p == "" and str(p.get("ida")) >= hoy.isoformat():
                cuenta["sin_mirar"] += 1
                continue
            antes = p.get("precio")
            est = estado_de(float(antes) if isinstance(antes, (int, float)) else None,
                            None if ahora_p in (None, "") else float(ahora_p), str(p["ida"]), hoy)
            vigente: dict[str, Any] = {"estado": est, "comprobado": ahora}
            if isinstance(ahora_p, (int, float)):
                vigente["precio"] = ahora_p
            if isinstance(antes, (int, float)):
                vigente["antes"] = float(antes)
            doc.reference.update({"vigente": vigente})
            cuenta["mirados"] += 1
            cuenta[est] += 1
    return cuenta
