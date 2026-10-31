"""Escala propia: dos low cost por un puente, sin red.

Se le da a `Escalas` un falso buscador de Ryanair y un falso calendario, y se
mira que cuadre las horas, que no ofrezca lo que ya hay en directo y que la
oferta lleve sus cuatro tramos."""

from __future__ import annotations

from datetime import date

from tripfinder import escalas
from tripfinder.escalas import Escalas, combinar, espera, salidas_de_finde
from tripfinder.models import Leg

VIERNES = date(2027, 3, 5)
DOMINGO = date(2027, 3, 7)


def _fare(dep, arr, dia, sale, llega, precio, ciudad=""):
    return {
        "outbound": {
            "departureAirport": {"iataCode": dep},
            "arrivalAirport": {"iataCode": arr, "city": {"name": ciudad or arr}, "countryName": "X"},
            "departureDate": f"{dia}T{sale}:00",
            "arrivalDate": f"{dia}T{llega}:00",
            "price": {"value": precio},
        }
    }


def _falso(respuestas):
    llamadas = []

    def consultar(url, params=None, **_):
        llamadas.append(params)
        clave = (params["departureAirportIataCode"], params.get("arrivalAirportIataCodes", ""),
                 params["outboundDepartureDateFrom"])
        fares = [f for f in respuestas.get(clave, [])
                 if f["outbound"]["departureDate"][11:16] >= params.get("outboundDepartureTimeFrom", "00:00")]
        return {"fares": fares}

    return consultar, llamadas


def _calendario(monkeypatch, ida, vuelta):
    def falso(origen, destino, desde, hasta, intervalo=2):
        return ida if origen == "MAD" else vuelta

    monkeypatch.setattr(escalas.ryanair, "precios_por_dia", falso)


def test_espera_cuenta_minutos_y_rechaza_lo_que_no_encaja():
    assert espera("10:00", "13:30") == 210
    assert espera("13:30", "10:00") is None
    assert espera("", "10:00") is None


def test_salidas_de_finde_son_viernes_desde_la_semana_que_viene():
    dias = salidas_de_finde(3, hoy=date(2027, 3, 1))
    assert [d.weekday() for d in dias] == [4, 4, 4]
    assert dias[0] >= date(2027, 3, 8)


def test_casa_ida_y_vuelta_por_el_puente_con_margen(monkeypatch):
    _calendario(
        monkeypatch,
        {VIERNES.isoformat(): {"price": 20, "time": "07:00", "arrive": "09:15"}},
        {DOMINGO.isoformat(): {"price": 25, "time": "20:00", "arrive": "22:10"}},
    )
    consultar, _ = _falso({
        # Desde Bergamo ese viernes: Tirana sin directo, Roma con directo.
        ("BGY", "", VIERNES.isoformat()): [
            _fare("BGY", "TIA", VIERNES, "13:00", "14:30", 15, "Tirana"),
            _fare("BGY", "FCO", VIERNES, "12:30", "13:30", 9, "Roma"),
        ],
        ("TIA", "BGY", DOMINGO.isoformat()): [_fare("TIA", "BGY", DOMINGO, "11:00", "12:40", 18)],
    })
    b = Escalas({"margen_horas": 3}, directos={"FCO", "BGY"}, consultar=consultar)
    ofertas = b.buscar("MAD", "Madrid", "BGY", [VIERNES], [2])
    assert [o.destination for o in ofertas] == ["TIA"]
    o = ofertas[0]
    assert o.via == "BGY" and o.via_name == "Bérgamo"
    assert o.price == 20 + 15 + 18 + 25
    assert o.stops == 1 and o.nights == 2
    assert o.escala_ida == 13 * 60 - (9 * 60 + 15)
    assert o.escala_vuelta == 20 * 60 - (12 * 60 + 40)
    assert [t["origin"] + t["destination"] for t in o.tramos] == ["MADBGY", "BGYTIA", "TIABGY", "BGYMAD"]
    assert o.depart_time == "07:00" and o.return_arrive_time == "22:10"


def test_sin_margen_en_el_puente_no_hay_viaje(monkeypatch):
    _calendario(
        monkeypatch,
        {VIERNES.isoformat(): {"price": 20, "time": "07:00", "arrive": "11:00"}},
        {DOMINGO.isoformat(): {"price": 25, "time": "20:00", "arrive": "22:10"}},
    )
    consultar, llamadas = _falso({
        # Sale a las 12:00: solo una hora despues de aterrizar.
        ("BGY", "", VIERNES.isoformat()): [_fare("BGY", "TIA", VIERNES, "12:00", "13:30", 15)],
    })
    b = Escalas({"margen_horas": 3}, directos=set(), consultar=consultar)
    assert b.buscar("MAD", "Madrid", "BGY", [VIERNES], [2]) == []
    # Y se le pregunta a Ryanair ya con la hora minima, no despues.
    assert llamadas[0]["outboundDepartureTimeFrom"] == "14:00"


def test_si_el_mas_barato_de_vuelta_sale_antes_busca_uno_que_cuadre(monkeypatch):
    _calendario(
        monkeypatch,
        {VIERNES.isoformat(): {"price": 20, "time": "07:00", "arrive": "09:00"}},
        # El mas barato del domingo sale a las 10:00, antes de llegar al puente.
        {DOMINGO.isoformat(): {"price": 10, "time": "10:00", "arrive": "12:00"}},
    )
    consultar, _ = _falso({
        ("BGY", "", VIERNES.isoformat()): [_fare("BGY", "RIX", VIERNES, "13:00", "17:00", 30)],
        ("RIX", "BGY", DOMINGO.isoformat()): [_fare("RIX", "BGY", DOMINGO, "08:00", "10:00", 30)],
        ("BGY", "MAD", DOMINGO.isoformat()): [_fare("BGY", "MAD", DOMINGO, "17:00", "19:10", 40)],
    })
    b = Escalas({"margen_horas": 3}, directos=set(), consultar=consultar)
    [o] = b.buscar("MAD", "Madrid", "BGY", [VIERNES], [2])
    assert o.tramos[3]["time"] == "17:00"
    assert o.price == 20 + 30 + 30 + 40


def test_combinar_rechaza_vuelta_antes_que_ida():
    def leg(o, d, dia, sale, llega):
        return Leg("ryanair", "Ryanair", o, d, dia, sale, 10, arrive=llega)

    assert combinar(
        leg("MAD", "BGY", "2027-03-05", "07:00", "09:00"),
        leg("BGY", "TIA", "2027-03-05", "13:00", "14:00"),
        leg("TIA", "BGY", "2027-03-05", "15:00", "16:00"),
        leg("BGY", "MAD", "2027-03-05", "20:00", "22:00"),
        origen_nombre="Madrid", via_nombre="Bérgamo",
    ) is None


def test_tope_de_consultas(monkeypatch):
    _calendario(monkeypatch, {}, {})
    consultar, llamadas = _falso({})
    b = Escalas({"max_consultas": 0}, directos=set(), consultar=consultar)
    assert b.desde("BGY", VIERNES, "10:00") == []
    assert llamadas == []
