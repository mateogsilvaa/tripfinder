"""Plantillas del aviso, con la misma estetica que la web.

Panel de salidas nocturno: negro calido, ambar y numeros en monoespaciada.
Todo va con tablas y estilos en linea porque los clientes de correo ignoran
hojas de estilo, clases y tipografias externas: Georgia y las monoespaciadas
del sistema son las que estan en todas partes.
"""

from __future__ import annotations

from ..config import site_url
from ..models import FlightOffer

BG = "#0d0b0a"
CARD = "#17130f"
INK = "#f7f1e6"
MUTED = "#a2937f"
FAINT = "#6d6154"
AMBER = "#ffb02e"
MINT = "#7fd6a2"
LINE = "#2a2320"

MONO = "'DM Mono','SFMono-Regular',Consolas,'Liberation Mono',monospace"
SERIF = "Georgia,'Times New Roman',serif"
SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif"

DIAS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]
MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]


def _fecha(iso: str) -> str:
    from datetime import date

    try:
        d = date.fromisoformat(iso)
    except (ValueError, TypeError):
        return iso or ""
    return f"{DIAS[d.weekday()]} {d.day} {MESES[d.month - 1]}"


def subject_for(offers: list[FlightOffer]) -> str:
    best = offers[0]
    text = (
        f"[TripFinder] {best.destination_name or best.destination} "
        f"{best.price:.0f}EUR ida y vuelta (-{best.discount_pct:.0f}%)"
    )
    if len(offers) > 1:
        text += f" y {len(offers) - 1} mas"
    return text


def _flap(letra: str) -> str:
    return (
        f'<span style="display:inline-block;background:#241d18;border:1px solid {LINE};'
        f'border-radius:4px;color:{AMBER};font:500 13px {MONO};padding:5px 6px;margin-right:3px">'
        f"{letra}</span>"
    )


def _ticket(offer: FlightOffer) -> str:
    url = f"{site_url()}/?offer={offer.id}"
    tachado = (
        f'<span style="color:{FAINT};font:400 13px {MONO};text-decoration:line-through">'
        f"{offer.baseline:.0f}&euro;</span>"
        if offer.baseline and offer.baseline > offer.price
        else ""
    )
    sello = (
        f'<span style="border:1px solid {AMBER};color:{AMBER};border-radius:99px;'
        f'font:500 11px {MONO};padding:5px 9px;white-space:nowrap">'
        f"&minus;{offer.discount_pct:.0f}%</span>"
        if offer.discount_pct >= 5
        else ""
    )
    escalas = "directo" if not offer.stops else f"{offer.stops} escala{'s' if offer.stops > 1 else ''}"
    horas = (
        f" &middot; {offer.useful_hours:.0f} h de viaje real"
        if offer.useful_hours
        else ""
    )

    def tramo(titulo: str, iso: str, sale: str, llega: str) -> str:
        if not iso:
            return ""
        reloj = f"{sale}{f' &rarr; {llega}' if llega else ''}" if sale else ""
        return f"""
        <td width="50%" valign="top" style="padding:0 10px 0 0">
          <div style="font:500 10px {MONO};letter-spacing:.14em;color:{FAINT};text-transform:uppercase">{titulo}</div>
          <div style="font:400 15px {MONO};color:{INK};padding-top:5px">{_fecha(iso)}</div>
          <div style="font:400 13px {MONO};color:{MUTED};padding-top:3px">{reloj}</div>
        </td>"""

    return f"""
    <tr><td style="padding:0 0 14px 0">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
             style="background:{CARD};border:1px solid {LINE};border-radius:14px">
        <tr><td style="padding:22px 24px">

          <div style="font:500 11px {MONO};letter-spacing:.18em;color:{MUTED}">
            {offer.origin} &nbsp;&#9992;&nbsp; {offer.destination}
          </div>
          <div style="font:400 30px/1.1 {SERIF};color:{INK};padding:8px 0 4px">
            {offer.destination_name or offer.destination}
          </div>
          <div style="font:400 13px {SANS};color:{MUTED};padding-bottom:16px">
            {offer.destination_country} &middot; {offer.airline} &middot; {escalas}{horas}
          </div>

          <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
                 style="border-top:1px solid {LINE};border-bottom:1px solid {LINE}">
            <tr>{tramo("Ida", offer.depart_date, offer.depart_time, offer.arrive_time)}
                {tramo("Vuelta", offer.return_date, offer.return_time, offer.return_arrive_time)}
            </tr>
          </table>

          <div style="padding-top:18px">
            <span style="font:500 36px {MONO};color:{INK};letter-spacing:-.03em">{offer.price:.0f}&euro;</span>
            &nbsp;{tachado}&nbsp;{sello}
            <div style="font:400 11px {MONO};color:{FAINT};padding-top:7px">
              ida y vuelta, 1 adulto{f" &middot; {offer.price_per_hour:.1f} &euro;/hora de viaje" if offer.price_per_hour else ""}
            </div>
          </div>

          <div style="padding-top:20px">
            <a href="{url}" style="background:{AMBER};color:#1a1206;text-decoration:none;
               font:600 14px {SANS};padding:12px 18px;border-radius:9px;display:inline-block">
              Ver y buscar alojamiento
            </a>
            <a href="{offer.deep_link}" style="color:{MUTED};text-decoration:none;
               font:600 14px {SANS};padding:12px 14px;display:inline-block">Reservar vuelo</a>
          </div>

        </td></tr>
      </table>
    </td></tr>"""


