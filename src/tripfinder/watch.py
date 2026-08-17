"""Seguimientos: viajes concretos que quieres vigilar todos los dias.

El scan diario busca chollos "a ver que sale". Esto es lo contrario: le dices
"quiero Roma en marzo por menos de 120 €" y cada mañana lo comprueba por ti y
te escribe solo cuando aparece algo que cumple.

Cada seguimiento vive en data/watch.json y guarda el mejor precio visto, para
avisar tambien cuando baja de su propio minimo aunque ya estuviera dentro de
presupuesto.
"""

from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

from .config import DATA_DIR, Config
from .models import FlightOffer

log = logging.getLogger("tripfinder")

FICHERO = DATA_DIR / "watch.json"


@dataclass
class Watch:
    """Un encargo: un destino, unas fechas, o las dos cosas."""

    id: str
    label: str = ""
    destination: str = ""  # vacio = cualquier destino
    depart: str = ""  # fecha exacta, o vacio
    return_date: str = ""
    months: int = 6
    nights: str = "2-3"
    weekend_only: bool = True
    adults: int = 2
    max_price: float | None = None
    created: str = ""
    best_price: float | None = None  # el mejor precio visto hasta hoy
    last_checked: str = ""
    active: bool = True
    # Lo ultimo encontrado, para poder verlo en la web sin esperar a un aviso
    last_offers: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @property
    def caducado(self) -> bool:
        """Un seguimiento con fecha fija deja de tener sentido cuando pasa."""
        return bool(self.depart) and self.depart < date.today().isoformat()


def _cargar() -> list[Watch]:
    if not FICHERO.exists():
        return []
    try:
        crudo = json.loads(FICHERO.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    salida = []
    for d in crudo.get("watches", []):
        conocidos = {k: v for k, v in d.items() if k in Watch.__dataclass_fields__}
        salida.append(Watch(**conocidos))
    return salida


def _guardar(lista: list[Watch]) -> None:
    FICHERO.parent.mkdir(parents=True, exist_ok=True)
    FICHERO.write_text(
        json.dumps(
            {"updated": date.today().isoformat(), "watches": [w.to_dict() for w in lista]},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def listar(incluir_caducados: bool = False) -> list[Watch]:
    return [w for w in _cargar() if incluir_caducados or (w.active and not w.caducado)]


def anadir(w: Watch) -> list[Watch]:
    lista = [x for x in _cargar() if x.id != w.id]
    w.created = w.created or date.today().isoformat()
    lista.append(w)
    _guardar(lista)
    log.info("Seguimiento guardado: %s", w.label or w.id)
    return lista


def borrar(watch_id: str) -> bool:
    lista = _cargar()
    quedan = [w for w in lista if w.id != watch_id]
    _guardar(quedan)
    return len(quedan) < len(lista)


def limpiar_caducados() -> int:
    lista = _cargar()
    vivos = [w for w in lista if not w.caducado]
    if len(vivos) < len(lista):
        _guardar(vivos)
    return len(lista) - len(vivos)


def merece_aviso(w: Watch, oferta: FlightOffer) -> bool:
    """Avisa si entra en presupuesto, o si bate el mejor precio visto.

    Lo segundo importa: si pediste Roma por menos de 150 € y lleva semanas a
    140 €, no tiene sentido escribirte cada dia; pero si un dia baja a 95 €, si.
    """
    if w.max_price and oferta.price > w.max_price:
        return False
    if w.best_price is None:
        return True
    # Una bajada de menos del 8% no justifica otro correo.
    return oferta.price <= w.best_price * 0.92


def revisar(w: Watch, cfg: Config, history: dict) -> tuple[list[FlightOffer], Watch]:
    """Ejecuta la busqueda del seguimiento y devuelve lo que merece aviso."""
    from .search import SearchRequest, run_search

    req = SearchRequest(
        destination=w.destination,
        label=w.label,
        max_price=w.max_price,
        nights_min=int(str(w.nights).split("-")[0] or 2),
        nights_max=int(str(w.nights).split("-")[-1] or 3),
        months=w.months,
        weekend_only=w.weekend_only,
        adults=w.adults,
        depart=w.depart,
        return_date=w.return_date,
    )
    try:
        resultado = run_search(req, cfg, history, max_queries=12)
    except Exception as exc:  # noqa: BLE001 - un seguimiento roto no tumba el resto
        log.warning("Seguimiento %s fallo: %s", w.id, exc)
        return [], w

    w.last_checked = date.today().isoformat()
    avisos = [o for o in resultado.offers if merece_aviso(w, o)]
    if resultado.offers:
        minimo = min(o.price for o in resultado.offers)
        w.best_price = minimo if w.best_price is None else min(w.best_price, minimo)
        # Se guarda lo encontrado aunque no merezca aviso: si no, en la web no
        # hay nada que ver hasta que salta una alerta, y parece que no funciona.
        w.last_offers = [o.to_dict() for o in sorted(resultado.offers, key=lambda x: x.price)[:6]]
    else:
        w.last_offers = []
    return avisos, w


def revisar_todos(cfg: Config, history: dict) -> list[tuple[Watch, list[FlightOffer]]]:
    """Revisa todos y devuelve el estado de cada uno, tenga novedad o no.

    Devolver solo los que encuentran algo dejaba el parte diario mudo cuando no
    habia nada, y entonces no se distingue "no hay chollo" de "esto se ha roto".
    """
    lista = _cargar()
    salida = []
    for i, w in enumerate(lista):
        if not w.active or w.caducado:
            continue
        avisos, actualizado = revisar(w, cfg, history)
        lista[i] = actualizado
        salida.append((actualizado, avisos[:4]))
    _guardar(lista)
    return salida
