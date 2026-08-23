"""Cuentas: que separan de verdad lo de cada uno y que el navegador y Python
hablan el mismo idioma al comprobar una contrasena."""

import json

import pytest

from tripfinder import users as U
from tripfinder import watch as W
from tripfinder.search import SearchRequest
from tripfinder.store import Store


@pytest.fixture(autouse=True)
def fichero_temporal(tmp_path, monkeypatch):
    """Cada test con su data/users.json, para no tocar el del repo."""
    monkeypatch.setattr(U, "FICHERO", tmp_path / "users.json")
    return tmp_path


# --------------------------------------------------------------- contrasenas
def test_el_hash_va_y_vuelve():
    guardado = U.hashear("una contrasena larga")
    assert U.comprobar("una contrasena larga", guardado)
    assert not U.comprobar("otra cosa", guardado)


def test_dos_cuentas_con_la_misma_clave_no_dan_el_mismo_hash():
    # Sal distinta por cuenta: si no, ver dos hashes iguales delata que dos
    # personas usan la misma contrasena, y una tabla vale para las dos.
    assert U.hashear("repetida")["hash"] != U.hashear("repetida")["hash"]


def test_el_hash_es_el_mismo_que_calcula_el_navegador():
    """Vector fijo contra WebCrypto (web/auth.js): PBKDF2-SHA256, 210k, 32 bytes.

    Si alguien cambia las vueltas o el algoritmo en un lado y no en el otro,
    las cuentas creadas desde el panel dejan de poder entrar. Esto lo caza.
    """
    calculado = U.hashear("hola1234", "ihn3Y7pcbQP8h4pexCHy2A==")
    assert calculado["hash"] == "OEbRvgPWgDGNo5oHB9lFDTR/lcTpgb4QfCoYDa3oJXw="
    assert calculado["iterations"] == 210_000


def test_un_hash_corrupto_no_revienta():
    assert not U.comprobar("lo que sea", {"salt": "no-es-base64!!", "hash": "tampoco"})
    assert not U.comprobar("lo que sea", None)


# -------------------------------------------------------------------- altas
def test_alta_y_autenticacion():
    u = U.anadir("ana", name="Ana", password="ana12345", email="ana@example.com")
    assert u.id.startswith("u-")
    assert U.autenticar("ana", "ana12345").id == u.id
    assert U.autenticar("Ana", "ana12345") is not None  # da igual como lo escribas
    assert U.autenticar("ana", "mal") is None
    assert U.autenticar("nadie", "ana12345") is None


def test_no_se_guarda_la_contrasena_en_claro(fichero_temporal):
    U.anadir("ana", password="secreto-de-ana")
    assert "secreto-de-ana" not in (fichero_temporal / "users.json").read_text(encoding="utf-8")


def test_el_panel_manda_el_hash_ya_hecho():
    # Lo que hace admin.html: el PBKDF2 lo calcula el navegador y aqui solo
    # llega la sal y el hash, asi que la clave no acaba en el log del workflow.
    cred = U.hashear("desde-el-navegador")
    U.anadir("ana", credencial=cred)
    assert U.autenticar("ana", "desde-el-navegador") is not None


def test_no_se_repiten_los_usuarios():
    U.anadir("ana", password="ana12345")
    with pytest.raises(ValueError):
        U.anadir("ANA", password="otra12345")


@pytest.mark.parametrize("malo", ["ab", "con espacio", "año", "a" * 25, ""])
def test_usuarios_invalidos(malo):
    with pytest.raises(ValueError):
        U.anadir(malo, password="12345678")


def test_alta_sin_contrasena_no_cuela():
    with pytest.raises(ValueError):
        U.anadir("ana")


# --------------------------------------------------------------- bajas y mas
def test_desactivar_no_borra_pero_no_deja_entrar():
    U.anadir("ana", password="ana12345")
    assert U.activar("ana", False)
    assert U.autenticar("ana", "ana12345") is None
    assert len(U.listar()) == 1
    U.activar("ana", True)
    assert U.autenticar("ana", "ana12345") is not None


def test_cambiar_contrasena():
    U.anadir("ana", password="ana12345")
    assert U.cambiar_password("ana", "nueva12345")
    assert U.autenticar("ana", "ana12345") is None
    assert U.autenticar("ana", "nueva12345") is not None


def test_borrar():
    U.anadir("ana", password="ana12345")
    assert U.borrar("ana")
    assert not U.borrar("ana")
    assert U.listar() == []


def test_fichero_ilegible_no_tumba_la_web(fichero_temporal):
    (fichero_temporal / "users.json").write_text("{roto", encoding="utf-8")
    assert U.listar() == []
    assert not U.hay_admin()


# -------------------------------------------------------------------- panel
def test_contrasena_del_panel():
    assert not U.hay_admin()
    U.set_admin("panel-secreto")
    assert U.hay_admin()
    assert U.comprobar_admin("panel-secreto")
    assert not U.comprobar_admin("panel-secretoo")


def test_el_panel_no_es_una_cuenta_mas():
    # Poner la clave del panel no crea una cuenta con la que entrar en la web.
    U.set_admin("panel-secreto")
    assert U.listar() == []


