"""Persistencia en JSON dentro de data/. El repo es la base de datos."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Any

from .config import DATA_DIR
from .models import FlightOffer, StayOffer

MAX_HISTORY_PER_ROUTE = 400


class Store:
    def __init__(self, root: Path | str = DATA_DIR):
        self.root = Path(root)
        self.stays_dir = self.root / "stays"
        self.searches_dir = self.root / "searches"
        self.root.mkdir(parents=True, exist_ok=True)
        self.stays_dir.mkdir(parents=True, exist_ok=True)
        self.searches_dir.mkdir(parents=True, exist_ok=True)

    # -- helpers ---------------------------------------------------------
    def _read(self, name: str, default: Any) -> Any:
        p = self.root / name
        if not p.exists():
            return default
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return default

    def _write(self, name: str, payload: Any) -> None:
        p = self.root / name
        p.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    # -- ofertas ---------------------------------------------------------
    def load_offers(self) -> list[FlightOffer]:
        raw = self._read("offers.json", {"offers": []})
        return [FlightOffer.from_dict(o) for o in raw.get("offers", [])]

    def save_offers(self, offers: list[FlightOffer], errors: list[str] | None = None) -> None:
        self._write(
            "offers.json",
            {
                "generated_at": date.today().isoformat(),
                "count": len(offers),
                "errors": errors or [],
                "offers": [o.to_dict() for o in offers],
            },
        )

    # -- historico de precios -------------------------------------------
    def load_history(self) -> dict[str, list[dict]]:
        return self._read("history.json", {})

    def record_prices(self, offers: list[FlightOffer]) -> dict[str, list[dict]]:
        """Anade el precio de hoy por ruta. Idempotente dentro del mismo dia."""
        history = self.load_history()
        today = date.today().isoformat()
        for o in offers:
            series = history.setdefault(o.history_key, [])
            if any(e["d"] == today and abs(e["p"] - o.price) < 0.01 for e in series):
                continue
            series.append({"d": today, "p": round(o.price, 2)})
            del series[:-MAX_HISTORY_PER_ROUTE]
        self._write("history.json", history)
        return history

    def save_search(self, payload: dict[str, Any]) -> Path:
        """Guarda una busqueda y refresca el indice que lee la web."""
        p = self.searches_dir / f"{payload['slug']}.json"
        p.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

        indice = []
        for f in sorted(self.searches_dir.glob("*.json")):
            if f.name == "index.json":
                continue
            try:
                d = json.loads(f.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue
            indice.append(
                {
                    "slug": d.get("slug"),
                    "label": d.get("label"),
                    "count": d.get("count", 0),
                    "generated_at": d.get("generated_at"),
                    "best_price": min((o["price"] for o in d.get("offers", [])), default=None),
                }
            )
        (self.searches_dir / "index.json").write_text(
            json.dumps({"searches": indice}, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return p

    def purge_expired_stays(self) -> int:
        """Los alojamientos scrapeados se quedan hasta que pasa la fecha del viaje.

        Nada de caducar por antiguedad: si la escapada es en enero, esos precios
        siguen siendo utiles en diciembre. Solo se borra lo que ya no sirve.
        """
        hoy = date.today().isoformat()
        borrados = 0
        for f in self.stays_dir.glob("*.json"):
            try:
                datos = json.loads(f.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue
            if (datos.get("checkout") or "9999") < hoy:
                f.unlink()
                borrados += 1
        return borrados

    # -- estado de notificaciones ---------------------------------------
    def load_state(self) -> dict[str, Any]:
        return self._read("state.json", {"notified": {}})

    def save_state(self, state: dict[str, Any]) -> None:
        self._write("state.json", state)

    # -- alojamientos ----------------------------------------------------
    def save_stays(self, offer_id: str, offer: FlightOffer | None, stays: list[StayOffer],
                   checkin: str, checkout: str, errors: list[str] | None = None,
                   summary: dict[str, Any] | None = None) -> Path:
        p = self.stays_dir / f"{offer_id}.json"
        p.write_text(
            json.dumps(
                {
                    "offer_id": offer_id,
                    "offer": offer.to_dict() if offer else None,
                    "checkin": checkin,
                    "checkout": checkout,
                    "generated_at": date.today().isoformat(),
                    "summary": summary or {},
                    "errors": errors or [],
                    "stays": [s.to_dict() for s in stays],
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        return p
