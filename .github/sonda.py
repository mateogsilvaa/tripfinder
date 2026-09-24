"""Sonda 2: DONDE guardan Holidu y Vrbo los anuncios dentro de la pagina.

Temporal, como la primera. La primera dijo que las dos responden con anuncios;
esta busca la estructura para escribir el parser contra lo que hay de verdad.
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


def scripts(html):
    out = []
    for m in re.finditer(r"<script([^>]*)>(.*?)</script>", html, re.S | re.I):
        attrs, cuerpo = m.group(1), m.group(2)
        out.append((attrs.strip()[:90], len(cuerpo), cuerpo))
    return out


def recorrer(nodo, claves, tipos, prof=0):
    if prof > 40:
        return
    if isinstance(nodo, dict):
        for k, v in nodo.items():
            claves[k] += 1
            if k == "__typename" and isinstance(v, str):
                tipos[v] += 1
            recorrer(v, claves, tipos, prof + 1)
    elif isinstance(nodo, list):
        for x in nodo:
            recorrer(x, claves, tipos, prof + 1)


def buscar_json(cuerpo):
    """El primer objeto JSON grande dentro de un script."""
    cuerpo = cuerpo.strip()
    for arranque in ("{", "["):
        i = cuerpo.find(arranque)
        if i < 0:
            continue
        try:
            return json.JSONDecoder().raw_decode(cuerpo[i:])[0]
        except Exception:
            continue
    return None


def muestra(nodo, pistas, max_n=2):
    """Objetos que tienen a la vez algo de precio y algo de nombre."""
    halladas = []

    def ir(n, prof=0):
        if len(halladas) >= max_n or prof > 40:
            return
        if isinstance(n, dict):
            ks = {k.lower() for k in n}
            if any(p in " ".join(ks) for p in ("price", "precio")) and any(
                p in " ".join(ks) for p in pistas
            ):
                halladas.append(n)
                return
            for v in n.values():
                ir(v, prof + 1)
        elif isinstance(n, list):
            for x in n:
                ir(x, prof + 1)

    ir(nodo)
    return halladas


def informe(nombre, html):
    print(f"\n===== {nombre}: {len(html)} bytes")
    grandes = sorted(scripts(html), key=lambda s: -s[1])[:6]
    for attrs, largo, cuerpo in grandes:
        print(f"  script {largo:>8}  [{attrs}]  {cuerpo.strip()[:100]!r}")
    for attrs, largo, cuerpo in grandes[:4]:
        datos = buscar_json(cuerpo)
        if datos is None:
            continue
        claves, tipos = Counter(), Counter()
        recorrer(datos, claves, tipos)
        print(f"  -- JSON en [{attrs[:50]}]: {sum(claves.values())} claves")
        print("     claves top:", [k for k, _ in claves.most_common(45)])
        if tipos:
            print("     __typename top:", tipos.most_common(25))
        for i, obj in enumerate(muestra(datos, ("name", "title", "headline", "nombre"))):
            txt = json.dumps(obj, ensure_ascii=False)
            print(f"     MUESTRA {i}: {txt[:1500]}")
        break


r = requests.get(
    f"https://www.holidu.es/s/Amsterdam?checkin={IDA}&checkout={VUELTA}&adults={GENTE}",
    headers={"User-Agent": UA, "Accept-Language": "es-ES,es;q=0.9"},
    timeout=30,
)
print("holidu url final:", r.url, r.status_code)
informe("holidu", r.text)

from scrapling.fetchers import Fetcher  # noqa: E402

v = Fetcher.get(
    f"https://www.vrbo.com/es-es/search?destination=Amsterdam&startDate={IDA}&endDate={VUELTA}&adults={GENTE}",
    stealthy_headers=True,
    timeout=40,
)
html = v.html_content if hasattr(v, "html_content") else str(v.body)
print("vrbo estado:", getattr(v, "status", "?"))
informe("vrbo", html)
