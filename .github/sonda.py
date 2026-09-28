"""Sonda 9: calendario de vuelos (Ryanair, Wizz) y tipos de Holidu. Temporal."""

import collections
import sys
from datetime import date, timedelta

sys.path.insert(0, "src")

from tripfinder.providers import ryanair, wizzair  # noqa: E402
from tripfinder.stays import holidu  # noqa: E402
from tripfinder.util import get_json, get_text  # noqa: E402

hoy = date.today()
d0, d1 = hoy + timedelta(days=30), hoy + timedelta(days=36)
crudo = get_json(ryanair.API_POR_DIA.format(origen="MAD", destino="BUD"),
                 params={"outboundMonthOfDate": d0.replace(day=1).isoformat(), "currency": "EUR"})
fares = ((crudo or {}).get("outbound") or {}).get("fares") or []
print("RYANAIR crudo claves", list((crudo or {}).keys()), "n", len(fares), "ej", fares[:2])
for o, dd in [("MAD", "BUD"), ("MAD", "BVA"), ("FCO", "MAD"), ("MAD", "EIN")]:
    print("RYANAIR", o, dd, ryanair.precios_por_dia(o, dd, d0, d1, 1))
for o, dd in [("MAD", "BUD"), ("BUD", "MAD"), ("MAD", "FCO"), ("MAD", "VIE")]:
    try:
        print("WIZZ", o, dd, wizzair.precios_por_dia(o, dd, d0, d1, {}))
    except Exception as e:
        print("WIZZ", o, dd, "ERROR", e)
# Wizz: la forma de un vuelo del timetable
try:
    prov = wizzair.WizzairProvider({})
    from tripfinder.config import Route
    idas, vueltas = prov._ventana(Route(origin="MAD"), "BUD", d0.isoformat(), d1.isoformat())
    print("WIZZ crudo", list(idas.items())[:1])
except Exception as e:
    print("WIZZ crudo ERROR", e)

for ciudad in ("Amsterdam", "Viena", "Roma"):
    html = get_text(f"{holidu.BASE}/s/{ciudad}", params={"checkin": d0.isoformat(), "checkout": (d0 + timedelta(days=2)).isoformat(), "adults": 2})
    st = holidu.estado_inicial(html)
    ofs = ((st.get("zustand") or {}).get("offersV2") or {}).get("offers") or {}
    tipos = collections.Counter(((o.get("details") or {}).get("apartmentType") or "?") for o in ofs.values())
    print("HOLIDU", ciudad, dict(tipos), "pasan", len(holidu.ofertas_de(html, 2)))
