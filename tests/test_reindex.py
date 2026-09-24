"""`reindex` rehace TODOS los derivados, no solo el índice de búsquedas.

POR QUÉ IMPORTA. El workflow que publica una búsqueda hace `git reset --hard`
contra `main` antes de escribir —para que dos runs a la vez no se pisen—, así
que guarda a un lado los ficheros nuevos y los vuelve a copiar encima. Lo que
NO puede copiar son los derivados, porque se calculan recorriendo la carpeta:
`data/searches/index.json`, `data/stays/index.json` y `data/camas.json`.

Al encadenar el alojamiento a la búsqueda —«organizar finde»— esos dos últimos
empezaron a cambiar en el mismo run, y sin rehacerlos el viaje se publicaba con
la cama buscada pero sin que el tablón supiera que la tiene.
"""

from __future__ import annotations

import json

import pytest

from tripfinder.store import Store


@pytest.fixture
def store(tmp_path) -> Store:
    return Store(tmp_path)


def viaje(oferta_id: str = "ryanair-MAD-FCO-20270115") -> dict:
    return {
        "offer_id": oferta_id,
        "offer": {
            "destination": "FCO",
            "destination_name": "Roma",
            "destination_country": "Italia",
            "depart_date": "2027-01-15",
            "nights": 2,
        },
        "checkin": "2027-01-15",
        "checkout": "2027-01-17",
        "summary": {"total": 201.92},
        "stays": [{"price_total": 120.0}, {"price_total": 90.0}, {"price_total": 150.0}],
    }


def test_rehace_el_indice_de_alojamiento(store, tmp_path):
    """Es lo que hace que el tablón marque el vuelo con la cama ya buscada."""
    (tmp_path / "stays").mkdir(parents=True, exist_ok=True)
    (tmp_path / "stays" / "ryanair-MAD-FCO-20270115.json").write_text(
        json.dumps(viaje()), encoding="utf-8"
    )
    store.save_beds()
    indice = json.loads((tmp_path / "stays" / "index.json").read_text(encoding="utf-8"))
    assert "ryanair-MAD-FCO-20270115" in indice["viajes"]


def test_rehace_lo_que_cuesta_dormir(store, tmp_path):
    """`camas.json` es lo que deja estimar la escapada completa en el tablón."""
    (tmp_path / "stays").mkdir(parents=True, exist_ok=True)
    (tmp_path / "stays" / "x.json").write_text(json.dumps(viaje("x")), encoding="utf-8")
    camas = store.save_beds()
    assert camas["destinos"]["FCO"]["noche"] > 0
    assert json.loads((tmp_path / "camas.json").read_text(encoding="utf-8"))["destinos"]


def test_sin_alojamiento_los_derivados_quedan_vacios_pero_existen(store, tmp_path):
    """Vacío y no ausente: la web distingue «nadie ha buscado nada» de «no se
    ha podido leer»."""
    camas = store.save_beds()
    assert camas["destinos"] == {}
    indice = json.loads((tmp_path / "stays" / "index.json").read_text(encoding="utf-8"))
    assert indice["viajes"] == {}


def test_rehacerlo_dos_veces_da_lo_mismo(store, tmp_path):
    """Es lo que permite llamarlo en cada reintento del push sin pensarlo."""
    (tmp_path / "stays").mkdir(parents=True, exist_ok=True)
    (tmp_path / "stays" / "x.json").write_text(json.dumps(viaje("x")), encoding="utf-8")
    store.save_beds()
    primera = (tmp_path / "stays" / "index.json").read_text(encoding="utf-8")
    store.save_beds()
    assert (tmp_path / "stays" / "index.json").read_text(encoding="utf-8") == primera
