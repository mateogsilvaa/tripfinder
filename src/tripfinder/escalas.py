"""Escala propia: dos low cost encadenadas por un aeropuerto puente.

Desde Madrid hay vuelo directo a unos ochenta sitios, y el tablon ya llega a
casi todos. Lo que falta no esta a un vuelo: esta a dos. Ryanair vuela desde
Bergamo a ciento y pico ciudades, desde Stansted a otras tantas, y muchas de
ellas no tienen nada desde Madrid —Tirana, Riga, Pafos, Rovaniemi, Fez—. Si se
compra MAD->BGY y BGY->Tirana por separado, con margen entre los dos, se llega.
Es lo que hacen Kiwi o Skyscanner con su «autotransferencia».

Como se busca, gastando pocas consultas:

1. El calendario de MAD->puente (una consulta por mes) da el vuelo mas barato
   de cada dia, con su hora de llegada.
2. Para cada dia de salida, UNA consulta al buscador de Ryanair desde el
   puente, solo con vuelos que salgan al menos `margen` horas despues de
   aterrizar: devuelve el mas barato de ese dia a cada destino.
3. Se quedan los destinos a los que NO se llega en directo desde Madrid —para
   eso ya esta el tablon— y, de esos, los mas baratos.
4. La vuelta igual al reves: destino->puente el dia de vuelta (una consulta por
   destino) y puente->Madrid despues, con el mismo margen.

Lo que sale va marcado con `via` y sus cuatro `tramos`, porque son cuatro
billetes. La web lo dice antes que el precio: si el primer vuelo se retrasa,
nadie te recoloca en el segundo.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

from .models import FlightOffer, Leg
from .providers import links, ryanair
from .providers.ryanair import API_ONEWAY, PAGE_SIZE, _meses
from .util import get_json

log = logging.getLogger("tripfinder")

NOMBRES_PUENTE = {
    "BGY": "Bérgamo", "STN": "Londres-Stansted", "CRL": "Bruselas-Charleroi",
    "DUB": "Dublín", "BUD": "Budapest", "MLA": "Malta", "BLQ": "Bolonia",
    "KRK": "Cracovia", "BVA": "París-Beauvais", "PSA": "Pisa", "CIA": "Roma-Ciampino",
    "FCO": "Roma", "NAP": "Nápoles", "MAN": "Mánchester", "EDI": "Edimburgo",
}


def _min(hhmm: str) -> int | None:
    try:
        h, m = hhmm.split(":")
        return int(h) * 60 + int(m)
    except (AttributeError, ValueError):
        return None


def _hhmm(minutos: int) -> str:
    minutos = max(0, min(minutos, 23 * 60 + 59))
    return f"{minutos // 60:02d}:{minutos % 60:02d}"


def espera(llega: str, sale: str) -> int | None:
    """Minutos entre aterrizar y despegar el mismo dia, o None si no encaja."""
    a, b = _min(llega), _min(sale)
    if a is None or b is None or b <= a:
        return None
    return b - a


def tramo(leg: Leg) -> dict[str, Any]:
    return {
        "origin": leg.origin,
        "destination": leg.destination,
        "date": leg.date,
        "time": leg.time,
        "arrive": leg.arrive,
        "price": leg.price,
        "airline": leg.airline,
        "deep_link": leg.deep_link,
    }


def combinar(
    ida1: Leg, ida2: Leg, vuelta1: Leg, vuelta2: Leg, *, origen_nombre: str, via_nombre: str,
    adultos: int = 1,
) -> FlightOffer | None:
    """Los cuatro tramos, en una oferta. None si alguna escala no cuadra."""
    e_ida = espera(ida1.arrive, ida2.time)
    e_vuelta = espera(vuelta1.arrive, vuelta2.time)
    if e_ida is None or e_vuelta is None:
        return None
    noches = (date.fromisoformat(vuelta1.date) - date.fromisoformat(ida2.date)).days
    if noches < 1:
        return None
    precio = round(ida1.price + ida2.price + vuelta1.price + vuelta2.price, 2)
    return FlightOffer(
        provider="escala",
        origin=ida1.origin,
        destination=ida2.destination,
        origin_name=origen_nombre,
        destination_name=ida2.destination_name or ida2.destination,
        destination_country=ida2.destination_country,
        depart_date=ida1.date,
        return_date=vuelta2.date,
        nights=noches,
        depart_time=ida1.time,
        arrive_time=ida2.arrive,
        return_time=vuelta1.time,
        return_arrive_time=vuelta2.arrive,
        stops=1,
        price=precio,
        airline=ida2.airline,
        airline_back=vuelta1.airline if vuelta1.airline != ida2.airline else "",
        deep_link=ida1.deep_link,
        deep_link_back=vuelta1.deep_link,
        adults=adultos,
        via=ida1.destination,
        via_name=via_nombre,
        escala_ida=e_ida,
        escala_vuelta=e_vuelta,
        tramos=[tramo(x) for x in (ida1, ida2, vuelta1, vuelta2)],
    )


class Escalas:
    """El buscador de escalas propias sobre la API publica de Ryanair."""

    def __init__(self, cfg: dict[str, Any], directos: set[str], *, consultar=get_json):
        self.cfg = cfg
        self.directos = {d.upper() for d in directos}
        self.consultar = consultar
        self.margen = int(float(cfg.get("margen_horas", 3)) * 60)
        self.maximo_espera = int(float(cfg.get("espera_max_horas", 10)) * 60)
        self.por_dia = int(cfg.get("destinos_por_dia", 6))
        self.intervalo = float(cfg.get("min_interval_seconds", 2))
        self.adultos = max(1, int(cfg.get("adults", 1)))
        self.consultas = 0
        self.tope = int(cfg.get("max_consultas", 160))

    # -- llamadas --------------------------------------------------------
    def _llamar(self, params: dict[str, Any]) -> list[dict]:
        if self.consultas >= self.tope:
            return []
        self.consultas += 1
        try:
            datos = self.consultar(
                API_ONEWAY,
                params={"currency": "EUR", "market": "es-es", "adultPaxCount": self.adultos,
                        "limit": PAGE_SIZE, **params},
                throttle_key="ryanair",
                min_interval=self.intervalo,
            )
        except Exception as exc:  # noqa: BLE001 - una consulta caida no tumba el barrido
            log.debug("Escalas %s: %s", params, exc)
            return []
        return (datos or {}).get("fares", []) if isinstance(datos, dict) else []

    def _legs(self, fares: list[dict]) -> list[Leg]:
        salida: list[Leg] = []
        for f in fares:
            out = f.get("outbound") or {}
            dep, arr = out.get("departureAirport") or {}, out.get("arrivalAirport") or {}
            precio = (out.get("price") or {}).get("value")
            cuando, llega = str(out.get("departureDate") or ""), str(out.get("arrivalDate") or "")
            if not (precio and cuando and llega and dep.get("iataCode") and arr.get("iataCode")):
                continue
            salida.append(
                Leg(
                    provider="ryanair",
                    airline="Ryanair",
                    origin=dep["iataCode"],
                    destination=arr["iataCode"],
                    date=cuando[:10],
                    time=cuando[11:16],
                    arrive=llega[11:16],
                    price=round(float(precio), 2),
                    destination_name=(arr.get("city") or {}).get("name") or arr["iataCode"],
                    destination_country=arr.get("countryName", ""),
                    deep_link=links.ryanair(dep["iataCode"], arr["iataCode"], cuando[:10],
                                            adultos=self.adultos),
                )
            )
        return salida

    def desde(self, puente: str, dia: date, despues_de: str, hasta: list[str] | None = None) -> list[Leg]:
        """Lo mas barato de ese dia desde el puente a cada destino, saliendo
        despues de una hora. Pagina hasta tres veces: Bergamo tiene muchos."""
        params: dict[str, Any] = {
            "departureAirportIataCode": puente,
            "outboundDepartureDateFrom": dia.isoformat(),
            "outboundDepartureDateTo": dia.isoformat(),
            "outboundDepartureTimeFrom": despues_de,
            "outboundDepartureTimeTo": "23:59",
        }
        if hasta:
            params["arrivalAirportIataCodes"] = ",".join(hasta)
        legs: list[Leg] = []
        for pagina in range(3 if not hasta else 1):
            fares = self._llamar({**params, "offset": pagina * PAGE_SIZE})
            legs += self._legs(fares)
            if len(fares) < PAGE_SIZE:
                break
        return legs

    # -- el barrido --------------------------------------------------------
    def buscar(self, origen: str, origen_nombre: str, puente: str, salidas: list[date],
               noches: list[int]) -> list[FlightOffer]:
        via_nombre = NOMBRES_PUENTE.get(puente, puente)
        if not salidas:
            return []
        hasta = max(salidas) + timedelta(days=max(noches or [2]))
        # Los dos calendarios, ida y vuelta al puente: una consulta por mes cada uno.
        calendario_ida = ryanair.precios_por_dia(origen, puente, min(salidas), max(salidas), self.intervalo)
        calendario_vuelta = ryanair.precios_por_dia(puente, origen, min(salidas), hasta, self.intervalo)
        self.consultas += len(_meses(min(salidas), max(salidas))) + len(_meses(min(salidas), hasta))

        ofertas: list[FlightOffer] = []
        for dia in salidas:
            primero = calendario_ida.get(dia.isoformat())
            if not primero or not primero.get("arrive"):
                continue
            ida1 = Leg(
                provider="ryanair", airline="Ryanair", origin=origen, destination=puente,
                date=dia.isoformat(), time=primero["time"], arrive=primero["arrive"],
                price=primero["price"], destination_name=via_nombre,
                deep_link=links.ryanair(origen, puente, dia.isoformat(), adultos=self.adultos),
            )
            a_partir = _min(ida1.arrive)
            if a_partir is None:
                continue
            # Se sigue el mismo dia: si el primero aterriza tarde, no hay segundo.
            if a_partir + self.margen > 23 * 60:
                continue
            nuevos = [
                leg for leg in self.desde(puente, dia, _hhmm(a_partir + self.margen))
                if leg.destination not in self.directos and leg.destination != origen
                and (espera(ida1.arrive, leg.time) or 0) <= self.maximo_espera
            ]
            nuevos.sort(key=lambda x: x.price)
            for ida2 in nuevos[: self.por_dia]:
                for n in noches:
                    vuelta_dia = dia + timedelta(days=n)
                    oferta = self._vuelta(origen, origen_nombre, puente, via_nombre, ida1, ida2,
                                          vuelta_dia, calendario_vuelta)
                    if oferta is not None:
                        ofertas.append(oferta)
                        break
        log.info("Escalas %s via %s: %d viajes con %d consultas", origen, puente, len(ofertas),
                 self.consultas)
        return ofertas

    def _vuelta(self, origen, origen_nombre, puente, via_nombre, ida1, ida2, dia, calendario):
        # Destino -> puente ese dia, el que sea; luego puente -> casa con margen.
        de_vuelta = [
            leg for leg in self._legs(self._llamar({
                "departureAirportIataCode": ida2.destination,
                "arrivalAirportIataCodes": puente,
                "outboundDepartureDateFrom": dia.isoformat(),
                "outboundDepartureDateTo": dia.isoformat(),
            }))
            if leg.destination == puente
        ]
        if not de_vuelta:
            return None
        vuelta1 = min(de_vuelta, key=lambda x: x.price)
        llega = _min(vuelta1.arrive)
        if llega is None or llega + self.margen > 23 * 60 + 30:
            return None
        casa = calendario.get(dia.isoformat())
        vuelta2: Leg | None = None
        if casa and (espera(vuelta1.arrive, casa.get("time", "")) or 0) >= self.margen:
            vuelta2 = Leg(
                provider="ryanair", airline="Ryanair", origin=puente, destination=origen,
                date=dia.isoformat(), time=casa["time"], arrive=casa.get("arrive", ""),
                price=casa["price"], destination_name=origen_nombre,
                deep_link=links.ryanair(puente, origen, dia.isoformat(), adultos=self.adultos),
            )
        else:
            # El mas barato del dia sale antes de que llegues: el siguiente que sí cuadre.
            tarde = self.desde(puente, dia, _hhmm(llega + self.margen), hasta=[origen])
            vuelta2 = min(tarde, key=lambda x: x.price) if tarde else None
        if vuelta2 is None or not vuelta2.arrive:
            return None
        if (espera(vuelta1.arrive, vuelta2.time) or 0) > self.maximo_espera:
            return None
        return combinar(ida1, ida2, vuelta1, vuelta2, origen_nombre=origen_nombre,
                        via_nombre=via_nombre, adultos=self.adultos)


def salidas_de_finde(cuantas: int, hoy: date | None = None, dias=(4,)) -> list[date]:
    """Los proximos viernes (u otros dias de la semana) a partir de la semana que viene."""
    hoy = hoy or date.today()
    salida: list[date] = []
    d = hoy + timedelta(days=7)
    while len(salida) < cuantas:
        if d.weekday() in dias:
            salida.append(d)
        d += timedelta(days=1)
    return salida
