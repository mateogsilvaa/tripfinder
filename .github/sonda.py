"""Sonda 4: el proveedor de Holidu de verdad, contra Holidu de verdad.

Temporal. Se borra en cuanto se lea.
"""

import json
import logging
import subprocess
import sys

sys.path.insert(0, "src")
logging.basicConfig(level=logging.INFO)

from tripfinder.stays import holidu  # noqa: E402
from tripfinder.stays.base import StayRequest  # noqa: E402

CIUDADES = [
    ("Ámsterdam", "Países Bajos", "2026-11-06", "2026-11-08"),
    ("Lucerna", "Suiza", "2026-11-08", "2026-11-10"),
    ("Roma", "Italia", "2026-11-13", "2026-11-16"),
    ("Bergen", "Noruega", "2026-11-13", "2026-11-15"),
    ("Montpellier", "Francia", "2026-11-07", "2026-11-09"),
]

for ciudad, pais, ida, vuelta in CIUDADES:
    req = StayRequest(city=ciudad, iata="", checkin=ida, checkout=vuelta, adults=2, country=pais)
    try:
        ofertas = holidu.HoliduProvider().search(req)
    except Exception as exc:
        print(json.dumps({"ciudad": ciudad, "error": str(exc)[:200]}, ensure_ascii=False))
        continue
    print(json.dumps({
        "ciudad": ciudad,
        "cuantas": len(ofertas),
        "con_fotos": sum(1 for s in ofertas if s.images),
        "con_nota": sum(1 for s in ofertas if s.rating),
        "fuentes": sorted({s.note for s in ofertas}),
        "tipos": sorted({s.area for s in ofertas}),
        "primeras": [
            {"n": s.name[:50], "t": s.price_total, "noche": s.price_per_night,
             "lat": s.lat, "nota": s.rating, "fotos": len(s.images)}
            for s in sorted(ofertas, key=lambda s: s.price_total)[:3]
        ],
    }, ensure_ascii=False))

# El valor crudo de la nota, para comprobar que se interpreta bien.
from tripfinder.util import get_text  # noqa: E402

html = get_text("https://www.holidu.es/s/Roma", params={"checkin": "2026-11-13", "checkout": "2026-11-16", "adults": 2})
ofertas = (((holidu.estado_inicial(html).get("zustand") or {}).get("offersV2") or {}).get("offers")) or {}
for o in list(ofertas.values())[:3]:
    print("NOTA CRUDA:", json.dumps(o.get("rating"), ensure_ascii=False)[:200],
          "| TIPO:", (o.get("details") or {}).get("apartmentType"))

# Y el flujo entero, como lo corre el Interrail: Airbnb + Holidu, solo enteros.
print("\n===== scan-stays --solo-enteros --dry-run (Roma)")
salida = subprocess.run(
    [sys.executable, "-m", "tripfinder", "scan-stays", "--offer-id", "ir-sonda-ROM-2026-11-13-2",
     "--city", "Roma", "--country", "Italia", "--checkin", "2026-11-13", "--checkout", "2026-11-16",
     "--adults", "2", "--solo-enteros", "--dry-run"],
    capture_output=True, text=True, env={"PYTHONPATH": "src", "PATH": "/usr/bin:/bin"}, timeout=240,
)
print(salida.stdout[-3500:])
print(salida.stderr[-1500:])
