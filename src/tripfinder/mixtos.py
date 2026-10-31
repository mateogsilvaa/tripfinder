"""Ida con una compañía y vuelta con otra.

Ryanair y Wizz venden cada sentido por separado y al mismo precio que dentro
de un ida y vuelta: un billete de ida y vuelta de low cost no es mas que dos
de ida pegados. Asi que la ida mas barata de un dia puede ser de Wizz y la
vuelta mas barata del domingo, de Ryanair, y comprar las dos por separado
sale por menos que cualquiera de las dos compañias entera.

Aqui no se pregunta nada nuevo: se cogen las mitades que ya han traido los
proveedores (`price_out` y `price_back`, con su hora y su compañia), se
cruzan por destino y fechas, y se publica la mezcla SOLO si es mas barata que
lo mejor de una sola compañia para ese mismo viaje. Google solo da el total y
no entra.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from .models import FlightOffer
from .providers import links

# Lo minimo que tiene que ahorrar la mezcla para que compense comprar dos
# billetes en dos webs en vez de uno.
AHORRO_MINIMO = 3.0


@dataclass
class Mitad:
    precio: float
    airline: str
    provider: str
    hora: str
    llega: str
    oferta: FlightOffer


def _enlace(airline: str, origen: str, destino: str, dia: str, adultos: int) -> str:
    if airline.lower().startswith("wizz"):
        return links.wizzair(origen, destino, dia, "", adultos)
    return links.ryanair(origen, destino, dia, "", adultos)


def mezclar(ofertas: list[FlightOffer], noches_min: int = 2, noches_max: int = 4) -> list[FlightOffer]:
    idas: dict[tuple[str, str, str], Mitad] = {}
    vueltas: dict[tuple[str, str, str], Mitad] = {}
    mejor_entera: dict[tuple[str, str, str, str], float] = {}
    for o in ofertas:
        if o.via or o.hidden_city or o.long_haul:
            continue
        if o.return_date:
            clave = (o.origin, o.destination, o.depart_date, o.return_date)
            mejor_entera[clave] = min(mejor_entera.get(clave, float("inf")), o.price)
        if not (o.price_out and o.price_back and o.return_date and o.airline):
            continue
        k_ida = (o.origin, o.destination, o.depart_date)
        if k_ida not in idas or o.price_out < idas[k_ida].precio:
            idas[k_ida] = Mitad(o.price_out, o.airline, o.provider, o.depart_time, o.arrive_time, o)
        k_vuelta = (o.origin, o.destination, o.return_date)
        if k_vuelta not in vueltas or o.price_back < vueltas[k_vuelta].precio:
            vueltas[k_vuelta] = Mitad(o.price_back, o.airline_back or o.airline, o.provider,
                                      o.return_time, o.return_arrive_time, o)

    salida: dict[tuple[str, str, str], FlightOffer] = {}
    for (origen, destino, dia), ida in idas.items():
        d0 = date.fromisoformat(dia)
        for n in range(noches_min, noches_max + 1):
            regreso = (d0 + timedelta(days=n)).isoformat()
            vuelta = vueltas.get((origen, destino, regreso))
            if vuelta is None or vuelta.airline == ida.airline:
                continue
            total = round(ida.precio + vuelta.precio, 2)
            entera = mejor_entera.get((origen, destino, dia, regreso), float("inf"))
            if total > entera - AHORRO_MINIMO:
                continue
            clave = (origen, destino, dia)
            if clave in salida and salida[clave].price <= total:
                continue
            base = ida.oferta
            adultos = base.adults
            salida[clave] = FlightOffer(
                provider="mixto",
                origin=origen,
                destination=destino,
                origin_name=base.origin_name,
                destination_name=base.destination_name,
                destination_country=base.destination_country,
                depart_date=dia,
                return_date=regreso,
                nights=n,
                price=total,
                price_out=ida.precio,
                price_back=vuelta.precio,
                airline=ida.airline,
                airline_back=vuelta.airline,
                depart_time=ida.hora,
                arrive_time=ida.llega,
                return_time=vuelta.hora,
                return_arrive_time=vuelta.llega,
                adults=adultos,
                deep_link=_enlace(ida.airline, origen, destino, dia, adultos),
                deep_link_back=_enlace(vuelta.airline, destino, origen, regreso, adultos),
            )
    return list(salida.values())
