"""La cama del Interrail: un encargo con todas las paradas, y solo sitios enteros.

UN ENCARGO Y NO UNO POR PARADA, por una regla de GitHub: los workflows que
escriben en `data/` comparten cola, y GitHub solo guarda UNA ejecucion en
espera por cola. Cinco encargos seguidos dejaban correr el primero y el ultimo
y cancelaban los del medio sin decir nada.

Y SOLO ENTEROS porque asi se pidio: en una ruta de una o dos noches por ciudad
lo que se compara es el precio de tener un sitio, no el de una cama en un
cuarto compartido.
"""

from __future__ import annotations

import json

import pytest

from tripfinder import cli
from tripfinder.models import StayOffer
from tripfinder.stays.base import StayRequest
from tripfinder.stays.enteros import es_entero, solo_enteros


def parada(**extra):
    base = {
        "offer_id": "ir-centro-AMS-2026-11-06-2n-2",
        "city": "Ámsterdam",
        "country": "Países Bajos",
        "iata": "AMS",
        "checkin": "2026-11-06",
        "checkout": "2026-11-08",
    }
    return {**base, **extra}


# ----------------------------------------------------------------- validacion
def test_una_peticion_buena_pasa_limpia():
    limpias = cli.paradas_interrail(json.dumps([parada(), parada(offer_id="ir-centro-BER-2026-11-08-3n-2", city="Berlín", iata="BER", checkin="2026-11-08", checkout="2026-11-11")]))
    assert [p["offer_id"] for p in limpias] == ["ir-centro-AMS-2026-11-06-2n-2", "ir-centro-BER-2026-11-08-3n-2"]
    assert limpias[0]["city"] == "Ámsterdam"


@pytest.mark.parametrize(
    "mala",
    [
        # El identificador acaba siendo un nombre de fichero: nada de subir de carpeta.
        {"offer_id": "../../etc/passwd"},
        {"offer_id": "ir-centro-AMS-2026-11-06-2n-2/../x"},
        # Ni un vuelo del tablon: el Interrail escribe los suyos y no pisa otros.
        {"offer_id": "ryanair-MAD-SOF-20261120"},
        {"iata": "AM5"},
        {"city": ""},
        {"city": "Roma\n--summary-out /tmp/x"},
        {"checkin": "manana"},
        {"checkout": "2026-11-06"},  # cero noches
        {"checkout": "2026-12-31"},  # mas de dos semanas en una parada
    ],
)
def test_lo_que_no_vale_se_rechaza(mala):
    with pytest.raises(ValueError):
        cli.paradas_interrail(json.dumps([parada(**mala)]))


def test_ni_vacia_ni_infinita():
    with pytest.raises(ValueError):
        cli.paradas_interrail("[]")
    with pytest.raises(ValueError):
        cli.paradas_interrail(json.dumps([parada()] * (cli.MAX_PARADAS + 1)))
    with pytest.raises(ValueError):
        cli.paradas_interrail("no es json")


def test_una_parada_sin_aeropuerto_vale():
    """Lucerna e Interlaken no tienen aeropuerto, y el IATA solo lo usa el
    buscador de hoteles, que aqui no se consulta."""
    limpias = cli.paradas_interrail(json.dumps([parada(offer_id="ir-suiza-LUC-2026-11-08-2n-2", city="Lucerna", iata="")]))
    assert limpias[0]["iata"] == ""


# --------------------------------------------------------------- el encargo
def test_busca_cada_parada_y_siempre_solo_enteros(monkeypatch):
    llamadas = []

    def falso(ns):
        llamadas.append(ns)
        return 0

    monkeypatch.setattr(cli, "cmd_scan_stays", falso)
    args = cli.build_parser().parse_args(
        ["interrail-stays", "--adults", "3", "--paradas", json.dumps([parada(), parada(offer_id="ir-centro-BER-2026-11-08-3n-2", city="Berlín", checkin="2026-11-08", checkout="2026-11-11")])]
    )
    assert cli.cmd_interrail_stays(args) == 0
    assert [n.offer_id for n in llamadas] == ["ir-centro-AMS-2026-11-06-2n-2", "ir-centro-BER-2026-11-08-3n-2"]
    assert all(n.solo_enteros for n in llamadas)
    assert all(n.adults == 3 for n in llamadas)


