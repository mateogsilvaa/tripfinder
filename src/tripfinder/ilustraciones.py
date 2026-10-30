"""Las ilustraciones de cada ciudad: de `ilustraciones/` a la web.

`ilustraciones/<pais>/<ciudad>/` lleva dos dibujos, `dia` y `noche` (png, jpg o
webp), uno para el tema claro y otro para el oscuro. Los originales pesan medio
mega largo cada uno, que en el movil es mucho para una tarjeta, asi que aqui se
sacan en WebP a 1200x750 en `web/ilustraciones/<pais>/<ciudad>/` y se escribe
`web/ilustraciones/indice.json`: que carpeta va con cada aeropuerto.

QUE AEROPUERTOS. La web pinta vuelos, y un vuelo dice su aeropuerto (STN, BVA),
no su ciudad. Cada carpeta se casa con los aeropuertos cuyo nombre de ciudad,
pasado a carpeta (sin tildes, minusculas, `_` por espacios), es el de la
carpeta: el de `data/airports.json` y el de `ARTICULOS`, la tabla de a que
ciudad sirve cada aeropuerto (Beauvais a Paris, Ilinden a Skopie). Si no
cuadra, un `aeropuertos.txt` en la carpeta con los codigos manda.

Desde el panel de administracion tambien se suben (`recoger`): quedan en
Firestore (`ilustraciones_subidas`) hasta que el workflow `ilustraciones.yml`
las escribe aqui, las convierte y las publica.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import re
import unicodedata
from pathlib import Path
from typing import Any

log = logging.getLogger("tripfinder")

RAIZ = Path(__file__).resolve().parents[2]
ORIGEN = RAIZ / "ilustraciones"
DESTINO = RAIZ / "web" / "ilustraciones"
AEROPUERTOS = RAIZ / "data" / "airports.json"
ANCHO, ALTO = 1200, 750
CALIDAD = 80
MOMENTOS = ("dia", "noche")
FORMATOS = (".png", ".jpg", ".jpeg", ".webp")
COLECCION = "ilustraciones_subidas"
# Donde se corta en vertical cuando el hueco es mas apaisado que el dibujo (el
# chollo del dia): 0 arriba, 100 abajo. Por defecto algo por debajo del centro,
# que es donde suelen estar los edificios; cada ciudad puede llevar el suyo en
# `encuadre.txt` (se ajusta desde el panel).
ENCUADRE = 65

ARTICULOS = {
    "ACE": "Lanzarote", "AGA": "Agadir", "AGP": "Málaga", "AHO": "Alguer", "ALC": "Alicante",
    "ALG": "Argel", "AMS": "Ámsterdam", "ARN": "Estocolmo", "ATH": "Atenas", "BCN": "Barcelona",
    "BEG": "Belgrado", "BER": "Berlín", "BGY": "Bérgamo", "BHX": "Birmingham", "BIO": "Bilbao",
    "BLQ": "Bolonia", "BOD": "Burdeos", "BRI": "Bari", "BRS": "Bristol", "BRU": "Bruselas",
    "BSL": "Basilea", "BTS": "Bratislava", "BUD": "Budapest", "BVA": "París", "BBU": "Bucarest",
    "CAG": "Cagliari", "CDG": "París", "CIA": "Roma", "CLJ": "Cluj-Napoca", "CPH": "Copenhague",
    "CRA": "Craiova", "CRL": "Bruselas", "CTA": "Catania", "DUB": "Dublín", "DBV": "Dubrovnik",
    "EDI": "Edimburgo", "EIN": "Eindhoven", "EZE": "Buenos Aires", "FCO": "Roma", "FEZ": "Fez",
    "FLR": "Florencia", "FRA": "Fráncfort del Meno", "FUE": "Fuerteventura", "GDN": "Gdansk",
    "GOA": "Génova", "GRU": "São Paulo", "GVA": "Ginebra", "HAM": "Hamburgo", "IAS": "Iași",
    "IBZ": "Ibiza", "ICN": "Seúl", "IST": "Estambul", "KRK": "Cracovia", "KTW": "Katowice",
    "KUT": "Kutaisi", "LCA": "Lárnaca", "LGW": "Londres", "LHR": "Londres", "LIM": "Lima",
    "LIS": "Lisboa", "LPA": "Gran Canaria", "LTN": "Londres", "LUX": "Luxemburgo (ciudad)",
    "LYS": "Lyon", "MAD": "Madrid", "MAN": "Mánchester", "MEX": "Ciudad de México", "MLA": "Malta",
    "MRS": "Marsella", "MUC": "Múnich", "MXP": "Milán", "NAP": "Nápoles", "NCE": "Niza",
    "NYO": "Estocolmo", "OPO": "Oporto", "ORY": "París", "OSL": "Oslo", "OTP": "Bucarest",
    "OVD": "Oviedo", "PMI": "Palma de Mallorca", "PMO": "Palermo", "PRG": "Praga", "PSA": "Pisa",
    "RAK": "Marrakech", "RBA": "Rabat", "RIX": "Riga", "SBZ": "Sibiu",
    "SCQ": "Santiago de Compostela", "SKP": "Skopie", "SOF": "Sofía", "SPU": "Split",
    "STN": "Londres", "SUF": "Lamezia Terme", "SVQ": "Sevilla", "TFS": "Tenerife", "TIA": "Tirana",
    "TLL": "Tallin", "TLS": "Toulouse", "TNG": "Tánger", "TPS": "Trapani", "TRN": "Turín",
    "TSF": "Venecia", "TSR": "Timișoara", "TTU": "Tetuán", "VCE": "Venecia", "VIE": "Viena",
    "VLC": "Valencia", "VNO": "Vilna", "VRN": "Verona", "WAW": "Varsovia", "WMI": "Varsovia",
    "WRO": "Breslavia", "ZAG": "Zagreb", "ZRH": "Zúrich",
}
# Lo que no esta en la tabla de las fotos pero si tiene vuelos.
ARTICULOS.update({"ARW": "Arad"})


def carpeta(texto: str) -> str:
    """«Cluj-Napoca» → «cluj_napoca»: el nombre de una carpeta."""
    t = unicodedata.normalize("NFD", re.sub(r"\s*\(.*\)\s*$", "", str(texto)))
    t = "".join(c for c in t if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"[^a-z0-9]+", "_", t).strip("_")


def _aeropuertos() -> list[dict[str, Any]]:
    try:
        return json.loads(AEROPUERTOS.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []


def codigos_de(ciudad: str, dir_: Path | None = None, lista: list[dict] | None = None) -> list[str]:
    """Los aeropuertos que sirven a esa carpeta de ciudad."""
    if dir_ is not None and (dir_ / "aeropuertos.txt").exists():
        texto = (dir_ / "aeropuertos.txt").read_text(encoding="utf-8")
        return sorted(set(re.findall(r"[A-Z]{3}", texto.upper())))
    codigos = {k for k, v in ARTICULOS.items() if carpeta(v) == ciudad}
    for a in _aeropuertos() if lista is None else lista:
        if ciudad in (carpeta(a.get("city", {}).get("name", "")), carpeta(a.get("name", ""))):
            codigos.add(a["code"])
    return sorted(codigos)


def encuadre_de(dir_: Path) -> int:
    try:
        return max(0, min(100, int((dir_ / "encuadre.txt").read_text(encoding="utf-8").strip())))
    except (OSError, ValueError):
        return ENCUADRE


def _fuente(dir_: Path, momento: str) -> Path | None:
    for ext in FORMATOS:
        f = dir_ / f"{momento}{ext}"
        if f.exists():
            return f
    return None


def _convertir(origen: Path, destino: Path) -> None:
    from PIL import Image, ImageOps

    with Image.open(origen) as img:
        img = ImageOps.fit(img.convert("RGB"), (ANCHO, ALTO), Image.LANCZOS)
        destino.parent.mkdir(parents=True, exist_ok=True)
        img.save(destino, "WEBP", quality=CALIDAD, method=6)


def construir(origen: Path = ORIGEN, destino: Path = DESTINO) -> dict[str, Any]:
    """Convierte lo que haya cambiado y reescribe el indice. Devuelve el indice."""
    lista = _aeropuertos()
    nombres = {a["code"]: a.get("city", {}).get("name", "") for a in lista}
    # Que original salio cada WebP, por su huella: la fecha de los ficheros no
    # sirve, en un checkout recien hecho todos tienen la misma.
    try:
        antes = json.loads((destino / "indice.json").read_text(encoding="utf-8"))
        huellas = {c["ruta"]: c.get("h", {}) for c in antes.get("ciudades", [])}
    except (OSError, json.JSONDecodeError):
        huellas = {}
    ciudades: list[dict[str, Any]] = []
    por_iata: dict[str, str] = {}
    vistas: set[str] = set()
    for dir_ in sorted(p for p in origen.glob("*/*") if p.is_dir()):
        pais, ciudad = dir_.parent.name, dir_.name
        ruta = f"{pais}/{ciudad}"
        hay: dict[str, bool] = {}
        h: dict[str, str] = {}
        for m in MOMENTOS:
            f = _fuente(dir_, m)
            hay[m] = bool(f)
            if not f:
                continue
            sale = destino / pais / ciudad / f"{m}.webp"
            vistas.add(str(sale))
            h[m] = hashlib.sha1(f.read_bytes()).hexdigest()[:10]
            if not sale.exists() or huellas.get(ruta, {}).get(m) != h[m]:
                _convertir(f, sale)
                log.info("Ilustracion: %s/%s", ruta, m)
        if not any(hay.values()):
            continue
        codigos = codigos_de(ciudad, dir_, lista)
        if not codigos:
            log.warning("Ilustracion sin aeropuerto: %s (pon un aeropuertos.txt)", ruta)
        nombre = next((ARTICULOS[c] for c in codigos if c in ARTICULOS), "") or next(
            (nombres[c] for c in codigos if nombres.get(c)), ciudad.replace("_", " ").title()
        )
        iso = next((a["country"]["code"] for a in lista if a["code"] in codigos), "")
        nombre = re.sub(r"\s*\(.*\)$", "", nombre)
        ciudades.append({
            "ruta": ruta, "nombre": nombre, "iso": iso, "aeropuertos": codigos,
            "y": encuadre_de(dir_), "h": h, **hay,
        })
        for c in codigos:
            por_iata.setdefault(c, ruta)
    # Lo que ya no tiene original (se borro o se movio) sale tambien de la web.
    for viejo in destino.glob("*/*/*.webp"):
        if str(viejo) not in vistas:
            viejo.unlink()
    indice = {"ciudades": ciudades, "por_iata": dict(sorted(por_iata.items()))}
    destino.mkdir(parents=True, exist_ok=True)
    (destino / "indice.json").write_text(
        json.dumps(indice, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    return indice


# ------------------------------------------------- lo subido desde el panel
def _guardar_subida(d: dict[str, Any], origen: Path) -> Path | None:
    pais, ciudad = carpeta(d.get("pais", "")), carpeta(d.get("ciudad", ""))
    if not pais or not ciudad:
        return None
    dir_ = origen / pais / ciudad
    escrito = False
    for m in MOMENTOS:
        crudo = str(d.get(m) or "")
        if not crudo:
            continue
        datos = base64.b64decode(crudo.split(",", 1)[-1])
        if datos[:4] != b"RIFF" or datos[8:12] != b"WEBP":
            log.warning("Subida %s/%s: %s no es un WebP, se ignora", pais, ciudad, m)
            continue
        dir_.mkdir(parents=True, exist_ok=True)
        # La nueva sustituye a la de antes, venga en el formato que viniera.
        for ext in FORMATOS:
            (dir_ / f"{m}{ext}").unlink(missing_ok=True)
        (dir_ / f"{m}.webp").write_bytes(datos)
        escrito = True
    y = d.get("encuadre")
    if isinstance(y, (int, float)) and 0 <= y <= 100 and (escrito or dir_.exists()):
        (dir_ / "encuadre.txt").write_text(f"{round(y)}\n", encoding="utf-8")
        escrito = True
    codigos = sorted({c for c in d.get("aeropuertos") or [] if re.fullmatch(r"[A-Z]{3}", str(c))})
    # Solo si dice algo que el nombre de la carpeta no da ya: si no, se perderian
    # los que salen solos (Londres son cuatro y la web solo conoce dos).
    solos = codigos_de(ciudad, dir_)
    if escrito and codigos and not set(codigos) <= set(solos):
        (dir_ / "aeropuertos.txt").write_text(" ".join(sorted({*solos, *codigos})) + "\n", encoding="utf-8")
    return dir_ if escrito else None


def recoger(db: Any, origen: Path = ORIGEN) -> list[str]:
    """Escribe en `ilustraciones/` lo subido desde el panel. Devuelve los ids,
    para borrarlos de Firestore cuando ya este publicado (`borrar`)."""
    hechos = []
    for doc in db.collection(COLECCION).stream():
        d = doc.to_dict() or {}
        try:
            dir_ = _guardar_subida(d, origen)
        except (ValueError, OSError) as exc:
            log.warning("Subida %s ilegible: %s", doc.id, exc)
            dir_ = None
        if dir_:
            print(f"Ilustracion subida: {dir_.relative_to(origen)}")
        # Las que no valen tambien se dan por recogidas: no se van a arreglar solas.
        hechos.append(doc.id)
    return hechos


def borrar(db: Any, ids: list[str]) -> None:
    for id_ in ids:
        db.collection(COLECCION).document(id_).delete()
