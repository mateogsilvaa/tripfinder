"""Sonda: que devuelven las webs de alojamiento a un runner de GitHub.

Temporal. Desde el contenedor donde se escribe el codigo no hay red, asi que
esto se ejecuta en Actions y se lee en su log. No guarda nada ni publica nada:
imprime, por cada web, si responde, cuanto, y si lo que llega parece una lista
de alojamientos o un muro antibot.
"""

import json
import re

import requests

IDA, VUELTA, GENTE = "2026-11-06", "2026-11-08", 2
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)

WEBS = {
    "booking-enteros": (
        "https://www.booking.com/searchresults.es.html?ss=Amsterdam"
        f"&checkin={IDA}&checkout={VUELTA}&group_adults={GENTE}&no_rooms=1"
        "&nflt=privacy_type%3D3&order=price"
    ),
    "hometogo": f"https://www.hometogo.es/amsterdam/?arrival={IDA}&duration=2&persons={GENTE}",
    "holidu": f"https://www.holidu.es/s/Amsterdam?checkin={IDA}&checkout={VUELTA}&adults={GENTE}",
    "vrbo": (
        "https://www.vrbo.com/es-es/search?destination=Amsterdam"
        f"&startDate={IDA}&endDate={VUELTA}&adults={GENTE}"
    ),
    "interhome": f"https://www.interhome.es/search/?q=Amsterdam&arrival={IDA}&duration=2&pax={GENTE}",
    "casamundo": f"https://www.casamundo.es/search/amsterdam?arrival={IDA}&duration=2&persons={GENTE}",
    "novasol": f"https://www.novasol.es/search?q=Amsterdam&arrival={IDA}&departure={VUELTA}&adults={GENTE}",
    "belvilla": f"https://www.belvilla.es/search?q=Amsterdam&arrival={IDA}&departure={VUELTA}&adults={GENTE}",
    "rentalia": f"https://es.rentalia.com/amsterdam/?llegada={IDA}&salida={VUELTA}&personas={GENTE}",
    "e-domizil": f"https://www.e-domizil.es/search/amsterdam?arrival={IDA}&duration=2&persons={GENTE}",
    "plumguide": f"https://www.plumguide.com/s/amsterdam?checkIn={IDA}&checkOut={VUELTA}&guests={GENTE}",
}

MUROS = ("captcha", "access denied", "cf-chl", "datadome", "px-captcha", "are you a robot",
         "unusual traffic", "perimeterx", "challenge-platform", "akamai")


def mirar(nombre, html, estado, via):
    bajo = html.lower()
    titulo = re.search(r"<title[^>]*>(.*?)</title>", html, re.S | re.I)
    ld = re.findall(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', html, re.S | re.I)
    tipos = []
    for bloque in ld[:20]:
        try:
            d = json.loads(bloque)
        except Exception:
            continue
        for x in d if isinstance(d, list) else [d]:
            if isinstance(x, dict):
                tipos.append(str(x.get("@type")))
    precios = len(re.findall(r"€\s?\d{2,4}|\d{2,4}\s?€", html))
    print(json.dumps({
        "web": nombre, "via": via, "estado": estado, "bytes": len(html),
        "titulo": (titulo.group(1).strip()[:80] if titulo else ""),
        "next_data": "__NEXT_DATA__" in html,
        "apollo_o_state": bool(re.search(r"__APOLLO_STATE__|__INITIAL_STATE__|window\.__[A-Z_]+__", html)),
        "ld_json": len(ld), "ld_tipos": sorted(set(tipos))[:8],
        "precios_en_texto": precios,
        "muro": [m for m in MUROS if m in bajo][:4],
    }, ensure_ascii=False))


for nombre, url in WEBS.items():
    try:
        r = requests.get(url, headers={"User-Agent": UA, "Accept-Language": "es-ES,es;q=0.9"}, timeout=30)
        mirar(nombre, r.text, r.status_code, "requests")
    except Exception as exc:
        print(json.dumps({"web": nombre, "via": "requests", "error": str(exc)[:120]}))
    try:
        from scrapling.fetchers import Fetcher

        r = Fetcher.get(url, stealthy_headers=True, timeout=30)
        html = r.html_content if hasattr(r, "html_content") else str(r.body)
        mirar(nombre, html, getattr(r, "status", "?"), "scrapling")
    except Exception as exc:
        print(json.dumps({"web": nombre, "via": "scrapling", "error": str(exc)[:120]}))
