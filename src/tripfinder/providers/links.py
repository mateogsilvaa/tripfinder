"""Enlaces de reserva. Un precio con un enlace roto no vale para nada.

Aqui vive todo lo que convierte (aerolinea, ruta, fechas, pasajeros) en una URL
que de verdad abre ese vuelo. Esta separado de los providers porque el enlace y
el precio no siempre vienen del mismo sitio: Google Flights nos dice que easyJet
vuela Madrid-Basilea por 89 EUR, pero para reservarlo hay que ir a easyjet.com.

Dos avisos por experiencia propia:

* **Wizz Air**: el formato con parametros (`?departureStation=MAD&...`) abre la
  pagina de reserva pero SIN la ruta puesta, asi que el usuario ve un formulario
  vacio y parece que el enlace no lleva a ningun sitio. El que funciona es el de
  por path (`/booking/select-flight/MAD/OTP/2026-11-06/2026-11-09/1/0/0/null`),
  que llega con Madrid -> Bucarest y las fechas ya seleccionadas.
* **easyJet**: su buscador rechaza cualquier peticion que no venga de un
  navegador de verdad, pero sus paginas de ruta por IATA
  (`/es/vuelos-baratos/MAD/LIS`) funcionan perfectamente al abrirlas y llevan el
  calendario de precios de esa ruta.

Cualquier aerolinea que no este aqui se queda con el enlace que trajera su
provider (Google Flights, normalmente), que siempre funciona.
"""

from __future__ import annotations

import unicodedata

ADULTOS_MAX = 9


def _iso(dia: str) -> str:
    """Solo la parte YYYY-MM-DD, vengan como vengan las fechas."""
    return (dia or "")[:10]


def google(origen: str, destino: str, ida: str, vuelta: str = "", adultos: int = 1) -> str:
    """Buscador de Google con la ruta y las fechas ya codificadas.

    Es el comodin: no es la web de la aerolinea, pero nunca falla y ensena todas
    las companias de esa ruta, incluida la que dio el precio.
    """
    from .google_flights import build_tfs

    ida, vuelta = _iso(ida), _iso(vuelta)
    tfs = build_tfs(origen, destino, ida, vuelta or ida, max(1, adultos))
    return f"https://www.google.com/travel/flights?tfs={tfs}&curr=EUR&hl=es&gl=ES"


def wizzair(origen: str, destino: str, ida: str, vuelta: str = "", adultos: int = 1) -> str:
    """Wizz Air, formato por path (el unico que llega con la ruta puesta)."""
    ida, vuelta = _iso(ida), _iso(vuelta)
    pax = min(ADULTOS_MAX, max(1, adultos))
    return (
        "https://www.wizzair.com/es-es/booking/select-flight/"
        f"{origen}/{destino}/{ida}/{vuelta or 'null'}/{pax}/0/0/null"
    )


def ryanair(origen: str, destino: str, ida: str, vuelta: str = "", adultos: int = 1) -> str:
    ida, vuelta = _iso(ida), _iso(vuelta)
    pax = min(ADULTOS_MAX, max(1, adultos))
    return (
        "https://www.ryanair.com/es/es/trip/flights/select"
        f"?adults={pax}&teens=0&children=0&infants=0"
        f"&dateOut={ida}&dateIn={vuelta}"
        f"&originIata={origen}&destinationIata={destino}"
        f"&isReturn={'true' if vuelta else 'false'}&discount=0"
    )


def easyjet(origen: str, destino: str, ida: str = "", vuelta: str = "", adultos: int = 1) -> str:
    """Pagina de ruta de easyJet: precios y calendario de MAD a donde sea.

    No admite fechas en la URL, pero abre el buscador de precios bajos de esa
    ruta exacta, que es lo unico que easyJet deja enlazar desde fuera.
    """
    return f"https://www.easyjet.com/es/vuelos-baratos/{origen}/{destino}"


def vueling(origen: str, destino: str, ida: str, vuelta: str = "", adultos: int = 1) -> str:
    ida, vuelta = _iso(ida), _iso(vuelta)
    pax = min(ADULTOS_MAX, max(1, adultos))
    return (
        "https://tickets.vueling.com/ScheduleSelectNew.aspx"
        f"?culture=es-ES&adults={pax}&children=0&infants=0"
        f"&origin={origen}&destination={destino}"
        f"&departure={ida}&arrival={vuelta}"
        f"&triptype={'RT' if vuelta else 'OW'}"
    )


def transavia(origen: str, destino: str, ida: str, vuelta: str = "", adultos: int = 1) -> str:
    ida, vuelta = _iso(ida), _iso(vuelta)
    pax = min(ADULTOS_MAX, max(1, adultos))
    return (
        "https://www.transavia.com/es-ES/reserva/vuelos/"
        f"?origin={origen}&destination={destino}"
        f"&outboundDate={ida}&inboundDate={vuelta}&adults={pax}"
    )


def volotea(origen: str, destino: str, ida: str, vuelta: str = "", adultos: int = 1) -> str:
    ida, vuelta = _iso(ida), _iso(vuelta)
    pax = min(ADULTOS_MAX, max(1, adultos))
    return (
        "https://www.volotea.com/es/vuelos/"
        f"?origin={origen}&destination={destino}"
        f"&departureDate={ida}&returnDate={vuelta}&adults={pax}"
    )


# Como llama Google Flights a cada compania -> quien sabe construirle un enlace.
# La clave se normaliza (sin acentos, minusculas, sin espacios) antes de buscar,
# asi que "easyJet", "EasyJet" y "easy jet" caen en la misma entrada.
CONSTRUCTORES = {
    "wizzair": wizzair,
    "ryanair": ryanair,
    "easyjet": easyjet,
    "easyjetswitzerland": easyjet,
    "vueling": vueling,
    "transavia": transavia,
    "transaviafrance": transavia,
    "volotea": volotea,
}

# Como se llama la compania de cara al usuario, para el texto del boton.
ETIQUETAS = {
    "wizzair": "Wizz Air",
    "ryanair": "Ryanair",
    "easyjet": "easyJet",
    "easyjetswitzerland": "easyJet",
    "vueling": "Vueling",
    "transavia": "Transavia",
    "transaviafrance": "Transavia",
    "volotea": "Volotea",
}


def _clave(aerolinea: str) -> str:
    limpio = unicodedata.normalize("NFKD", (aerolinea or "").strip().lower())
    return "".join(c for c in limpio if c.isalnum() and not unicodedata.combining(c))


def por_aerolinea(
    aerolinea: str, origen: str, destino: str, ida: str, vuelta: str = "", adultos: int = 1
) -> tuple[str, str]:
    """(url, etiqueta) de la web de esa compania, o ("", "") si no la conocemos.

    Se usa para anadir un segundo boton "Reservar en easyJet" junto al enlace
    normal, no para sustituirlo: si el formato de alguna cambia, el enlace de
    siempre sigue ahi y el usuario no se queda sin poder abrir el vuelo.
    """
    clave = _clave(aerolinea)
    constructor = CONSTRUCTORES.get(clave)
    if constructor is None:
        return "", ""
    try:
        return constructor(origen, destino, ida, vuelta, adultos), ETIQUETAS.get(clave, aerolinea)
    except Exception:  # noqa: BLE001 - un enlace mal formado no puede tumbar un scan
        return "", ""
