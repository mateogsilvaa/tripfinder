"""Avisos de chollo. El transporte se elige con `notify.method` en el YAML.

    resend        -> API de Resend (recomendado; solo una API key)
    smtp          -> SMTP clasico (Gmail necesita contrasena de aplicacion)
    github_issue  -> abre una issue en el repo y GitHub te manda el email

Si el metodo elegido falla se intenta el siguiente disponible, para no perder un
chollo por un problema de credenciales.
"""

from __future__ import annotations

import logging

from ..config import env
from ..models import FlightOffer
from . import github_issue, render, resend, smtp

log = logging.getLogger("tripfinder")

ORDER = ("resend", "smtp", "github_issue")


def _send_with(method: str, offers: list[FlightOffer], to: str) -> None:
    subject = render.subject_for(offers)
    if method == "resend":
        resend.send(subject, render.render_html(offers), to)
    elif method == "smtp":
        smtp.send_email(subject, render.render_html(offers), to)
    elif method == "github_issue":
        github_issue.send(subject, render.render_markdown(offers))
    else:
        raise RuntimeError(f"Metodo de aviso desconocido: {method}")


def _configured(method: str) -> bool:
    return {
        "resend": bool(env("RESEND_API_KEY")),
        "smtp": bool(env("SMTP_USER") and env("SMTP_PASSWORD")),
        "github_issue": bool(env("GITHUB_TOKEN") or env("GH_TOKEN")),
    }.get(method, False)


def notify_offers(offers: list[FlightOffer], to: str, method: str = "resend") -> str:
    """Envia el aviso y devuelve el metodo que funciono."""
    if not offers:
        return ""

    candidates = [method] + [m for m in ORDER if m != method]
    errors: list[str] = []
    for candidate in candidates:
        if not _configured(candidate):
            log.debug("Metodo %s sin credenciales, se salta", candidate)
            continue
        try:
            _send_with(candidate, offers, to)
            if candidate != method:
                log.warning("Aviso enviado por %s (el metodo elegido, %s, no pudo)", candidate, method)
            return candidate
        except Exception as exc:  # noqa: BLE001 - se prueba el siguiente transporte
            log.warning("Fallo el aviso por %s: %s", candidate, exc)
            errors.append(f"{candidate}: {exc}")

    if errors:
        raise RuntimeError("Ningun metodo de aviso funciono: " + " | ".join(errors))
    raise RuntimeError("Ningun metodo de aviso tiene credenciales configuradas.")


__all__ = ["notify_offers", "render"]
