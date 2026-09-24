"""Sonda 7: alojamiento cerca del centro de verdad (Airbnb por mapa, Holidu). Temporal."""

import json
import re
import statistics
import sys

sys.path.insert(0, "src")

from tripfinder.stays import airbnb as A  # noqa: E402
from tripfinder.stays import holidu as H  # noqa: E402
from tripfinder.stays.base import StayRequest  # noqa: E402
from tripfinder.stays.centro import km_entre  # noqa: E402
from tripfinder.util import get_text  # noqa: E402

CIUDADES = [
    ("Roma", "Italia", 41.8986, 12.4768),
    ("Amsterdam", "Paises Bajos", 52.3731, 4.8926),
    ("Praga", "Chequia", 50.0875, 14.4213),
    ("Viena", "Austria", 48.2085, 16.3721),
]


def resumen(nombre, ofertas, centro):
    kms = sorted(round(km_entre(centro, (o.lat, o.lon)), 1) for o in ofertas if o.lat and o.lon)
    precios = sorted(int(o.price_total) for o in ofertas if o.price_total)
    med = statistics.median(kms) if kms else None
    print(f"  {nombre:22} n={len(ofertas):2} km={kms[:12]} mediana={med} <=2.5km={sum(k <= 2.5 for k in kms)} precios={precios[:8]}")


def airbnb_caja(req, lat, lon, d):
    url = A.SEARCH.format(place=A.quote(A.sin_tildes(req.slug)))
    dlat, dlon = d / 111.0, d / (111.0 * 0.66)
    params = {
        "query": A.sin_tildes(req.query), "checkin": req.checkin, "checkout": req.checkout,
        "adults": req.adults, "room_types[]": "Entire home/apt",
        "ne_lat": round(lat + dlat, 5), "ne_lng": round(lon + dlon, 5),
        "sw_lat": round(lat - dlat, 5), "sw_lng": round(lon - dlon, 5),
        "zoom": 14, "zoom_level": 14, "search_by_map": "true", "search_type": "user_map_move",
    }
    html = get_text(url, params=params, stealth=True, timeout=40)
    m = A.STATE_RE.search(html)
    if not m:
        print("  caja: sin estado")
        return []
    state = json.loads(m.group(1))
    items = []
    for node in A._walk(state):
        r = node.get("searchResults")
        if isinstance(r, list):
            items.extend(x for x in r if isinstance(x, dict))
    out = []
    for it in items:
        if it.get("__typename") != "StaySearchResult":
            continue
        total, _ = A._prices(it, req.nights)
        lat2, lon2 = A._coordenadas(it)
        out.append(type("O", (), {"lat": lat2, "lon": lon2, "price_total": total})())
    return out


for ciudad, pais, lat, lon in CIUDADES:
    centro = (lat, lon)
    print(ciudad)
    req = StayRequest(city=ciudad, iata="", checkin="2026-11-06", checkout="2026-11-08", adults=2, country=pais, solo_enteros=True)
    try:
        resumen("airbnb normal", A.AirbnbProvider().search(req), centro)
    except Exception as exc:
        print("  airbnb normal ERROR", exc)
    for d in (1.5, 2.5):
        try:
            resumen(f"airbnb caja {d}km", airbnb_caja(req, lat, lon, d), centro)
        except Exception as exc:
            print("  airbnb caja ERROR", exc)
    try:
        resumen("holidu normal", H.HoliduProvider().search(req), centro)
    except Exception as exc:
        print("  holidu ERROR", exc)

# Holidu: que parametros de mapa entiende. Se mira el estado de una busqueda.
html = get_text(f"{H.BASE}/s/Roma", params={"checkin": "2026-11-06", "checkout": "2026-11-08", "adults": 2})
st = H.estado_inicial(html)
vistos = set()


def pasear(n, ruta=""):
    if isinstance(n, dict):
        for k, v in n.items():
            r = f"{ruta}.{k}"
            if re.search(r"bound|viewport|bbox|mapArea|northEast|southWest|zoom", k, re.I) and r not in vistos:
                vistos.add(r)
                print("HOLIDU", r, json.dumps(v)[:200])
            pasear(v, r)
    elif isinstance(n, list):
        for x in n[:3]:
            pasear(x, ruta + "[]")


pasear(st)
for m in re.finditer(r'https://www\.holidu\.es/s/[^"\\\s]{0,200}', html):
    print("HOLIDU URL", m.group(0)[:200])
    break
print("HOLIDU keys zustand", list((st.get("zustand") or {}).keys())[:40])