# ------------------------------------------------------- de quien es cada cosa
def test_un_seguimiento_ajeno_no_se_borra(tmp_path, monkeypatch):
    monkeypatch.setattr(W, "FICHERO", tmp_path / "watch.json")
    W.anadir(W.Watch(id="roma-6", label="Roma", owner="u-ana"))
    assert not W.borrar("roma-6", owner="u-mateo")
    assert len(W.listar()) == 1
    assert W.borrar("roma-6", owner="u-ana")


def test_un_seguimiento_sin_dueno_lo_borra_cualquiera(tmp_path, monkeypatch):
    # Los de antes de que hubiera cuentas no son de nadie: se comportan como
    # siempre, que es lo que espera quien ya los tenia apuntados.
    monkeypatch.setattr(W, "FICHERO", tmp_path / "watch.json")
    W.anadir(W.Watch(id="roma-6", label="Roma"))
    assert W.borrar("roma-6", owner="u-mateo")


def test_la_misma_busqueda_de_dos_personas_son_dos_ficheros():
    base = {"destination": "FCO", "max_price": 120, "months": 6}
    de_ana = SearchRequest(**base, owner="u-ana")
    de_mateo = SearchRequest(**base, owner="u-mateo")
    assert de_ana.slug != de_mateo.slug
    # Y una sin dueño sigue teniendo el nombre de siempre.
    assert SearchRequest(**base).slug == "mad-fco-23-120-6m-finde-2p"


def test_el_indice_de_busquedas_dice_de_quien_es_cada_una(tmp_path):
    store = Store(tmp_path)
    req = SearchRequest(destination="FCO", owner="u-ana", owner_name="Ana")
    store.save_search(
        {"slug": req.slug, "label": "Roma", "count": 0, "owner": "u-ana",
         "owner_name": "Ana", "request": req.to_dict(), "offers": []}
    )
    indice = json.loads((tmp_path / "searches" / "index.json").read_text(encoding="utf-8"))
    assert indice["searches"][0]["owner"] == "u-ana"


def test_una_busqueda_ajena_no_se_borra(tmp_path):
    store = Store(tmp_path)
    store.save_search({"slug": "roma-ana", "label": "Roma", "owner": "u-ana", "offers": []})
    assert not store.delete_search("roma-ana", owner="u-mateo")
    assert (tmp_path / "searches" / "roma-ana.json").exists()
    assert store.delete_search("roma-ana", owner="u-ana")


def test_el_parte_diario_va_a_cada_uno_al_suyo(monkeypatch):
    """Ana no tiene por que enterarse de lo que sigues tu."""
    from tripfinder.cli import _partes_por_dueno
    from tripfinder.config import Config

    ana = U.anadir("ana", password="ana12345", email="ana@example.com")
    mateo = U.anadir("mateo", password="mateo12345")  # sin email: al buzon de siempre

    cfg = Config(raw={"notify": {"to": "el-de-siempre@example.com"}})
    estado = [
        (W.Watch(id="a", owner=ana.id), []),
        (W.Watch(id="b", owner=mateo.id), []),
        (W.Watch(id="c"), []),  # sin dueño: de la epoca sin cuentas
    ]
    partes = _partes_por_dueno(estado, cfg)
    assert set(partes) == {"ana@example.com", "el-de-siempre@example.com"}
    assert [w.id for w, _ in partes["ana@example.com"]] == ["a"]
    assert [w.id for w, _ in partes["el-de-siempre@example.com"]] == ["b", "c"]


# ------------------------------------------------ ponerle dueño a lo de antes
def test_reclamar_solo_toca_lo_que_no_es_de_nadie(tmp_path, monkeypatch):
    monkeypatch.setattr(W, "FICHERO", tmp_path / "watch.json")
    W.anadir(W.Watch(id="viejo", label="De antes de las cuentas"))
    W.anadir(W.Watch(id="de-ana", label="Roma", owner="u-ana", owner_name="Ana"))

    assert W.reclamar("u-mateo", "Mateo") == 1
    por_id = {w.id: w for w in W.listar()}
    assert por_id["viejo"].owner == "u-mateo"
    assert por_id["viejo"].owner_name == "Mateo"
    assert por_id["de-ana"].owner == "u-ana"  # lo de Ana sigue siendo de Ana
    assert W.reclamar("u-mateo", "Mateo") == 0  # y ya no queda nada que asignar


def test_reclamar_busquedas_y_rehacer_el_indice(tmp_path):
    store = Store(tmp_path)
    store.save_search({"slug": "vieja", "label": "De antes", "offers": []})
    store.save_search({"slug": "de-ana", "label": "Roma", "owner": "u-ana", "offers": []})

    assert store.claim_searches("u-mateo", "Mateo") == 1
    indice = json.loads((tmp_path / "searches" / "index.json").read_text(encoding="utf-8"))
    dueños = {s["slug"]: s["owner"] for s in indice["searches"]}
    assert dueños == {"vieja": "u-mateo", "de-ana": "u-ana"}


def test_una_busqueda_reclamada_lleva_el_dueño_tambien_dentro(tmp_path):
    # La web lee el indice, pero el fichero es el que manda al reindexar: si el
    # dueño solo estuviera en el indice, el primer reindex lo borraria.
    store = Store(tmp_path)
    store.save_search({"slug": "vieja", "label": "De antes", "request": {}, "offers": []})
    store.claim_searches("u-mateo", "Mateo")
    datos = json.loads((tmp_path / "searches" / "vieja.json").read_text(encoding="utf-8"))
    assert datos["owner"] == "u-mateo"
    assert datos["request"]["owner"] == "u-mateo"
