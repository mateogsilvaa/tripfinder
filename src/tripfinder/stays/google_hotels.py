"""Google Hoteles: hoteles de verdad, con precio de las fechas, sin clave.

POR QUE. Hasta aqui los hoteles solo llegaban por la pasada de «habitacion de
hotel» de Airbnb, que trae pocos y caros, y por Amadeus, que pide claves que no
hay. El resultado era una lista de pisos de Airbnb y ningun hotel. Booking
contesta a un runner con un reto de JavaScript (ver `holidu.py`); Google
Hoteles contesta con la pagina entera, como Google Vuelos, y ademas es un
comparador: el precio que da es el mas barato de Booking, Expedia, la web del
propio hotel y compania.

LAS FECHAS van en el parametro `ts`, un protobuf en base64 igual que el `tfs`
de Google Vuelos. Sin el, Google da precios de esta noche. Se construye a mano
abajo (`ts`): comprobado desde un runner el 24 de octubre de 2026 con Roma del
11 al 13 de diciembre, la pagina contesta «2 noches con impuestos y tasas
incluidos» y cada hotel trae esas dos fechas.

DONDE ESTAN LOS DATOS. En el `AF_initDataCallback` de la pagina, un JSON de
listas anidadas sin nombres. Cada hotel de la lista es un objeto con la clave
`397419284`, y dentro, por posicion:

    [1]  nombre                    [2][0]  [lat, lon]
    [3]  ["Hotel de 4 estrellas", 4]
    [5]  fotos                     [6][1][3]  moneda ("EUR", "USD"…)
    [6][2][1]  precio por noche: [texto, texto con tasas, numero, _, redondeado]
    [6][2][9]  total de la estancia: [texto, texto con tasas]
    [7][0]  [nota sobre 5, numero de reseñas]
    [11][0] descripcion            [20]  id de la ficha en Google Hoteles

Las posiciones se leen con `_en`, que devuelve None en vez de reventar: si
Google mueve algo, un hotel sale sin foto o sin nota, no se cae la busqueda.

EL TOTAL QUE SE GUARDA es el que lleva tasas e impuestos, que es lo que se
paga. Y es por habitacion doble: para tres o cuatro se cuentan dos.
"""

from __future__ import annotations

import base64
import json
import logging
import math
import re
from collections.abc import Iterator
from datetime import date
from typing import Any
from urllib.parse import quote

from ..models import StayOffer
from ..util import a_euros, get_text
from .base import StayProvider, StayRequest, register

log = logging.getLogger("tripfinder")

URL = "https://www.google.com/travel/search"
FICHA = "https://www.google.com/travel/hotels/entity/{id}"
# El mismo consentimiento no personalizado que Google Vuelos: sin el, la pagina
# llega con el muro de cookies y vacia.
CONSENT_COOKIE = "SOCS=CAESEwgDEgk0ODE3Nzk3MjQaAmVzIAEaBgiA_LyaBg"
CLAVE_HOTEL = "397419284"
CALLBACK_RE = re.compile(r"AF_initDataCallback\(\{key: '[^']+', hash: '[^']*', data:(.*?), sideChannel", re.DOTALL)
MAX_FOTOS = 6
# Cada pagina trae unos veinte. Se pregunta por la ciudad y por su centro, que
# son listas distintas: la primera mezcla las afueras y la segunda las deja fuera.
CONSULTAS = ("hoteles en el centro de {ciudad}", "hoteles en {ciudad}")
POR_HABITACION = 2


# ------------------------------------------------------------------ el `ts`
def _varint(n: int) -> bytes:
    out = b""
    while True:
        x, n = n & 0x7F, n >> 7
        if n:
            out += bytes([x | 0x80])
        else:
            return out + bytes([x])


def _num(campo: int, valor: int) -> bytes:
    return _varint(campo << 3) + _varint(valor)


def _bytes(campo: int, datos: bytes | str) -> bytes:
    if isinstance(datos, str):
        datos = datos.encode()
    return _varint((campo << 3) | 2) + _varint(len(datos)) + datos


def _fecha(iso: str) -> bytes:
    d = date.fromisoformat(iso)
    return _num(1, d.year) + _num(2, d.month) + _num(3, d.day)


def ts(ciudad: str, checkin: str, checkout: str, moneda: str = "EUR") -> str:
    """El parametro `ts` de Google Hoteles con la ciudad y las fechas."""
    noches = max(1, (date.fromisoformat(checkout) - date.fromisoformat(checkin)).days)
    fechas = _bytes(2, _bytes(1, _fecha(checkin)) + _bytes(2, _fecha(checkout)) + _num(3, noches))
    fechas += _bytes(6, _num(2, 0))
    lugar = _bytes(1, _bytes(2, _bytes(7, ciudad)) + _bytes(3, b""))
    dinero = _bytes(5, _bytes(1, _bytes(7, moneda)) + _bytes(3, b""))
    mensaje = _num(1, 1) + _bytes(2, b"") + _bytes(3, lugar + _bytes(2, fechas) + dinero)
    return base64.urlsafe_b64encode(mensaje).decode().rstrip("=")


# -------------------------------------------------------------- leer la pagina
def _en(x: Any, *ruta: int | str) -> Any:
    for paso in ruta:
        try:
            x = x[paso]
        except (IndexError, KeyError, TypeError):
            return None
    return x


