"""Un proveedor que no hace nada se ve igual que uno que no encuentra nada.

Y por eso Amadeus llevaba meses sin poner una sola tarifa sin que nadie lo
notara. Está encendido en `config/watchlist.yml`, tiene credenciales declaradas
en los tres workflows que buscan, y se salta la ruta ENTERA en cuanto no hay
destinos explícitos:

    if not dests:
        log.info("Amadeus: ruta %s sin destinos explicitos, se omite", ...)
        return []

La ruta del barrido diario es `destinations: any`, o sea `dest_list == []`. Así
que el proveedor que trae las aerolíneas que no son low cost —Iberia, KLM,
Lufthansa— no se ejecuta nunca en el barrido que llena el tablón, y añadir las
credenciales tampoco lo arreglaría: no es un problema de acceso, es de código.
"""

from __future__ import annotations

import json
from pathlib import Path

import yaml

RAIZ = Path(__file__).resolve().parent.parent


def test_la_ruta_del_barrido_diario_no_lleva_destinos():
    """El hecho del que cuelga todo lo demás."""
    cfg = yaml.safe_load((RAIZ / "config" / "watchlist.yml").read_text(encoding="utf-8"))
    primera = cfg["routes"][0]
    assert primera["destinations"] == "any"


def test_amadeus_se_rinde_sin_destinos_explicitos():
    fuente = (RAIZ / "src" / "tripfinder" / "providers" / "amadeus.py").read_text(encoding="utf-8")
    assert "if not dests:" in fuente
    assert "return []" in fuente.split("if not dests:")[1][:200]


def test_el_parte_delata_al_que_no_pone_nada():
    """La red de seguridad: que la próxima vez se vea desde fuera."""
    cli = (RAIZ / "src" / "tripfinder" / "cli.py").read_text(encoding="utf-8")
    assert "sin_tarifas" in cli
    assert "mudos" in cli


def test_amadeus_daria_el_codigo_iata_como_ciudad():
    """Y cuando llegue a ejecutarse, que diga «Roma» y no «FCO».

    El resto de proveedores sacan el nombre de su propia respuesta; Amadeus no
    lo trae, así que se resuelve contra `airports_world.json` como hace el
    resto de la web."""
    fuente = (RAIZ / "src" / "tripfinder" / "providers" / "amadeus.py").read_text(encoding="utf-8")
    assert "destination_name=_mundial(dest)[0] or dest" in fuente
    assert "destination_country=_mundial(dest)[1]" in fuente


def test_el_nombre_de_ciudad_se_resuelve_de_verdad():
    """Que el fichero contra el que se resuelve tiene lo que hace falta."""
    import sys

    sys.path.insert(0, str(RAIZ / "src"))
    from tripfinder.routes import _mundial

    ciudad, pais = _mundial("FCO")
    assert ciudad and ciudad != "FCO", "FCO debería resolverse a una ciudad"
    assert pais


def test_el_tablon_publicado_dice_de_donde_sale_cada_tarifa():
    """Lo que ya había, y sobre lo que se apoya lo nuevo."""
    d = json.loads((RAIZ / "data" / "offers.json").read_text(encoding="utf-8"))
    assert "fuentes" in d
    assert "tarifas" in d["fuentes"]
