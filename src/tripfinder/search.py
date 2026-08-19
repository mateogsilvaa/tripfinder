"""Busqueda personalizada: "un finde en Roma por menos de 120 €, cuando sea".

Es el reverso del scan automatico. El scan pregunta "que hay barato ahora mismo";
esto pregunta "cuando puedo permitirme ESTE viaje", y para responder recorre
fin de semana a fin de semana hasta donde haga falta, aunque sea el año que viene.
"""

from __future__ import annotations

import logging
import re
import unicodedata
from dataclasses import asdict, dataclass, field
from datetime import date, timedelta
from typing import Any

from . import routes as rutas
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
        """Nombre del fichero. Tiene que distinguir DOS busquedas distintas.

        Antes solo entraban origen, destino, noches y tope de precio: buscar
        "donde sea por 300 EUR" el 6 de noviembre y otra vez para diciembre
        daba el mismo `mad-todos-23-300`, la segunda pisaba a la primera y en
        la web parecia que las busquedas se borraban solas. Ahora entran
        tambien las fechas (o el horizonte y el tipo de barrido) y la gente,
        que es lo que de verdad hace que dos busquedas sean distintas.
        """
        partes = [self.origin, self.destination or "todos", f"{self.nights_min}{self.nights_max}"]
        if self.max_price:
            partes.append(str(int(self.max_price)))
        if self.depart:
            partes.append(self.depart.replace("-", ""))
            if self.return_date:
                partes.append(self.return_date.replace("-", ""))
        else:
            partes.append(f"{int(self.months)}m")
            partes.append("finde" if self.weekend_only else "libre")
        partes.append(f"{max(1, int(self.adults))}p")
        return re.sub(r"[^A-Za-z0-9-]", "", "-".join(partes)).lower()

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
                 "country": {"name": a["pais"]}, "cont": a.get("cont", "")}
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


def _norm(texto: str) -> str:
    """Sin acentos, en minusculas y sin espacios de sobra.

    `airports_world.json` mezcla idiomas sin ningun criterio: los paises estan
    casi todos en español ("Japon", "Tailandia") pero las ciudades vienen en
    ingles la mitad de las veces ("New York", "Seoul", "Cairo"), y algunas ni
    siquiera son la ciudad sino el municipio del aeropuerto ("Sepang" por Kuala
    Lumpur, "Kuta, Badung" por Bali). Comparar en crudo hacia que "Nueva York"
    o "Sofia" no existieran.
    """
    limpio = unicodedata.normalize("NFKD", (texto or "").strip().lower())
    return " ".join("".join(c for c in limpio if not unicodedata.combining(c)).split())


# Como se dicen en español los sitios que el listado guarda en ingles (o con el
# nombre del municipio). Van a IATA directamente: es lo unico que no se presta
# a interpretaciones.
ALIAS: dict[str, str] = {
    "nueva york": "JFK", "new york": "JFK", "nueva jersey": "EWR",
    "los angeles": "LAX", "san francisco": "SFO", "chicago": "ORD",
    "washington": "IAD", "boston": "BOS", "miami": "MIA", "orlando": "MCO",
    "toronto": "YYZ", "montreal": "YUL", "vancouver": "YVR",
    "ciudad de mexico": "MEX", "mexico df": "MEX", "cancun": "CUN",
    "la habana": "HAV", "habana": "HAV", "punta cana": "PUJ",
    "buenos aires": "EZE", "sao paulo": "GRU", "rio de janeiro": "GIG",
    "bogota": "BOG", "lima": "LIM", "santiago de chile": "SCL",
    "tokio": "HND", "tokyo": "HND", "osaka": "KIX", "kioto": "KIX",
    "seul": "ICN", "pekin": "PEK", "pequin": "PEK", "shanghai": "PVG",
    "hong kong": "HKG", "taipei": "TPE", "taipeh": "TPE",
    "nueva delhi": "DEL", "delhi": "DEL", "bombay": "BOM", "mumbai": "BOM",
    "bangkok": "BKK", "singapur": "SIN", "kuala lumpur": "KUL",
    "bali": "DPS", "yakarta": "CGK", "saigon": "SGN", "ho chi minh": "SGN",
    "hanoi": "HAN", "manila": "MNL", "maldivas": "MLE",
    "dubai": "DXB", "abu dabi": "AUH", "doha": "DOH", "estambul": "IST",
    "tel aviv": "TLV", "el cairo": "CAI", "cairo": "CAI",
    "johannesburgo": "JNB", "ciudad del cabo": "CPT", "nairobi": "NBO",
    "sidney": "SYD", "sydney": "SYD", "melbourne": "MEL", "auckland": "AKL",
}

