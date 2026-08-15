"""Transporte SMTP (Gmail requiere contrasena de aplicacion; ver resend.py)."""

from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

from ..config import env, site_url

log = logging.getLogger("tripfinder")


def send_email(subject: str, html: str, to: str | None = None) -> None:
    host = env("SMTP_HOST", "smtp.gmail.com")
    port = int(env("SMTP_PORT", "465"))
    user = env("SMTP_USER")
    password = env("SMTP_PASSWORD")
    dest = to or env("NOTIFY_TO") or user
    if not (user and password and dest):
        raise RuntimeError("Faltan SMTP_USER / SMTP_PASSWORD / NOTIFY_TO")

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = f"TripFinder <{user}>"
    msg["To"] = dest
    msg.set_content("Tu cliente no soporta HTML. Abre " + site_url())
    msg.add_alternative(html, subtype="html")

    with smtplib.SMTP_SSL(host, port, timeout=30) as server:
        server.login(user, password)
        server.send_message(msg)
    log.info("Email enviado a %s: %s", dest, subject)
