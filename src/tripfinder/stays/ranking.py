"""Ordenar las camas por lo que de verdad decide: precio Y cercanía.

ANTES. La lista salía ordenada por precio a secas. Con eso, el primero podía ser
un estudio a doce kilómetros del centro y el segundo, por diez euros más, estar
en la plaza mayor. En una escapada de dos noches eso no es un detalle: son dos
horas de transporte cada día y el precio de los billetes, que no sale en la
ficha. Un sitio barato y lejos no es más barato, es otro viaje.

CÓMO SE MEZCLAN. Dos notas de 0 a 1 —lo barato y lo céntrico— y una media con
más peso en el precio, porque sigue siendo lo primero que mira nadie.

La nota de precio se mide en CUÁNTO MÁS CARO que la más barata de la lista, en
tanto por uno, y no repartiendo el rango entre la mejor y la peor. Con el rango,
una lista de dos camas a 100 € y 120 € convertía veinte euros en «la más cara
posible» y la de 120 se hundía; medido así, veinte euros sobre cien son un 20 %
y pesan un 20 %. Y es relativo a la ciudad sin tener que saber nada de ella:
«caro» en Nápoles y «caro» en Zúrich no son el mismo número, pero «un 30 % más
caro que la más barata que hay aquí» sí significa lo mismo en las dos.

Y cuando no se sabe dónde cae una cama —Airbnb no siempre da las coordenadas—
no se la castiga: se le da la nota de cercanía de la mediana. Penalizarla sería
esconder alojamientos por un fallo nuestro de lectura.
"""

from __future__ import annotations

import logging
from statistics import median

from ..models import StayOffer
from .base import StayRequest
from .centro import coordenadas, km_entre

log = logging.getLogger("tripfinder")

# Cuánto pesa cada cosa. El precio manda, pero no solo.
PESO_PRECIO = 0.65
PESO_CENTRO = 0.35
# A partir de aquí da igual lo lejos que esté: ya es "hay que coger transporte".
LEJOS_KM = 8.0
# Cuánto más cara que la más barata para valer un cero en precio. Un 60 % más
# es «esto ya es otra categoría de alojamiento», no una cama algo mejor.
TOLERANCIA = 0.6
# Andando, a paso normal. Sirve para decirlo en minutos, que se entiende mejor
# que un decimal de kilómetro.
KM_POR_HORA = 4.8


def _nota_precio(precio: float, barato: float) -> float:
    """1 la más barata; 0 la que cuesta `TOLERANCIA` veces más que ella."""
    if barato <= 0:
        return 0.5
    de_mas = precio / barato - 1
    return max(0.0, min(1.0, 1 - de_mas / TOLERANCIA))


def _nota_centro(km: float) -> float:
    """1 en el centro mismo; 0 a `LEJOS_KM` o más."""
    return max(0.0, min(1.0, 1 - min(km, LEJOS_KM) / LEJOS_KM))


def a_pie(km: float | None) -> str:
    """«a 12 min andando», «a 4,2 km del centro»."""
    if km is None:
        return ""
    if km <= 3.5:
        minutos = max(1, round(km / KM_POR_HORA * 60))
        return f"a {minutos} min andando del centro"
    return f"a {km:.1f} km del centro".replace(".", ",")


def medir(ofertas: list[StayOffer], req: StayRequest) -> list[StayOffer]:
    """Pone `km_centro` a lo que tenga coordenadas. Una llamada por ciudad."""
    if not any(o.lat and o.lon for o in ofertas):
        return ofertas
    centro = coordenadas(req.city, req.country)
    if not centro:
        return ofertas
    for o in ofertas:
        if o.lat and o.lon:
            o.km_centro = km_entre(centro, (o.lat, o.lon))
    return ofertas


def ordenar(ofertas: list[StayOffer], req: StayRequest) -> list[StayOffer]:
    """Las mejores primero, y con su sello puesto."""
    conPrecio = [o for o in ofertas if o.price_total]
    sinPrecio = [o for o in ofertas if not o.price_total]
    if not conPrecio:
        return ofertas

    medir(conPrecio, req)

    barato = min(o.price_total for o in conPrecio)

    kms = [o.km_centro for o in conPrecio if o.km_centro is not None]
    # Sin ninguna coordenada, todo el peso al precio: inventar una nota de
    # cercanía igual para todos solo añadiría ruido.
    hayCentro = len(kms) >= 2
    medioKm = median(kms) if kms else None

    for o in conPrecio:
        nota = _nota_precio(o.price_total, barato)
        if not hayCentro:
            o.score = round(nota, 4)
            continue
        km = o.km_centro if o.km_centro is not None else medioKm
        o.score = round(PESO_PRECIO * nota + PESO_CENTRO * _nota_centro(km), 4)

    conPrecio.sort(key=lambda o: (-o.score, o.price_total))
    _sellar(conPrecio)
    return conPrecio + sinPrecio


def _sellar(ofertas: list[StayOffer]) -> None:
    """El sello dice por qué está donde está. Uno por cama, el que más pesa.

    Se reparten de fuera hacia dentro —primero los que son únicos— para que no
    haya dos «el más barato» ni una cama con dos motivos y ninguno visible.
    """
    conPrecio = [o for o in ofertas if o.price_total]
    if not conPrecio:
        return
    barata = min(conPrecio, key=lambda o: o.price_total)
    barata.sello = "el más barato"

    conKm = [o for o in ofertas if o.km_centro is not None]
    if conKm:
        centrica = min(conKm, key=lambda o: o.km_centro)
        if not centrica.sello:
            centrica.sello = "el más céntrico"
        elif centrica is barata:
            # Barato Y céntrico: no hay nada mejor que decir de una cama.
            barata.sello = "el más barato, y el más céntrico"

    for o in ofertas:
        if not o.sello and o.kind == "hotel":
            o.sello = "hotel"