# Un continente puede ser mas de uno: "America" a secas son las dos.
CONTINENTES: dict[str, tuple[str, ...]] = {
    "europa": ("Europa",),
    "asia": ("Asia",),
    "africa": ("Africa",),
    "america": ("America del Norte", "America del Sur"),
    "las americas": ("America del Norte", "America del Sur"),
    "america del norte": ("America del Norte",),
    "norteamerica": ("America del Norte",),
    "america del sur": ("America del Sur",),
    "sudamerica": ("America del Sur",),
    "suramerica": ("America del Sur",),
    "latinoamerica": ("America del Sur", "America del Norte"),
    "oceania": ("Oceania",),
    "australia y oceania": ("Oceania",),
}


def _hubs_del_continente(continentes: tuple[str, ...], cfg: Config) -> list[tuple[str, str, str]]:
    """Los aeropuertos que merece la pena mirar de un continente entero.

    Asia tiene 956 aeropuertos en el listado: preguntarlos todos no es una
    busqueda, es un castigo. Se usan los que ya estan elegidos a mano en el
    YAML (`long_haul.destinations` y `city_names`), que son justamente los
    grandes, y se filtran por continente.
    """
    candidatos = list(cfg.long_haul.get("destinations", []) or []) + list(cfg.city_names)
    salida: list[tuple[str, str, str]] = []
    vistos = set()
    for a in _airport_directory():
        code = a["code"]
        if code in vistos or code not in candidatos:
            continue
        if _norm(a.get("cont", "")) not in {_norm(c) for c in continentes}:
            continue
        vistos.add(code)
        salida.append(
            (
                code,
                (a.get("city") or {}).get("name") or a.get("name", code),
                (a.get("country") or {}).get("name", ""),
            )
        )
    return salida


def resolve_many(texto: str, cfg: Config) -> list[tuple[str, str, str]]:
    """Como resolve_destination pero admite un pais entero.

    Escribir "Alemania" antes reventaba la busqueda; ahora devuelve todos los
    aeropuertos de ese pais y se buscan todos.
    """
    objetivo = _norm(texto)

    # Un continente entero: solo sus hubs, o la busqueda no termina nunca.
    if objetivo in CONTINENTES:
        hubs = _hubs_del_continente(CONTINENTES[objetivo], cfg)
        if hubs:
            log.info("'%s' es un continente: %d hubs", texto, len(hubs))
            return hubs
        raise ValueError(
            f"No hay ningun destino de {texto} en la lista. Añade alguno a "
            f"`long_haul.destinations` o `city_names` en config/watchlist.yml."
        )

    paises = []
    for a in _airport_directory():
        pais = _norm((a.get("country") or {}).get("name") or "")
        if pais and pais == objetivo:
            paises.append(
                (
                    a["code"],
                    (a.get("city") or {}).get("name") or a.get("name", a["code"]),
                    (a.get("country") or {}).get("name", ""),
                )
            )
    if paises:
        # Ordenar importa: sin esto, "Japon" devolvia Akita, Tokunoshima y
        # Amami —los doce primeros por codigo— y ni rastro de Tokio. Van
        # delante los que estan elegidos a mano en el YAML.
        conocidos = set(cfg.long_haul.get("destinations", []) or []) | set(cfg.city_names)
        paises.sort(key=lambda a: a[0] not in conocidos)
        log.info("'%s' es un pais: %d aeropuertos", texto, len(paises))
        return paises[:12]
    return [resolve_destination(texto, cfg)]


def sugerencias(texto: str, limite: int = 6) -> list[str]:
    """Nombres parecidos, para cuando no se reconoce lo que se ha escrito."""
    objetivo = _norm(texto)[:4]
    if not objetivo:
        return []
    vistos = []
    for a in _airport_directory():
        ciudad = (a.get("city") or {}).get("name") or a.get("name", "")
        if _norm(ciudad).startswith(objetivo) and ciudad not in vistos:
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

    objetivo = _norm(texto)

    # "Nueva York", "Tokio", "Pekin": el listado los guarda en ingles o con el
    # nombre del municipio, asi que se traducen a IATA antes de buscar.
    if objetivo in ALIAS:
        iata = ALIAS[objetivo]
        for a in _airport_directory():
            if a["code"] == iata:
                return (
                    iata,
                    (a.get("city") or {}).get("name") or texto.strip(),
                    (a.get("country") or {}).get("name", ""),
                )
        return iata, texto.strip(), ""

    for iata, (ciudad, pais) in cfg.city_names.items():
        if _norm(ciudad) == objetivo or objetivo in _norm(ciudad):
            return iata, ciudad, pais

    candidatos = []
    for a in _airport_directory():
        nombre = _norm(a.get("name") or "")
        ciudad = _norm((a.get("city") or {}).get("name") or "")
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


