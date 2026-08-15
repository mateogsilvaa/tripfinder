"""Envio de avisos por email (SMTP con contrasena de aplicacion de Gmail)."""

from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

from ..config import env, site_url
from ..models import FlightOffer

log = logging.getLogger("tripfinder")


def send_email(subject: str, html: str, to: str | None = None) -> None:
    host = env("SMTP_HOST", "smtp.gmail.com")
    port = int(env("SMTP_PORT", "465"))
    user = env("SMTP_USER")
    password = env("SMTP_PASSWORD")
    dest = to or env("NOTIFY_TO") or user
    if not (user and password and dest):
        raise RuntimeError("Faltan SMTP_USER / SMTP_PASSWORD / NOTIFY_TO")

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = f"TripFinder <{user}>"
    msg["To"] = dest
    msg.set_content("Tu cliente no soporta HTML. Abre " + site_url())
    msg.add_alternative(html, subtype="html")

    with smtplib.SMTP_SSL(host, port, timeout=30) as server:
        server.login(user, password)
        server.send_message(msg)
    log.info("Email enviado a %s: %s", dest, subject)


def _offer_row(offer: FlightOffer) -> str:
    url = f"{site_url()}/?offer={offer.id}"
    dates = offer.depart_date
    if offer.return_date:
        dates += f" &rarr; {offer.return_date}"
        if offer.nights:
            dates += f" ({offer.nights} noches)"
    baseline = (
        f'<span style="color:#8a8f98;text-decoration:line-through">{offer.baseline:.0f}&euro;</span>'
        if offer.baseline
        else ""
    )
    return f"""
    <tr><td style="padding:0 0 16px 0">
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6e8eb;border-radius:12px">
        <tr><td style="padding:18px 20px">
          <div style="font:600 19px/1.3 -apple-system,Segoe UI,Roboto,sans-serif;color:#0f1115">
            {offer.origin_name or offer.origin} &rarr; {offer.destination_name or offer.destination}
          </div>
          <div style="font:400 14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#5c6370;padding-top:4px">
            {dates} &middot; {offer.airline}
          </div>
          <div style="padding-top:12px">
            <span style="font:700 30px/1 -apple-system,Segoe UI,Roboto,sans-serif;color:#0f1115">
              {offer.price:.0f}&euro;
            </span>
            &nbsp;{baseline}
            <span style="background:#e8f7ee;color:#0a7a3d;font:600 13px/1 sans-serif;padding:6px 9px;border-radius:99px;margin-left:8px">
              -{offer.discount_pct:.0f}% &middot; score {offer.score}
            </span>
          </div>
          <div style="padding-top:16px">
            <a href="{url}" style="background:#0f1115;color:#fff;text-decoration:none;font:600 14px sans-serif;padding:11px 18px;border-radius:8px;display:inline-block">
              Ver y buscar alojamiento
            </a>
            <a href="{offer.deep_link}" style="color:#5c6370;text-decoration:none;font:600 14px sans-serif;padding:11px 14px;display:inline-block">
              Reservar vuelo
            </a>
          </div>
        </td></tr>
      </table>
    </td></tr>"""


def render_offers_email(offers: list[FlightOffer]) -> str:
    rows = "".join(_offer_row(o) for o in offers)
    return f"""<!doctype html>
<html><body style="margin:0;background:#f6f7f9;padding:24px 12px">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px">
      <tr><td style="padding-bottom:18px">
        <div style="font:700 22px/1.2 -apple-system,Segoe UI,Roboto,sans-serif;color:#0f1115">
          {len(offers)} chollo{'s' if len(offers) != 1 else ''} de vuelo
        </div>
        <div style="font:400 14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#5c6370;padding-top:4px">
          Precios por debajo de su media historica. Suelen durar horas.
        </div>
      </td></tr>
      {rows}
      <tr><td style="padding-top:8px;font:400 12px/1.6 sans-serif;color:#8a8f98">
        TripFinder &middot; <a href="{site_url()}" style="color:#8a8f98">ver todas las ofertas</a>
        &middot; ajusta umbrales en config/watchlist.yml
      </td></tr>
    </table>
  </td></tr></table>
</body></html>"""


def notify_offers(offers: list[FlightOffer], to: str | None = None) -> None:
    if not offers:
        return
    best = offers[0]
    subject = (
        f"[TripFinder] {best.origin} -> {best.destination_name or best.destination} "
        f"por {best.price:.0f}EUR (-{best.discount_pct:.0f}%)"
    )
    if len(offers) > 1:
        subject += f" y {len(offers) - 1} mas"
    send_email(subject, render_offers_email(offers), to=to)
