"""Que a cada uno le llegue lo que pidió, y solo cuando lo pidió."""

import pytest

from tripfinder import users as U
from tripfinder import watch as W
from tripfinder.cli import _cada_cuanto, _partes_por_dueno, _reparto_de_chollos
from tripfinder.config import Config
from tripfinder.models import FlightOffer


@pytest.fixture(autouse=True)
def fichero_temporal(tmp_path, monkeypatch):
    monkeypatch.setattr(U, "FICHERO", tmp_path / "users.json")
    return tmp_path


CFG = Config(raw={"notify": {"to": "el-de-siempre@example.com"}})


def oferta(precio: float, dest: str = "FCO") -> FlightOffer:
    return FlightOffer(
        provider="ryanair", origin="MAD", destination=dest,
        depart_date="2026-11-13", return_date="2026-11-16", price=precio,
    )


# ------------------------------------------------------------- frecuencias
@pytest.mark.parametrize(
    "frecuencia,ultimo,toca",
    [
        ("nunca", "", False),
        ("nunca", "2020-01-01", False),
        ("cada_vez", "2026-08-23", True),   # da igual cuando fue el ultimo
        ("diario", "", True),               # nunca se le ha escrito
        ("diario", "2026-08-23", False),    # ya se le escribio hoy
        ("diario", "2026-08-22", True),
        ("semanal", "2026-08-20", False),
        ("semanal", "2026-08-15", True),
        ("diario", "fecha rota", True),     # ante la duda, se escribe
    ],
)
def test_cada_cuanto(frecuencia, ultimo, toca, monkeypatch):
    import tripfinder.cli as C

    class Hoy(C.date):
        @classmethod
        def today(cls):
            return C.date(2026, 8, 23)

    monkeypatch.setattr(C, "date", Hoy)
    assert _cada_cuanto(frecuencia, ultimo) is toca


def test_prefs_rotas_no_tumban_nada():
    p = U.prefs_validas({"chollos": "cuando sea", "chollos_max_precio": "ochenta"})
    assert p["chollos"] == "cada_vez"  # lo que no se entiende, al valor de casa
    assert p["chollos_max_precio"] is None
    assert U.prefs_validas(None) == U.PREFS_DEFECTO
    assert U.prefs_validas("una cadena") == U.PREFS_DEFECTO


# ----------------------------------------------------------------- chollos
def test_cada_uno_recibe_lo_suyo():
    U.anadir("ana", password="ana12345", email="ana@example.com")
    U.cambiar_prefs("ana", {"chollos": "cada_vez", "chollos_max_precio": 60})
    U.anadir("mateo", password="mateo12345", email="mateo@example.com")
    U.cambiar_prefs("mateo", {"chollos": "nunca"})

    nuevas = [oferta(45), oferta(120, "BKK")]
    reparto = _reparto_de_chollos(nuevas, nuevas, CFG, {}, 6)

    # Ana solo lo que baja de su tope; Mateo nada; el buzon de siempre, todo.
    assert [o.price for o, in [(x,) for x in reparto["ana@example.com"][0]]] == [45]
    assert "mateo@example.com" not in reparto
    assert len(reparto["el-de-siempre@example.com"][0]) == 2


def test_el_resumen_manda_lo_mejor_que_hay_no_solo_lo_de_hoy():
    """Con un resumen semanal, mandar solo lo nuevo del martes se come el resto."""
    U.anadir("ana", password="ana12345", email="ana@example.com")
    U.cambiar_prefs("ana", {"chollos": "semanal"})

    vivas = [oferta(40), oferta(55, "OTP"), oferta(70, "BGY")]
    reparto = _reparto_de_chollos(vivas, [], CFG, {}, 6)
    assert len(reparto["ana@example.com"][0]) == 3
    assert reparto["ana@example.com"][1] == "resumen semanal"
    # y sin nada nuevo, al buzon de siempre no se le escribe
    assert "el-de-siempre@example.com" not in reparto


def test_no_se_escribe_dos_veces_al_mismo_buzon():
    # Si la cuenta usa el mismo email que notify.to, manda lo que ella eligio.
    U.anadir("mateo", password="mateo12345", email="el-de-siempre@example.com")
    U.cambiar_prefs("mateo", {"chollos": "nunca"})
    assert _reparto_de_chollos([oferta(30)], [oferta(30)], CFG, {}, 6) == {}


def test_el_semanal_espera_su_semana():
    U.anadir("ana", password="ana12345", email="ana@example.com")
    U.cambiar_prefs("ana", {"chollos": "semanal"})
    from datetime import date

    state = {"digest": {"ana@example.com": date.today().isoformat()}}
    assert "ana@example.com" not in _reparto_de_chollos([oferta(30)], [], CFG, state, 6)


def test_una_cuenta_apagada_no_recibe():
    U.anadir("ana", password="ana12345", email="ana@example.com")
    U.activar("ana", False)
    reparto = _reparto_de_chollos([oferta(30)], [oferta(30)], CFG, {}, 6)
    assert "ana@example.com" not in reparto


# ------------------------------------------------------------ seguimientos
def test_el_parte_respeta_la_frecuencia_de_cada_uno():
    ana = U.anadir("ana", password="ana12345", email="ana@example.com")
    U.cambiar_prefs("ana", {"seguimientos": "nunca"})
    mateo = U.anadir("mateo", password="mateo12345", email="mateo@example.com")

    estado = [
        (W.Watch(id="a", owner=ana.id), []),
        (W.Watch(id="b", owner=mateo.id), [oferta(40)]),
    ]
    partes = _partes_por_dueno(estado, CFG, {})
    assert set(partes) == {"mateo@example.com"}


def test_solo_novedades_calla_el_parte_vacio():
    ana = U.anadir("ana", password="ana12345", email="ana@example.com")
    U.cambiar_prefs("ana", {"seguimientos": "diario", "seguimientos_solo_novedades": True})
    vacio = [(W.Watch(id="a", owner=ana.id), [])]
    assert _partes_por_dueno(vacio, CFG, {}) == {}

    con_algo = [(W.Watch(id="a", owner=ana.id), [oferta(40)])]
    assert "ana@example.com" in _partes_por_dueno(con_algo, CFG, {})


# ------------------------------------------- el token y los sobres, por encima
def test_el_token_se_guarda_tal_cual_llega_cifrado(fichero_temporal):
    U.set_site_token({"iv": "aXY=", "data": "Y2lmcmFkbw=="})
    assert U.hay_site_token()
    guardado = (fichero_temporal / "users.json").read_text(encoding="utf-8")
    assert "Y2lmcmFkbw==" in guardado  # el blob, y nada mas


def test_cambiar_la_contrasena_sin_sobre_marca_la_cuenta():
    """El aviso importa: si no, la cuenta diria que puede lanzar y no podria."""
    U.anadir("ana", password="ana12345", credencial=None, sobre={"salt": "s", "data": "d"})
    assert U.buscar("ana").puede_escribir
    U.cambiar_password("ana", "otra12345")
    u = U.buscar("ana")
    assert not u.puede_escribir
    assert u.sobre["stale"] is True  # se conserva, por si vuelve la de antes


def test_con_sobre_nuevo_la_cuenta_sigue_pudiendo():
    U.anadir("ana", password="ana12345", sobre={"salt": "s", "data": "d"})
    U.cambiar_password("ana", "otra12345", sobre={"salt": "s2", "data": "d2"})
    assert U.buscar("ana").puede_escribir
