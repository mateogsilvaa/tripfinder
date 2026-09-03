"""Interfaz de linea de comandos. Es lo que ejecutan los workflows de Actions."""

from __future__ import annotations

import argparse
import json
import logging
import random
import sys
from datetime import date, timedelta
from pathlib import Path

from .config import Config, Route, load_config, site_url
from .models import FlightOffer, StayOffer
from .providers import build_providers
from .scoring import is_deal, score_offer, should_notify
from .stays import StayRequest, build_stay_providers
from .store import Store

log = logging.getLogger("tripfinder")


def _setup_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(levelname)s %(message)s",
        stream=sys.stdout,
    )


def _shortlist(found: list[FlightOffer], cfg: Config, limit: int) -> tuple[list, dict]:
    """Destinos y fechas que merece la pena contrastar con otras aerolineas.

    Tres fuentes, en este orden:

    1. Lo que ya han encontrado los demas providers, por si otra compania lo
       mejora.
    2. Los destinos declarados en el YAML: a esos vuelan Iberia o Vueling
       aunque Ryanair no los ofrezca.
    3. El resto del mapa de rutas del origen. Este es el que faltaba. Sin el,
       un destino solo se miraba si Ryanair lo volaba o si estaba escrito a
       mano en la config, y todo lo demas era invisible por definicion.

    Como el presupuesto de consultas no da para el mapa entero en una tanda, el
    bloque 3 se baraja con la fecha como semilla: cada scan mira un trozo
    distinto y en unos dias se ha recorrido todo, sin repetir siempre los
    mismos veinte.
    """
    pairs: list[tuple[str, date, date]] = []
    names: dict[str, tuple[str, str]] = {}

    vistos: dict[tuple, FlightOffer] = {}
    for o in sorted(found, key=lambda x: (not x.weekend, -x.score)):
        if o.return_date:
            vistos.setdefault((o.destination, o.depart_date, o.return_date), o)
    for o in list(vistos.values())[: limit // 2]:
        pairs.append((o.destination, date.fromisoformat(o.depart_date), date.fromisoformat(o.return_date)))
        names[o.destination] = (
            o.destination_name or cfg.city_names.get(o.destination, (o.destination, ""))[0],
            o.destination_country or cfg.city_names.get(o.destination, ("", ""))[1],
        )

    weekend = cfg.weekend
    findes = _next_weekends(
        int(weekend.get("outbound_weekday", 4)),
        int(weekend.get("inbound_weekday", 6)),
        weeks=4,
    )

    declarados = [d for r in cfg.routes for d in r.dest_list]
    universo: dict[str, tuple[str, str]] = {}
    origen = cfg.routes[0].origin if cfg.routes else "MAD"
    try:
        from . import routes as rutas

        universo = rutas.destinos(origen, cfg)
    except Exception as exc:  # noqa: BLE001 - sin mapa se sigue con lo declarado
        log.warning("No se pudo montar el mapa de rutas de %s: %s", origen, exc)

    resto = [d for d in universo if d not in declarados]
    random.Random(date.today().toordinal()).shuffle(resto)
    candidatos = declarados + resto

    ya = {(p[0], p[1], p[2]) for p in pairs}
    for out_date, in_date in findes:
        for dest in candidatos:
            if len(pairs) >= limit:
                break
            if (dest, out_date, in_date) not in ya:
                pairs.append((dest, out_date, in_date))
                ya.add((dest, out_date, in_date))
                names.setdefault(dest, universo.get(dest) or cfg.city_names.get(dest, (dest, "")))
    return pairs[:limit], names


def _next_weekends(out_day: int, in_day: int, weeks: int) -> list[tuple[date, date]]:
    today = date.today()
    first = today + timedelta(days=(out_day - today.weekday()) % 7 or 7)
    nights = (in_day - out_day) % 7 or 7
    return [
        (first + timedelta(days=7 * i), first + timedelta(days=7 * i + nights))
        for i in range(weeks)
    ]


def _dedupe(offers: list[FlightOffer]) -> list[FlightOffer]:
    """Misma ruta y fecha: se queda la mejor.

    "Mejor" = la que encaja con la escapada de finde y, a igualdad, la mas barata.
    Sin esa preferencia, un vuelo de las 06:00 del mismo dia tumbaria al de la tarde
    solo por ser dos euros mas barato.
    """
    def rank(o: FlightOffer) -> tuple[bool, float]:
        return (not o.weekend, o.price)

    # La clave ignora el provider a proposito: si Google encuentra el mismo
    # viaje mas barato con Iberia, esa gana a la tarifa de Ryanair.
    grupos: dict[str, list[FlightOffer]] = {}
    for o in offers:
        grupos.setdefault(f"{o.route_key}-{o.depart_date}", []).append(o)

    ganadoras: list[FlightOffer] = []
    for candidatas in grupos.values():
        candidatas.sort(key=rank)
        mejor = candidatas[0]
        # Las demas companias del mismo viaje se guardan como alternativa en vez
        # de tirarse: "Ryanair 80 €, tambien Vueling 92 € sin equipaje aparte".
        otras: dict[str, FlightOffer] = {}
        for c in candidatas[1:]:
            if c.airline and c.airline != mejor.airline:
                otras.setdefault(c.airline, c)
        # Se guarda la hora porque una alternativa puede ser MAS barata que la
        # ganadora y quedar segunda por salir de madrugada: sin el horario
        # delante, eso parece un error del programa.
        mejor.alternatives = [
            {
                "airline": c.airline,
                "price": c.price,
                "price_per_person": c.price_per_person,
                "adults": c.adults,
                "deep_link": c.airline_link or c.deep_link,
                "depart_time": c.depart_time,
                "weekend": c.weekend,
            }
            for c in sorted(otras.values(), key=lambda x: x.price)[:3]
        ]
        ganadoras.append(mejor)
    return ganadoras


def _nombre_mundial(iata: str) -> tuple[str, str]:
    """Ciudad y pais desde el listado mundial, para que no salga solo "JFK"."""
    from .config import DATA_DIR

    cache = _nombre_mundial.__dict__.setdefault("cache", {})
    if not cache:
        import json

        f = DATA_DIR / "airports_world.json"
        if f.exists():
            try:
                for a in json.loads(f.read_text(encoding="utf-8")):
                    cache[a["code"]] = (a.get("ciudad") or a["code"], a.get("pais", ""))
            except (json.JSONDecodeError, KeyError):
                pass
    return cache.get(iata, (iata, ""))


def _publicables(found: list[FlightOffer], limite: int) -> list[FlightOffer]:
    """Que ofertas van a la web.

    Ordenar por score y cortar por lo sano dejaba fuera cualquier destino donde
    no vuele una low cost: Amsterdam o Zurich nunca van a puntuar como Bergamo.
    Asi que primero entra la mejor de CADA destino y luego se rellena por score.
    """
    mejor_por_destino: dict[str, FlightOffer] = {}
    for o in found:
        actual = mejor_por_destino.get(o.destination)
        if actual is None or o.score > actual.score:
            mejor_por_destino[o.destination] = o

    publicadas = list(mejor_por_destino.values())
    ya = {id(o) for o in publicadas}
    for o in found:
        if len(publicadas) >= limite:
            break
        if id(o) not in ya:
            publicadas.append(o)
    publicadas.sort(key=lambda o: (-o.score, o.price))
    return publicadas


# --------------------------------------------------------------------------- #
# scan-flights
# --------------------------------------------------------------------------- #
def cmd_scan_flights(args: argparse.Namespace) -> int:
    cfg: Config = load_config(args.config)
    store = Store()
    history = store.load_history()
    state = store.load_state()

    providers = build_providers(cfg.providers, cfg.search)
    if not providers:
        log.error("Ningun provider activo. Revisa 'providers:' en el YAML y los secretos.")
        return 1

    min_score = int(cfg.notify.get("min_score", 88))
    weekend_cfg = cfg.weekend
    weekend_mode = str(weekend_cfg.get("mode", "prefer"))
    renotify = float(cfg.notify.get("renotify_drop_pct", 12))

    found: list[FlightOffer] = []
    deals: list[FlightOffer] = []
    errors: list[str] = []

    for route in cfg.routes:
        for provider in providers:
            if provider.name == "google_flights":
                continue  # se ejecuta despues, con la lista corta ya construida
            try:
                results = provider.search(route)
            except Exception as exc:  # noqa: BLE001 - un provider caido no tumba el scan
                msg = f"{provider.name} / {route.origin}: {exc}"
                log.warning("Fallo %s", msg)
                errors.append(msg)
                continue
            for offer in results:
                score_offer(offer, history, route, weekend_cfg)
                found.append(offer)
                if is_deal(offer, route, min_score, weekend_mode):
                    deals.append(offer)

    # Google Flights va al final: contrasta con el resto de aerolineas los
    # destinos y fechas que ya han salido, en vez de buscar a ciegas.
    google = next((p for p in providers if p.name == "google_flights"), None)
    if google is not None:
        pairs, names = _shortlist(found, cfg, int(cfg.search.get("google", {}).get("max_queries", 20)))
        google.shortlist, google.names = pairs, names
        for route in cfg.routes[:1]:  # el origen es el mismo en todas
            try:
                for offer in google.search(route):
                    score_offer(offer, history, route, weekend_cfg)
                    found.append(offer)
                    if is_deal(offer, route, min_score, weekend_mode):
                        deals.append(offer)
            except Exception as exc:  # noqa: BLE001
                log.warning("Google Flights fallo: %s", exc)
                errors.append(f"google_flights: {exc}")
        if getattr(google, "bloqueado", False):
            errors.append(
                "Google Flights devolvio casi todo vacio: probable limite de peticiones. "
                "Esta tanda trae menos aerolineas de lo normal."
            )

    # Otros continentes: estancias largas y presupuesto propio. Van aparte
    # porque un vuelo a Bangkok jamas competira con un finde a Bergamo, pero
    # un ofertón de largo radio no se puede dejar pasar.
    lh = cfg.long_haul
    if google is not None and lh.get("enabled", True) and lh.get("destinations"):
        noches = int(lh.get("nights", 8))
        pares, nombres = [], {}
        for i in range(int(lh.get("months", 8))):
            salida = date.today() + timedelta(days=30 * (i + 1))
            for dest in lh["destinations"]:
                pares.append((dest, salida, salida + timedelta(days=noches)))
                nombres[dest] = cfg.city_names.get(dest) or _nombre_mundial(dest)
        google.shortlist = pares[: int(lh.get("max_queries", 16))]
        google.names.update(nombres)
        ruta_lh = Route(
            origin=cfg.routes[0].origin,
            origin_name=cfg.routes[0].origin_name,
            destinations=list(lh["destinations"]),
            max_price=float(lh.get("max_price", 650)),
            max_price_weekend=float(lh.get("max_price", 650)),
            baseline_price=float(lh.get("max_price", 650)) * 1.6,
            baseline_price_weekend=float(lh.get("max_price", 650)) * 1.6,
        )
        try:
            for offer in google.search(ruta_lh):
                offer.long_haul = True
                score_offer(offer, history, ruta_lh, weekend_cfg)
                found.append(offer)
                if is_deal(offer, ruta_lh, min_score, "prefer"):
                    deals.append(offer)
        except Exception as exc:  # noqa: BLE001
            log.warning("Largo radio fallo: %s", exc)
            errors.append(f"long_haul: {exc}")

    for o in found:
        if not o.destination_name or o.destination_name == o.destination:
            o.destination_name, pais = _nombre_mundial(o.destination)
            o.destination_country = o.destination_country or pais

    found = _dedupe(found)
    deals = _dedupe(deals)
    found.sort(key=lambda o: (-o.score, o.price))
    deals.sort(key=lambda o: (-o.score, o.price))

    findes = sum(1 for o in found if o.weekend)
    print(
        f"\n{len(found)} ofertas ({findes} escapadas de finde), "
        f"{len(deals)} superan score {min_score}"
    )
    for o in deals[:15]:
        marca = "FINDE" if o.weekend else "  ·  "
        horas = f"{o.depart_time or '--:--'}>{o.return_time or '--:--'}"
        print(
            f"  {o.score:3d} {marca} {o.price:7.2f}{o.currency}  "
            f"{o.origin}->{o.destination:<4} {o.depart_date} {horas} "
            f"{o.useful_hours:5.1f}h utiles {o.price_per_hour:5.2f}EUR/h "
            f"(-{o.discount_pct:.0f}%) {o.destination_name}"
        )

    if args.dry_run:
        print("\n--dry-run: no se escribe nada ni se envia email.")
        return 0

    # Dos motivos para escribir: un chollo excepcional en cualquier momento, o
    # el resumen del domingo. Asi no llega un correo cada dia por costumbre.
    max_email = int(cfg.notify.get("max_offers_per_email", 6))
    digest_day = int(cfg.notify.get("digest_weekday", 6))
    digest_min = int(cfg.notify.get("digest_min_score", 70))

    excepcionales = [o for o in deals if should_notify(o, state, renotify)]
    es_dia_de_digest = date.today().weekday() == digest_day
    if excepcionales:
        to_notify, motivo = excepcionales, "chollo excepcional"
    elif es_dia_de_digest:
        to_notify = [o for o in deals if o.score >= digest_min][:max_email]
        motivo = "resumen semanal"
    else:
        to_notify, motivo = [], ""
    if to_notify:
        log.info("Motivo del aviso: %s", motivo)

    caducados = store.purge_expired_stays()
    if caducados:
        print(f"{caducados} busquedas de alojamiento caducadas (el viaje ya paso).")

    store.record_prices(found)
    store.save_offers(_publicables(found, args.limit), errors=errors)
    # El mapa de continentes que usa el filtro de la portada. Sale del listado
    # mundial, que es estatico, asi que casi siempre escribe lo mismo y no
    # genera commit; esta aqui para que no se pueda quedar viejo.
    store.save_continents()
    # Y lo que cuesta dormir en cada sitio, para poder estimar la escapada
    # completa en el tablon sin abrir el panel de alojamiento.
    store.save_beds()

    if args.no_email:
        print(f"{len(to_notify)} ofertas notificables, pero --no-email esta activo.")
        return 0

    # A quien se le manda y que. Cada cuenta decide cada cuanto quiere saber de
    # los chollos y a partir de que precio le interesan; el buzon de la config
    # sigue recibiendo lo de siempre si no hay una cuenta que ya lo cubra.
    reparto = _reparto_de_chollos(deals, to_notify, cfg, state, max_email)
    if not reparto:
        print("Nada nuevo que notificar.")
        return 0

    from .notify import notify_offers  # import tardio: no hace falta para --dry-run

    today = date.today().isoformat()
    enviado_algo = False
    for destino, (batch, motivo_destino) in reparto.items():
        try:
            used = notify_offers(
                batch, to=destino, method=cfg.notify.get("method", "resend")
            )
        except Exception as exc:  # noqa: BLE001
            log.error("No se pudo enviar el email a %s: %s", destino, exc)
            errors.append(f"email {destino}: {exc}")
            continue
        enviado_algo = True
        state.setdefault("digest", {})[destino] = today
        print(f"Aviso enviado por {used} a {destino} ({len(batch)} ofertas, {motivo_destino}).")

    # El registro de "ya te la mande" es global a proposito: marca la oferta como
    # vista, y quien la reciba depende de las preferencias de cada uno. Solo se
    # apunta si de verdad salio algun correo, para no perder un chollo por un
    # fallo de SMTP.
    if enviado_algo:
        for o in to_notify[:max_email]:
            state.setdefault("notified", {})[o.id] = {"price": o.price, "date": today}
    store.save_state(state)
    return 0


def _cada_cuanto(frecuencia: str, ultimo: str) -> bool:
    """Si toca escribir hoy segun lo que pidio esa cuenta."""
    if frecuencia == "nunca":
        return False
    if frecuencia == "cada_vez" or not ultimo:
        return True
    try:
        dias = (date.today() - date.fromisoformat(ultimo[:10])).days
    except ValueError:
        return True
    return dias >= (7 if frecuencia == "semanal" else 1)


def _reparto_de_chollos(
    deals: list[FlightOffer],
    nuevas: list[FlightOffer],
    cfg: Config,
    state: dict,
    max_email: int,
) -> dict[str, tuple[list[FlightOffer], str]]:
    """Que ofertas le tocan hoy a cada buzon.

    Dos cosas distintas conviven aqui: "avisame en cuanto aparezca" manda lo que
    ha salido nuevo hoy, y "una vez al dia" o "a la semana" manda lo mejor que
    hay vivo en ese momento. Si a alguien le llegara solo lo nuevo del dia que
    le toca su resumen, se perderia justo los chollos de los otros seis dias.
    """
    from . import users as U

    ultimos = state.get("digest", {})
    salida: dict[str, tuple[list[FlightOffer], str]] = {}
    buzon_config = (cfg.notify.get("to") or "").strip()
    cubiertos = set()

    for u in U.listar(incluir_inactivos=False):
        correo = (u.email or "").strip()
        if not correo:
            continue
        cubiertos.add(correo.lower())
        frecuencia = str(u.prefs.get("chollos", "cada_vez"))
        if not _cada_cuanto(frecuencia, ultimos.get(correo, "")):
            continue
        tope = u.prefs.get("chollos_max_precio")
        fuente = nuevas if frecuencia == "cada_vez" else deals
        suyas = [o for o in fuente if not tope or o.price <= float(tope)]
        if suyas:
            motivo = "lo nuevo" if frecuencia == "cada_vez" else f"resumen {frecuencia}"
            salida[correo] = (suyas[:max_email], motivo)

    # El buzon de siempre sigue como estaba, salvo que ya haya una cuenta con
    # ese mismo email: entonces manda lo que haya elegido esa cuenta y no se
    # duplica el correo.
    if buzon_config and buzon_config.lower() not in cubiertos and nuevas:
        salida[buzon_config] = (nuevas[:max_email], "lo nuevo")
    return salida


# --------------------------------------------------------------------------- #
# scan-stays
# --------------------------------------------------------------------------- #
def _find_offer(store: Store, offer_id: str) -> FlightOffer | None:
    """Busca la oferta en los tres sitios donde puede estar.

    Antes solo se miraba `offers.json`, que es el resultado del scan diario. Si
    pedias alojamiento para un vuelo salido de una busqueda a mano o de un
    seguimiento —que es lo normal, porque son los que tienen tus fechas— la
    oferta no aparecia: sin ella no hay resumen del viaje completo y, si ademas
    faltaba alguna fecha en la peticion, el comando abortaba y la web se
    quedaba esperando un fichero que no iba a llegar nunca.
    """
    import json as _json

    for o in store.load_offers():
        if o.id == offer_id:
            return o

    for f in sorted(store.searches_dir.glob("*.json"), reverse=True):
        if f.name == "index.json":
            continue
        try:
            datos = _json.loads(f.read_text(encoding="utf-8"))
        except (OSError, _json.JSONDecodeError):
            continue
        for crudo in datos.get("offers", []):
            if crudo.get("id") == offer_id:
                return FlightOffer.from_dict(crudo)

    watch = store.root / "watch.json"
    if watch.exists():
        try:
            datos = _json.loads(watch.read_text(encoding="utf-8"))
        except (OSError, _json.JSONDecodeError):
            datos = {}
        for w in datos.get("watches", []):
            for crudo in w.get("last_offers", []):
                if crudo.get("id") == offer_id:
                    return FlightOffer.from_dict(crudo)

    log.warning("La oferta %s no esta en offers.json, ni en searches, ni en watch.json", offer_id)
    return None


def cmd_scan_stays(args: argparse.Namespace) -> int:
    cfg: Config = load_config(args.config)
    store = Store()
    offer = _find_offer(store, args.offer_id)

    if offer is None and not (args.city and args.checkin):
        log.error(
            "No existe la oferta %s por ningun lado y la peticion no trae "
            "--city/--checkin como alternativa.",
            args.offer_id,
        )
        return 1

    if offer is not None:
        city = args.city or offer.destination_name or offer.destination
        iata = offer.destination
        checkin = args.checkin or offer.depart_date
        checkout = args.checkout or offer.return_date or (
            date.fromisoformat(offer.depart_date) + timedelta(days=3)
        ).isoformat()
        country = args.country or offer.destination_country
    else:
        city, iata = args.city, (args.iata or "")
        checkin = args.checkin
        checkout = args.checkout or (
            date.fromisoformat(args.checkin) + timedelta(days=3)
        ).isoformat()
        country = args.country or ""

    req = StayRequest(
        city=city,
        iata=iata,
        checkin=checkin,
        checkout=checkout,
        adults=args.adults or cfg.adults,
        max_total=args.max_total,
        country=country,
    )

    stays: list[StayOffer] = []
    errors: list[str] = []
    for provider in build_stay_providers(cfg.stay_providers or ["deeplinks"], cfg.search):
        try:
            stays.extend(provider.search(req))
        except Exception as exc:  # noqa: BLE001
            log.warning("Fallo %s: %s", provider.name, exc)
            errors.append(f"{provider.name}: {exc}")

    # Con precio primero y de mas barato a mas caro; los enlaces de busqueda, al final.
    stays.sort(key=lambda s: (s.price_total is None, s.price_total or 0))

    print(f"\n{req.city} {req.checkin} -> {req.checkout} ({req.nights} noches, {req.adults} adultos)")
    for s in stays[:20]:
        price = f"{s.price_total:7.0f}EUR" if s.price_total else "   enlace"
        print(f"  {price}  [{s.provider}] {s.name[:60]}")

    if args.dry_run:
        print("\n--dry-run: no se escribe nada.")
        return 0

    resumen = _trip_summary(offer, stays, req.adults, req)
    if resumen:
        print(
            f"\nEscapada completa para {resumen['party']}: {resumen['total']:.0f} EUR "
            f"({resumen['per_person']:.0f} EUR por cabeza) = vuelos {resumen['flights']:.0f} "
            f"+ alojamiento {resumen['stay']:.0f}"
        )

    path = store.save_stays(
        args.offer_id, offer, stays, req.checkin, req.checkout, errors, summary=resumen
    )
    # Cada busqueda de cama mejora la estimacion del tablon: aqui es cuando hay
    # dato nuevo que destilar.
    store.save_beds()
    print(f"\nGuardado en {path}")
    if args.summary_out:
        with open(args.summary_out, "w", encoding="utf-8") as fh:
            fh.write(_stays_markdown(args.offer_id, req, stays, resumen))
    return 0


def _trip_summary(
    offer: FlightOffer | None, stays: list[StayOffer], party: int, req: StayRequest
) -> dict:
    """Lo que de verdad cuesta el finde: vuelos de todos + una cama para todos.

    El precio del vuelo es por persona y el del alojamiento para el grupo entero.
    Sumarlos sin tener eso en cuenta es el error clasico, y es justo el numero
    que nadie te da: cuanto sale la escapada completa por cabeza.
    """
    con_precio = [s.price_total for s in stays if s.price_total]
    if not (offer and con_precio):
        return {}
    vuelos = offer.price * party
    cama = min(con_precio)
    total = vuelos + cama
    return {
        "party": party,
        "flights": round(vuelos, 2),
        "stay": round(cama, 2),
        "total": round(total, 2),
        "per_person": round(total / party, 2),
        "per_person_night": round(total / party / max(1, req.nights), 2),
        "useful_hours": offer.useful_hours,
        "cost_per_useful_hour": (
            round(total / party / offer.useful_hours, 2) if offer.useful_hours else None
        ),
    }


def _stays_markdown(
    offer_id: str, req: StayRequest, stays: list[StayOffer], resumen: dict | None = None
) -> str:
    lines = [
        f"### Alojamiento en {req.city}",
        "",
        f"**{req.checkin} -> {req.checkout}** · {req.nights} noches · {req.adults} adultos",
        "",
        "| Precio total | Por noche | Sitio | Alojamiento |",
        "| ---: | ---: | --- | --- |",
    ]
    if resumen:
        lines[3:3] = [
            (
                f"**Escapada completa para {resumen['party']}: {resumen['total']:.0f} EUR** "
                f"({resumen['per_person']:.0f} EUR por persona) = vuelos {resumen['flights']:.0f} "
                f"+ alojamiento {resumen['stay']:.0f}"
            ),
            "",
        ]
    for s in stays[:15]:
        total = f"{s.price_total:.0f} €" if s.price_total else "—"
        night = f"{s.price_per_night:.0f} €" if s.price_per_night else "—"
        lines.append(f"| {total} | {night} | {s.provider} | [{s.name}]({s.url}) |")
    lines += ["", f"Ver en la web: {site_url()}/?offer={offer_id}"]
    return "\n".join(lines)


# --------------------------------------------------------------------------- #
# search
# --------------------------------------------------------------------------- #
def cmd_search(args: argparse.Namespace) -> int:
    from .search import SearchRequest, run_search

    cfg: Config = load_config(args.config)
    store = Store()

    noches = str(args.nights or "2-3")
    if "-" in noches:
        nmin, nmax = (int(x) for x in noches.split("-", 1))
    else:
        nmin = nmax = int(noches)

    req = SearchRequest(
        destination=args.dest,
        label=args.label or "",
        max_price=args.max_price,
        nights_min=nmin,
        nights_max=nmax,
        months=args.months,
        weekend_only=not args.any_day,
        adults=args.adults or cfg.party_size,
        depart=args.depart or "",
        return_date=getattr(args, "return") or "",
        owner=args.owner or "",
        owner_name=args.owner_name or "",
    )

    try:
        resultado = run_search(req, cfg, store.load_history())
    except ValueError as exc:
        # Un destino que no se reconoce es un aviso para el usuario, no un
        # fallo del sistema: se guarda con el motivo y la web lo enseña.
        log.warning("%s", exc)
        store.save_search(
            {
                "slug": req.slug,
                "label": req.label or args.dest,
                "request": req.to_dict(),
                "generated_at": date.today().isoformat(),
                "errors": [str(exc)],
                "count": 0,
                "owner": req.owner,
                "owner_name": req.owner_name,
                "offers": [],
            }
        )
        print(f"\n{exc}")
        return 0

    print(f"\n{req.label or req.destination}: {len(resultado.offers)} viajes")
    for o in resultado.offers[:12]:
        print(
            f"  {o.price:7.2f}EUR  {o.depart_date} {o.depart_time}>{o.return_time} "
            f"{o.nights}n  {o.useful_hours:5.1f}h utiles  {o.destination_name}"
        )
    if not resultado.offers:
        print("  Nada dentro de ese presupuesto. Prueba a subirlo o ampliar meses.")

    if args.dry_run:
        return 0

    ruta = store.save_search(resultado.to_dict())
    print(f"\nGuardado en {ruta}")
    if args.summary_out:
        with open(args.summary_out, "w", encoding="utf-8") as fh:
            fh.write(_search_markdown(resultado))
    return 0


def _search_markdown(resultado) -> str:
    req = resultado.request
    lines = [
        f"### {req.label or req.destination}",
        "",
        f"Hasta {req.months} meses vista · {req.nights_min}-{req.nights_max} noches"
        + (f" · maximo {req.max_price:.0f} €" if req.max_price else "")
        + (" · solo findes" if req.weekend_only else ""),
        "",
    ]
    if not resultado.offers:
        lines.append("**Nada dentro de ese presupuesto.** Sube el tope o amplia el horizonte.")
        return "\n".join(lines)

    lines += ["| Precio | Fechas | Horario | Viaje real |", "| ---: | --- | --- | ---: |"]
    for o in resultado.offers[:15]:
        lines.append(
            f"| **{o.price:.0f} €** | {o.depart_date} → {o.return_date} ({o.nights}n) | "
            f"{o.depart_time}–{o.return_time} | {o.useful_hours:.0f} h |"
        )
    lines += ["", f"Ver en la web: {site_url()}/?search={req.slug}"]
    return "\n".join(lines)


def cmd_reindex(args: argparse.Namespace) -> int:
    """Rehace data/searches/index.json a partir de los ficheros que haya.

    Con varias busquedas a la vez, dos runs tocan el indice y el rebase choca.
    En vez de resolver el conflicto a mano, se regenera: el indice es un
    derivado, nunca la fuente de la verdad.
    """
    import json as _json

    store = Store()
    ficheros = [f for f in store.searches_dir.glob("*.json") if f.name != "index.json"]
    if ficheros:
        store.save_search(_json.loads(ficheros[0].read_text(encoding="utf-8")))
    else:
        (store.searches_dir / "index.json").write_text(
            _json.dumps({"searches": []}, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    print(f"Indice rehecho con {len(ficheros)} busquedas.")
    return 0


# --------------------------------------------------------------------------- #
# watch
# --------------------------------------------------------------------------- #
def cmd_watch(args: argparse.Namespace) -> int:
    from . import watch as W

    cfg: Config = load_config(args.config)

    if args.accion == "list":
        seguimientos = W.listar(incluir_caducados=True)
        print(f"\n{len(seguimientos)} seguimientos")
        for w in seguimientos:
            estado = "caducado" if w.caducado else "activo"
            print(
                f"  [{estado:8}] {w.id}: {w.label or w.destination or 'donde sea'} "
                f"{w.depart or f'proximos {w.months} meses'} "
                f"{'<= ' + str(int(w.max_price)) + ' EUR' if w.max_price else ''} "
                f"{'(mejor visto ' + str(int(w.best_price)) + ')' if w.best_price else ''}"
            )
        return 0

    if args.accion == "add":
        # El id lleva la cuenta dentro: sin eso, dos personas siguiendo "Roma
        # en marzo" comparten id y la segunda pisa el seguimiento de la primera.
        sufijo = f"-{args.owner.replace('u-', '')}" if args.owner else ""
        ident = (
            args.id or f"{(args.dest or 'todos').lower()}-{args.depart or args.months}{sufijo}"
        )
        W.anadir(
            W.Watch(
                id=ident,
                label=args.label or args.dest or "Donde sea",
                destination=args.dest or "",
                depart=args.depart or "",
                return_date=getattr(args, "return") or "",
                months=args.months,
                nights=args.nights or "2-3",
                weekend_only=not args.any_day,
                adults=args.adults or cfg.party_size,
                max_price=args.max_price,
                owner=args.owner or "",
                owner_name=args.owner_name or "",
            )
        )
        print(f"Seguimiento '{ident}' guardado.")
        return 0

    if args.accion == "remove":
        borrado = W.borrar(args.id or "", args.owner or "")
        print("Borrado." if borrado else "No existe ese seguimiento (o no es tuyo).")
        return 0

    if args.accion == "remove-search":
        borrada = Store().delete_search(args.id or "", args.owner or "")
        print("Busqueda borrada." if borrada else "No existe esa busqueda (o no es tuya).")
        return 0

    # run: lo que ejecuta el cron cada dia
    store = Store()
    caducados = W.limpiar_caducados()
    if caducados:
        print(f"{caducados} seguimientos caducados retirados.")

    # revisar_todos devuelve el estado de TODOS: los que traen algo y los que no.
    estado = W.revisar_todos(cfg, store.load_history())
    hallazgos = [(w, ofertas) for w, ofertas in estado if ofertas]
    print(f"\n{len(estado)} seguimientos revisados, {len(hallazgos)} con novedades")
    for w, ofertas in hallazgos:
        print(f"  {w.label or w.id}:")
        for o in ofertas:
            print(
                f"     {o.price:7.2f}EUR  {o.depart_date} {o.depart_time or ''} "
                f"{o.destination_name} ({o.airline})"
            )

    # El parte va siempre que haya algo que seguir: saber que se ha mirado y
    # no hay nada es informacion, y ademas confirma que el sistema sigue vivo.
    #
    # Un parte por destinatario: si Ana sigue Roma y tu sigues Praga, a Ana no
    # le interesa Praga ni tiene por que enterarse de lo que sigues tu. Los
    # seguimientos sin cuenta (o de una cuenta sin email) van al buzon de
    # siempre, que es como funcionaba esto antes de que hubiera cuentas.
    if estado and not args.no_email:
        hoy = date.today().isoformat()
        state = store.load_state()
        for destino, parte in _partes_por_dueno(estado, cfg, state).items():
            if _mandar_parte(cfg, parte, destino):
                state.setdefault("watch_digest", {})[destino] = hoy
        store.save_state(state)
    return 0


def _partes_por_dueno(estado: list, cfg: Config, state: dict | None = None) -> dict[str, list]:
    """Reparte los seguimientos revisados entre los buzones a los que van.

    Cada cuenta dice cada cuanto quiere el parte y si lo quiere tambien los dias
    en que no hay nada. Lo que no tiene dueño (o cuya cuenta no tiene email) va
    al buzon de la configuracion, como antes de que hubiera cuentas.
    """
    from . import users as U

    ultimos = (state or {}).get("watch_digest", {})
    por_cuenta = {u.id: u for u in U.listar()}
    defecto = (cfg.notify.get("to") or "").strip()
    partes: dict[str, list] = {}
    for w, ofertas in estado:
        cuenta = por_cuenta.get(getattr(w, "owner", "") or "")
        destino = (cuenta.email.strip() if cuenta and cuenta.email else defecto) or defecto
        if not destino:
            continue
        prefs = cuenta.prefs if cuenta and cuenta.email else {}
        if not _cada_cuanto(str(prefs.get("seguimientos", "diario")), ultimos.get(destino, "")):
            continue
        partes.setdefault(destino, []).append((w, ofertas))

    # "Solo cuando haya algo": el parte de "he mirado y no hay nada" confirma que
    # el sistema esta vivo, pero no todo el mundo quiere ese correo cada dia.
    for cuenta in por_cuenta.values():
        correo = (cuenta.email or "").strip()
        if not correo or correo not in partes:
            continue
        if cuenta.prefs.get("seguimientos_solo_novedades") and not any(
            ofertas for _, ofertas in partes[correo]
        ):
            del partes[correo]
    return partes


def _mandar_parte(cfg: Config, estado: list, destinatario: str) -> bool:
    """Manda un parte diario, probando los transportes hasta que uno pase."""
    from .notify import _configured, render

    asunto = render.subject_watch_digest(estado)
    cuerpo = render.render_watch_digest(estado)
    for candidato in [cfg.notify.get("method", "resend"), "resend", "smtp", "github_issue"]:
        try:
            if not _configured(candidato):
                continue
            if candidato == "github_issue":
                from .notify import github_issue

                github_issue.send(asunto, "Parte diario de seguimientos.")
            elif candidato == "resend":
                from .notify import resend

                resend.send(asunto, cuerpo, destinatario)
            else:
                from .notify import smtp

                smtp.send_email(asunto, cuerpo, destinatario)
            print(f"Parte diario enviado por {candidato} a {destinatario or 'el buzon de siempre'}.")
            return True
        except Exception as exc:  # noqa: BLE001
            log.warning("Parte diario por %s fallo: %s", candidato, exc)
    log.error("No se pudo mandar el parte diario de seguimientos a %s", destinatario)
    return False


# --------------------------------------------------------------------------- #
# skiplag
# --------------------------------------------------------------------------- #
def cmd_skiplag(args: argparse.Namespace) -> int:
    from .search import resolve_destination
    from .skiplag import find_hidden_city

    cfg: Config = load_config(args.config)
    store = Store()
    try:
        iata, ciudad, pais = resolve_destination(args.dest, cfg)
    except ValueError as exc:
        log.error("%s", exc)
        return 1

    dia = date.fromisoformat(args.depart)
    directo = args.direct_price
    if directo is None:
        # Referencia: lo mas barato que tengamos guardado para ese dia y destino
        mismos = [
            o.price for o in store.load_offers()
            if o.destination == iata and o.depart_date == args.depart
        ]
        directo = min(mismos) if mismos else None

    hallazgos = find_hidden_city(iata, dia, cfg, directo)
    print(f"\n{ciudad} el {args.depart}: {len(hallazgos)} billetes con escala ahi")
    if directo:
        print(f"  (referencia directa: {directo:.0f} EUR)")
    for h in hallazgos[:10]:
        print(
            f"  {h.price:7.2f}EUR  billete a {h.ticket_to}  sale {h.depart_time}  "
            f"escala de {h.layover_hours} en {h.destination}  {h.airline}"
        )
    if hallazgos:
        print("\n  OJO: solo ida, sin equipaje facturado, y la vuelta del billete se cancela.")

    if args.dry_run or not hallazgos:
        return 0

    ofertas = [h.to_offer(ciudad, pais) for h in hallazgos]
    payload = {
        "slug": f"skiplag-{iata.lower()}-{args.depart.replace('-', '')}",
        "label": f"Bajarse en la escala · {ciudad} · {args.depart}",
        "request": {"destination": iata, "depart": args.depart, "hidden_city": True},
        "generated_at": date.today().isoformat(),
        "errors": [],
        "count": len(ofertas),
        "offers": [o.to_dict() for o in ofertas],
    }
    print(f"\nGuardado en {store.save_search(payload)}")
    return 0


# --------------------------------------------------------------------------- #
def cmd_test_email(args: argparse.Namespace) -> int:
    from .config import load_config
    from .notify import notify_offers

    cfg = load_config(args.config)

    demo = FlightOffer(
        provider="ryanair",
        origin="MAD",
        destination="FCO",
        origin_name="Madrid",
        destination_name="Roma",
        depart_date=(date.today() + timedelta(days=30)).isoformat(),
        return_date=(date.today() + timedelta(days=34)).isoformat(),
        nights=4,
        price=38.0,
        baseline=110.0,
        discount_pct=65.5,
        score=92,
        airline="Ryanair",
        deep_link="https://www.ryanair.com",
    )
    used = notify_offers(
        [demo],
        to=args.to or cfg.notify.get("to", ""),
        method=args.method or cfg.notify.get("method", "resend"),
    )
    print(f"Aviso de prueba enviado por {used}.")
    return 0


# --------------------------------------------------------------------------- #
# cuentas
# --------------------------------------------------------------------------- #
def cmd_users(args: argparse.Namespace) -> int:
    """Altas y bajas de cuentas. Lo usa el panel a traves de users.yml."""
    from . import users as U

    # El panel manda la sal y el hash ya calculados por el navegador: la
    # contrasena en claro no viaja nunca. Desde la terminal se pasa --password.
    credencial = (
        {"salt": args.salt, "hash": args.hash, "iterations": args.iterations}
        if args.salt and args.hash
        else None
    )
    # El sobre y las preferencias vienen como JSON porque son varias cosas y las
    # arma el navegador. El sobre es una caja opaca: aqui solo se guarda.
    sobre = _json_arg(args.sobre, "sobre")
    prefs = _json_arg(args.prefs, "prefs")

    if args.accion == "list":
        cuentas = U.listar()
        print(f"\n{len(cuentas)} cuentas" + ("" if U.hay_admin() else " · el panel aun no tiene contrasena"))
        for u in cuentas:
            print(
                f"  [{'activa  ' if u.active else 'inactiva'}] {u.id}  {u.user:<16} "
                f"{u.name}{'  <' + u.email + '>' if u.email else ''}"
            )
        return 0

    if args.accion == "add":
        try:
            u = U.anadir(
                user=args.user or "",
                name=args.name or "",
                password=args.password or "",
                email=args.email or "",
                credencial=credencial,
                sobre=sobre,
                prefs=prefs,
                uid=args.id or "",
            )
        except ValueError as exc:
            print(f"No se pudo crear la cuenta: {exc}")
            return 1
        print(f"Cuenta '{u.user}' creada con id {u.id}.")
        return 0

    if args.accion == "remove":
        print("Cuenta borrada." if U.borrar(args.user or args.id or "") else "No existe esa cuenta.")
        return 0

    if args.accion in ("enable", "disable"):
        ok = U.activar(args.user or args.id or "", args.accion == "enable")
        print("Hecho." if ok else "No existe esa cuenta.")
        return 0

    if args.accion == "passwd":
        if not credencial and not args.password:
            print("Hace falta --password (o --salt/--hash desde el panel).")
            return 1
        ok = U.cambiar_password(
            args.user or args.id or "", args.password or "", credencial, sobre
        )
        print("Contrasena cambiada." if ok else "No existe esa cuenta.")
        return 0

    if args.accion == "prefs":
        ok = U.cambiar_prefs(
            args.user or args.id or "", prefs or {}, args.email or None
        )
        print("Preferencias guardadas." if ok else "No existe esa cuenta.")
        return 0

    if args.accion == "publish":
        # Lo que sube a Pages: lo mismo menos las direcciones de correo.
        destino = Path(args.out or "users.public.json")
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_text(
            json.dumps(U.para_publicar(), ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"Escrito {destino} sin emails.")
        return 0

    if args.accion == "site-token":
        # Lo que llega es el token ya cifrado por el navegador con la clave
        # maestra. Ni este proceso ni el log de Actions lo ven en claro.
        cifrado = _json_arg(args.token, "token")
        if not cifrado or not cifrado.get("data"):
            print("Hace falta --token con el token ya cifrado.")
            return 1
        U.set_site_token(cifrado, sobre)
        print("Token del sitio guardado (cifrado).")
        return 0

    # set-admin: la contrasena que abre el panel
    if not credencial and not args.password:
        print("Hace falta --password (o --salt/--hash desde el panel).")
        return 1
    U.set_admin(args.password or "", credencial, sobre)
    print("Contrasena del panel guardada.")
    return 0


def cmd_claim(args: argparse.Namespace) -> int:
    """Le pone dueño a lo que no lo tiene. Lo lanza el panel."""
    from . import watch as W

    if not args.owner:
        print("Hace falta --owner.")
        return 1
    seguimientos = W.reclamar(args.owner, args.owner_name or "")
    busquedas = Store().claim_searches(args.owner, args.owner_name or "")
    print(
        f"Asignados a {args.owner_name or args.owner}: "
        f"{seguimientos} seguimientos y {busquedas} busquedas."
    )
    return 0


def _json_arg(crudo: str | None, que: str) -> dict | None:
    """Un argumento que viaja como JSON. Si viene roto, se dice y se sigue."""
    if not crudo:
        return None
    try:
        valor = json.loads(crudo)
    except json.JSONDecodeError as exc:
        log.warning("El %s no es JSON valido (%s); se ignora", que, exc)
        return None
    return valor if isinstance(valor, dict) else None


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="tripfinder", description="Buscador de chollos de vuelo.")
    p.add_argument("-v", "--verbose", action="store_true")
    p.add_argument("--config", help="Ruta a watchlist.yml")
    sub = p.add_subparsers(dest="cmd", required=True)

    f = sub.add_parser("scan-flights", help="Busca vuelos, guarda resultados y notifica")
    f.add_argument("--dry-run", action="store_true", help="No escribe ni envia email")
    f.add_argument("--no-email", action="store_true")
    f.add_argument("--limit", type=int, default=120, help="Ofertas maximas a publicar en la web")
    f.set_defaults(func=cmd_scan_flights)

    s = sub.add_parser("scan-stays", help="Busca alojamiento para una oferta concreta")
    s.add_argument("--offer-id", required=True)
    s.add_argument("--city", help="Fuerza la ciudad si la oferta no esta en offers.json")
    s.add_argument("--iata")
    s.add_argument("--country", help="Pais del destino (desambigua la ciudad)")
    s.add_argument("--checkin")
    s.add_argument("--checkout")
    s.add_argument("--adults", type=int)
    s.add_argument("--max-total", type=float, dest="max_total")
    s.add_argument("--summary-out", help="Escribe un resumen en markdown en este fichero")
    s.add_argument("--dry-run", action="store_true")
    s.set_defaults(func=cmd_scan_stays)

    b = sub.add_parser("search", help="Busqueda personalizada a un destino concreto")
    b.add_argument("--dest", default="", help="IATA (FCO) o ciudad (Roma). Vacio = a cualquier sitio")
    b.add_argument("--label", help="Nombre de la busqueda para la web")
    b.add_argument("--max-price", type=float, dest="max_price")
    b.add_argument("--nights", help="2, o un rango como 2-4")
    b.add_argument("--months", type=int, default=12, help="Hasta cuantos meses buscar")
    b.add_argument("--any-day", action="store_true", help="No limitarse a fines de semana")
    b.add_argument("--depart", help="Fecha exacta de ida (YYYY-MM-DD)")
    b.add_argument("--return", dest="return", help="Fecha exacta de vuelta (YYYY-MM-DD)")
    b.add_argument("--adults", type=int)
    b.add_argument("--summary-out")
    b.add_argument("--owner", default="", help="Id de la cuenta que la pide")
    b.add_argument("--owner-name", dest="owner_name", default="")
    b.add_argument("--dry-run", action="store_true")
    b.set_defaults(func=cmd_search)

    k = sub.add_parser(
        "skiplag", help="Billetes que hacen escala en tu destino y salen mas baratos"
    )
    k.add_argument("--dest", required=True, help="Donde quieres bajarte (IATA o ciudad)")
    k.add_argument("--depart", required=True, help="Fecha de ida (YYYY-MM-DD)")
    k.add_argument("--direct-price", type=float, dest="direct_price",
                   help="Precio del vuelo directo con el que comparar")
    k.add_argument("--dry-run", action="store_true")
    k.set_defaults(func=cmd_skiplag)

    v = sub.add_parser("watch", help="Seguimientos: viajes que se vigilan a diario")
    v.add_argument("accion", choices=["add", "list", "remove", "remove-search", "run"])
    v.add_argument("--id")
    v.add_argument("--dest", default="")
    v.add_argument("--label")
    v.add_argument("--depart")
    v.add_argument("--return", dest="return")
    v.add_argument("--nights")
    v.add_argument("--months", type=int, default=6)
    v.add_argument("--adults", type=int)
    v.add_argument("--max-price", type=float, dest="max_price")
    v.add_argument("--any-day", action="store_true")
    v.add_argument("--owner", default="", help="Id de la cuenta a la que pertenece")
    v.add_argument("--owner-name", dest="owner_name", default="")
    v.add_argument("--no-email", action="store_true")
    v.set_defaults(func=cmd_watch)

    c = sub.add_parser("users", help="Cuentas de la web: quien entra y de quien es cada cosa")
    c.add_argument(
        "accion",
        choices=[
            "add", "list", "remove", "passwd", "prefs",
            "enable", "disable", "set-admin", "site-token", "publish",
        ],
    )
    c.add_argument("--out", help="publish: donde escribir el users.json sin emails")
    c.add_argument("--user", help="Nombre con el que entra (o el id)")
    c.add_argument("--id", help="Id de la cuenta, si se quiere fijar")
    c.add_argument("--name", help="Como se le llama en la web")
    c.add_argument("--email", default="")
    c.add_argument("--password", help="Solo para uso local: se hashea aqui mismo")
    c.add_argument("--salt", help="Sal en base64 (la calcula el panel)")
    c.add_argument("--hash", help="PBKDF2-SHA256 en base64 (lo calcula el panel)")
    c.add_argument("--iterations", type=int, default=0)
    c.add_argument("--sobre", help="JSON: la clave maestra cifrada con su contrasena")
    c.add_argument("--prefs", help="JSON: que correos quiere y cada cuanto")
    c.add_argument("--token", help="JSON: el token del sitio, ya cifrado por el navegador")
    c.set_defaults(func=cmd_users)

    cl = sub.add_parser("claim", help="Asigna a una cuenta lo que no tiene dueño")
    cl.add_argument("--owner", required=True, help="Id de la cuenta")
    cl.add_argument("--owner-name", dest="owner_name", default="")
    cl.set_defaults(func=cmd_claim)

    sub.add_parser("reindex", help="Rehace el indice de busquedas").set_defaults(func=cmd_reindex)

    t = sub.add_parser("test-email", help="Envia un aviso de ejemplo")
    t.add_argument("--to")
    t.add_argument("--method", choices=["resend", "smtp", "github_issue"])
    t.set_defaults(func=cmd_test_email)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    _setup_logging(args.verbose)
    return int(args.func(args))
