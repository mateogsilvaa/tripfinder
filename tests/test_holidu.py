"""Holidu: el parser, contra la forma real de su pagina.

La estructura sale de la sonda que se paso por GitHub Actions el 24 de
septiembre: `<script data-key="initial-state">` con un comentario HTML dentro,
y los anuncios en `zustand.offersV2.offers`, indexados por id. El primer
anuncio de aqui es el que devolvio de verdad para Amsterdam, recortado.
"""

from __future__ import annotations

import json

from tripfinder.stays import holidu
from tripfinder.stays.base import StayRequest


def anuncio(ident, tipo="APARTMENT", total=400, caben=4, **extra):
    base = {
        "id": ident,
        "isAvailable": True,
        "internalLink": f"/d/{ident}?checkin=2026-11-06&checkout=2026-11-08&adults=2",
        "provider": {"id": "VRBO", "shortName": "Expedia"},
        "price": {"total": total, "daily": total / 2, "currency": "EUR", "nights": 2},
        "details": {
            "name": f"Piso {ident}",
            "apartmentType": tipo,
            "apartmentTypeTitle": "Apartamento",
            "guestsCount": caben,
        },
        "location": {"lat": 52.37, "lng": 4.89, "name": "Costa Holandesa"},
        "photos": [
            {"t": f"https://img.holidu.com/{ident}-t.jpg", "l": f"https://img.holidu.com/{ident}-l.jpg"},
            {"t": f"https://img.holidu.com/{ident}-2.jpg"},
        ],
    }
    base.update(extra)
    return base


# El que devolvio Holidu de verdad, tal cual en lo que importa.
REAL = {
    "id": "59431045",
    "isAvailable": True,
    "internalLink": "/d/59431045?searchId=3dd9&checkin=2026-11-06&checkout=2026-11-08&adults=2",
    "provider": {"id": "VRBO", "shortName": "Expedia", "legalName": "Expedia Inc."},
    "price": {"total": 698, "daily": 349, "isExact": True, "currency": "EUR", "nights": 2},
    "details": {
        "name": "Mercedesbnb Amsterdam City Center Deluxe Studio",
        "apartmentTypeTitle": "Alojamiento y desayuno",
        "apartmentType": "BED_AND_BREAKFAST",
        "guestsCount": 2,
    },
    "location": {"lat": 52.381343, "lng": 4.888468, "name": "Costa Holandesa"},
    "photos": [{"t": "https://img.holidu.com/images/9ae1.jpg"}],
}


def pagina(*ofertas, envuelta=True):
    estado = {
        "redux": {"router": {}},
        "zustand": {"offersV2": {"offers": {o["id"]: o for o in ofertas}}},
    }
    cuerpo = json.dumps(estado, ensure_ascii=False)
    if envuelta:
        cuerpo = f"<!--{cuerpo}-->"
    return (
        '<html><head><script type="application/ld+json">{}</script></head><body>'
        f'<script type="application/json" data-key="initial-state">{cuerpo}</script>'
        "</body></html>"
    )


def test_lee_el_estado_aunque_venga_dentro_de_un_comentario():
    assert holidu.estado_inicial(pagina(anuncio("1")))["zustand"]
    assert holidu.estado_inicial(pagina(anuncio("1"), envuelta=False))["zustand"]


def test_un_piso_entero_sale_con_todo_lo_que_hace_falta():
    [s] = holidu.ofertas_de(pagina(anuncio("7", total=420)), adultos=2)
    assert s.provider == "holidu"
    assert s.kind == "stay"
    assert s.price_total == 420
    assert s.price_per_night == 210
    assert s.url.startswith("https://www.holidu.es/d/7?")
    assert (s.lat, s.lon) == (52.37, 4.89)
    assert s.note == "vía Expedia"
    # La foto grande primero, y solo https.
    assert s.images[0].endswith("7-l.jpg")
    assert s.image == s.images[0]


def test_el_bnb_de_verdad_no_entra():
    """El primer anuncio que devolvio Holidu para Amsterdam era un B&B: una
    habitacion con desayuno. Se pidio nada de habitaciones."""
    assert holidu.ofertas_de(pagina(REAL), adultos=2) == []


def test_nada_de_habitaciones_ni_hoteles_ni_hostales():
    tipos = ["ROOM", "PRIVATE_ROOM", "SHARED_ROOM", "HOTEL_ROOM", "HOSTEL", "GUEST_HOUSE", "BED_AND_BREAKFAST"]
    ofertas = [anuncio(str(i), tipo=t) for i, t in enumerate(tipos)]
    assert holidu.ofertas_de(pagina(*ofertas), adultos=2) == []


def test_lo_entero_si_entra_aunque_sea_un_tipo_nuevo():
    tipos = ["APARTMENT", "HOUSE", "VILLA", "CHALET", "HOUSEBOAT", "LOFT_NUEVO"]
    ofertas = [anuncio(str(i), tipo=t) for i, t in enumerate(tipos)]
    assert len(holidu.ofertas_de(pagina(*ofertas), adultos=2)) == len(tipos)


