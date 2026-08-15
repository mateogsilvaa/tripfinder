"""Utilidades HTTP compartidas: sesion con reintentos y rate limiting por host."""

from __future__ import annotations

import logging
import time
from typing import Any

import requests

log = logging.getLogger("tripfinder")

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36 tripfinder/0.1"
)

_last_call: dict[str, float] = {}


def throttle(key: str, min_interval: float) -> None:
    """Garantiza min_interval segundos entre llamadas con la misma clave."""
    now = time.monotonic()
    wait = min_interval - (now - _last_call.get(key, 0.0))
    if wait > 0:
        time.sleep(wait)
    _last_call[key] = time.monotonic()


def get_json(
    url: str,
    *,
    params: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout: int = 25,
    retries: int = 3,
    throttle_key: str | None = None,
    min_interval: float = 1.0,
) -> Any:
    h = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    h.update(headers or {})
    last: Exception | None = None
    for attempt in range(retries):
        if throttle_key:
            throttle(throttle_key, min_interval)
        try:
            r = requests.get(url, params=params, headers=h, timeout=timeout)
            if r.status_code == 429:
                time.sleep(3 * (attempt + 1))
                continue
            r.raise_for_status()
            return r.json()
        except Exception as exc:  # noqa: BLE001 - se reintenta y luego se propaga
            last = exc
            log.debug("GET %s fallo (intento %d/%d): %s", url, attempt + 1, retries, exc)
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"GET {url} fallo tras {retries} intentos: {last}")


def get_text(url: str, *, params=None, headers=None, timeout: int = 25) -> str:
    h = {"User-Agent": USER_AGENT, "Accept-Language": "es-ES,es;q=0.9,en;q=0.8"}
    h.update(headers or {})
    r = requests.get(url, params=params, headers=h, timeout=timeout)
    r.raise_for_status()
    return r.text
