"""Plantillas del aviso, con la misma estetica que la web.

El mismo panel de salidas que la web: fondo casi negro, marfil, el naranja de
la marca para el precio y todo dato en monoespaciada. Sin radios y sin sombras, igual que la web; lo que separa un
bloque de otro es una regla, no una tarjeta.

Todo va con tablas y estilos en linea porque los clientes de correo ignoran
hojas de estilo, clases y tipografias externas. Newsreader, Sora y Martian Mono
no llegan aqui: en su sitio van las de sistema, que estan en todas partes. Los colores si son los mismos.
"""

from __future__ import annotations

import html

from ..config import site_url
from ..models import FlightOffer

BG = "#100f0e"      # --paper del tema oscuro
CARD = "#0f1d27"    # zona reglada
INK = "#f4f1e8"     # --ink
MUTED = "#8c8880"
FAINT = "#8c8880"
ROJO = "#ff5a22"    # el naranja de la marca: el precio que ha bajado
VERDE = "#4fd6b0"   # lo que se queda apuntado y vigila solo
LINE = "#34332e"    # el correo no lleva bien rgba: la hairline va opaca
REGLA = "#f4f1e8"   # la regla mayor, en tinta

MONO = "'IBM Plex Mono','SFMono-Regular',Consolas,'Liberation Mono',monospace"
SERIF = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"
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
    """Una inicial del origen, grabada en su casilla reglada. Sin fondo."""
    return (
        f'<span style="display:inline-block;border:1px solid {LINE};'
        f'color:{INK};font:400 12px {MONO};padding:5px 7px;margin-right:3px">'
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
    # El cartucho: la cajita reglada de la leyenda de una carta. Ni pastilla,
    # ni sello de goma girado.
    sello = (
        f'<span style="border:1px solid {ROJO};color:{ROJO};'
        f'font:400 11px {MONO};padding:5px 9px;white-space:nowrap">'
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
          <div style="font:400 10px {MONO};letter-spacing:.2em;color:{FAINT};text-transform:lowercase">{titulo}</div>
          <div style="font:400 15px {MONO};color:{INK};padding-top:5px">{_fecha(iso)}</div>
          <div style="font:400 13px {MONO};color:{MUTED};padding-top:3px">{reloj}</div>
        </td>"""

    # La plancha: se abre con una regla mayor y no tiene caja. Es lo mismo que
    # hace la web con el destino del dia.
    return f"""
    <tr><td style="padding:0 0 26px 0">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
        <tr><td style="border-top:2px solid {REGLA};font-size:0;line-height:0;padding:0">
          <div style="width:46px;height:2px;background:{ROJO};font-size:0;line-height:0">&nbsp;</div>
        </td></tr>
        <tr><td style="padding:14px 0 0">

          <div style="font:400 11px {MONO};letter-spacing:.2em;color:{FAINT}">
            {offer.origin} &nbsp;&mdash;&nbsp; {offer.destination}
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
            <span style="font:400 30px {MONO};color:{ROJO};letter-spacing:-.04em">{offer.price:.0f}&euro;</span>
            &nbsp;{tachado}&nbsp;{sello}
            <div style="font:400 11px {MONO};color:{FAINT};padding-top:7px">
              ida y vuelta, 1 adulto{f" &middot; {offer.price_per_hour:.1f} &euro;/hora de viaje" if offer.price_per_hour else ""}
            </div>
          </div>

          <div style="padding-top:20px">
            <a href="{url}" style="background:{ROJO};color:{BG};text-decoration:none;
               font:500 14px {SANS};padding:13px 22px;display:inline-block">
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
          <span style="font:400 11px {MONO};letter-spacing:.2em;color:{FAINT};
                       text-transform:lowercase;padding-left:8px">indice de escapadas</span>
        </div>
        <div style="font:400 34px/1.05 {SERIF};color:{INK}">
          {len(offers)} chollo{'s' if len(offers) != 1 else ''}
          <span style="color:{ROJO};font-style:italic">desde Madrid</span>
        </div>
        <div style="font:400 14px/1.5 {SANS};color:{MUTED};padding-top:8px">
          {resumen}. Los precios de verdad duran horas, no dias.
        </div>
      </td></tr>

      {"".join(_ticket(o) for o in offers)}

      <tr><td style="border-top:2px solid {REGLA};padding-top:16px;font:400 12px/1.7 {MONO};color:{FAINT}">
        <a href="{site_url()}" style="color:{ROJO};text-decoration:none">ver todo en la web</a>
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
                f'<span style="color:{VERDE}">{mejor.price:.0f}&euro;</span> '
                f'<span style="color:{MUTED}">{_fecha(mejor.depart_date)}'
                f'{" &middot; " + mejor.airline if mejor.airline else ""}</span>'
            )
        elif w.best_price:
            detalle = f'<span style="color:{MUTED}">sin novedad &middot; mejor visto {w.best_price:.0f}&euro;</span>'
        else:
            detalle = f'<span style="color:{FAINT}">todavia sin resultados</span>'
        # De donde salio el seguimiento, cuando se sabe. Va pequeño y al lado
        # del titulo: en el parte importa el precio, no la procedencia (#13).
        origen = (
            f'<span style="font:400 11px {MONO};color:{FAINT};'
            f'letter-spacing:.08em"> &middot; via {html.escape(w.source)}</span>'
            if getattr(w, "source", "")
            else ""
        )
        filas.append(
            f"""<tr>
              <td style="padding:12px 0;border-bottom:1px solid {LINE}">
                <div style="font:400 17px {SERIF};color:{INK}">{w.label or w.destination or "Donde sea"}{origen}</div>
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
          <span style="font:400 11px {MONO};letter-spacing:.2em;color:{FAINT};
                       text-transform:lowercase;padding-left:8px">parte diario</span></div>
        <div style="font:400 28px/1.15 {SERIF};color:{INK}">{titulo}</div>
      </td></tr>
      <tr><td><table width="100%" cellpadding="0" cellspacing="0">{"".join(filas)}</table></td></tr>
      <tr><td style="border-top:2px solid {REGLA};padding-top:16px;font:400 12px/1.7 {MONO};color:{FAINT}">
        <a href="{site_url()}" style="color:{ROJO};text-decoration:none">ver en la web</a>
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
