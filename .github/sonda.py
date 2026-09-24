"""Sonda 5: los vuelos del Interrail, de verdad. Temporal: se borra al leerla."""

import json
import subprocess
import sys

vuelos = [
    {"id": "ir-vuelo-MAD-AMS-2026-11-06-ida", "origen": "MAD", "aeropuertos": ["AMS", "EIN", "RTM"], "fecha": "2026-11-06", "sentido": "ida"},
    {"id": "ir-vuelo-MAD-BUD-2026-11-17-vuelta", "origen": "MAD", "aeropuertos": ["BUD"], "fecha": "2026-11-17", "sentido": "vuelta"},
    {"id": "ir-vuelo-MAD-BGO-2026-11-15-vuelta", "origen": "MAD", "aeropuertos": ["BGO"], "fecha": "2026-11-15", "sentido": "vuelta"},
    {"id": "ir-vuelo-BCN-ROM-2026-11-06-ida", "origen": "BCN", "aeropuertos": ["FCO", "CIA"], "fecha": "2026-11-06", "sentido": "ida"},
]
paradas = [{"offer_id": "ir-centro-AMS-2026-11-06-2n-2", "city": "Ámsterdam", "country": "Países Bajos", "iata": "AMS", "checkin": "2026-11-06", "checkout": "2026-11-08"}]
r = subprocess.run(
    [sys.executable, "-m", "tripfinder", "interrail-stays", "--paradas", json.dumps(paradas),
     "--vuelos", json.dumps(vuelos), "--adults", "2"],
    capture_output=True, text=True, env={"PYTHONPATH": "src", "PATH": "/usr/bin:/bin"}, timeout=300,
)
print(r.stdout[-2500:])
print(r.stderr[-2000:])
for v in vuelos:
    try:
        d = json.load(open(f"data/interrail/{v['id']}.json"))
        print(v["id"], "->", [(x["origin"], x["destination"], x["time"], x["price"]) for x in d["legs"]])
    except Exception as exc:
        print(v["id"], "ERROR", exc)
