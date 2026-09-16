"""El índice de lo que ya tiene cama buscada.

Buscar alojamiento son tres minutos de workflow, y lo buscado queda publicado
para siempre en `data/stays/<id>.json`. Lo que faltaba era una forma de SABERLO
sin pedir un fichero por vuelo: el tablón tiene ciento veinte filas y no puede
hacer ciento veinte peticiones para averiguar cuáles ya están hechas.

El índice sale de la misma pasada que destila `camas.json`, así que recorrer la
carpeta no se paga dos veces.
"""

from __future__ import annotations

import json

from tripfinder.store import Store


def guardar(carpeta, nombre: str, datos: dict) -> None:
    (carpeta / "stays").mkdir(parents=True, exist_ok=True)
    (carpeta / "stays" / f"{nombre}.json").write_text(json.dumps(datos), encoding="utf-8")


def viaje(**extra) -> dict:
    base = {
        "offer_id": "ryanair-MAD-ACE-20270115",
        "offer": {
            "destination": "ACE",
            "destination_name": "Lanzarote",
            "destination_country": "España",
            "depart_date": "2027-01-15",
            "nights": 2,
        },
        "checkin": "2027-01-15",
        "checkout": "2027-01-17",
        "summary": {"total": 201.92},
        "stays": [{"price_total": 120.0}, {"price_total": 90.0}, {"price_total": 300.0}],
    }
    base.update(extra)
    return base


def indice(tmp_path) -> dict:
    Store(tmp_path).save_beds()
    return json.loads((tmp_path / "stays" / "index.json").read_text(encoding="utf-8"))["viajes"]


def test_apunta_el_viaje_que_ya_tiene_cama(tmp_path):
    guardar(tmp_path, "ryanair-MAD-ACE-20270115", viaje())
    hechos = indice(tmp_path)
    assert "ryanair-MAD-ACE-20270115" in hechos
    assert hechos["ryanair-MAD-ACE-20270115"]["n"] == "Lanzarote"
    assert hechos["ryanair-MAD-ACE-20270115"]["c"] == 3


def test_lleva_el_precio_de_la_escapada_entera(tmp_path):
    """Con esto la fila dice el número REAL sin abrir el panel. Hasta ahora solo
    lo sabía quien lo hubiera abierto en esa misma sesión."""
    guardar(tmp_path, "ryanair-MAD-ACE-20270115", viaje())
    assert indice(tmp_path)["ryanair-MAD-ACE-20270115"]["t"] == 201.92


def test_sin_resumen_el_precio_va_a_cero_y_no_se_inventa(tmp_path):
    guardar(tmp_path, "ryanair-MAD-ACE-20270115", viaje(summary={}))
    assert indice(tmp_path)["ryanair-MAD-ACE-20270115"]["t"] == 0


def test_el_indice_no_se_cuenta_a_si_mismo(tmp_path):
    """Vive en la misma carpeta: sin cuidado aparecía un viaje llamado «index»
    y, a la siguiente pasada, otro que lo contenía."""
    guardar(tmp_path, "ryanair-MAD-ACE-20270115", viaje())
    Store(tmp_path).save_beds()
    hechos = indice(tmp_path)  # segunda pasada, con el índice ya escrito
    assert list(hechos) == ["ryanair-MAD-ACE-20270115"]


def test_un_fichero_roto_no_tumba_el_indice(tmp_path):
    guardar(tmp_path, "ryanair-MAD-ACE-20270115", viaje())
    (tmp_path / "stays" / "roto.json").write_text("{esto no es json", encoding="utf-8")
    assert list(indice(tmp_path)) == ["ryanair-MAD-ACE-20270115"]


def test_un_viaje_sin_destino_sigue_estando(tmp_path):
    """No sirve para estimar camas —no se sabe dónde— pero sí para decir que
    eso ya se buscó, que es para lo que lo lee el tablón."""
    guardar(tmp_path, "google-MAD-GDN-20261106", viaje(offer=None, offer_id="google-MAD-GDN-20261106"))
    assert "google-MAD-GDN-20261106" in indice(tmp_path)


def test_sin_ninguna_busqueda_el_indice_esta_pero_vacio(tmp_path):
    """Vacío y no ausente: la web distingue «nadie ha buscado nada» de «no hay
    índice», y con lo segundo no marca nada."""
    assert indice(tmp_path) == {}


def test_lo_caducado_deja_de_estar(tmp_path):
    """El viaje ya pasó: su fichero se borra y el índice tiene que enterarse a
    la siguiente pasada, o el tablón marcaría filas que no se pueden abrir."""
    guardar(tmp_path, "viejo", viaje(offer_id="viejo", checkout="2020-01-02"))
    guardar(tmp_path, "ryanair-MAD-ACE-20270115", viaje())
    store = Store(tmp_path)
    assert store.purge_expired_stays() == 1
    store.save_beds()
    hechos = json.loads((tmp_path / "stays" / "index.json").read_text(encoding="utf-8"))["viajes"]
    assert list(hechos) == ["ryanair-MAD-ACE-20270115"]