def _google_candidatas(
    universo: dict[str, tuple[str, str]],
    fechas: list[tuple[date, date]],
    encontradas: dict[str, FlightOffer],
    presupuesto: int,
) -> list[tuple[str, date, date]]:
    """Reparte las consultas de Google entre descubrir y contrastar.

    Dos trabajos distintos con la misma herramienta:

    * **Descubrir**: destinos de los que no tenemos ni un precio. Ryanair y Wizz
      solo saben de sus propias rutas, asi que Milan con ITA, Turin con Vueling
      o Bucarest con Tarom solo aparecen si se pregunta aqui. Se lleva la mayor
      parte del presupuesto, porque es donde estaba el agujero.
    * **Contrastar**: destinos que ya tienen precio de bajo coste, por si otra
      compania lo mejora (o por si el directo de Ryanair sale a las 6:00 y hay
      un Iberia decente por poco mas).

    Las fechas cercanas van primero: si el presupuesto se acaba, que se acabe
    en marzo del año que viene y no en el finde que viene.
    """
    con_precio = {(o.destination, o.depart_date) for o in encontradas.values()}
    descubrir: list[tuple[str, date, date]] = []
    contrastar: list[tuple[str, date, date]] = []
    for salida, regreso in fechas:
        for iata in universo:
            par = (iata, salida, regreso)
            if (iata, salida.isoformat()) in con_precio:
                contrastar.append(par)
            else:
                descubrir.append(par)

    # Lo barato primero al contrastar: mejorar una oferta de 90 EUR interesa mas
    # que mejorar una de 600 que no va a comprar nadie.
    precios = {(o.destination, o.depart_date): o.price for o in encontradas.values()}
    contrastar.sort(key=lambda c: precios.get((c[0], c[1].isoformat()), 1e9))

    # Cuanto se guarda para contrastar. Con fecha fija casi todo va a descubrir:
    # son ~100 destinos de un solo dia y caben. Con un barrido de findes a doce
    # meses no cabe ni de lejos, asi que descubrir se queda en el primer finde y
    # el peso se va a contrastar, que si mira todas las fechas porque ordena las
    # ofertas por precio, vengan del dia que vengan.
    reserva = max(presupuesto // (4 if len(fechas) <= 2 else 2), 6)
    reserva = min(reserva, len(contrastar))  # sin nada que contrastar no se guarda nada
    elegidas = descubrir[: max(presupuesto - reserva, 0)]
    elegidas += contrastar[: presupuesto - len(elegidas)]
    # Si una de las dos listas se ha quedado corta, la otra rellena el hueco en
    # vez de devolver el presupuesto a medio gastar.
    if len(elegidas) < presupuesto:
        ya = set(elegidas)
        elegidas += [c for c in descubrir + contrastar if c not in ya][
            : presupuesto - len(elegidas)
        ]
    return elegidas[:presupuesto]


def run_search(req: SearchRequest, cfg: Config, history: dict, max_queries: int = 45) -> SearchResult:
    """Busca el viaje pedido en todas las fuentes disponibles.

    El orden no es casual:

    1. **Ryanair y Wizz** (APIs propias, rapidas y baratas) barren todas las
       fechas candidatas de una tacada. Dan precio, hora y enlace de reserva.
    2. **Google Flights** cubre el resto del mapa: una consulta por destino y
       fecha, empezando por los destinos de los que aun no se sabe nada.

    Antes solo existia el paso 1 con Ryanair, y Google se limitaba a repasar los
    destinos que Ryanair ya habia devuelto. Por eso una busqueda "donde sea"
    para el 6 de noviembre daba seis resultados mientras Skyscanner enseñaba
    Pisa, Bucarest o Milan mas baratos: no es que se descartaran, es que no se
    llegaban a mirar.
    """
    # Sin destino se busca a todas partes: "un finde donde sea, por menos de X".
    if req.destination.strip():
        encontrados_dest = resolve_many(req.destination, cfg)
        destinos: Any = [d[0] for d in encontrados_dest]
        iata = destinos[0] if len(destinos) == 1 else ""
        ciudad, pais = (encontrados_dest[0][1], encontrados_dest[0][2]) if iata else ("", "")
        nombres_dest = {d[0]: (d[1], d[2]) for d in encontrados_dest}
        universo = dict(nombres_dest)
    else:
        iata, ciudad, pais = "", "", ""
        destinos = "any"
        nombres_dest = {}
        # A donde se puede volar de verdad desde el origen, vuele quien vuele.
        # Esta es la lista que antes decidia Ryanair el solo.
        universo = rutas.destinos(req.origin, cfg)

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
    ryanair = next((p for p in activos if p.name == "ryanair"), None)
    wizz = next((p for p in activos if p.name == "wizzair"), None)
    google = next((p for p in activos if p.name == "google_flights"), None)

    resultado = SearchResult(request=req, generated_at=date.today().isoformat())
    if ryanair is None and google is None:
        resultado.errors.append("no hay ningun proveedor de vuelos disponible")
        return resultado

    fechas = _candidate_trips(req, weekend_cfg)[:max_queries]
    log.info(
        "Busqueda %s: %d ventanas y %d destinos posibles, hasta %s",
        iata or "cualquier destino",
        len(fechas),
        len(universo),
        fechas[-1][0] if fechas else "?",
    )

    encontradas: dict[str, FlightOffer] = {}

    def anotar(oferta: FlightOffer) -> None:
        n, pa = universo.get(oferta.destination, (ciudad, pais))
        oferta.destination_name = oferta.destination_name or n or oferta.destination
        oferta.destination_country = oferta.destination_country or pa
        anterior = encontradas.get(oferta.id)
        if anterior is None or oferta.price < anterior.price:
            encontradas[oferta.id] = oferta

    # -- 1. Ryanair -------------------------------------------------------
    if ryanair is not None:
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
                    anotar(oferta)
            except Exception as exc:  # noqa: BLE001 - una ventana fallida no tumba la busqueda
                log.warning("Busqueda %s %s: %s", iata, salida, exc)
                resultado.errors.append(f"{salida}: {exc}")
    else:
        resultado.errors.append("ryanair no disponible")

    # -- 2. Wizz Air ------------------------------------------------------
    # Es la que vuela a Bucarest, Sofia, Tirana o Cluj desde Madrid: justo los
    # destinos que no aparecian por ningun lado.
    if wizz is not None:
        try:
            for oferta in wizz.buscar_fechas(route, list(nombres_dest), fechas):
                anotar(oferta)
        except Exception as exc:  # noqa: BLE001
            log.warning("Busqueda: Wizz fallo (%s)", exc)
            resultado.errors.append(f"wizzair: {exc}")

    # -- 3. Google Flights -------------------------------------------------
    # Aqui salen Iberia, Vueling, ITA, Lufthansa, Tarom, Aer Lingus... todo lo
    # que no tiene una API publica que preguntar.
    if google is not None and universo:
        presupuesto = int(cfg.search.get("google", {}).get("max_queries_search", 90))
        candidatas = _google_candidatas(universo, fechas, encontradas, presupuesto)
        google.shortlist, google.names = candidatas, dict(universo)
        google.limite = presupuesto
        try:
            for oferta in google.search(route):
                anotar(oferta)
        except Exception as exc:  # noqa: BLE001
            log.warning("Busqueda: Google fallo (%s)", exc)
            resultado.errors.append(f"google: {exc}")
        if getattr(google, "bloqueado", False):
            resultado.errors.append("Google devolvio paginas vacias: puede faltar alguna aerolinea")

    ofertas = list(encontradas.values())
    for o in ofertas:
        score_offer(o, history, route, weekend_cfg)
        o.useful_hours = useful_hours(o)
    if req.max_price:
        ofertas = [o for o in ofertas if o.price <= req.max_price]

    # Ryanair, Wizz y Google devuelven el mismo viaje: se fusionan por ruta y
    # fecha como en el scan, quedandose con la mas barata y guardando el resto
    # como alternativa. Sin esto cada destino salia varias veces en la lista.
    from .cli import _dedupe

    ofertas = _dedupe(ofertas)
    ofertas.sort(key=lambda o: o.price)
    resultado.offers = ofertas[:60]
    log.info(
        "Busqueda %s: %d viajes dentro de presupuesto (%d tarifas vistas)",
        iata or "cualquier destino",
        len(resultado.offers),
        len(encontradas),
    )
    return resultado
