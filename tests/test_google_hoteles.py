"""Google Hoteles: el `ts` con las fechas y el parser, contra su pagina real.

`datos/google_hoteles_roma.html` es la que contesto Google a un runner de
GitHub el 24 de octubre de 2026 (Roma, 11-13 de diciembre), recortada a tres
hoteles con la misma estructura: dos con categoria y un piso sin ella. Llego en
dolares aunque se pidieron euros, que es lo que pasa desde un runner.
"""

from __future__ import annotations

import base64
from pathlib import Path

import pytest

from tripfinder import util
from tripfinder.stays import google_hotels as G
from tripfinder.stays.base import StayRequest

HTML = (Path(__file__).parent / "datos" / "google_hoteles_roma.html").read_text(encoding="utf-8")
TS = G.ts("Roma", "2026-12-11", "2026-12-13")


def req(adultos=2):
    return StayRequest(city="Roma", iata="FCO", checkin="2026-12-11", checkout="2026-12-13", adults=adultos)


@pytest.fixture(autouse=True)
def cambio(monkeypatch):
    # Sin red: un dolar fijo a 0,925 €.
    monkeypatch.setattr(util, "_CAMBIOS", {"USD": 1.08, "_": 1.0})


def test_el_ts_lleva_la_ciudad_y_las_dos_fechas():
    crudo = base64.urlsafe_b64decode(TS + "=" * (-len(TS) % 4))
    assert b"Roma" in crudo
    # 2026 en varint es 0xea 0x0f; diciembre, 12; los dias 11 y 13; dos noches.
    assert bytes([0x08, 0xEA, 0x0F, 0x10, 0x0C, 0x18, 0x0B]) in crudo
    assert bytes([0x08, 0xEA, 0x0F, 0x10, 0x0C, 0x18, 0x0D]) in crudo
    assert bytes([0x18, 0x02]) in crudo
    # El que se comprobo a mano desde el runner, el mismo byte a byte.
    assert TS == "CAESABozCgoSBjoEUm9tYRoAEhoSFAoHCOoPEAwYCxIHCOoPEAwYDRgCMgIQACoJCgU6A0VVUhoA"


def test_lee_los_tres_alojamientos_de_la_pagina():
    ofertas = G.ofertas_de(HTML, req(), TS)
    assert [o.name for o in ofertas] == [
        "Hotel Gabriella",
        "Caravel Hotel - 4 stars",
        "GuestHost - NEW! Sallustiano Guest House GREEN ROOM x2",
    ]


def test_el_total_es_el_de_con_tasas_y_en_euros():
    gabriella = G.ofertas_de(HTML, req(), TS)[0]
    # 137 US$ las dos noches con tasas, a 1,08: 126,85 €.
    assert gabriella.price_total == pytest.approx(137 / 1.08, abs=0.01)
    assert gabriella.currency == "EUR"
    assert gabriella.price_per_night == pytest.approx(69 / 1.08, abs=0.01)


def test_hotel_con_categoria_y_piso_sin_ella():
    gabriella, caravel, piso = G.ofertas_de(HTML, req(), TS)
    assert gabriella.kind == caravel.kind == "hotel"
    assert caravel.note.startswith("★★★★ ")
    assert caravel.rating == 4.1 and caravel.reviews == 2021
    # Google mezcla pisos en la lista: sin categoria no se le llama hotel.
    assert piso.kind == "stay"


def test_trae_donde_esta_fotos_y_enlace_a_la_ficha_con_las_fechas():
    caravel = G.ofertas_de(HTML, req(), TS)[1]
    assert caravel.lat == pytest.approx(41.865, abs=0.001)
    assert caravel.lon == pytest.approx(12.496, abs=0.001)
    assert caravel.images and caravel.image == caravel.images[0]
    assert caravel.url.startswith("https://www.google.com/travel/hotels/entity/")
    assert f"ts={TS}" in caravel.url


def test_para_cuatro_se_cuentan_dos_habitaciones():
    una = G.ofertas_de(HTML, req(2), TS)[0]
    dos = G.ofertas_de(HTML, req(4), TS)[0]
    assert dos.price_total == pytest.approx(2 * una.price_total)
    assert "2 habitaciones" in dos.note


def test_sin_cambio_de_moneda_no_se_inventa_el_precio(monkeypatch):
    monkeypatch.setattr(util, "_CAMBIOS", {"_": 1.0})
    assert G.ofertas_de(HTML, req(), TS) == []


def test_una_pagina_que_no_es_la_esperada_da_lista_vacia():
    assert G.ofertas_de("<html>muro de cookies</html>", req(), TS) == []
    assert G.ofertas_de("", req(), TS) == []


@pytest.mark.parametrize(
    "texto,valor",
    [("182\xa0US$", 182.0), ("1.234\xa0€", 1234.0), ("89,50 €", 89.5), (None, None), ("gratis", None)],
)
def test_importe(texto, valor):
    assert G.importe(texto) == valor


def test_buscar_junta_las_consultas_sin_repetir(monkeypatch):
    preguntas = []

    def falso(url, params=None, **kw):
        preguntas.append(params["q"])
        return HTML

    monkeypatch.setattr(G, "get_text", falso)
    ofertas = G.GoogleHotels().search(req())
    assert len(preguntas) == len(G.CONSULTAS)
    assert all("Roma" in q for q in preguntas)
    assert len(ofertas) == 3


# --------------------------------------------- todo alojamiento, cerca del centro
def test_el_alojamiento_de_un_vuelo_tambien_se_busca_a_menos_de_2_5_km(monkeypatch, tmp_path):
    """Antes solo el Interrail buscaba alrededor del centro; el resto, por
    nombre de ciudad, y salian pisos a 6 y 8 km."""
    from tripfinder import cli
    from tripfinder.models import StayOffer
    from tripfinder.stays import centro

    vistas = []

    class Falso:
        name = "falso"

        def search(self, r):
            vistas.append(r)
            return [
                StayOffer(provider="falso", name="Cerca", url="u", price_total=200, lat=41.90, lon=12.49),
                StayOffer(provider="falso", name="Barato y lejos", url="u", price_total=90, lat=41.85, lon=12.60),
                StayOffer(provider="falso", name="Otra cerca", url="u", price_total=210, lat=41.89, lon=12.48),
                StayOffer(provider="falso", name="Y otra", url="u", price_total=220, lat=41.895, lon=12.485),
            ]

    monkeypatch.setattr(centro, "coordenadas", lambda ciudad, pais="": (41.8933, 12.4829))
    monkeypatch.setattr(cli, "build_stay_providers", lambda nombres, cfg: [Falso()])
    args = cli.build_parser().parse_args(
        ["scan-stays", "--offer-id", "x", "--city", "Roma", "--checkin", "2026-12-11", "--dry-run"]
    )
    assert cli.cmd_scan_stays(args) == 0
    (r,) = vistas
    assert r.centro == (41.8933, 12.4829)
    assert r.radio_km == cli.RADIO_KM == 2.5
