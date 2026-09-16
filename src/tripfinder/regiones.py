"""Regiones: un nombre para un puñado de países que se viajan juntos.

Buscar "los Balcanes" o "los nórdicos" es algo que la gente piensa y la web no
entendía: había continentes (demasiado grande: Europa son 44 países) y países
sueltos (demasiado pequeño: nadie quiere Albania *y sólo* Albania). Entre los
dos faltaba el escalón que de verdad se usa al decidir un viaje.

OJO CON LOS NOMBRES. `airports_world.json` mezcla idiomas sin ningún criterio
—"Croacia" al lado de "North Macedonia"— y a veces trae DOS grafías del mismo
país ("Bosnia & Herzegovina" y "Bosnia and Herzegovina", "Czech Republic" y
"República Checa"). Por eso cada región lista todas las variantes que aparecen
en el fichero: una región a la que le falte una grafía se deja fuera medio país
sin que nada falle, que es la peor forma de equivocarse.

Hay una prueba que comprueba que todos estos nombres existen de verdad en el
listado de aeropuertos: si mañana cambia una grafía, salta ahí y no en una
búsqueda vacía.
"""

from __future__ import annotations

import unicodedata

# region -> paises, tal y como se escriben en `airports_world.json`
REGIONES: dict[str, tuple[str, ...]] = {
    "los balcanes": (
        "Albania", "Bosnia & Herzegovina", "Bosnia and Herzegovina", "Bulgaria",
        "Croacia", "Eslovenia", "Grecia", "Kosovo", "Montenegro",
        "North Macedonia", "Rumanía", "Serbia",
    ),
    "los nordicos": (
        "Dinamarca", "Faroe Islands", "Finlandia", "Islandia", "Noruega", "Suecia",
    ),
    "los balticos": ("Estonia", "Letonia", "Lituania"),
    "benelux": ("Bélgica", "Luxembourg", "Países Bajos"),
    "las islas britanicas": (
        "Guernsey", "Irlanda", "Isle of Man", "Jersey", "Reino Unido",
    ),
    "la peninsula iberica": ("España", "Gibraltar", "Portugal"),
    "centroeuropa": (
        "Alemania", "Austria", "Czech Republic", "Eslovaquia", "Hungría",
        "Polonia", "República Checa", "Suiza",
    ),
    "el magreb": ("Algeria", "Libya", "Marruecos", "Túnez", "Western Sahara (disputed territory)"),
    "el mediterraneo oriental": ("Chipre", "Grecia", "Israel", "Jordania", "Lebanon", "Turquía"),
    "el caucaso": ("Armenia", "Azerbaijan", "Georgia"),
    "el golfo": (
        "Bahrain", "Emiratos Árabes Unidos", "Kuwait", "Oman", "Qatar", "Saudi Arabia",
    ),
    "el sudeste asiatico": (
        "Brunei", "Cambodia", "Indonesia", "Laos", "Malaysia", "Myanmar",
        "Philippines", "Singapore", "Tailandia", "Timor-Leste", "Vietnam",
    ),
    "el caribe": (
        "Anguilla", "Antigua and Barbuda", "Aruba", "Bahamas", "Barbados",
        "Bermuda", "British Virgin Islands", "Caribbean Netherlands",
        "Cayman Islands", "Cuba", "Curaçao", "Dominica", "Grenada", "Guadeloupe",
        "Haiti", "Jamaica", "Martinique", "Montserrat", "Puerto Rico",
        "República Dominicana", "Saint Barthélemy", "Saint Kitts and Nevis",
        "Saint Lucia", "Saint Martin", "Saint Vincent and the Grenadines",
        "Sint Maarten", "Trinidad and Tobago", "Turks and Caicos Islands",
        "U.S. Virgin Islands",
    ),
    "centroamerica": (
        "Belize", "Costa Rica", "El Salvador", "Guatemala", "Honduras",
        "Nicaragua", "Panama",
    ),
    "el cono sur": ("Argentina", "Chile", "Paraguay", "Uruguay"),
}

# Como se ENSEÑA cada una. La clave va en minusculas y sin tildes porque es lo
# que se teclea; el nombre lleva sus tildes y sus mayusculas, que es lo que se
# lee. Sin esto salia "El caucaso" y "La peninsula iberica" en el desplegable.
NOMBRES: dict[str, str] = {
    "los balcanes": "Los Balcanes",
    "los nordicos": "Los nórdicos",
    "los balticos": "Los bálticos",
    "benelux": "Benelux",
    "las islas britanicas": "Las Islas Británicas",
    "la peninsula iberica": "La Península Ibérica",
    "centroeuropa": "Centroeuropa",
    "el magreb": "El Magreb",
    "el mediterraneo oriental": "El Mediterráneo oriental",
    "el caucaso": "El Cáucaso",
    "el golfo": "El Golfo",
    "el sudeste asiatico": "El Sudeste Asiático",
    "el caribe": "El Caribe",
    "centroamerica": "Centroamérica",
    "el cono sur": "El Cono Sur",
}

# Como se puede escribir cada una. Lo que la gente teclea no es la clave.
ALIAS: dict[str, str] = {
    "balcanes": "los balcanes",
    "peninsula balcanica": "los balcanes",
    "nordicos": "los nordicos",
    "escandinavia": "los nordicos",
    "paises nordicos": "los nordicos",
    "paises escandinavos": "los nordicos",
    "balticos": "los balticos",
    "paises balticos": "los balticos",
    "islas britanicas": "las islas britanicas",
    "gran bretana": "las islas britanicas",
    "peninsula iberica": "la peninsula iberica",
    "iberia": "la peninsula iberica",
    "europa central": "centroeuropa",
    "magreb": "el magreb",
    "norte de africa": "el magreb",
    "africa del norte": "el magreb",
    "mediterraneo oriental": "el mediterraneo oriental",
    "levante": "el mediterraneo oriental",
    "caucaso": "el caucaso",
    "golfo": "el golfo",
    "paises del golfo": "el golfo",
    "sudeste asiatico": "el sudeste asiatico",
    "sudeste de asia": "el sudeste asiatico",
    "caribe": "el caribe",
    "antillas": "el caribe",
    "america central": "centroamerica",
    "cono sur": "el cono sur",
}


def _norm(texto: str) -> str:
    """Sin tildes, sin mayusculas y sin articulos sueltos."""
    sin = "".join(
        c for c in unicodedata.normalize("NFD", (texto or "").strip().lower())
        if unicodedata.category(c) != "Mn"
    )
    return " ".join(sin.split())


_INDICE: dict[str, str] | None = None


def _indice() -> dict[str, str]:
    global _INDICE
    if _INDICE is None:
        _INDICE = {_norm(k): k for k in REGIONES}
        for alias, destino in ALIAS.items():
            _INDICE[_norm(alias)] = destino
    return _INDICE


def region_de(texto: str) -> str:
    """La region que nombra ese texto, o "" si no nombra ninguna."""
    return _indice().get(_norm(texto), "")


def paises_de(texto: str) -> tuple[str, ...]:
    """Los paises de esa region, vacio si el texto no es una region."""
    clave = region_de(texto)
    return REGIONES[clave] if clave else ()


def nombre_bonito(clave: str) -> str:
    """Como se enseña: «Los Balcanes», no «los balcanes»."""
    return NOMBRES.get(clave, clave)