def test_una_parada_que_falla_no_tumba_las_demas(monkeypatch):
    """Media ruta con cama es mejor que ninguna."""
    vistas = []

    def falso(ns):
        vistas.append(ns.offer_id)
        if "AMS" in ns.offer_id:
            raise RuntimeError("Airbnb no contesta")
        return 0

    monkeypatch.setattr(cli, "cmd_scan_stays", falso)
    args = cli.build_parser().parse_args(
        ["interrail-stays", "--paradas", json.dumps([parada(), parada(offer_id="ir-centro-BER-2026-11-08-3n-2", city="Berlín", checkin="2026-11-08", checkout="2026-11-11")])]
    )
    assert cli.cmd_interrail_stays(args) == 0
    assert len(vistas) == 2


def test_una_peticion_mala_no_busca_nada(monkeypatch):
    monkeypatch.setattr(cli, "cmd_scan_stays", lambda ns: pytest.fail("no debia buscar"))
    args = cli.build_parser().parse_args(["interrail-stays", "--paradas", "[{}]"])
    assert cli.cmd_interrail_stays(args) == 2


# ------------------------------------------------------------ solo enteros
def casa(area, kind="stay", precio=100.0):
    return StayOffer(provider="airbnb", name="x", url="u", kind=kind, area=area, price_total=precio)


@pytest.mark.parametrize(
    "area",
    ["Apartamento en Monastiraki", "Loft en Kreuzberg", "Casa en Trastevere", "Rooftop apartment in Plaka"],
)
def test_lo_entero_pasa(area):
    assert es_entero(casa(area))


@pytest.mark.parametrize(
    "area",
    [
        "Habitación privada en Plaka",
        "Habitación compartida en Kerameikos",
        "Habitación de hotel en Marrakech Medina",
        "Private room in Kreuzberg",
        "Shared room in Mitte",
        "Room in Trastevere",
        "Cama en dormitorio compartido",
    ],
)
def test_una_habitacion_no_pasa(area):
    assert not es_entero(casa(area))


def test_ni_un_hotel_ni_un_enlace_ni_algo_sin_precio():
    assert not es_entero(casa("Apartamento en Plaka", kind="hotel"))
    assert not es_entero(casa("Booking.com", kind="link", precio=None))
    assert not es_entero(casa("Apartamento en Plaka", precio=None))


def test_los_enlaces_se_quedan_detras_para_seguir_buscando():
    lista = [
        casa("Enlace", kind="link", precio=None),
        casa("Habitación privada en Plaka"),
        casa("Apartamento en Plaka"),
    ]
    quedan = solo_enteros(lista)
    assert [s.area for s in quedan] == ["Apartamento en Plaka", "Enlace"]


# ----------------------------------------------------------------- airbnb
def test_airbnb_pide_solo_enteros_y_no_pregunta_por_hoteles(monkeypatch):
    """Filtrar en Airbnb y no aqui: pedirlo todo y tirar las habitaciones
    dejaba cuatro o cinco pisos de dieciocho anuncios."""
    from tripfinder.stays import airbnb

    pasadas = []

    def falsa(self, req, tipo, extra, vistos):
        pasadas.append((tipo, dict(extra)))
        return []

    monkeypatch.setattr(airbnb.AirbnbProvider, "_pasada", falsa)
    prov = airbnb.AirbnbProvider.__new__(airbnb.AirbnbProvider)
    req = StayRequest(city="Roma", iata="FCO", checkin="2026-11-06", checkout="2026-11-08", solo_enteros=True)
    prov.search(req)
    assert pasadas == [("stay", {"room_types[]": "Entire home/apt"})]

    pasadas.clear()
    prov.search(StayRequest(city="Roma", iata="FCO", checkin="2026-11-06", checkout="2026-11-08"))
    assert [t for t, _ in pasadas] == ["stay", "hotel"]


# ------------------------------------------------------------------ vuelos
def vuelo(**extra):
    base = {
        "id": "ir-vuelo-MAD-AMS-2026-11-06-ida",
        "origen": "MAD",
        "aeropuertos": ["AMS", "EIN", "RTM"],
        "fecha": "2026-11-06",
        "sentido": "ida",
    }
    return {**base, **extra}


def test_un_vuelo_bueno_pasa():
    [v] = cli.vuelos_interrail(json.dumps([vuelo()]))
    assert v["aeropuertos"] == ["AMS", "EIN", "RTM"]


