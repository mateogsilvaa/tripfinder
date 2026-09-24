"""Los correos de las cuentas no salen a ningun sitio publico.

El repositorio es publico, sus logs de Actions tambien, y `data/` se copia a
Pages. Con el SMTP caido, cada chollo acababa en tres issues iguales —una por
cuenta, que solo leia el dueño— y el log decia a quien iba cada una, direccion
incluida. Y `state.json` llevaba las direcciones como claves.
"""

import logging

import pytest

from tripfinder import notify
from tripfinder.cli import _es_del_dueno
from tripfinder.config import Config
from tripfinder.models import FlightOffer
from tripfinder.store import Store
from tripfinder.util import TaparCorreos, clave_buzon, tapar_correos

CFG = Config(raw={"notify": {"to": "Dueno@Example.com"}})


def test_tapar_correos():
    assert tapar_correos("a ana.perez@gmail.com (1 oferta)") == "a a***@gmail.com (1 oferta)"
    assert tapar_correos("sin nada") == "sin nada"
    # Tambien dentro del error que devuelve Resend.
    assert "mateo@" not in tapar_correos('{"message":"(mateo@gmail.com)"}')


def test_el_filtro_tapa_lo_que_va_al_log(caplog):
    log = logging.getLogger("prueba-correos")
    manejador = caplog.handler
    manejador.addFilter(TaparCorreos())
    try:
        log.warning("Aviso a %s: %s", "ana@example.com", "error de pepe@example.org")
    finally:
        manejador.removeFilter(manejador.filters[-1])
    assert "ana@" not in caplog.text and "pepe@" not in caplog.text
    assert "a***@example.com" in caplog.text


def test_la_issue_solo_es_respaldo_para_el_dueno():
    assert _es_del_dueno("dueno@example.com", CFG)
    assert _es_del_dueno("", CFG)  # el buzon de siempre
    assert not _es_del_dueno("ana@example.com", CFG)


def test_sin_issue_para_las_demas_cuentas(monkeypatch):
    """Con el correo caido, el aviso de otra cuenta falla, no abre una issue."""
    abiertas = []
    monkeypatch.setattr(notify, "_configured", lambda m: True)

    def enviar(metodo, ofertas, to):
        if metodo == "github_issue":
            abiertas.append(to)
            return
        raise RuntimeError("caido")

    monkeypatch.setattr(notify, "_send_with", enviar)
    oferta = FlightOffer(
        provider="ryanair", origin="MAD", destination="FCO",
        depart_date="2026-11-13", return_date="2026-11-16", price=40,
    )
    with pytest.raises(RuntimeError):
        notify.notify_offers([oferta], to="ana@example.com", method="smtp", issue_ok=False)
    assert abiertas == []
    # Para el dueño sigue siendo el ultimo recurso.
    assert notify.notify_offers([oferta], to="dueno@example.com", method="smtp") == "github_issue"


def test_state_json_no_guarda_direcciones(tmp_path):
    store = Store(tmp_path)
    store.save_state(
        {
            "notified": {},
            "digest": {"ana@example.com": "2026-09-20", clave_buzon("ana@example.com"): "2026-09-22"},
            "watch_digest": {"pepe@example.com": "2026-09-21"},
        }
    )
    texto = (tmp_path / "state.json").read_text(encoding="utf-8")
    assert "@" not in texto
    estado = store.load_state()
    # Si convivian la clave vieja y la nueva, gana la fecha mas reciente.
    assert estado["digest"] == {clave_buzon("ana@example.com"): "2026-09-22"}
    assert estado["watch_digest"] == {clave_buzon("pepe@example.com"): "2026-09-21"}


def test_clave_buzon_no_distingue_mayusculas():
    assert clave_buzon(" Ana@Example.com ") == clave_buzon("ana@example.com")
    assert clave_buzon("") == ""
