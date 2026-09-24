"""Sonda 8: que parametros de mapa entiende Holidu. Temporal."""

import sys

sys.path.insert(0, "src")

from tripfinder.stays import holidu as H  # noqa: E402
from tripfinder.stays.centro import km_entre  # noqa: E402
from tripfinder.util import get_text  # noqa: E402

LAT, LON = 48.2085, 16.3721  # Viena, Stephansplatz
d = 1.5
dlat, dlon = d / 111.0, d / (111.0 * 0.66)
NE, SW = (round(LAT + dlat, 5), round(LON + dlon, 5)), (round(LAT - dlat, 5), round(LON - dlon, 5))
BASE = {"checkin": "2026-11-06", "checkout": "2026-11-08", "adults": 2}
VARIANTES = {
    "nada": {},
    "ne_sw_lat": {"ne_lat": NE[0], "ne_lng": NE[1], "sw_lat": SW[0], "sw_lng": SW[1]},
    "neLat": {"neLat": NE[0], "neLng": NE[1], "swLat": SW[0], "swLng": SW[1]},
    "mapBounds": {"mapBounds": f"{NE[0]},{NE[1]},{SW[0]},{SW[1]}"},
    "bounds": {"bounds": f"{SW[0]},{SW[1]},{NE[0]},{NE[1]}"},
    "viewport": {"viewport": f"{NE[0]},{NE[1]},{SW[0]},{SW[1]}"},
    "lat_lng_radius": {"lat": LAT, "lng": LON, "radius": 2},
    "center_zoom": {"lat": LAT, "lng": LON, "zoom": 14},
}
for ruta in ("Viena", "Innere-Stadt--Viena--Austria", "Wien-Innere-Stadt"):
    for nombre, extra in VARIANTES.items():
        if ruta != "Viena" and nombre != "nada":
            continue
        try:
            html = get_text(f"{H.BASE}/s/{ruta}", params={**BASE, **extra})
        except Exception as exc:
            print(ruta, nombre, "ERROR", exc)
            continue
        st = H.estado_inicial(html)
        z = st.get("zustand") or {}
        vp = ((z.get("offersV2") or {}).get("metadata") or {}).get("REGULAR_OFFERS_SEARCH", {}).get("viewport")
        ofertas = H.ofertas_de(html, 2)
        kms = sorted(round(km_entre((LAT, LON), (o.lat, o.lon)), 1) for o in ofertas if o.lat and o.lon)
        print(f"{ruta:30} {nombre:15} n={len(ofertas):2} km={kms[:10]} vp={vp} qp={str(z.get('queryParams'))[:160]}")
