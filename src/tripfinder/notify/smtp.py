"""Transporte SMTP. Con Gmail hace falta una contrasena de aplicacion.

POR QUE SMTP Y NO RESEND. Resend solo deja escribir a la direccion del dueno de
la clave mientras el dominio no este verificado, y el dominio de esta web es
`mateogsilvaa.github.io`: `github.io` es de GitHub, asi que no hay ningun
registrador donde meter los registros que Resend pide. O sea que con Resend solo
recibe avisos una cuenta y las demas acaban en una issue. Por SMTP se escribe a
cualquiera.

LAS DOS TRAMPAS DE GMAIL, que son las que hacen que esto falle a la primera:

  · La contrasena de aplicacion la ensena Google en cuatro grupos de cuatro
    —"abcd efgh ijkl mnop"— y al copiarla se copian los espacios. Gmail los
    rechaza. Se quitan aqui: es mas util que un 535 que no explica nada.
  · El puerto 465 habla TLS desde el saludo y el 587 empieza en claro y sube a
    TLS con STARTTLS. Son dos protocolos distintos, y casi todas las guias dicen
    587. Antes esto abria siempre `SMTP_SSL`, asi que poner 587 —lo que hace
    cualquiera que siga una guia— colgaba hasta el timeout sin decir por que.
"""

from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

from ..config import env, site_url

log = logging.getLogger("tripfinder")

# El de TLS desde el saludo. Cualquier otro se trata como STARTTLS.
PUERTO_TLS_DIRECTO = 465


def _clave(bruta: str) -> str:
    """Sin espacios ni saltos: Google la ensena en grupos de cuatro."""
    return "".join(bruta.split())


def _faltan(user: str, password: str, dest: str) -> list[str]:
    return [
        nombre
        for nombre, valor in (
            ("SMTP_USER", user),
            ("SMTP_PASSWORD", password),
            ("NOTIFY_TO (o notify.to en el YAML)", dest),
        )
        if not valor
    ]


def send_email(subject: str, html: str, to: str | None = None) -> None:
    host = env("SMTP_HOST", "smtp.gmail.com")
    port = int(env("SMTP_PORT", str(PUERTO_TLS_DIRECTO)))
    user = env("SMTP_USER").strip()
    password = _clave(env("SMTP_PASSWORD"))
    dest = (to or env("NOTIFY_TO") or user).strip()

    if falta := _faltan(user, password, dest):
        # Con los nombres puestos: "faltan credenciales" obliga a ir a mirar
        # cuales, y desde un log de Actions eso es abrir otra pestana.
        raise RuntimeError("Faltan " + ", ".join(falta))

    msg = EmailMessage()
    msg["Subject"] = subject
    # Gmail reescribe cualquier remitente que no sea la propia cuenta, asi que
    # no se intenta: el nombre se pone delante y la direccion es la de verdad.
    msg["From"] = f"TripFinder <{user}>"
    msg["To"] = dest
    msg.set_content("Tu cliente no soporta HTML. Abre " + site_url())
    msg.add_alternative(html, subtype="html")

    try:
        if port == PUERTO_TLS_DIRECTO:
            with smtplib.SMTP_SSL(host, port, timeout=30) as server:
                server.login(user, password)
                server.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=30) as server:
                server.starttls()
                server.login(user, password)
                server.send_message(msg)
    except smtplib.SMTPAuthenticationError as exc:
        # El fallo mas probable con diferencia, y el que peor se explica solo.
        raise RuntimeError(
            f"{host} no acepta el usuario o la contrasena ({exc.smtp_code}). "
            "Con Gmail tiene que ser una CONTRASENA DE APLICACION, no la de "
            "entrar a la cuenta, y para crearla hace falta la verificacion en "
            "dos pasos encendida."
        ) from exc

    log.info("Email enviado a %s por %s:%s", dest, host, port)
