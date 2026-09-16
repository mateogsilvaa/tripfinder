"""Las regiones, y el nombre de cada país.

Entre el continente —Europa son 44 países— y el país suelto —nadie quiere
Albania *y sólo* Albania— faltaba el escalón que de verdad se usa al decidir un
viaje: «los Balcanes», «los nórdicos».

LO QUE ESTA PRUEBA VIGILA DE VERDAD es el nombre de los países.
`airports_world.json` mezcla idiomas sin ningún criterio —«Croacia» al lado de
«North Macedonia»— y a veces trae dos grafías del mismo país. Una región a la
que le falte una grafía se deja fuera medio país sin que nada falle: la búsqueda
sale más pobre y nadie se entera. Así que aquí se comprueba contra el listado.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from tripfinder.regiones import ALIAS, REGIONES, paises_de, region_de

RAIZ = Path(__file__).resolve().parent.parent


def _paises_del_listado() -> set[str]:
    datos = json.loads((RAIZ / "data" / "airports_world.json").read_text(encoding="utf-8"))
    return {a.get("pais", "") for a in datos if a.get("pais")}


@pytest.mark.parametrize("region", sorted(REGIONES))
def test_todos_los_paises_de_la_region_existen(region):
    reales = _paises_del_listado()
    faltan = [p for p in REGIONES[region] if p not in reales]
    assert not faltan, (
        f"«{region}» nombra países que no están en airports_world.json: {faltan}. "
        "Si ha cambiado una grafía, hay que actualizarla aquí o esa región se "
        "queda sin esos destinos y nadie se entera."
    )


@pytest.mark.parametrize("region", sorted(REGIONES))
def test_cada_region_tiene_aeropuertos_de_verdad(region):
    """Una región sin aeropuertos es una opción que no devuelve nada."""
    datos = json.loads((RAIZ / "data" / "airports_world.json").read_text(encoding="utf-8"))
    dentro = set(REGIONES[region])
    cuantos = sum(1 for a in datos if a.get("pais") in dentro)
    assert cuantos >= 3, f"«{region}» solo tiene {cuantos} aeropuertos"


def test_se_escribe_como_se_quiera():
    for texto in ["Balcanes", "los balcanes", "LOS BALCANES", "Los Balcánes".replace("á", "a")]:
        assert region_de(texto) == "los balcanes"
    assert region_de("Escandinavia") == "los nordicos"
    assert region_de("Países Bálticos") == "los balticos"


def test_lo_que_no_es_una_region_no_lo_es():
    """Que no se trague una ciudad: «Roma» es un destino, no una región."""
    for texto in ["Roma", "FCO", "Italia", "", "   "]:
        assert region_de(texto) == ""
        assert paises_de(texto) == ()


def test_los_alias_apuntan_a_regiones_que_existen():
    for alias, destino in ALIAS.items():
        assert destino in REGIONES, f"el alias «{alias}» apunta a «{destino}», que no existe"


def test_ninguna_region_se_llama_como_un_continente():
    """`resolve_many` mira primero los continentes: una región que se llamara
    igual no se alcanzaría nunca."""
    from tripfinder.search import CONTINENTES

    choques = set(REGIONES) & set(CONTINENTES)
    assert not choques, f"región y continente con el mismo nombre: {choques}"