@pytest.mark.parametrize(
    "malo",
    [
        {"id": "../../x"},
        {"id": "ir-vuelo-MAD-AMS-2026-11-06-ida", "sentido": "vuelta"},  # no casan
        {"origen": "MADRID"},
        {"aeropuertos": []},
        {"aeropuertos": ["AMS", "EIN", "RTM", "BRU", "CRL"]},  # mas de cuatro
        {"aeropuertos": ["AMS; rm -rf"]},
        {"fecha": "pasado"},
    ],
)
def test_un_vuelo_malo_se_rechaza(malo):
    with pytest.raises(ValueError):
        cli.vuelos_interrail(json.dumps([vuelo(**malo)]))


def test_sin_vuelos_es_una_lista_vacia():
    assert cli.vuelos_interrail("[]") == []
    assert cli.vuelos_interrail("") == []


class Ryanair:
    """Falso: devuelve lo que se le diga y apunta lo que le piden."""

    def __init__(self, tramos):
        self.tramos = tramos
        self.pedidos = []

    def search_oneway(self, ruta, dia, *, inbound=False, destinations=None, **kw):
        self.pedidos.append((ruta.origin, dia.isoformat(), inbound, destinations))
        return self.tramos


def tramo(precio, desde="MAD", hasta="EIN"):
    from tripfinder.models import Leg

    return Leg(provider="ryanair", airline="Ryanair", origin=desde, destination=hasta,
               date="2026-11-06", time="07:10", price=precio)


def test_se_queda_con_el_mas_barato_de_todos_los_aeropuertos(monkeypatch):
    """Ryanair no vuela a Amsterdam pero si a Eindhoven: sin los aeropuertos de
    al lado, casi ninguna ruta tendria precio de vuelo."""
    falso = Ryanair([tramo(89, hasta="EIN"), tramo(41, hasta="EIN"), tramo(120, hasta="AMS")])
    monkeypatch.setattr(cli, "build_providers", lambda nombres, cfg: [falso])
    res = cli.buscar_vuelo_interrail(cli.vuelos_interrail(json.dumps([vuelo()]))[0], cli.load_config(None))
    assert [leg["price"] for leg in res["legs"]] == [41, 89, 120]
    assert falso.pedidos == [("MAD", "2026-11-06", False, ["AMS", "EIN", "RTM"])]


def test_la_vuelta_se_pregunta_al_reves(monkeypatch):
    """La API solo filtra por aeropuerto de salida: la vuelta se pregunta
    desde cada aeropuerto de la ciudad hacia Madrid."""
    falso = Ryanair([tramo(35, desde="BUD", hasta="MAD")])
    monkeypatch.setattr(cli, "build_providers", lambda nombres, cfg: [falso])
    v = vuelo(id="ir-vuelo-MAD-BUD-2026-11-17-vuelta", aeropuertos=["BUD"], fecha="2026-11-17", sentido="vuelta")
    res = cli.buscar_vuelo_interrail(cli.vuelos_interrail(json.dumps([v]))[0], cli.load_config(None))
    assert falso.pedidos == [("MAD", "2026-11-17", True, ["BUD"])]
    assert res["legs"][0]["price"] == 35


def test_sin_vuelo_se_guarda_igual_para_que_la_web_lo_sepa(monkeypatch, tmp_path):
    """«Se buscó y no hay» es un dato: sin el fichero, la web se quedaria
    esperando para siempre."""
    monkeypatch.setattr(cli, "build_providers", lambda nombres, cfg: [Ryanair([])])
    monkeypatch.setattr(cli, "cmd_scan_stays", lambda ns: 0)
    monkeypatch.setattr(cli, "Store", lambda: _store(tmp_path))
    args = cli.build_parser().parse_args(
        ["interrail-stays", "--paradas", json.dumps([parada()]), "--vuelos", json.dumps([vuelo()])]
    )
    assert cli.cmd_interrail_stays(args) == 0
    guardado = json.loads((tmp_path / "interrail" / "ir-vuelo-MAD-AMS-2026-11-06-ida.json").read_text())
    assert guardado["legs"] == []
    indice = json.loads((tmp_path / "interrail" / "index.json").read_text())
    assert indice["vuelos"] == ["ir-vuelo-MAD-AMS-2026-11-06-ida"]


def _store(raiz):
    from tripfinder.store import Store

    return Store(raiz)
