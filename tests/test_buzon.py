"""El buzón por el que llegan las peticiones de cuenta con su contraseña dentro.

EL PROBLEMA QUE RESUELVE. Para que una cuenta nazca ACTIVA hacen falta dos cosas
que nunca están en el mismo sitio: la contraseña, que solo sabe quien la pide, y
la clave maestra, que solo tiene quien aprueba. Sin las dos no hay sobre, y sin
sobre la cuenta entra en la web pero no puede lanzar ni una búsqueda. Aprobar
era, por eso, inventar una contraseña, escribirla y salir a decírsela por otro
lado.

El buzón junta las dos mitades sin que ninguna viaje en claro: quien pide la
cuenta cierra su correo y su contraseña con la clave pública, y el panel los
abre con la privada.

Aquí se prueba la parte de Python, que es la que guarda y publica. Abrir y
cerrar sobres es del navegador (`web/auth.js`), y eso se prueba en Playwright:
este módulo NO puede abrir nada, y eso es justo lo que se comprueba abajo.
"""

from __future__ import annotations

import json

import pytest

from tripfinder import users as U

BUZON = {
    "pub": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAfalso",
    "priv": {"iv": "aXZmYWxzbw==", "data": "ZGF0b3NmYWxzb3M="},
}


@pytest.fixture(autouse=True)
def fichero_de_prueba(tmp_path, monkeypatch):
    monkeypatch.setattr(U, "FICHERO", tmp_path / "users.json")
    return tmp_path


def test_se_guarda_la_publica_en_claro_y_la_privada_cerrada():
    U.set_buzon(BUZON)
    admin = json.loads((U.FICHERO).read_text(encoding="utf-8"))["admin"]
    assert admin["buzon"]["pub"] == BUZON["pub"]
    assert admin["buzon"]["priv"]["data"] == BUZON["priv"]["data"]
    assert admin["buzon"]["priv"]["iv"] == BUZON["priv"]["iv"]


def test_queda_apuntado_cuando_se_puso():
    U.set_buzon(BUZON)
    assert json.loads(U.FICHERO.read_text(encoding="utf-8"))["admin"]["buzon"]["updated"]


def test_un_buzon_a_medias_no_se_guarda():
    """Medio buzón es peor que ninguno: el formulario ofrecería poner contraseña
    y luego no habría con qué cerrarla."""
    with pytest.raises(ValueError):
        U.set_buzon({"pub": "algo"})
    with pytest.raises(ValueError):
        U.set_buzon({"priv": BUZON["priv"]})
    with pytest.raises(ValueError):
        U.set_buzon({"pub": "algo", "priv": {"iv": "x"}})


def test_el_buzon_no_se_lleva_por_delante_la_contrasena_del_panel():
    U.set_admin(password="contradelpanel")
    U.set_buzon(BUZON)
    admin = json.loads(U.FICHERO.read_text(encoding="utf-8"))["admin"]
    assert admin["hash"]
    assert admin["buzon"]["pub"]
    assert U.comprobar_admin("contradelpanel")


def test_cambiar_la_contrasena_del_panel_no_tira_el_buzon():
    """Son cosas distintas: la contraseña del panel es la puerta y el buzón es
    una cerradura que no depende de ella. Si se perdiera al cambiarla, las
    peticiones ya cerradas quedarían sin poder abrirse."""
    U.set_buzon(BUZON)
    U.set_admin(password="otracontradelpanel")
    admin = json.loads(U.FICHERO.read_text(encoding="utf-8"))["admin"]
    assert admin.get("buzon", {}).get("pub") == BUZON["pub"]


def test_poner_otro_buzon_sustituye_al_anterior():
    U.set_buzon(BUZON)
    U.set_buzon({"pub": "otrapublica", "priv": {"iv": "aXY=", "data": "b3Ryb3M="}})
    admin = json.loads(U.FICHERO.read_text(encoding="utf-8"))["admin"]
    assert admin["buzon"]["pub"] == "otrapublica"


# ------------------------------------------------------------ lo que se publica
def test_la_publica_SE_publica():
    """Es su trabajo: sin ella, el formulario de pedir cuenta no tiene con qué
    cerrar la contraseña y vuelve a pedirla por otro lado."""
    U.set_buzon(BUZON)
    assert U.para_publicar()["admin"]["buzon"]["pub"] == BUZON["pub"]


def test_la_privada_publicada_sigue_cerrada():
    """Se publica cifrada con la clave maestra, que es la misma protección que
    ya tiene el token del sitio. Lo que no puede pasar es que salga en claro."""
    U.set_buzon(BUZON)
    publicado = U.para_publicar()["admin"]["buzon"]["priv"]
    assert set(publicado) == {"iv", "data"}


def test_publicar_con_buzon_sigue_sin_llevar_correos():
    """La regla de siempre: `pages.yml` falla si se cuela una arroba."""
    U.set_buzon(BUZON)
    U.anadir(user="ana", name="Ana", email="ana@example.com", password="x" * 12)
    assert "@" not in json.dumps(U.para_publicar(), ensure_ascii=False)


def test_python_no_puede_abrir_el_buzon():
    """Ni tiene por qué. Si algún día este módulo aprendiera a abrirlo, la
    contraseña de las peticiones pasaría por el runner de Actions y por su log,
    que es exactamente lo que este diseño evita."""
    assert not hasattr(U, "abrir_buzon")
    assert not any("decrypt" in n.lower() or "descifrar" in n.lower() for n in dir(U))
