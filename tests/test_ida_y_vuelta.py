"""Un viaje de ida y vuelta cuesta la ida Y la vuelta.

EL FALLO. Wizz publica en `search/timetable` TODOS los días de la ventana que
se le pide, también aquellos en los que no vuela o no queda plaza; esos vienen
con el objeto `price` puesto pero con el importe a cero o a nulo. El provider
filtraba por «trae precio» —el objeto, no el importe— y después sumaba
`(ida + (vuelta or 0))`: cuando la vuelta no tenía tarifa, el total era
exactamente la tarifa de ida. Un viaje de ida y vuelta publicado al precio de
la mitad.

Y no era inofensivo: al salir barato ganaba el desempate de su ruta y se
colocaba arriba del tablón, que es justo donde más se mira. En los datos
publicados se veía a simple vista — las tarifas de Wizz acaban en .99 o .98, y
sumando dos el total solo puede acabar en .98, .97 o .96; había ocho ofertas
acabadas en .99, que no puede ser una suma de dos.

Ryanair tenía el mismo cero silencioso en el camino de respaldo, así que se
prueba aquí al lado: es el mismo fallo, no dos.
"""

from __future__ import annotations

from tripfinder.config import Route
from tripfinder.providers.ryanair import RyanairProvider
from tripfinder.providers.wizzair import WizzairProvider, _importe

RUTA = Route(origin="MAD", origin_name="Madrid")


def vuelo(dia: str, importe):
    """Un día tal y como lo devuelve el `timetable` de Wizz."""
    return {
        "departureDate": f"{dia}T06:00:00",
        "price": {"amount": importe, "currencyCode": "EUR"},
    }


def wizz(**cfg) -> WizzairProvider:
    base = {"adults": 1, "nights_min": 2, "nights_max": 4, "weekend": {"outbound_weekday": 4}}
    base.update(cfg)
    return WizzairProvider(base)


# ------------------------------------------------------------- el importe
def test_un_dia_sin_tarifa_no_tiene_importe():
    """Cero y nulo son «ese día no se puede volar», no «ese día es gratis»."""
    assert _importe(vuelo("2026-12-11", 0)) is None
    assert _importe(vuelo("2026-12-11", None)) is None
    assert _importe(vuelo("2026-12-11", 0.0)) is None
    assert _importe({"departureDate": "2026-12-11T06:00:00"}) is None
    assert _importe({"departureDate": "2026-12-11T06:00:00", "price": None}) is None


def test_un_dia_con_tarifa_da_su_importe():
    assert _importe(vuelo("2026-12-11", 19.99)) == 19.99


def test_una_tarifa_ilegible_no_se_inventa():
    assert _importe({"price": {"amount": "gratis"}}) is None


# --------------------------------------------------- lo que se publica
def test_sin_tarifa_de_vuelta_NO_se_publica_el_viaje():
    """El fallo, tal cual: antes salía una oferta de ida y vuelta a 19,99."""
    idas = {"2026-12-11": vuelo("2026-12-11", 19.99)}
    vueltas = {"2026-12-13": vuelo("2026-12-13", 0)}
    assert wizz()._casar(RUTA, "MXP", idas, vueltas, 2) == []


def test_sin_tarifa_de_vuelta_tampoco_por_fechas_exactas():
    """El otro camino: el de las búsquedas personalizadas."""
    ida, vuelta = vuelo("2026-12-11", 19.99), vuelo("2026-12-13", None)
    assert wizz()._oferta(RUTA, "MXP", "2026-12-11", "2026-12-13", ida, vuelta, 2) is None


def test_con_las_dos_tarifas_se_suman_las_dos():
    idas = {"2026-12-11": vuelo("2026-12-11", 19.99)}
    vueltas = {"2026-12-13": vuelo("2026-12-13", 24.99)}
    ofertas = wizz()._casar(RUTA, "MXP", idas, vueltas, 2)
    assert len(ofertas) == 1
    assert ofertas[0].price == 44.98
    assert ofertas[0].return_date == "2026-12-13"