def test_lo_que_no_vale_se_queda_fuera():
    ofertas = [
        anuncio("no-disp", isAvailable=False),
        anuncio("sin-precio", total=0),
        anuncio("dolares", price={"total": 300, "currency": "USD"}),
        anuncio("pequeno", caben=2),  # para 3 no cabe
        anuncio("sin-enlace", internalLink="https://otra.web/x"),
        anuncio("bueno"),
    ]
    quedan = holidu.ofertas_de(pagina(*ofertas), adultos=3)
    assert [s.name for s in quedan] == ["Piso bueno"]


def test_la_comarca_no_se_cuela_como_barrio():
    """`location.name` es «Costa Holandesa», no un barrio. Si fuera al `area`
    con la forma «X en Y», `zonas.py` agruparia la ciudad entera ahi."""
    from tripfinder.stays.zonas import barrio

    [s] = holidu.ofertas_de(pagina(anuncio("1")), adultos=2)
    assert "Costa Holandesa" not in s.area
    assert barrio(s.area, "Ámsterdam") == ""


def test_las_notas_se_pasan_a_escala_de_cinco():
    assert holidu._nota({"rating": {"value": 9.2, "count": 40}}) == 4.6
    # Así llega de verdad (Roma, 24 sep): sobre 100.
    assert holidu._nota({"rating": {"count": 98, "value": 86}}) == 4.3
    assert holidu._nota({"rating": {"value": 92}}) == 4.6
    assert holidu._nota({"rating": {"value": 4.8}}) == 4.8
    assert holidu._nota({"rating": None}) is None
    assert holidu._resenas({"rating": {"value": 9.2, "count": 40}}) == 40


def test_una_pagina_sin_estado_no_revienta():
    assert holidu.ofertas_de("<html>Just a moment...</html>") == []
    assert holidu.ofertas_de('<script data-key="initial-state"><!--{roto--></script>') == []


def test_el_proveedor_pide_la_ciudad_y_las_fechas(monkeypatch):
    pedido = {}

    def falso(url, params=None, **kw):
        pedido.update(url=url, params=params)
        return pagina(anuncio("1"), anuncio("2", tipo="ROOM"))

    monkeypatch.setattr(holidu, "get_text", falso)
    req = StayRequest(city="Ámsterdam", iata="AMS", checkin="2026-11-06", checkout="2026-11-08", adults=2)
    ofertas = holidu.HoliduProvider().search(req)
    assert pedido["url"] == "https://www.holidu.es/s/%C3%81msterdam"
    assert pedido["params"] == {"checkin": "2026-11-06", "checkout": "2026-11-08", "adults": 2}
    assert [s.name for s in ofertas] == ["Piso 1"]


def test_casa_de_huespedes_no_entra_aunque_su_tipo_no_lo_diga():
    """Lo trajo la primera prueba de verdad, en Montpellier: una «Casa de
    huéspedes» —habitaciones— con un tipo interno que no lo decía."""
    raro = anuncio("1", tipo="HOLIDAY_HOME")
    raro["details"]["apartmentTypeTitle"] = "Casa de huéspedes"
    desayuno = anuncio("2", tipo="APARTMENT")
    desayuno["details"]["apartmentTypeTitle"] = "Alojamiento y desayuno"
    assert holidu.ofertas_de(pagina(raro, desayuno), adultos=2) == []


def test_un_subtitulo_en_frances_no_se_cuela_como_barrio():
    """También de Montpellier: el `apartmentTypeTitle` a veces es el subtítulo
    que se inventa el anfitrión, en su idioma, y con un «en» dentro."""
    from tripfinder.stays.zonas import barrio

    o = anuncio("1", tipo="APARTMENT")
    o["details"]["apartmentTypeTitle"] = "Le Cosy, T3 en Duplex, Centre historique"
    [s] = holidu.ofertas_de(pagina(o), adultos=2)
    assert s.area == "Apartamento"
    assert barrio(s.area, "Montpellier") == ""


def test_cada_tipo_con_su_etiqueta_y_lo_desconocido_como_entero():
    assert holidu.etiqueta("HOUSEBOAT") == "Casa flotante"
    assert holidu.etiqueta("VILLA") == "Villa"
    assert holidu.etiqueta("ALGO_NUEVO") == "Alojamiento entero"


def test_una_habitacion_con_el_nombre_en_ingles_no_entra():
    """De la primera búsqueda de verdad en Ámsterdam: tipo de piso, título de
    piso, y el nombre decía la verdad."""
    malos = []
    for i, nombre in enumerate(["Roomwest Amsterdam - Double room", "Rembrandt - luxury authentic room at Museumplein"]):
        o = anuncio(str(i))
        o["details"]["name"] = nombre
        malos.append(o)
    assert holidu.ofertas_de(pagina(*malos), adultos=2) == []


def test_bedroom_y_rooftop_son_de_pisos_y_pasan():
    buenos = []
    for i, nombre in enumerate(["2 bedroom apartment in Jordaan", "Rooftop loft near Dam", "Showroom-style studio"]):
        o = anuncio(str(i))
        o["details"]["name"] = nombre
        buenos.append(o)
    assert len(holidu.ofertas_de(pagina(*buenos), adultos=2)) == 3