def _hoteles_crudos(html: str) -> Iterator[list]:
    """Cada lista de hotel que haya en los bloques de datos de la pagina."""
    for m in CALLBACK_RE.finditer(html or ""):
        try:
            datos = json.loads(m.group(1))
        except json.JSONDecodeError:
            continue
        pila: list[Any] = [datos]
        while pila:
            x = pila.pop()
            if isinstance(x, dict):
                h = x.get(CLAVE_HOTEL)
                if isinstance(h, list) and h and isinstance(h[0], list):
                    yield h[0]
                pila.extend(x.values())
            elif isinstance(x, list):
                pila.extend(x)


PRECIO_RE = re.compile(r"\d[\d.,\s\xa0]*")


def importe(texto: Any) -> float | None:
    """«1.234 €» o «182 US$» -> 1234.0 / 182.0. Google escribe a la española:
    punto de miles y coma decimal."""
    if not isinstance(texto, str):
        return None
    m = PRECIO_RE.search(texto)
    if not m:
        return None
    limpio = re.sub(r"[\s\xa0.]", "", m.group(0)).replace(",", ".")
    try:
        return float(limpio)
    except ValueError:
        return None


def _fotos(h: list) -> list[str]:
    fotos: list[str] = []
    for f in _en(h, 5, 1) or []:
        url = _en(f, 1, 0)
        if isinstance(url, str) and url.startswith("https://") and url not in fotos:
            fotos.append(url)
        if len(fotos) >= MAX_FOTOS:
            break
    return fotos


def a_oferta(h: list, req: StayRequest, consulta_ts: str) -> StayOffer | None:
    nombre = _en(h, 1)
    if not isinstance(nombre, str) or not nombre.strip():
        return None
    moneda = _en(h, 6, 1, 3) or "EUR"
    total = importe(_en(h, 6, 2, 9, 1)) or importe(_en(h, 6, 2, 9, 0))
    noche = importe(_en(h, 6, 2, 1, 1)) or importe(_en(h, 6, 2, 1, 0))
    if not total and noche:
        total = noche * req.nights
    if not total:
        return None
    total, noche = a_euros(total, moneda), a_euros(noche, moneda)
    if not total:
        return None
    habitaciones = max(1, math.ceil(req.adults / POR_HABITACION))
    total *= habitaciones
    noche = noche * habitaciones if noche else round(total / req.nights, 2)

    lat, lon = _en(h, 2, 0, 0), _en(h, 2, 0, 1)
    if not (isinstance(lat, (int, float)) and isinstance(lon, (int, float))):
        lat = lon = None
    nota, resenas = _en(h, 7, 0, 0), _en(h, 7, 0, 1)
    categoria = _en(h, 3, 0)
    estrellas = _en(h, 3, 1)
    ident = _en(h, 20)
    url = (
        FICHA.format(id=quote(ident)) + f"?ts={consulta_ts}&hl=es&gl=ES&curr=EUR"
        if isinstance(ident, str) and ident
        else f"{URL}?q={quote(nombre + ' ' + req.city)}&ts={consulta_ts}&hl=es&gl=ES&curr=EUR"
    )
    fotos = _fotos(h)
    nota_txt = ["por habitación doble" if habitaciones == 1 else f"{habitaciones} habitaciones dobles"]
    if isinstance(estrellas, int) and 1 <= estrellas <= 5:
        nota_txt.insert(0, "★" * estrellas)
    return StayOffer(
        provider="google_hotels",
        name=nombre.strip()[:120],
        url=url,
        # Google mezcla pisos turísticos en la lista. Sin categoría de hotel,
        # no se le llama hotel.
        kind="hotel" if isinstance(categoria, str) and categoria else "stay",
        price_total=round(total, 2),
        price_per_night=round(noche, 2) if noche else None,
        currency="EUR",
        rating=round(float(nota), 2) if isinstance(nota, (int, float)) and nota > 0 else None,
        reviews=int(resenas) if isinstance(resenas, (int, float)) and resenas > 0 else None,
        area=categoria if isinstance(categoria, str) else "",
        image=fotos[0] if fotos else "",
        images=fotos,
        note=" · ".join(nota_txt),
        lat=float(lat) if lat is not None else None,
        lon=float(lon) if lon is not None else None,
    )


def ofertas_de(html: str, req: StayRequest, consulta_ts: str) -> list[StayOffer]:
    salida: list[StayOffer] = []
    for h in _hoteles_crudos(html):
        try:
            o = a_oferta(h, req, consulta_ts)
        except Exception as exc:  # noqa: BLE001 - un hotel raro no tumba la lista
            log.debug("Google Hoteles: hotel ilegible (%s)", exc)
            continue
        if o:
            salida.append(o)
    return salida


@register("google_hotels")
class GoogleHotels(StayProvider):
    def search(self, req: StayRequest) -> list[StayOffer]:
        # La ciudad sola: el pais en el `ts` hace que Google busque el pais.
        consulta_ts = ts(req.city, req.checkin, req.checkout)
        vistos: set[str] = set()
        ofertas: list[StayOffer] = []
        for plantilla in CONSULTAS:
            params = {
                "q": plantilla.format(ciudad=req.city),
                "ts": consulta_ts,
                "hl": "es",
                "gl": "ES",
                "curr": "EUR",
            }
            try:
                html = get_text(
                    URL,
                    params=params,
                    headers={"Cookie": CONSENT_COOKIE},
                    timeout=40,
                    throttle_key="google_hotels",
                    min_interval=4.0,
                )
            except Exception as exc:  # noqa: BLE001 - una consulta fallida no tumba la otra
                log.warning("Google Hoteles %s: %s", req.city, exc)
                continue
            for o in ofertas_de(html, req, consulta_ts):
                k = o.name.lower()
                if k not in vistos:
                    vistos.add(k)
                    ofertas.append(o)
        log.info("Google Hoteles %s: %d alojamientos", req.city, len(ofertas))
        return ofertas