def render_html(offers: list[FlightOffer]) -> str:
    findes = sum(1 for o in offers if o.weekend)
    resumen = (
        f"{findes} escapada{'s' if findes != 1 else ''} de fin de semana"
        if findes
        else "por debajo de su precio habitual"
    )
    return f"""<!doctype html>
<html><body style="margin:0;background:{BG};padding:26px 12px">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
   <tr><td align="center">
    <table width="580" cellpadding="0" cellspacing="0" role="presentation" style="max-width:580px">

      <tr><td style="padding-bottom:22px">
        <div style="padding-bottom:14px">
          {_flap("M")}{_flap("A")}{_flap("D")}
          <span style="font:500 11px {MONO};letter-spacing:.16em;color:{MUTED};
                       text-transform:uppercase;padding-left:8px">salidas</span>
        </div>
        <div style="font:400 30px/1.1 {SERIF};color:{INK}">
          {len(offers)} chollo{'s' if len(offers) != 1 else ''}
          <span style="color:{AMBER};font-style:italic">desde Madrid</span>
        </div>
        <div style="font:400 14px/1.5 {SANS};color:{MUTED};padding-top:8px">
          {resumen}. Los precios de verdad duran horas, no dias.
        </div>
      </td></tr>

      {"".join(_ticket(o) for o in offers)}

      <tr><td style="padding-top:10px;font:400 12px/1.7 {MONO};color:{FAINT}">
        <a href="{site_url()}" style="color:{MINT};text-decoration:none">ver todo en la web</a>
        &middot; el aviso solo salta con chollos excepcionales o los domingos
      </td></tr>

    </table>
   </td></tr>
  </table>
</body></html>"""


def render_markdown(offers: list[FlightOffer]) -> str:
    """Version para el aviso via issue de GitHub."""
    lines = [
        f"**{len(offers)}** escapadas por debajo de su precio habitual.",
        "",
        "| Precio | Ruta | Fechas | Viaje real | |",
        "| ---: | --- | --- | ---: | --- |",
    ]
    for o in offers:
        fechas = _fecha(o.depart_date) + (f" → {_fecha(o.return_date)}" if o.return_date else "")
        lines.append(
            f"| **{o.price:.0f} €** | {o.origin} → {o.destination_name or o.destination} | "
            f"{fechas} ({o.nights or '?'}n) | {o.useful_hours:.0f} h | "
            f"[web]({site_url()}/?offer={o.id}) · [reservar]({o.deep_link}) |"
        )
    lines += ["", "_Precio total ida y vuelta para 1 adulto._"]
    return "\n".join(lines)


def render_watch_digest(estado: list[tuple]) -> str:
    """Parte diario de los viajes que sigues.

    Aunque no haya novedades se manda: si el scan corre y no dice nada, no
    sabes si es que no hay chollo o es que se ha roto algo.
    """
    filas = []
    for w, ofertas in estado:
        if ofertas:
            mejor = min(ofertas, key=lambda o: o.price)
            detalle = (
                f'<span style="color:{MINT}">{mejor.price:.0f}&euro;</span> '
                f'<span style="color:{MUTED}">{_fecha(mejor.depart_date)}'
                f'{" &middot; " + mejor.airline if mejor.airline else ""}</span>'
            )
        elif w.best_price:
            detalle = f'<span style="color:{MUTED}">sin novedad &middot; mejor visto {w.best_price:.0f}&euro;</span>'
        else:
            detalle = f'<span style="color:{FAINT}">todavia sin resultados</span>'
        filas.append(
            f"""<tr>
              <td style="padding:12px 0;border-bottom:1px solid {LINE}">
                <div style="font:400 17px {SERIF};color:{INK}">{w.label or w.destination or "Donde sea"}</div>
                <div style="font:400 13px {MONO};padding-top:4px">{detalle}</div>
              </td></tr>"""
        )

    con_novedad = sum(1 for _, o in estado if o)
    titulo = (
        f"{con_novedad} de tus {len(estado)} seguimientos tienen algo nuevo"
        if con_novedad
        else f"Tus {len(estado)} seguimientos, sin novedad"
    )
    return f"""<!doctype html>
<html><body style="margin:0;background:{BG};padding:26px 12px">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px">
      <tr><td style="padding-bottom:18px">
        <div style="padding-bottom:12px">{_flap("M")}{_flap("A")}{_flap("D")}
          <span style="font:500 11px {MONO};letter-spacing:.16em;color:{MUTED};
                       text-transform:uppercase;padding-left:8px">parte diario</span></div>
        <div style="font:400 26px/1.2 {SERIF};color:{INK}">{titulo}</div>
      </td></tr>
      <tr><td><table width="100%" cellpadding="0" cellspacing="0">{"".join(filas)}</table></td></tr>
      <tr><td style="padding-top:16px;font:400 12px/1.7 {MONO};color:{FAINT}">
        <a href="{site_url()}" style="color:{MINT};text-decoration:none">ver en la web</a>
        &middot; se avisa cuando algo entra en tu tope o baja de su minimo
      </td></tr>
    </table>
  </td></tr></table>
</body></html>"""


def subject_watch_digest(estado: list[tuple]) -> str:
    con_novedad = [w for w, o in estado if o]
    if not con_novedad:
        return f"[TripFinder] Sin novedad en tus {len(estado)} seguimientos"
    primero = con_novedad[0]
    extra = f" y {len(con_novedad) - 1} mas" if len(con_novedad) > 1 else ""
    return f"[TripFinder] Novedad en {primero.label or primero.destination}{extra}"
