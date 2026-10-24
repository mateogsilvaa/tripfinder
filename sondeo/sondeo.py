"""Sondeo TEMPORAL 2: el proveedor de Google Hoteles de verdad. Se borra despues."""
import json, logging, pathlib, sys, statistics
sys.path.insert(0, "src")
logging.basicConfig(level=logging.INFO)
from tripfinder.stays import google_hotels as G
from tripfinder.stays.base import StayRequest
from tripfinder.stays.centro import coordenadas, km_entre
from tripfinder.util import get_text

OUT = pathlib.Path("sondeo/out"); OUT.mkdir(parents=True, exist_ok=True)
res = {}
for ciudad, pais in [("Roma", "Italia"), ("Praga", "República Checa"), ("Copenhague", "Dinamarca")]:
    req = StayRequest(city=ciudad, iata="", checkin="2026-12-11", checkout="2026-12-13", adults=2, country=pais)
    c = coordenadas(ciudad, pais)
    filas = []
    for plantilla in G.CONSULTAS + ("hoteles baratos en el centro de {ciudad}",):
        t = G.ts(ciudad, req.checkin, req.checkout)
        html = get_text(G.URL, params={"q": plantilla.format(ciudad=ciudad), "ts": t, "hl": "es", "gl": "ES", "curr": "EUR"},
                        headers={"Cookie": G.CONSENT_COOKIE}, timeout=40)
        mon = sorted({str(G._en(h, 6, 1, 3)) for h in G._hoteles_crudos(html)})
        os_ = G.ofertas_de(html, req, t)
        kms = [km_entre(c, (o.lat, o.lon)) for o in os_ if o.lat and c]
        filas.append({"q": plantilla, "monedas": mon, "n": len(os_), "dentro_2_5": sum(k <= 2.5 for k in kms),
                      "mediana_km": statistics.median(kms) if kms else None,
                      "precios": sorted(round(o.price_total) for o in os_)[:8],
                      "dentro": sorted((round(o.price_total), round(km_entre(c,(o.lat,o.lon)),1), o.name[:30]) for o in os_ if o.lat and c and km_entre(c,(o.lat,o.lon))<=2.5)[:6]})
        print(ciudad, filas[-1], flush=True)
    res[ciudad] = filas
(OUT / "resumen.json").write_text(json.dumps(res, indent=2, ensure_ascii=False))
