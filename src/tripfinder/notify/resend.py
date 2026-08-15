"""Envio via Resend (https://resend.com).

Ventaja sobre SMTP: la credencial es una API key revocable de un servicio de envio,
no la contrasena de tu cuenta de correo. Plan gratuito: 3.000 emails/mes.

Secretos: RESEND_API_KEY (obligatorio) y RESEND_FROM (opcional; por defecto usa el
remitente de pruebas onboarding@resend.dev, que funciona sin verificar dominio pero
solo puede enviarte a TI, a la direccion con la que te diste de alta).
"""

from __future__ import annotations

import logging

import requests

from ..config import env

log = logging.getLogger("tripfinder")

API = "https://api.resend.com/emails"
DEFAULT_FROM = "TripFinder <onboarding@resend.dev>"


def send(subject: str, html: str, to: str) -> None:
    key = env("RESEND_API_KEY")
    if not key:
        raise RuntimeError("Falta RESEND_API_KEY")

    r = requests.post(
        API,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={
            "from": env("RESEND_FROM", DEFAULT_FROM),
            "to": [to],
            "subject": subject,
            "html": html,
        },
        timeout=30,
    )
    if r.status_code >= 400:
        raise RuntimeError(f"Resend {r.status_code}: {r.text[:300]}")
    log.info("Email enviado por Resend a %s (id %s)", to, r.json().get("id", "?"))
