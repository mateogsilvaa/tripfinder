"""Que no se publiquen las direcciones de correo de las cuentas.

`pages.yml` copia `data/*` entero al sitio, y `data/users.json` lleva el email
en claro. La web no lo necesita; el cron sí, y lo saca del repo.
"""

import json

import pytest

from tripfinder import users as U


@pytest.fixture(autouse=True)
def fichero_de_prueba(tmp_path, monkeypatch):
    monkeypatch.setattr(U, "FICHERO", tmp_path / "users.json")
    U.anadir(user="ana", name="Ana", email="ana@example.com", password="x" * 12)
    U.anadir(user="luis", name="Luis", email="", password="y" * 12)
    return tmp_path


def test_no_sale_ninguna_direccion():
    publicado = json.dumps(U.para_publicar(), ensure_ascii=False)
    assert "@" not in publicado, publicado
    assert "ana@example.com" not in publicado


def test_se_dice_quien_tiene_email_y_quien_no():
    """No es lo mismo que el email, y hace falta: sin esto el modal le diría
    "no recibes nada" a quien sí recibe, y escribiría otro creyendo que no
    tenía ninguno."""
    por_user = {u["user"]: u for u in U.para_publicar()["users"]}
    assert por_user["ana"]["tiene_email"] is True
    assert por_user["luis"]["tiene_email"] is False


def test_lo_que_el_login_necesita_sigue_estando():
    """Entrar, los sobres y la apertura del token salen de estos campos."""
    u = U.para_publicar()["users"][0]
    for campo in ("id", "user", "name", "salt", "hash", "iterations", "active", "sobre", "prefs"):
        assert campo in u, f"falta {campo}: se rompe el login o el sobre"
    assert "email" not in u


def test_lo_de_la_raiz_se_mantiene():
    """El sobre del administrador y el token del sitio viven en la raíz."""
    pub = U.para_publicar()
    completo = json.loads(U.FICHERO.read_text(encoding="utf-8"))
    for k in completo:
        if k != "users":
            assert pub[k] == completo[k], f"{k} cambió al publicar"


def test_el_fichero_del_repo_conserva_los_emails():
    """El cron manda el parte a cada uno desde aquí."""
    U.para_publicar()
    guardado = json.loads(U.FICHERO.read_text(encoding="utf-8"))
    assert any(u.get("email") == "ana@example.com" for u in guardado["users"])


def test_guardar_prefs_en_blanco_no_borra_el_correo():
    """Lo que hace seguro publicar sin emails: el modal manda el campo vacío
    cuando no lo tocas, y eso tiene que significar "déjalo como está"."""
    U.cambiar_prefs("ana", {"chollos": "semanal"}, None)
    assert U.buscar("ana").email == "ana@example.com"
    U.cambiar_prefs("ana", {"chollos": "semanal"}, "")
    assert U.buscar("ana").email == "ana@example.com"
    # Y si escribes uno nuevo, ese sí manda.
    U.cambiar_prefs("ana", {"chollos": "semanal"}, "otra@example.com")
    assert U.buscar("ana").email == "otra@example.com"
