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


def _dedupe(offers: list[FlightOffer]) -> list[FlightOffer]:
    """Misma ruta y fecha desde varios providers: se queda la mas barata."""
    best: dict[str, FlightOffer] = {}
    for o in offers:
        cur = best.get(o.id)
        if cur is None or o.price < cur.price:
            best[o.id] = o
    return list(best.values())


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

    min_score = int(cfg.notify.get("min_score", 70))
    renotify = float(cfg.notify.get("renotify_drop_pct", 12))

    found: list[FlightOffer] = []
    deals: list[FlightOffer] = []
    errors: list[str] = []

    for route in cfg.routes:
        for provider in providers:
            try:
                results = provider.search(route)
            except Exception as exc:  # noqa: BLE001 - un provider caido no tumba el scan
                msg = f"{provider.name} / {route.origin}: {exc}"
                log.warning("Fallo %s", msg)
                errors.append(msg)
                continue
            for offer in results:
                score_offer(offer, history, route)
                found.append(offer)
                if is_deal(offer, route, min_score):
                    deals.append(offer)

    found = _dedupe(found)
    deals = _dedupe(deals)
    found.sort(key=lambda o: (-o.score, o.price))
    deals.sort(key=lambda o: (-o.score, o.price))

    print(f"\n{len(found)} ofertas encontradas, {len(deals)} superan score {min_score}")
    for o in deals[:15]:
        print(
            f"  {o.score:3d}  {o.price:7.2f}{o.currency}  {o.origin}->{o.destination:<4} "
            f"{o.depart_date} ({o.discount_pct:.0f}% bajo {o.baseline}) {o.destination_name}"
        )

    if args.dry_run:
        print("\n--dry-run: no se escribe nada ni se envia email.")
        return 0

    to_notify = [o for o in deals if should_notify(o, state, renotify)]
    max_email = int(cfg.notify.get("max_offers_per_email", 6))

    store.record_prices(found)
    store.save_offers(found[: args.limit], errors=errors)

    if to_notify and not args.no_email:
        from .notify.email import notify_offers  # import tardio: no hace falta para --dry-run

        batch = to_notify[:max_email]
        try:
            notify_offers(batch, to=cfg.notify.get("to"))
        except Exception as exc:  # noqa: BLE001
            log.error("No se pudo enviar el email: %s", exc)
            errors.append(f"email: {exc}")
        else:
            today = date.today().isoformat()
            for o in batch:
                state.setdefault("notified", {})[o.id] = {"price": o.price, "date": today}
            store.save_state(state)
            print(f"Email enviado con {len(batch)} ofertas.")
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

    path = store.save_stays(args.offer_id, offer, stays, req.checkin, req.checkout, errors)
    print(f"\nGuardado en {path}")
    if args.summary_out:
        with open(args.summary_out, "w", encoding="utf-8") as fh:
            fh.write(_stays_markdown(args.offer_id, req, stays))
    return 0


def _stays_markdown(offer_id: str, req: StayRequest, stays: list[StayOffer]) -> str:
    lines = [
        f"### Alojamiento en {req.city}",
        "",
        f"**{req.checkin} -> {req.checkout}** · {req.nights} noches · {req.adults} adultos",
        "",
        "| Precio total | Por noche | Sitio | Alojamiento |",
        "| ---: | ---: | --- | --- |",
    ]
    for s in stays[:15]:
        total = f"{s.price_total:.0f} €" if s.price_total else "—"
        night = f"{s.price_per_night:.0f} €" if s.price_per_night else "—"
        lines.append(f"| {total} | {night} | {s.provider} | [{s.name}]({s.url}) |")
    lines += ["", f"Ver en la web: {site_url()}/?offer={offer_id}"]
    return "\n".join(lines)


# --------------------------------------------------------------------------- #
def cmd_test_email(args: argparse.Namespace) -> int:
    from .notify.email import notify_offers

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
    notify_offers([demo], to=args.to)
    print("Email de prueba enviado.")
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

    t = sub.add_parser("test-email", help="Envia un email de ejemplo")
    t.add_argument("--to")
    t.set_defaults(func=cmd_test_email)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    _setup_logging(args.verbose)
    return int(args.func(args))
