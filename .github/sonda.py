"""Sonda 3: la ruta exacta de los anuncios en Holidu y Vrbo, y uno de muestra.

Temporal. Se borra en cuanto se lea.
"""

import json
import re
from collections import Counter

import requests

IDA, VUELTA, GENTE = "2026-11-06", "2026-11-08", 2
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)


def rutas_con(nodo, quiere, ruta="$", out=None, prof=0):
    """Rutas a dicts que tienen TODAS las claves de `quiere`."""
    if out is None:
        out = []
    if prof > 30 or len(out) > 400:
        return out
    if isinstance(nodo, dict):
        if all(k in nodo for k in quiere):
            out.append((ruta, nodo))
        for k, v in nodo.items():
            rutas_con(v, quiere, f"{ruta}.{k}", out, prof + 1)
    elif isinstance(nodo, list):
        for i, x in enumerate(nodo):
            rutas_con(x, quiere, f"{ruta}[{i}]", out, prof + 1)
    return out


def generalizar(ruta):
    return re.sub(r"\[\d+\]", "[*]", ruta)


def recortar(obj, n=2500):
    return json.dumps(obj, ensure_ascii=False)[:n]


# ------------------------------------------------------------------ holidu
r = requests.get(
    f"https://www.holidu.es/s/Amsterdam?checkin={IDA}&checkout={VUELTA}&adults={GENTE}",
    headers={"User-Agent": UA, "Accept-Language": "es-ES,es;q=0.9"},
    timeout=30,
)
m = re.search(r'<script[^>]*data-key="initial-state"[^>]*>(.*?)</script>', r.text, re.S)
crudo = m.group(1).strip()
crudo = re.sub(r"^<!--", "", crudo)
crudo = re.sub(r"-->$", "", crudo)
estado = json.loads(crudo)
print("HOLIDU arriba:", list(estado.keys())[:20])
print("HOLIDU redux:", list(estado.get("redux", {}).keys())[:40])
halladas = rutas_con(estado, ("price", "location"))
print("HOLIDU con price+location:", len(halladas))
print("  rutas:", Counter(generalizar(p) for p, _ in halladas).most_common(8))
if halladas:
    print("  MUESTRA:", recortar(halladas[0][1]))
    if len(halladas) > 1:
        print("  MUESTRA 2 (price):", recortar(halladas[1][1].get("price"), 600))

# ------------------------------------------------------------------ vrbo
from scrapling.fetchers import Fetcher  # noqa: E402

v = Fetcher.get(
    f"https://www.vrbo.com/es-es/search?destination=Amsterdam&startDate={IDA}&endDate={VUELTA}&adults={GENTE}",
    stealthy_headers=True,
    timeout=40,
)
html = v.html_content if hasattr(v, "html_content") else str(v.body)
print("\nVRBO estado:", getattr(v, "status", "?"), "bytes:", len(html), "euros:", html.count("€"))
i = html.find("window.__APOLLO_STATE__ = JSON.parse(")
if i < 0:
    print("VRBO: sin __APOLLO_STATE__")
else:
    ini = html.index("(", i) + 1
    texto, _ = json.JSONDecoder().raw_decode(html[ini:])
    apollo = json.loads(texto)
    tipos = Counter()

    def contar(n, prof=0):
        if prof > 40:
            return
        if isinstance(n, dict):
            t = n.get("__typename")
            if isinstance(t, str):
                tipos[t] += 1
            for x in n.values():
                contar(x, prof + 1)
        elif isinstance(n, list):
            for x in n:
                contar(x, prof + 1)

    contar(apollo)
    print("VRBO claves raiz:", list(apollo.keys())[:15])
    print("VRBO ROOT_QUERY:", [k[:90] for k in apollo.get("ROOT_QUERY", {}).keys()][:15])
    print("VRBO __typename:", tipos.most_common(40))
    for quiere in (("headingSection",), ("priceSection",), ("price",), ("name", "id")):
        h = rutas_con(apollo, quiere)
        if h:
            print(f"VRBO con {quiere}: {len(h)}", Counter(generalizar(p) for p, _ in h).most_common(4))
            print("   MUESTRA:", recortar(h[0][1], 1800))
    # Y si los anuncios no estan en Apollo, donde aparece el primer precio.
    j = html.find("€")
    print("VRBO contexto del primer €:", re.sub(r"\s+", " ", html[max(0, j - 400):j + 100]))
