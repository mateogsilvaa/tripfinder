"""Aviso abriendo una issue en el propio repo.

Cero credenciales que gestionar: dentro de Actions el GITHUB_TOKEN ya existe, y
GitHub te manda el email de notificacion por ser propietario del repo. Es el plan
B si un dia Resend falla o no quieres depender de un tercero.
"""

from __future__ import annotations

import logging

import requests

from ..config import env, repo_slug

log = logging.getLogger("tripfinder")


def send(subject: str, markdown: str, labels: list[str] | None = None) -> None:
    token = env("GITHUB_TOKEN") or env("GH_TOKEN")
    if not token:
        raise RuntimeError("Falta GITHUB_TOKEN (solo existe dentro de Actions)")

    r = requests.post(
        f"https://api.github.com/repos/{repo_slug()}/issues",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
        },
        json={"title": subject, "body": markdown, "labels": labels or ["chollo"]},
        timeout=30,
    )
    if r.status_code >= 400:
        raise RuntimeError(f"GitHub issues {r.status_code}: {r.text[:300]}")
    log.info("Aviso publicado como issue #%s", r.json().get("number", "?"))
