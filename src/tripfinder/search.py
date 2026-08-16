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
    depart: str = ""  # fecha exacta de ida (ISO); si esta, manda sobre todo lo demas
    return_date: str = ""

    @property
    def slug(self) -> str:
        base = f"{self.origin}-{self.destination or 'todos'}-{self.nights_min}{self.nights_max}"
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


AIRPORTS_URL = "https://www.ryanair.com/api/views/locate/5/airports/es/active"


def _airport_directory() -> list[dict]:
    """Todos los aeropuertos con nombre en español, cacheados en disco.

    Sirve para que el buscador acepte "Palermo" o "Cracovia" sin tener que
    mantener a mano una lista de ciudades en el YAML.
    """
    from .config import DATA_DIR
    from .util import get_json

    # El listado mundial manda; el de Ryanair queda de reserva.
    mundial = DATA_DIR / "airports_world.json"
    if mundial.exists():
        import json

        try:
            crudo = json.loads(mundial.read_text(encoding="utf-8"))
            return [
                {"code": a["code"], "city": {"name": a["ciudad"]}, "name": a["ciudad"],
                 "country": {"name": a["pais"]}}
                for a in crudo
            ]
        except (json.JSONDecodeError, KeyError):
            pass

    cache = DATA_DIR / "airports.json"
    if cache.exists():
        import json

        try:
            return json.loads(cache.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    try:
        datos = get_json(AIRPORTS_URL, throttle_key="ryanair", min_interval=1)
    except Exception as exc:  # noqa: BLE001 - sin lista se sigue con city_names
        log.warning("No se pudo bajar la lista de aeropuertos: %s", exc)
        return []
    import json

    cache.write_text(json.dumps(datos, ensure_ascii=False), encoding="utf-8")
    return datos


def resolve_many(texto: str, cfg: Config) -> list[tuple[str, str, str]]:
    """Como resolve_destination pero admite un pais entero.

    Escribir "Alemania" antes reventaba la busqueda; ahora devuelve todos los
    aeropuertos de ese pais y se buscan todos.
    """
    objetivo = (texto or "").strip().lower()
    paises = []
    for a in _airport_directory():
        pais = ((a.get("country") or {}).get("name") or "").lower()
        if pais and pais == objetivo:
            paises.append(
                (
                    a["code"],
                    (a.get("city") or {}).get("name") or a.get("name", a["code"]),
                    (a.get("country") or {}).get("name", ""),
                )
            )
    if paises:
        log.info("'%s' es un pais: %d aeropuertos", texto, len(paises))
        return paises[:12]
    return [resolve_destination(texto, cfg)]


def sugerencias(texto: str, limite: int = 6) -> list[str]:
    """Nombres parecidos, para cuando no se reconoce lo que se ha escrito."""
    objetivo = (texto or "").strip().lower()[:4]
    if not objetivo:
        return []
    vistos = []
    for a in _airport_directory():
        ciudad = (a.get("city") or {}).get("name") or a.get("name", "")
        if ciudad.lower().startswith(objetivo) and ciudad not in vistos:
            vistos.append(f"{ciudad} ({a['code']})")
        if len(vistos) >= limite:
            break
    return vistos


def resolve_destination(texto: str, cfg: Config) -> tuple[str, str, str]:
    """De lo que escriba el usuario saca (IATA, ciudad, pais).

    Acepta el codigo IATA, un nombre de `city_names` o el nombre de cualquier
    aeropuerto o ciudad de la red, para no obligar a nadie a saberse los codigos.
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

    candidatos = []
    for a in _airport_directory():
        nombre = (a.get("name") or "").lower()
        ciudad = ((a.get("city") or {}).get("name") or "").lower()
        if objetivo in (nombre, ciudad):
            candidatos.insert(0, a)  # coincidencia exacta primero
        elif objetivo in nombre or objetivo in ciudad:
            candidatos.append(a)
    if candidatos:
        a = candidatos[0]
        return (
            a["code"],
            (a.get("city") or {}).get("name") or a.get("name", a["code"]),
            (a.get("country") or {}).get("name", ""),
        )

    pistas = sugerencias(texto)
    extra = f" Quiza querias: {', '.join(pistas)}." if pistas else ""
    raise ValueError(
        f"No se reconoce el destino {texto!r}. Usa el codigo IATA (FCO), el nombre "
        f"de la ciudad o el de un pais entero.{extra}"
    )


def _candidate_trips(req: SearchRequest, weekend_cfg: dict) -> list[tuple[date, date]]:
    """Fechas a probar: los findes del horizonte, o el dia 1 y 15 de cada mes."""
    hoy = date.today()
    fin = hoy + timedelta(days=int(req.months * 30.4))

    # Fechas exactas: si el usuario ya sabe cuando viaja, no hay nada que barrer.
    if req.depart:
        try:
            ida = date.fromisoformat(req.depart)
            vuelta = (
                date.fromisoformat(req.return_date)
                if req.return_date
                else ida + timedelta(days=req.nights_min)
            )
            return [(ida, vuelta)]
        except ValueError:
            log.warning("Fechas exactas invalidas (%s / %s), se ignoran", req.depart, req.return_date)

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
    # Sin destino se busca a todas partes: "un finde donde sea, por menos de X".
    if req.destination.strip():
        encontrados_dest = resolve_many(req.destination, cfg)
        destinos: Any = [d[0] for d in encontrados_dest]
        iata = destinos[0] if len(destinos) == 1 else ""
        ciudad, pais = (encontrados_dest[0][1], encontrados_dest[0][2]) if iata else ("", "")
        nombres_dest = {d[0]: (d[1], d[2]) for d in encontrados_dest}
    else:
        iata, ciudad, pais = "", "", ""
        destinos = "any"
        nombres_dest = {}

    route = Route(
        origin=req.origin,
        origin_name="Madrid",
        destinations=destinos,
        max_price=req.max_price or 1e6,
        max_price_weekend=req.max_price or 1e6,
        # Sin referencia inventada: si no hay historico de la ruta no hay
        # descuento que ensenar. Antes salia "-90%" comparando con un numero
        # sacado del propio presupuesto, que no significaba nada.
        baseline_price=0,
        baseline_price_weekend=0,
    )

    # El precio se pide para todo el grupo, que es como se compara de verdad.
    search_cfg = {**cfg.search, "adults": max(1, req.adults)}
    weekend_cfg = cfg.weekend
    activos = build_providers(cfg.providers, search_cfg)
    proveedores = [p for p in activos if p.name == "ryanair"]
    google = next((p for p in activos if p.name == "google_flights"), None)

    resultado = SearchResult(request=req, generated_at=date.today().isoformat())
    if not proveedores:
        resultado.errors.append("ryanair no disponible")
        return resultado
    ryanair = proveedores[0]

    fechas = _candidate_trips(req, weekend_cfg)[:max_queries]
    log.info(
        "Busqueda %s: %d ventanas hasta %s",
        iata or "cualquier destino",
        len(fechas),
        fechas[-1][0] if fechas else "?",
    )

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
            for oferta in ryanair._paginate(params, route, 60):  # noqa: SLF001
                if nombres_dest and oferta.destination not in nombres_dest:
                    continue
                n, pa = nombres_dest.get(oferta.destination, (ciudad, pais))
                oferta.destination_name = oferta.destination_name or n or oferta.destination
                oferta.destination_country = oferta.destination_country or pa
                anterior = encontradas.get(oferta.id)
                if anterior is None or oferta.price < anterior.price:
                    encontradas[oferta.id] = oferta
        except Exception as exc:  # noqa: BLE001 - una ventana fallida no tumba la busqueda
            log.warning("Busqueda %s %s: %s", iata, salida, exc)
            resultado.errors.append(f"{salida}: {exc}")

    # Ryanair no vuela a todo ni es siempre el mas barato: Wizz, Iberia o Vueling
    # solo aparecen si se pregunta a Google, y antes la busqueda no lo hacia.
    if google is not None:
        if nombres_dest:
            # Google mira las mismas fechas que Ryanair (hasta 12 ventanas por
            # destino): si solo se le dieran 6, la lista final volveria a ser
            # casi toda de Ryanair por cobertura, no por precio.
            candidatas = [
                (d, s, r) for d in list(nombres_dest)[:4] for s, r in fechas[:12]
            ]
            nombres = dict(nombres_dest)
        else:
            mejores = sorted(encontradas.values(), key=lambda o: o.price)[:14]
            candidatas = [
                (o.destination, date.fromisoformat(o.depart_date), date.fromisoformat(o.return_date))
                for o in mejores
                if o.return_date
            ]
            nombres = {o.destination: (o.destination_name, o.destination_country) for o in mejores}
        google.shortlist, google.names = candidatas, nombres
        try:
            for oferta in google.search(route):
                anterior = encontradas.get(oferta.id)
                if anterior is None or oferta.price < anterior.price:
                    encontradas[oferta.id] = oferta
        except Exception as exc:  # noqa: BLE001
            log.warning("Busqueda: Google fallo (%s)", exc)
            resultado.errors.append(f"google: {exc}")

    ofertas = list(encontradas.values())
    for o in ofertas:
        score_offer(o, history, route, weekend_cfg)
        o.useful_hours = useful_hours(o)
    if req.max_price:
        ofertas = [o for o in ofertas if o.price <= req.max_price]

    # Ryanair y Google devuelven el mismo viaje: se fusionan por ruta y fecha
    # como en el scan, quedandose con la mas barata y guardando el resto como
    # alternativa. Sin esto cada destino salia dos veces en la lista.
    from .cli import _dedupe

    ofertas = _dedupe(ofertas)
    ofertas.sort(key=lambda o: o.price)
    resultado.offers = ofertas[:40]
    log.info(
        "Busqueda %s: %d viajes dentro de presupuesto",
        iata or "cualquier destino",
        len(resultado.offers),
    )
    return resultado
