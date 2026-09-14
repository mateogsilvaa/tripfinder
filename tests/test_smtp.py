"""El transporte SMTP, y las dos trampas de Gmail.

Resend solo deja escribir a la dirección del dueño de la clave mientras el
dominio no esté verificado, y el dominio de esta web es `mateogsilvaa.github.io`:
`github.io` es de GitHub, así que no hay ningún registrador donde meter los
registros que Resend pide. O sea que por Resend solo recibe avisos una cuenta.
Por SMTP se escribe a cualquiera, y por eso importa que SMTP funcione a la
primera.
"""

from __future__ import annotations

import smtplib

import pytest

from tripfinder.notify import smtp


@pytest.fixture(autouse=True)
def _sin_entorno(monkeypatch):
    for k in ("SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "NOTIFY_TO"):
        monkeypatch.delenv(k, raising=False)


class _Servidor:
    """Un SMTP de mentira que apunta lo que le piden."""

    def __init__(self, registro, *args, **kwargs):
        self.registro = registro
        registro["host"], registro["port"] = args[0], args[1]
        registro["starttls"] = False

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def starttls(self):
        self.registro["starttls"] = True

    def login(self, user, password):
        self.registro["login"] = (user, password)

    def send_message(self, msg):
        self.registro["msg"] = msg


def _monta(monkeypatch, registro):
    """Los dos, para que la prueba no decida por el código cuál se abre."""
    for nombre in ("SMTP_SSL", "SMTP"):
        monkeypatch.setattr(
            smtp.smtplib, nombre, lambda *a, **k: _Servidor(registro, *a, **k)
        )


def _credenciales(monkeypatch, password="abcd efgh ijkl mnop", port=None):
    monkeypatch.setenv("SMTP_USER", "yo@gmail.com")
    monkeypatch.setenv("SMTP_PASSWORD", password)
    monkeypatch.setenv("NOTIFY_TO", "tu@correo.com")
    if port:
        monkeypatch.setenv("SMTP_PORT", port)


def test_la_contrasena_de_aplicacion_va_sin_los_espacios(monkeypatch):
    """Google la enseña en cuatro grupos de cuatro y al copiarla vienen los
    espacios. Gmail los rechaza con un 535 que no explica nada."""
    registro = {}
    _monta(monkeypatch, registro)
    _credenciales(monkeypatch)
    smtp.send_email("Hola", "<p>hola</p>")
    assert registro["login"] == ("yo@gmail.com", "abcdefghijklmnop")


def test_el_465_habla_tls_desde_el_saludo(monkeypatch):
    registro = {}
    _monta(monkeypatch, registro)
    _credenciales(monkeypatch)
    smtp.send_email("Hola", "<p>hola</p>")
    assert registro["port"] == 465
    assert registro["starttls"] is False


def test_el_587_sube_a_tls_con_starttls(monkeypatch):
    """Casi todas las guías de Gmail dicen 587. Antes esto abría siempre
    `SMTP_SSL`, así que poner 587 colgaba hasta el timeout sin decir por qué."""
    registro = {}
    _monta(monkeypatch, registro)
    _credenciales(monkeypatch, port="587")
    smtp.send_email("Hola", "<p>hola</p>")
    assert registro["port"] == 587
    assert registro["starttls"] is True


def test_dice_exactamente_que_credencial_falta(monkeypatch):
    """«Faltan credenciales» obliga a ir a mirar cuáles, y desde un log de
    Actions eso es abrir otra pestaña."""
    monkeypatch.setenv("SMTP_USER", "yo@gmail.com")
    with pytest.raises(RuntimeError) as e:
        smtp.send_email("Hola", "<p>hola</p>")
    assert "SMTP_PASSWORD" in str(e.value)
    assert "SMTP_USER" not in str(e.value)


def test_un_535_se_cuenta_en_cristiano(monkeypatch):
    """Es el fallo más probable con diferencia, y el que peor se explica solo."""
    _credenciales(monkeypatch)

    def _falla(*_a, **_k):
        raise smtplib.SMTPAuthenticationError(535, b"Username and Password not accepted")

    class _Malo(_Servidor):
        login = _falla

    monkeypatch.setattr(smtp.smtplib, "SMTP_SSL", lambda *a, **k: _Malo({}, *a, **k))
    with pytest.raises(RuntimeError) as e:
        smtp.send_email("Hola", "<p>hola</p>")
    assert "CONTRASENA DE APLICACION" in str(e.value)
    assert "dos pasos" in str(e.value)


def test_el_remitente_es_la_propia_cuenta(monkeypatch):
    """Gmail reescribe cualquier otro, así que no se intenta."""
    registro = {}
    _monta(monkeypatch, registro)
    _credenciales(monkeypatch)
    smtp.send_email("Hola", "<p>hola</p>")
    assert registro["msg"]["From"] == "TripFinder <yo@gmail.com>"
    assert registro["msg"]["To"] == "tu@correo.com"


def test_sin_destinatario_se_escribe_uno_mismo(monkeypatch):
    registro = {}
    _monta(monkeypatch, registro)
    monkeypatch.setenv("SMTP_USER", "yo@gmail.com")
    monkeypatch.setenv("SMTP_PASSWORD", "x")
    smtp.send_email("Hola", "<p>hola</p>")
    assert registro["msg"]["To"] == "yo@gmail.com"


def test_probar_un_transporte_no_cae_a_los_demas(monkeypatch):
    """PROBAR ES PROBAR ESE. Sin `solo`, un `--method smtp` que falla lo rescata
    la cadena —resend, y si no, abrir una issue— y el comando dice «enviado»:
    justo lo contrario de lo que se le ha preguntado. Para un botón que existe
    para saber si unas credenciales están bien, eso es mentir con éxito."""
    import tripfinder.notify as N
    from tripfinder.models import FlightOffer

    intentados = []

    def _apunta(method, offers, to):
        intentados.append(method)
        raise RuntimeError("no")

    monkeypatch.setattr(N, "_send_with", _apunta)
    monkeypatch.setattr(N, "_configured", lambda _m: True)
    oferta = FlightOffer(provider="x", origin="MAD", destination="FCO",
                         depart_date="2027-01-01", price=10.0)

    with pytest.raises(RuntimeError):
        N.notify_offers([oferta], to="t@t.com", method="smtp", solo=True)
    assert intentados == ["smtp"]

    # Y sin `solo`, la cadena entera: un chollo vale más por una vía rara que
    # perdido, que es justo lo contrario del caso de arriba.
    intentados.clear()
    with pytest.raises(RuntimeError):
        N.notify_offers([oferta], to="t@t.com", method="smtp")
    assert intentados == ["smtp", "resend", "github_issue"]