def test_el_precio_no_puede_ser_el_de_una_sola_tarifa():
    """La comprobación que delató el fallo en los datos publicados: sumando dos
    tarifas de Wizz el total NO puede acabar en .99."""
    idas = {"2026-12-11": vuelo("2026-12-11", 29.99)}
    vueltas = {"2026-12-13": vuelo("2026-12-13", 29.99)}
    precio = wizz()._casar(RUTA, "MXP", idas, vueltas, 2)[0].price
    assert round(precio % 1, 2) != 0.99
    assert precio == 59.98


def test_si_falta_la_vuelta_se_prueba_otra_duracion_antes_de_rendirse():
    """Tres noches en vez de dos es un viaje distinto, no medio viaje."""
    idas = {"2026-12-11": vuelo("2026-12-11", 19.99)}
    vueltas = {"2026-12-13": vuelo("2026-12-13", 0), "2026-12-14": vuelo("2026-12-14", 24.99)}
    ofertas = wizz()._casar(RUTA, "MXP", idas, vueltas, 2)
    assert len(ofertas) == 1
    assert ofertas[0].return_date == "2026-12-14"
    assert ofertas[0].nights == 3
    assert ofertas[0].price == 44.98


def test_el_precio_es_para_toda_la_gente_que_viaja():
    """`timetable` da el precio por persona y se ríe del `adultCount`."""
    idas = {"2026-12-11": vuelo("2026-12-11", 19.99)}
    vueltas = {"2026-12-13": vuelo("2026-12-13", 24.99)}
    oferta = wizz(adults=2)._casar(RUTA, "MXP", idas, vueltas, 2)[0]
    assert oferta.price == 89.96
    assert oferta.adults == 2
    assert oferta.price_per_person == 44.98


def test_el_enlace_lleva_la_vuelta_puesta():
    """Si el viaje se publica como ida y vuelta, el enlace abre ida y vuelta."""
    idas = {"2026-12-11": vuelo("2026-12-11", 19.99)}
    vueltas = {"2026-12-13": vuelo("2026-12-13", 24.99)}
    enlace = wizz()._casar(RUTA, "MXP", idas, vueltas, 2)[0].deep_link
    assert enlace.endswith("/MAD/MXP/2026-12-11/2026-12-13/1/0/0/null")
    assert "null/1/0/0" not in enlace  # eso sería una vuelta sin fecha


# ------------------------------------------------------------- ryanair
def _fare(**extra):
    base = {
        "outbound": {
            "departureAirport": {"iataCode": "MAD"},
            "arrivalAirport": {"iataCode": "FCO", "city": {"name": "Roma"}},
            "departureDate": "2026-12-11T06:35:00",
            "price": {"value": 29.99, "currencyCode": "EUR"},
        }
    }
    base.update(extra)
    return base


def test_ryanair_sin_resumen_necesita_las_dos_mitades():
    """Sin `summary`, sumar a mano con un cero por la vuelta publicaba el viaje
    al precio de la ida. El mismo fallo que en Wizz."""
    assert RyanairProvider._parse(_fare(), Route(origin="MAD"), "EUR") is None


def test_ryanair_sin_resumen_pero_con_las_dos_si_suma():
    fare = _fare(inbound={
        "departureDate": "2026-12-13T20:00:00",
        "price": {"value": 34.99, "currencyCode": "EUR"},
    })
    oferta = RyanairProvider._parse(fare, Route(origin="MAD"), "EUR")
    assert oferta is not None
    assert oferta.price == 64.98
    assert oferta.return_date == "2026-12-13"


def test_ryanair_con_resumen_sigue_usando_el_resumen():
    """Es el camino normal y el bueno: el total lo da Ryanair, no lo sumamos."""
    fare = _fare(summary={"price": {"value": 59.98, "currencyCode": "EUR"}})
    oferta = RyanairProvider._parse(fare, Route(origin="MAD"), "EUR")
    assert oferta is not None and oferta.price == 59.98
