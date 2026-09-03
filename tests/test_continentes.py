"""Que el mapa de continentes publicado sea el que sale del listado mundial.

La portada ya no carga `airports_world.json` (270 KB) para saber en que
continente cae cada destino: usa `continentes.json`, que son 10 KB. El precio
de tener un fichero derivado es que puede quedarse viejo, y esto es lo que lo
evita: se vuelve a derivar y se compara con lo que hay en el repo.
"""

import json
from pathlib import Path

from tripfinder.store import Store

RAIZ = Path(__file__).resolve().parent.parent
DATA = RAIZ / "data"


def _descodificar(agrupado: dict[str, str]) -> dict[str, str]:
    """Lo mismo que hace `app.js`: los codigos IATA miden tres letras."""
    plano = {}
    for continente, codigos in agrupado.items():
        for i in range(0, len(codigos), 3):
            plano[codigos[i : i + 3]] = continente
    return plano


def test_el_mapa_publicado_esta_al_dia(tmp_path):
    publicado = json.loads((DATA / "continentes.json").read_text(encoding="utf-8"))

    # Se deriva en un directorio aparte para no tocar el del repo.
    (tmp_path / "airports_world.json").write_text(
        (DATA / "airports_world.json").read_text(encoding="utf-8"), encoding="utf-8"
    )
    Store(tmp_path).save_continents()
    recien = json.loads((tmp_path / "continentes.json").read_text(encoding="utf-8"))

    assert publicado == recien, (
        "data/continentes.json no coincide con airports_world.json. "
        "Corre `python -m tripfinder scan-flights` o regeneralo con Store().save_continents()."
    )


def test_no_se_pierde_ningun_aeropuerto():
    mundial = json.loads((DATA / "airports_world.json").read_text(encoding="utf-8"))
    esperados = {a["code"]: a["cont"] for a in mundial if a.get("code") and a.get("cont")}
    publicado = _descodificar(json.loads((DATA / "continentes.json").read_text(encoding="utf-8")))
    assert publicado == esperados


def test_pesa_mucho_menos_que_el_listado_entero():
    """El motivo de todo esto. Si alguien cambia el formato y se dispara, salta."""
    mapa = (DATA / "continentes.json").stat().st_size
    entero = (DATA / "airports_world.json").stat().st_size
    assert mapa < entero / 10, f"{mapa} bytes; se esperaba menos de {entero // 10}"


def test_la_portada_cabe_en_200_kb():
    """El criterio de la #19, medido sobre los ficheros que pide de verdad."""
    pide = ["offers.json", "continentes.json"]
    total = sum((DATA / f).stat().st_size for f in pide)
    assert total < 200 * 1024, f"{total} bytes entre {pide}"


def test_sin_listado_mundial_no_inventa_nada(tmp_path):
    """Es un fichero estatico del repo; si no esta, no hay nada que derivar."""
    assert Store(tmp_path).save_continents() is None
    assert not (tmp_path / "continentes.json").exists()
