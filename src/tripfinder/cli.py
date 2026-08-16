"""Interfaz de linea de comandos. Es lo que ejecutan los workflows de Actions."""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import date, timedelta

from .config import Config, load_config, site_url
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

    Mezcla dos fuentes a proposito: lo que ya han encontrado los demas providers
    (para ver si otra compania lo mejora) y los destinos declarados en el YAML,
    porque a esos vuelan Iberia o Vueling aunque Ryanair no los ofrezca.
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
    for out_date, in_date in findes:
        for dest in declarados:
            if len(pairs) >= limit:
                break
            if (dest, out_date, in_date) not in {(p[0], p[1], p[2]) for p in pairs}:
                pairs.append((dest, out_date, in_date))
                names.setdefault(dest, cfg.city_names.get(dest, (dest, "")))
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
                "deep_link": c.deep_link,
                "depart_time": c.depart_time,
                "weekend": c.weekend,
            }
            for c in sorted(otras.values(), key=lambda x: x.price)[:3]
        ]
        ganadoras.append(mejor)
    return ganadoras


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

    if to_notify and not args.no_email:
        from .notify import notify_offers  # import tardio: no hace falta para --dry-run

        batch = to_notify[:max_email]
        try:
            used = notify_offers(
                batch,
                to=cfg.notify.get("to", ""),
                method=cfg.notify.get("method", "resend"),
            )
        except Exception as exc:  # noqa: BLE001
            log.error("No se pudo enviar el email: %s", exc)
            errors.append(f"email: {exc}")
        else:
            today = date.today().isoformat()
            for o in batch:
                state.setdefault("notified", {})[o.id] = {"price": o.price, "date": today}
            store.save_state(state)
            print(f"Aviso enviado por {used} con {len(batch)} ofertas.")
    elif args.no_email:
        print(f"{len(to_notify)} ofertas notificables, pero --no-email esta activo.")
    else:
        print("Nada nuevo que notificar.")
    return 0


# --------------------------------------------------------------------------- #
# scan-stays
# --------------------------------------------------------------------------- #
def _find_offer(store: Store, offer_id: str) -> FlightOffer | None:
    for o in store.load_offers():
        if o.id == offer_id:
            return o
    return None


def cmd_scan_stays(args: argparse.Namespace) -> int:
    cfg: Config = load_config(args.config)
    store = Store()
    offer = _find_offer(store, args.offer_id)

    if offer is None and not (args.city and args.checkin and args.checkout):
        log.error(
            "No existe la oferta %s en data/offers.json y no se han dado "
            "--city/--checkin/--checkout como alternativa.",
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
        checkin, checkout = args.checkin, args.checkout
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
            f"**Escapada completa para {resumen['party']}: {resumen['total']:.0f} EUR** "
            f"({resumen['per_person']:.0f} EUR por persona) = vuelos {resumen['flights']:.0f} "
            f"+ alojamiento {resumen['stay']:.0f}",
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
        ident = args.id or f"{(args.dest or 'todos').lower()}-{args.depart or args.months}"
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
            )
        )
        print(f"Seguimiento '{ident}' guardado.")
        return 0

    if args.accion == "remove":
        print("Borrado." if W.borrar(args.id or "") else "No existe ese seguimiento.")
        return 0

    if args.accion == "remove-search":
        borrada = Store().delete_search(args.id or "")
        print("Busqueda borrada." if borrada else "No existe esa busqueda.")
        return 0

    # run: lo que ejecuta el cron cada dia
    store = Store()
    caducados = W.limpiar_caducados()
    if caducados:
        print(f"{caducados} seguimientos caducados retirados.")

    hallazgos = W.revisar_todos(cfg, store.load_history())
    print(f"\n{len(hallazgos)} seguimientos con novedades")
    for w, ofertas in hallazgos:
        print(f"  {w.label or w.id}:")
        for o in ofertas:
            print(
                f"     {o.price:7.2f}EUR  {o.depart_date} {o.depart_time or ''} "
                f"{o.destination_name} ({o.airline})"
            )

    if hallazgos and not args.no_email:
        from .notify import notify_offers

        todas = [o for _, ofertas in hallazgos for o in ofertas]
        etiquetas = ", ".join(w.label or w.id for w, _ in hallazgos)
        try:
            usado = notify_offers(
                todas[:6],
                to=cfg.notify.get("to", ""),
                method=cfg.notify.get("method", "resend"),
            )
            print(f"Aviso de seguimientos enviado por {usado} ({etiquetas}).")
        except Exception as exc:  # noqa: BLE001
            log.error("No se pudo avisar de los seguimientos: %s", exc)
    return 0


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
    v.add_argument("--no-email", action="store_true")
    v.set_defaults(func=cmd_watch)

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
