"""Lo que cuesta dormir en cada sitio, destilado de lo ya buscado.

Es lo que permite decir "escapada ≈ X €" en el tablón sin abrir el panel de
alojamiento, que es un workflow de varios minutos.
"""

import json

import pytest

from tripfinder.store import Store


def _fichero(carpeta, nombre, dest, pais, noches, precios):
    (carpeta / "stays").mkdir(exist_ok=True)
    (carpeta / "stays" / nombre).write_text(
        json.dumps(
            {
                "offer_id": nombre[:-5],
                "offer": {
                    "destination": dest,
                    "destination_name": dest,
                    "destination_country": pais,
                    "nights": noches,
                },
                "stays": [{"name": f"c{i}", "price_total": p, "price_per_night": p / noches}
                          for i, p in enumerate(precios)],
            }
        ),
        encoding="utf-8",
    )


def test_estima_del_extremo_barato_no_de_la_media(tmp_path):
    """Airbnb devuelve desde una habitación compartida hasta un chalet. Si la
    estimación cogiera la mediana del catálogo, estimaría un viaje que nadie
    hace —y encima el número 'real' que la sustituye, que es el más barato,
    parecería una rebaja."""
    # Por noche: 20, 30, 40, 200, 400.  Mediana del catálogo: 40. Del trío
    # barato: 30.
    _fichero(tmp_path, "a.json", "BGY", "Italia", 1, [20, 30, 40, 200, 400])
    p = Store(tmp_path).save_beds()
    assert p["destinos"]["BGY"]["noche"] == 30


def test_convierte_a_precio_por_noche(tmp_path):
    """El total de una estancia de tres noches no es lo que cuesta una."""
    _fichero(tmp_path, "a.json", "FCO", "Italia", 3, [90, 120, 150])
    p = Store(tmp_path).save_beds()
    assert p["destinos"]["FCO"]["noche"] == 40  # 120/3, el del medio del trío


def test_el_pais_sirve_de_respaldo(tmp_path):
    _fichero(tmp_path, "a.json", "BGY", "Italia", 1, [50, 60, 70])
    p = Store(tmp_path).save_beds()
    assert p["paises"]["Italia"]["noche"] == 60


def test_no_se_inventa_un_valor_para_lo_que_nadie_busco(tmp_path):
    """Un número igual para todos no informa y encima parece que sabe algo."""
    _fichero(tmp_path, "a.json", "BGY", "Italia", 1, [50, 60, 70])
    p = Store(tmp_path).save_beds()
    assert "ACE" not in p["destinos"]
    assert "España" not in p["paises"]


def test_pide_un_minimo_de_muestras(tmp_path):
    """Con un solo anuncio no se estima nada: puede ser cualquier cosa."""
    _fichero(tmp_path, "a.json", "BGY", "Italia", 1, [50])
    p = Store(tmp_path).save_beds()
    assert p["destinos"] == {}


def test_los_ficheros_viejos_sin_offer_no_rompen(tmp_path):
    """Los primeros `stays` no llevaban el bloque `offer`: sin destino no hay
    nada que atribuir, y adivinarlo del nombre del fichero es pedirlo."""
    (tmp_path / "stays").mkdir()
    (tmp_path / "stays" / "viejo.json").write_text(
        json.dumps({"stays": [{"price_total": 100, "price_per_night": 50}] * 5}), encoding="utf-8"
    )
    p = Store(tmp_path).save_beds()
    assert p["destinos"] == {}


def test_sin_carpeta_de_stays_no_peta(tmp_path):
    p = Store(tmp_path).save_beds()
    assert p["destinos"] == {} and p["paises"] == {}


@pytest.mark.parametrize("roto", ["{", "no soy json"])
def test_un_fichero_corrupto_no_tumba_el_resto(tmp_path, roto):
    _fichero(tmp_path, "bueno.json", "BGY", "Italia", 1, [50, 60, 70])
    (tmp_path / "stays" / "malo.json").write_text(roto, encoding="utf-8")
    p = Store(tmp_path).save_beds()
    assert p["destinos"]["BGY"]["noche"] == 60
