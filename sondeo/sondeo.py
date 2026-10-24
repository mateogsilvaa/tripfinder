"""Sondeo TEMPORAL de fuentes de hoteles desde un runner. Se borra despues."""
import base64, json, pathlib, sys, time, traceback
sys.path.insert(0, "src")
from tripfinder.util import get_text

OUT = pathlib.Path("sondeo/out"); OUT.mkdir(parents=True, exist_ok=True)

def varint(n):
    b = b""
    while True:
        x = n & 0x7F; n >>= 7
        if n: b += bytes([x | 0x80])
        else: return b + bytes([x])

def f_v(num, v): return varint(num << 3) + varint(v)
def f_b(num, data):
    if isinstance(data, str): data = data.encode()
    return varint((num << 3) | 2) + varint(len(data)) + data

def fecha(y, m, d): return f_v(1, y) + f_v(2, m) + f_v(3, d)

def ts(city, a, b, noches):
    dates = f_b(2, f_b(1, fecha(*a)) + f_b(2, fecha(*b)) + f_v(3, noches)) + f_b(6, f_v(2, 0))
    inner = f_b(1, f_b(2, f_b(7, city)) + f_b(3, b"")) + f_b(2, dates) + f_b(5, f_b(1, f_b(7, "EUR")) + f_b(3, b""))
    msg = f_v(1, 1) + f_b(2, b"") + f_b(3, inner)
    return base64.urlsafe_b64encode(msg).decode().rstrip("=")

SOCS = "SOCS=CAESEwgDEgk0ODE3Nzk3MjQaAmVzIAEaBgiA_LyaBg"
T = ts("Roma", (2026, 12, 11), (2026, 12, 13), 2)
C = [
    ("google_sin_fecha", "https://www.google.com/travel/search?q=hoteles%20en%20Roma&hl=es&gl=es&curr=EUR", {"Cookie": SOCS}),
    ("google_ts", f"https://www.google.com/travel/search?q=hoteles%20en%20Roma&hl=es&gl=es&curr=EUR&ts={T}", {"Cookie": SOCS}),
    ("google_hotels_ts", f"https://www.google.com/travel/hotels/Roma?q=hoteles%20en%20Roma&hl=es&gl=es&curr=EUR&ts={T}", {"Cookie": SOCS}),
    ("booking", "https://www.booking.com/searchresults.es.html?ss=Roma&checkin=2026-12-11&checkout=2026-12-13&group_adults=2&no_rooms=1&group_children=0&order=price&selected_currency=EUR", {}),
    ("hotellook", "https://engine.hotellook.com/api/v2/cache.json?location=Rome&currency=eur&checkIn=2026-12-11&checkOut=2026-12-13&limit=20", {}),
    ("trivago", "https://www.trivago.es/es/srl?search=200-22235;dr-20261211-20261213;rc-1-2", {}),
    ("destinia", "https://destinia.com/hotels/search/?destination=Roma&checkin=2026-12-11&checkout=2026-12-13&rooms=2", {}),
    ("hostelworld", "https://www.hostelworld.com/st/hostels/europe/italy/rome/", {}),
    ("kayak", "https://www.kayak.es/hotels/Roma,Italia/2026-12-11/2026-12-13/2adults", {}),
    ("hotels_com", "https://es.hoteles.com/Hotel-Search?destination=Roma&startDate=2026-12-11&endDate=2026-12-13&adults=2", {}),
    ("agoda", "https://www.agoda.com/es-es/search?city=4382&checkIn=2026-12-11&los=2&rooms=1&adults=2", {}),
]
res = {"ts": T}
for nombre, url, h in C:
    for stealth in (True, False):
        k = f"{nombre}{'_sigilo' if stealth else ''}"
        t0 = time.time()
        try:
            html = get_text(url, headers=h, stealth=stealth, retries=1, timeout=30)
            (OUT / f"{k}.html").write_text(html, encoding="utf-8")
            res[k] = {"len": len(html), "euros": html.count("€"), "s": round(time.time() - t0, 1)}
        except Exception as e:
            res[k] = {"error": str(e)[:300]}
        print(k, res[k], flush=True)
(OUT / "resumen.json").write_text(json.dumps(res, indent=2))
