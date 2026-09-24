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
        "offer_id": "ir-centro-AMS-2026-11-06-2",
        "city": "Ámsterdam",
        "country": "Países Bajos",
        "iata": "AMS",
        "checkin": "2026-11-06",
        "checkout": "2026-11-08",
    }
    return {**base, **extra}


# ----------------------------------------------------------------- validacion
def test_una_peticion_buena_pasa_limpia():
    limpias = cli.paradas_interrail(json.dumps([parada(), parada(offer_id="ir-centro-BER-2026-11-08-2", city="Berlín", iata="BER", checkin="2026-11-08", checkout="2026-11-11")]))
    assert [p["offer_id"] for p in limpias] == ["ir-centro-AMS-2026-11-06-2", "ir-centro-BER-2026-11-08-2"]
    assert limpias[0]["city"] == "Ámsterdam"


@pytest.mark.parametrize(
    "mala",
    [
        # El identificador acaba siendo un nombre de fichero: nada de subir de carpeta.
        {"offer_id": "../../etc/passwd"},
        {"offer_id": "ir-centro-AMS-2026-11-06-2/../x"},
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
    limpias = cli.paradas_interrail(json.dumps([parada(offer_id="ir-suiza-LUC-2026-11-08-2", city="Lucerna", iata="")]))
    assert limpias[0]["iata"] == ""


# --------------------------------------------------------------- el encargo
def test_busca_cada_parada_y_siempre_solo_enteros(monkeypatch):
    llamadas = []

    def falso(ns):
        llamadas.append(ns)
        return 0

    monkeypatch.setattr(cli, "cmd_scan_stays", falso)
    args = cli.build_parser().parse_args(
        ["interrail-stays", "--adults", "3", "--paradas", json.dumps([parada(), parada(offer_id="ir-centro-BER-2026-11-08-2", city="Berlín", checkin="2026-11-08", checkout="2026-11-11")])]
    )
    assert cli.cmd_interrail_stays(args) == 0
    assert [n.offer_id for n in llamadas] == ["ir-centro-AMS-2026-11-06-2", "ir-centro-BER-2026-11-08-2"]
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
        ["interrail-stays", "--paradas", json.dumps([parada(), parada(offer_id="ir-centro-BER-2026-11-08-2", city="Berlín", checkin="2026-11-08", checkout="2026-11-11")])]
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
