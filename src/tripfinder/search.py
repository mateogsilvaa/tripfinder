"""Busqueda personalizada: "un finde en Roma por menos de 120 €, cuando sea".

Es el reverso del scan automatico. El scan pregunta "que hay barato ahora mismo";
esto pregunta "cuando puedo permitirme ESTE viaje", y para responder recorre
fin de semana a fin de semana hasta donde haga falta, aunque sea el año que viene.
"""

from __future__ import annotations

import logging
import re
from dataclasses import asdict, dataclass, field
from datetime import date, timedelta
from typing import Any

from .config import Config, Route
from .models import FlightOffer
from .providers import build_providers
from .scoring import score_offer, useful_hours

log = logging.getLogger("tripfinder")


@dataclass
class SearchRequest:
    """Lo que el usuario pide desde la web."""

    destination: str  # IATA, o nombre de ciudad si esta en city_names
    label: str = ""
    max_price: float | None = None
    nights_min: int = 2
    nights_max: int = 3
    months: int = 12  # hasta cuando buscar
    weekend_only: bool = True
    adults: int = 2
    origin: str = "MAD"

    @property
    def slug(self) -> str:
        base = f"{self.origin}-{self.destination}-{self.nights_min}{self.nights_max}"
        extra = f"-{int(self.max_price)}" if self.max_price else ""
        return re.sub(r"[^A-Za-z0-9-]", "", base + extra).lower()

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["slug"] = self.slug
        return d


@dataclass
class SearchResult:
    request: SearchRequest
    offers: list[FlightOffer] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    generated_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "slug": self.request.slug,
            "label": self.request.label or self.request.destination,
            "request": self.request.to_dict(),
            "generated_at": self.generated_at or date.today().isoformat(),
            "errors": self.errors,
            "count": len(self.offers),
            "offers": [o.to_dict() for o in self.offers],
        }


def resolve_destination(texto: str, cfg: Config) -> tuple[str, str, str]:
    """De lo que escriba el usuario saca (IATA, ciudad, pais).

    Acepta el codigo directamente o el nombre de la ciudad tal y como aparece
    en `city_names`, para no obligar a nadie a saberse los IATA.
    """
    texto = (texto or "").strip()
    if re.fullmatch(r"[A-Za-z]{3}", texto):
        iata = texto.upper()
        ciudad, pais = cfg.city_names.get(iata, (iata, ""))
        return iata, ciudad, pais

    objetivo = texto.lower()
    for iata, (ciudad, pais) in cfg.city_names.items():
        if ciudad.lower() == objetivo or objetivo in ciudad.lower():
            return iata, ciudad, pais
    raise ValueError(
        f"No se reconoce el destino {texto!r}. Usa el codigo IATA (FCO) o "
        f"anadelo a city_names en config/watchlist.yml."
    )


def _candidate_trips(req: SearchRequest, weekend_cfg: dict) -> list[tuple[date, date]]:
    """Fechas a probar: los findes del horizonte, o el dia 1 y 15 de cada mes."""
    hoy = date.today()
    fin = hoy + timedelta(days=int(req.months * 30.4))

    if req.weekend_only:
        salida = int(weekend_cfg.get("outbound_weekday", 4))
        vuelta = int(weekend_cfg.get("inbound_weekday", 6))
        noches = (vuelta - salida) % 7 or 7
        primero = hoy + timedelta(days=(salida - hoy.weekday()) % 7 or 7)
        dias = []
        d = primero
        while d <= fin:
            dias.append((d, d + timedelta(days=noches)))
            d += timedelta(days=7)
        return dias

    # Sin restriccion de finde basta con muestrear: la API devuelve la tarifa
    # mas barata de la ventana, asi que dos sondeos por mes cubren el mes entero.
    dias = []
    d = hoy + timedelta(days=1)
    while d <= fin:
        dias.append((d, d + timedelta(days=req.nights_min)))
        d += timedelta(days=15)
    return dias


def run_search(req: SearchRequest, cfg: Config, history: dict, max_queries: int = 45) -> SearchResult:
    iata, ciudad, pais = resolve_destination(req.destination, cfg)
    route = Route(
        origin=req.origin,
        origin_name="Madrid",
        destinations=[iata],
        max_price=req.max_price or 1e6,
        max_price_weekend=req.max_price or 1e6,
        baseline_price=req.max_price * 2 if req.max_price else 200,
        baseline_price_weekend=req.max_price * 2 if req.max_price else 250,
    )

    search_cfg = {**cfg.search, "adults": 1}
    weekend_cfg = cfg.weekend
    proveedores = [p for p in build_providers(cfg.providers, search_cfg) if p.name == "ryanair"]

    resultado = SearchResult(request=req, generated_at=date.today().isoformat())
    if not proveedores:
        resultado.errors.append("ryanair no disponible")
        return resultado
    ryanair = proveedores[0]

    fechas = _candidate_trips(req, weekend_cfg)[:max_queries]
    log.info("Busqueda %s: %d ventanas hasta %s", iata, len(fechas), fechas[-1][0] if fechas else "?")

    encontradas: dict[str, FlightOffer] = {}
    for salida, regreso in fechas:
        params = {
            **ryanair._base_params(route),  # noqa: SLF001 - mismo paquete
            "outboundDepartureDateFrom": salida.isoformat(),
            "outboundDepartureDateTo": salida.isoformat(),
            "inboundDepartureDateFrom": regreso.isoformat(),
            "inboundDepartureDateTo": regreso.isoformat(),
            "durationFrom": req.nights_min,
            "durationTo": max(req.nights_min, req.nights_max),
        }
        if req.weekend_only:
            params.update(
                outboundDepartureTimeFrom=weekend_cfg.get("outbound_after", "15:00"),
                outboundDepartureTimeTo=weekend_cfg.get("outbound_before", "22:00"),
                inboundDepartureTimeFrom=weekend_cfg.get("inbound_after", "15:00"),
                inboundDepartureTimeTo=weekend_cfg.get("inbound_before", "23:59"),
            )
        try:
            for oferta in ryanair._paginate(params, route, 20):  # noqa: SLF001
                if oferta.destination != iata:
                    continue
                oferta.destination_name = oferta.destination_name or ciudad
                oferta.destination_country = oferta.destination_country or pais
                anterior = encontradas.get(oferta.id)
                if anterior is None or oferta.price < anterior.price:
                    encontradas[oferta.id] = oferta
        except Exception as exc:  # noqa: BLE001 - una ventana fallida no tumba la busqueda
            log.warning("Busqueda %s %s: %s", iata, salida, exc)
            resultado.errors.append(f"{salida}: {exc}")

    ofertas = list(encontradas.values())
    for o in ofertas:
        score_offer(o, history, route, weekend_cfg)
        o.useful_hours = useful_hours(o)
    if req.max_price:
        ofertas = [o for o in ofertas if o.price <= req.max_price]

    ofertas.sort(key=lambda o: o.price)
    resultado.offers = ofertas[:25]
    log.info("Busqueda %s: %d viajes dentro de presupuesto", iata, len(resultado.offers))
    return resultado
