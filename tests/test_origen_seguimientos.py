"""De dónde sale cada seguimiento (#13).

El campo existe para responder una pregunta concreta: si el test de destinos
trae gente o si todo el mundo acaba usando el formulario. Lo que se comprueba
aquí es sobre todo que **no rompa lo que ya está apuntado**: `data/watch.json`
tiene seguimientos de antes de que este campo existiera.
"""

import json
from pathlib import Path

import pytest

from tripfinder import watch as W
from tripfinder.cli import _origen

RAIZ = Path(__file__).resolve().parent.parent


def test_los_seguimientos_de_antes_siguen_cargando(tmp_path, monkeypatch):
    """El criterio de aceptación: `_cargar` filtra por `__dataclass_fields__`,
    así que un JSON sin `source` tiene que entrar igual. Y al revés: una clave
    que ya no existe tampoco puede tumbarlo."""
    fichero = tmp_path / "watch.json"
    fichero.write_text(
        json.dumps(
            {
                "updated": "2026-01-01",
                "watches": [
                    {"id": "viejo", "label": "Roma en marzo", "destination": "FCO"},
                    {"id": "raro", "label": "Con basura", "campo_que_ya_no_existe": 1},
                ],
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(W, "FICHERO", fichero)
    lista = W._cargar()
    assert [w.id for w in lista] == ["viejo", "raro"]
    assert all(w.source == "" for w in lista)


def test_lo_que_se_apunta_hoy_lleva_su_origen(tmp_path, monkeypatch):
    monkeypatch.setattr(W, "FICHERO", tmp_path / "watch.json")
    W.anadir(W.Watch(id="nuevo", label="Roma", source="test"))
    assert W._cargar()[0].source == "test"


def test_el_origen_sobrevive_a_ida_y_vuelta(tmp_path, monkeypatch):
    monkeypatch.setattr(W, "FICHERO", tmp_path / "watch.json")
    W.anadir(W.Watch(id="a", source="formulario"))
    W.anadir(W.Watch(id="b", source="test"))
    assert {w.id: w.source for w in W._cargar()} == {"a": "formulario", "b": "test"}


# ------------------------------------------------------------------ normalizar
@pytest.mark.parametrize(
    ("entra", "sale"),
    [
        ("formulario", "formulario"),
        ("Test", "test"),
        ("  test  ", "test"),
        ("", ""),
        (None, ""),
        # Llega en un client_payload, o sea de fuera de casa.
        ("<script>alert(1)</script>", "scriptalert1script"),
        ("a" * 80, "a" * 24),
        # Las letras con tilde o eñe pasan: son letras. Lo que se cae es
        # todo lo que podria significar algo en un HTML o en un shell.
        ("con espacios y ñ", "conespaciosyñ"),
    ],
)
def test_el_origen_llega_de_fuera_y_se_limpia(entra, sale):
    """No es una etiqueta que el usuario escriba: es una de las tres o cuatro
    puertas de entrada del sistema, y va a parar a un HTML de correo."""
    assert _origen(entra) == sale


# ------------------------------------------------------------------- se propaga
def test_la_web_dice_de_donde_viene():
    js = (RAIZ / "web" / "js" / "seguimientos.js").read_text(encoding="utf-8")
    assert 'source: "formulario"' in js


def test_el_workflow_lo_pasa_al_cli():
    yml = (RAIZ / ".github" / "workflows" / "watch.yml").read_text(encoding="utf-8")
    assert "client_payload.source" in yml
    assert "--source" in yml


def test_el_panel_y_el_parte_lo_ensenan():
    assert "w.source" in (RAIZ / "web" / "admin.html").read_text(encoding="utf-8")
    assert 'getattr(w, "source"' in (
        RAIZ / "src" / "tripfinder" / "notify" / "render.py"
    ).read_text(encoding="utf-8")
