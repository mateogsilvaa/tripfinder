"""Las ilustraciones de cada ciudad: que se conviertan, que cada una vaya con
sus aeropuertos, y que lo subido desde el panel acabe en su carpeta."""

import base64
import io
import json

import pytest
from PIL import Image

from tripfinder import ilustraciones as I


def png(color=(200, 80, 40), tam=(320, 200)) -> bytes:
    b = io.BytesIO()
    Image.new("RGB", tam, color).save(b, "PNG")
    return b.getvalue()


def webp() -> bytes:
    b = io.BytesIO()
    Image.new("RGB", (160, 100), (10, 20, 30)).save(b, "WEBP")
    return b.getvalue()


@pytest.fixture
def dirs(tmp_path, monkeypatch):
    origen, destino = tmp_path / "ilustraciones", tmp_path / "web"
    aeropuertos = tmp_path / "airports.json"
    aeropuertos.write_text(json.dumps([
        {"code": "STN", "name": "Londres Stansted", "city": {"name": "Londres"}, "country": {"code": "gb"}},
        {"code": "LTN", "name": "Londres Luton", "city": {"name": "Londres"}, "country": {"code": "gb"}},
    ]), encoding="utf-8")
    monkeypatch.setattr(I, "AEROPUERTOS", aeropuertos)
    return origen, destino


def poner(origen, ruta, **ficheros):
    d = origen / ruta
    d.mkdir(parents=True, exist_ok=True)
    for nombre, datos in ficheros.items():
        (d / nombre.replace("_", ".")).write_bytes(datos) if isinstance(datos, bytes) else (
            d / nombre.replace("_", ".")).write_text(datos, encoding="utf-8")
    return d


def test_carpeta():
    assert I.carpeta("Cluj-Napoca") == "cluj_napoca"
    assert I.carpeta("Iași") == "iasi"
    assert I.carpeta("Luxemburgo (ciudad)") == "luxemburgo"


def test_cada_ciudad_con_sus_aeropuertos(dirs):
    origen, destino = dirs
    poner(origen, "uk/londres", dia_png=png(), noche_png=png((5, 5, 40)))
    # Skopie no está en airports.json: sale de la tabla de a qué ciudad sirve cada aeropuerto.
    poner(origen, "macedonia/skopie", noche_png=png())
    ind = I.construir(origen, destino)
    assert ind["por_iata"]["STN"] == ind["por_iata"]["LTN"] == ind["por_iata"]["LGW"] == "uk/londres"
    assert ind["por_iata"]["SKP"] == "macedonia/skopie"
    skopie = next(c for c in ind["ciudades"] if c["ruta"] == "macedonia/skopie")
    assert (skopie["dia"], skopie["noche"]) == (False, True)
    salida = Image.open(destino / "uk" / "londres" / "dia.webp")
    assert (salida.format, salida.size) == ("WEBP", (I.ANCHO, I.ALTO))
    assert json.loads((destino / "indice.json").read_text()) == ind


def test_aeropuertos_txt_y_encuadre_mandan(dirs):
    origen, destino = dirs
    poner(origen, "rumania/arad_centro", dia_png=png(), aeropuertos_txt="arw\n", encuadre_txt="80")
    c = I.construir(origen, destino)["ciudades"][0]
    assert c["aeropuertos"] == ["ARW"]
    assert c["y"] == 80


def test_solo_se_reconvierte_lo_que_cambia(dirs):
    origen, destino = dirs
    d = poner(origen, "uk/londres", dia_png=png())
    I.construir(origen, destino)
    sale = destino / "uk" / "londres" / "dia.webp"
    antes = sale.read_bytes()
    sale.write_bytes(b"tocado")  # si se reconvirtiera, volvería a ser un WebP
    I.construir(origen, destino)
    assert sale.read_bytes() == b"tocado"
    (d / "dia.png").write_bytes(png((0, 255, 0)))
    I.construir(origen, destino)
    assert sale.read_bytes() not in (b"tocado", antes)


def test_lo_que_se_borra_del_repo_sale_de_la_web(dirs):
    origen, destino = dirs
    d = poner(origen, "uk/londres", dia_png=png(), noche_png=png())
    I.construir(origen, destino)
    (d / "noche.png").unlink()
    I.construir(origen, destino)
    assert not (destino / "uk" / "londres" / "noche.webp").exists()


class Doc:
    def __init__(self, id_, datos):
        self.id, self._d = id_, datos

    def to_dict(self):
        return self._d


class Db:
    def __init__(self, docs):
        self.docs, self.borrados = docs, []

    def collection(self, nombre):
        assert nombre == I.COLECCION
        return self

    def stream(self):
        return iter(self.docs)

    def document(self, id_):
        db = self

        class Ref:
            def delete(self):
                db.borrados.append(id_)

        return Ref()


def test_lo_subido_desde_el_panel_va_a_su_carpeta(dirs):
    origen, destino = dirs
    poner(origen, "uk/londres", dia_png=png())
    b64 = base64.b64encode(webp()).decode()
    db = Db([
        Doc("a", {"pais": "uk", "ciudad": "londres", "dia": b64, "encuadre": 40, "aeropuertos": ["STN", "LTN"]}),
        Doc("b", {"pais": "georgia", "ciudad": "kutaisi", "noche": b64, "aeropuertos": ["KUT"]}),
        Doc("c", {"pais": "x", "ciudad": "y", "dia": base64.b64encode(b"<script>").decode()}),
    ])
    assert I.recoger(db, origen) == ["a", "b", "c"]
    # La nueva sustituye a la de antes, aunque fuera de otro formato.
    assert not (origen / "uk/londres/dia.png").exists()
    assert (origen / "uk/londres/dia.webp").read_bytes()[:4] == b"RIFF"
    assert (origen / "uk/londres/encuadre.txt").read_text().strip() == "40"
    # Los aeropuertos que ya salen solos no hacen falta apuntarlos.
    assert not (origen / "uk/londres/aeropuertos.txt").exists()
    # Lo que no es un WebP no se escribe.
    assert not (origen / "x").exists()
    ind = I.construir(origen, destino)
    assert ind["por_iata"]["KUT"] == "georgia/kutaisi"
    I.borrar(db, ["a", "b"])
    assert db.borrados == ["a", "b"]


def test_solo_el_encuadre(dirs):
    origen, _ = dirs
    poner(origen, "uk/londres", dia_png=png())
    I.recoger(Db([Doc("a", {"pais": "uk", "ciudad": "londres", "encuadre": 90})]), origen)
    assert (origen / "uk/londres/encuadre.txt").read_text().strip() == "90"
    assert (origen / "uk/londres/dia.png").exists()


def test_el_repo_trae_las_suyas_publicadas():
    """Lo de `ilustraciones/` y `web/ilustraciones/` va a la par: si alguien sube
    dibujos y no se convierten, la web no los ve."""
    ind = json.loads((I.DESTINO / "indice.json").read_text(encoding="utf-8"))
    rutas = {c["ruta"] for c in ind["ciudades"]}
    en_repo = {f"{d.parent.name}/{d.name}" for d in I.ORIGEN.glob("*/*") if d.is_dir()}
    assert rutas == en_repo
    for c in ind["ciudades"]:
        assert c["aeropuertos"], c["ruta"]
        for m in I.MOMENTOS:
            assert (I.DESTINO / c["ruta"] / f"{m}.webp").exists() == c[m]
