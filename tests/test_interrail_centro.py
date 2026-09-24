"""La cama del Interrail, en el centro de verdad.

Pedido tal cual: «Los alojamientos no son buenos si estan a 7 km del centro, ni
a 43 min andando». Por nombre de ciudad, Airbnb y Holidu devolvian pisos con
la mediana a 2-4 km. Medido el 24 de septiembre desde un runner: buscando en un
recuadro alrededor del centro, los dieciocho de Airbnb quedaban a menos de 1,6
km en Roma, Amsterdam, Praga y Viena, y los de Holidu en Viena igual.
"""

from __future__ import annotations

import json

import pytest

from tripfinder import cli
from tripfinder.models import StayOffer
from tripfinder.stays import airbnb, holidu, ranking
from tripfinder.stays.base import RECUADROS_KM, StayRequest, recuadro
from tripfinder.stays.centro import km_entre

VIENA = (48.2085, 16.3721)


def req(**extra):
    base = {"city": "Viena", "iata": "VIE", "checkin": "2026-11-06", "checkout": "2026-11-08", "country": "Austria"}
    return StayRequest(**{**base, **extra})


# ------------------------------------------------------------- el recuadro
def test_el_recuadro_mide_lo_que_dice():
    r = recuadro(VIENA, 1.5)
    # De la esquina al centro, en linea recta: medio lado por raiz de dos.
    assert km_entre(VIENA, (r["ne_lat"], r["ne_lng"])) == pytest.approx(1.5 * 2**0.5, rel=0.03)
    assert r["sw_lat"] < VIENA[0] < r["ne_lat"]
    assert r["sw_lng"] < VIENA[1] < r["ne_lng"]


def test_airbnb_busca_en_los_dos_recuadros_cuando_sabe_el_centro(monkeypatch):
    pasadas = []
    monkeypatch.setattr(
        airbnb.AirbnbProvider, "_pasada", lambda self, r, tipo, extra, vistos: pasadas.append(dict(extra)) or []
    )
    prov = airbnb.AirbnbProvider.__new__(airbnb.AirbnbProvider)
    prov.search(req(solo_enteros=True, centro=VIENA))
    assert len(pasadas) == len(RECUADROS_KM)
    for extra, km in zip(pasadas, RECUADROS_KM, strict=True):
        assert extra["room_types[]"] == "Entire home/apt"
        assert extra["ne_lat"] == recuadro(VIENA, km)["ne_lat"]
        assert extra["search_by_map"] == "true"


def test_sin_centro_airbnb_busca_como_siempre(monkeypatch):
    pasadas = []
    monkeypatch.setattr(
        airbnb.AirbnbProvider, "_pasada", lambda self, r, tipo, extra, vistos: pasadas.append(dict(extra)) or []
    )
    prov = airbnb.AirbnbProvider.__new__(airbnb.AirbnbProvider)
    prov.search(req(solo_enteros=True))
    assert pasadas == [{"room_types[]": "Entire home/apt"}]


def test_holidu_tambien_y_sin_repetir_pisos(monkeypatch):
    pedidas = []

    def falso(url, params=None, **kw):
        pedidas.append(dict(params))
        return "<html></html>"

    piso = StayOffer(provider="holidu", name="Piso", url="h/1", price_total=200, kind="stay")
    monkeypatch.setattr(holidu, "get_text", falso)
    monkeypatch.setattr(holidu, "ofertas_de", lambda html, adultos=1: [piso])
    ofertas = holidu.HoliduProvider().search(req(centro=VIENA))
    assert [p["ne_lat"] for p in pedidas] == [recuadro(VIENA, km)["ne_lat"] for km in RECUADROS_KM]
    assert ofertas == [piso]  # el mismo piso en los dos recuadros cuenta una vez


# -------------------------------------------------------------- el radio
def casa(nombre, precio, km):
    # Hacia el este desde Viena: a esa latitud un grado de longitud son ~74 km.
    return StayOffer(
        provider="x", name=nombre, url=f"u/{nombre}", price_total=precio, kind="stay",
        lat=VIENA[0], lon=VIENA[1] + km / 74.0,
    )


def test_con_radio_lo_de_fuera_no_entra_aunque_sea_lo_mas_barato():
    ofertas = [casa("a 43 min", 90, 3.4), casa("a 7 km", 60, 7.0), casa("centro", 150, 0.4),
               casa("cerca", 120, 1.2), casa("paseo", 110, 2.2)]
    quedan = ranking.ordenar(ofertas, req(centro=VIENA, radio_km=2.5))
    assert {o.name for o in quedan} == {"centro", "cerca", "paseo"}


def test_con_radio_la_cercania_pesa_como_el_precio():
    """Diez euros más por estar a diez minutos en vez de a media hora."""
    quedan = ranking.ordenar(
        [casa("lejos", 100, 2.4), casa("cerca", 110, 0.5), casa("medio", 105, 1.5)],
        req(centro=VIENA, radio_km=2.5),
    )
    assert quedan[0].name == "cerca"


def test_si_casi_nada_cabe_en_el_radio_entra_lo_mas_cercano_hasta_el_doble():
    """Una parada sin cama es peor que una cama a 3 km dicha como tal."""
    quedan = ranking.ordenar(
        [casa("dentro", 150, 1.0), casa("a 3", 100, 3.0), casa("a 4,5", 90, 4.5), casa("a 9", 50, 9.0)],
        req(centro=VIENA, radio_km=2.5),
    )
    assert {o.name for o in quedan} == {"dentro", "a 3", "a 4,5"}


def test_el_centro_de_la_peticion_manda_sobre_el_geocodificador(monkeypatch):
    monkeypatch.setattr(ranking, "coordenadas", lambda *a, **k: (0.0, 0.0))
    quedan = ranking.ordenar([casa("centro", 100, 0.3)], req(centro=VIENA, radio_km=2.5))
    assert quedan[0].km_centro == pytest.approx(0.3, abs=0.05)


# --------------------------------------------------------- la peticion
def parada(**extra):
    base = {
        "offer_id": "ir-VIE-2026-11-06-2n-2",
        "city": "Viena",
        "country": "Austria",
        "iata": "VIE",
        "checkin": "2026-11-06",
        "checkout": "2026-11-08",
        "lat": VIENA[0],
        "lon": VIENA[1],
    }
    return {**base, **extra}


def test_la_cama_ya_no_depende_de_la_ruta_y_lleva_el_centro():
    [p] = cli.paradas_interrail(json.dumps([parada()]))
    assert p["offer_id"] == "ir-VIE-2026-11-06-2n-2"
    assert p["centro"] == VIENA


def test_lo_de_antes_sigue_valiendo():
    [p] = cli.paradas_interrail(json.dumps([parada(offer_id="ir-danubio-VIE-2026-11-06-2n-2", lat=None, lon=None)]))
    assert p["centro"] is None


@pytest.mark.parametrize("mala", [{"lat": "norte", "lon": 1}, {"lat": 95, "lon": 1}, {"lat": 10, "lon": 200}])
def test_un_centro_raro_se_rechaza(mala):
    with pytest.raises(ValueError):
        cli.paradas_interrail(json.dumps([parada(**mala)]))


def test_el_centro_llega_hasta_la_busqueda(monkeypatch):
    vistos = []
    monkeypatch.setattr(cli, "cmd_scan_stays", lambda ns: vistos.append(ns) or 0)
    args = cli.build_parser().parse_args(["interrail-stays", "--paradas", json.dumps([parada()])])
    assert cli.cmd_interrail_stays(args) == 0
    assert vistos[0].centro == VIENA
