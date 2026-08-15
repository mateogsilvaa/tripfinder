"""Carga de config/watchlist.yml y del entorno."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

try:  # .env es opcional (en Actions las vars vienen de Secrets)
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:  # pragma: no cover
    pass

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG = ROOT / "config" / "watchlist.yml"
DATA_DIR = ROOT / "data"


@dataclass
class Route:
    origin: str
    origin_name: str = ""
    destinations: Any = "any"  # "any" o lista de IATA
    max_price: float = 100.0
    baseline_price: float = 150.0

    @property
    def dest_list(self) -> list[str]:
        return [] if self.destinations in ("any", None) else list(self.destinations)


@dataclass
class Config:
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def routes(self) -> list[Route]:
        return [Route(**r) for r in self.raw.get("routes", [])]

    @property
    def search(self) -> dict[str, Any]:
        return self.raw.get("search", {})

    @property
    def notify(self) -> dict[str, Any]:
        return self.raw.get("notify", {})

    @property
    def providers(self) -> list[str]:
        return self.raw.get("providers", ["ryanair"])

    @property
    def stays(self) -> dict[str, Any]:
        return self.raw.get("stays", {}) or {}

    @property
    def stay_providers(self) -> list[str]:
        return list(self.stays.get("providers", ["deeplinks"]))

    @property
    def adults(self) -> int:
        return int(self.stays.get("adults", 2))


def load_config(path: str | Path | None = None) -> Config:
    p = Path(path) if path else DEFAULT_CONFIG
    with open(p, "r", encoding="utf-8") as fh:
        return Config(raw=yaml.safe_load(fh) or {})


def env(key: str, default: str = "") -> str:
    return os.getenv(key, default) or default


def site_url() -> str:
    return env("SITE_URL", "https://mateogsilvaa.github.io/tripfinder").rstrip("/")


def repo_slug() -> str:
    return env("REPO_SLUG", "mateogsilvaa/tripfinder")
