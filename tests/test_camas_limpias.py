"""Las camas del Interrail, limpias: lo visto en la primera ruta de verdad.

París, Ámsterdam, Berlín, Praga, Viena, Venecia y Roma, del 26 de octubre al 9
de noviembre, dos personas. Entre lo que salió primero:

· en Berlín, «Numa | Habitación estándar con balcón», con `area` de
  «Apartamento en Prenzlauer Berg»;
· en Viena, «Habitación de hotel moderna | Vista a la ciudad»;
· en Ámsterdam, «AmicitiA» (un barco hotel) a 50 € dos noches, DOS VECES, cuando
  los pisos de la ciudad iban de 300 a 800.
"""

from __future__ import annotations

from tripfinder.models import StayOffer
from tripfinder.stays.enteros import es_entero, sin_precios_imposibles, sin_repetir, solo_enteros


def piso(nombre, precio, area="Apartamento en Mitte", url=None, provider="airbnb"):
    return StayOffer(
        provider=provider, name=nombre, url=url or f"https://x.test/{nombre}", kind="stay",
        price_total=precio, area=area,
    )


def test_lo_que_el_anfitrion_llama_habitacion_lo_es():
    assert not es_entero(piso("Numa | Habitación estándar con balcón", 200))
    assert not es_entero(piso("Habitación de hotel moderna | Vista a la ciudad", 134))
    assert not es_entero(piso("Cozy double room near the station", 90))


def test_bedroom_rooftop_y_roomy_siguen_siendo_pisos():
    assert es_entero(piso("Two-bedroom flat with rooftop", 300))
    assert es_entero(piso("Roomy loft in Mitte", 250))
    assert es_entero(piso("Numa | Estudio grande con cocina en Berlín Mitte", 257))


def test_el_mismo_anuncio_con_otra_consulta_cuenta_una_vez():
    a = piso("AmicitiA", 50, url="https://www.holidu.es/d/2008871?searchId=aaa", provider="holidu")
    b = piso("AmicitiA", 50, url="https://www.holidu.es/d/2008871?searchId=bbb", provider="holidu")
    c = piso("Otro", 300, url="https://www.holidu.es/d/99?searchId=aaa", provider="holidu")
    assert [s.url for s in sin_repetir([a, b, c])] == [a.url, c.url]


def test_un_precio_imposible_para_un_piso_entero_se_tira():
    lista = [piso("Barco", 50)] + [piso(f"P{i}", p) for i, p in enumerate([305, 366, 427, 499, 560])]
    assert [s.name for s in sin_precios_imposibles(lista)] == ["P0", "P1", "P2", "P3", "P4"]


def test_con_pocos_precios_no_se_juzga_nada():
    lista = [piso("Barato", 50), piso("Caro", 500)]
    assert sin_precios_imposibles(lista) == lista


def test_todo_junto_y_los_enlaces_detras():
    enlace = StayOffer(provider="deeplinks", name="Booking", url="https://b.test", kind="link")
    lista = [
        enlace,
        piso("Numa | Habitación grande", 219),
        piso("A", 300), piso("A", 300), piso("B", 320), piso("C", 350), piso("D", 380),
    ]
    assert [s.name for s in solo_enteros(lista)] == ["A", "B", "C", "D", "Booking"]
