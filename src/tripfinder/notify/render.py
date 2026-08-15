"""Plantillas del aviso, independientes del transporte (SMTP, Resend o issue)."""

from __future__ import annotations

from ..config import site_url
from ..models import FlightOffer


def subject_for(offers: list[FlightOffer]) -> str:
    best = offers[0]
    text = (
        f"[TripFinder] {best.origin} -> {best.destination_name or best.destination} "
        f"{best.price:.0f}EUR ida y vuelta (-{best.discount_pct:.0f}%)"
    )
    if len(offers) > 1:
        text += f" y {len(offers) - 1} mas"
    return text


def _dates(offer: FlightOffer) -> str:
    text = offer.depart_date
    if offer.return_date:
        text += f" &rarr; {offer.return_date}"
        if offer.nights:
            text += f" ({offer.nights} noches)"
    return text


def _offer_row(offer: FlightOffer) -> str:
    url = f"{site_url()}/?offer={offer.id}"
    baseline = (
        f'<span style="color:#8a8f98;text-decoration:line-through">{offer.baseline:.0f}&euro;</span>'
        if offer.baseline
        else ""
    )
    trip = "ida y vuelta" if offer.return_date else "solo ida"
    return f"""
    <tr><td style="padding:0 0 16px 0">
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6e8eb;border-radius:12px">
        <tr><td style="padding:18px 20px">
          <div style="font:600 19px/1.3 -apple-system,Segoe UI,Roboto,sans-serif;color:#0f1115">
            {offer.origin_name or offer.origin} &rarr; {offer.destination_name or offer.destination}
          </div>
          <div style="font:400 14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#5c6370;padding-top:4px">
            {_dates(offer)} &middot; {offer.airline}
          </div>
          <div style="padding-top:12px">
            <span style="font:700 30px/1 -apple-system,Segoe UI,Roboto,sans-serif;color:#0f1115">
              {offer.price:.0f}&euro;
            </span>
            &nbsp;{baseline}
            <span style="background:#e8f7ee;color:#0a7a3d;font:600 13px/1 sans-serif;padding:6px 9px;border-radius:99px;margin-left:8px">
              -{offer.discount_pct:.0f}% &middot; score {offer.score}
            </span>
            <div style="font:400 12px/1.5 sans-serif;color:#8a8f98;padding-top:6px">
              precio total {trip}, 1 adulto
            </div>
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


def render_html(offers: list[FlightOffer]) -> str:
    rows = "".join(_offer_row(o) for o in offers)
    plural = "s" if len(offers) != 1 else ""
    return f"""<!doctype html>
<html><body style="margin:0;background:#f6f7f9;padding:24px 12px">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px">
      <tr><td style="padding-bottom:18px">
        <div style="font:700 22px/1.2 -apple-system,Segoe UI,Roboto,sans-serif;color:#0f1115">
          {len(offers)} chollo{plural} de vuelo
        </div>
        <div style="font:400 14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#5c6370;padding-top:4px">
          Ida y vuelta por debajo de su media historica. Suelen durar horas.
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


def render_markdown(offers: list[FlightOffer]) -> str:
    """Version para el aviso via issue de GitHub."""
    lines = [
        f"**{len(offers)}** vuelos de ida y vuelta por debajo de su media historica.",
        "",
        "| Precio | Ruta | Fechas | Descuento | |",
        "| ---: | --- | --- | ---: | --- |",
    ]
    for o in offers:
        fechas = o.depart_date + (f" → {o.return_date}" if o.return_date else "")
        lines.append(
            f"| **{o.price:.0f} €** | {o.origin_name or o.origin} → "
            f"{o.destination_name or o.destination} | {fechas} "
            f"({o.nights or '?'} noches) | −{o.discount_pct:.0f}% | "
            f"[web]({site_url()}/?offer={o.id}) · [reservar]({o.deep_link}) |"
        )
    lines += ["", "_Precio total ida y vuelta para 1 adulto. Cierra esta issue cuando la hayas visto._"]
    return "\n".join(lines)
