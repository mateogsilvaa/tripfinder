"""Lo que tarda cada vuelo de Wizz, para saber a que hora llega.

POR QUE HACE FALTA. El `timetable` de Wizz —el que da el precio de cada dia y
del que sale todo el barrido— dice a que hora SALE cada vuelo, pero no a que
hora llega. Sin la llegada, la web no puede contar las horas que pasas en
destino («viaje real») y el score no sabe si una escapada es de dos dias
enteros o de una tarde: Wizz salia siempre peor informado que Ryanair.

Un vuelo directo tarda lo mismo un martes que un viernes, y casi lo mismo con
una compañia que con otra. Asi que basta con saber, UNA vez por ruta y
sentido, cuanto tarda (en hora local: llegada menos salida, con el cambio de
huso dentro) para ponerle la llegada a todas las ofertas de esa ruta. Se
aprende de dos sitios:

* De los vuelos directos que ya traen salida y llegada: Ryanair y Google
  (`aprender_de`). Es lo que funciona: Ryanair vuela casi todas las rutas de
  Wizz desde Madrid, y Google cubre el resto.
* De `search/search`, el buscador de Wizz. Contesta 429 a los robots (visto
  en el barrido del 2026-11-01), asi que al primer 429 se deja.

Se guarda en `data/duraciones.json` y se vuelve a mirar pasado mes y medio,
por si cambia el horario de temporada.
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

log = logging.getLogger("tripfinder")

FICHERO = "duraciones.json"
# Dias que vale lo apuntado. Los horarios de temporada cambian dos veces al
# año; mes y medio da margen de sobra para enterarse.
CADUCIDAD = 45


def minutos_de_vuelo(salida: str, llegada: str) -> int | None:
    """Minutos entre dos fechas-hora LOCALES («2026-11-13T06:20:00»). Es lo que
    tarda el vuelo mas el cambio de huso, que es justo lo que hay que sumar a
    la hora de salida local para tener la de llegada local."""
    try:
        a = datetime.fromisoformat(str(salida)[:19])
        b = datetime.fromisoformat(str(llegada)[:19])
    except ValueError:
        return None
    m = int((b - a).total_seconds() // 60)
    # Fuera de esto es un dato roto, no un vuelo de Wizz.
    return m if 0 < m <= 16 * 60 else None


def llegada(hora: str, minutos: int | None) -> str:
    """HH:MM de salida mas lo que tarda; "" si falta cualquiera de los dos."""
    if not hora or not minutos:
        return ""
    try:
        h, m = (int(x) for x in hora.split(":"))
    except ValueError:
        return ""
    total = (h * 60 + m + int(minutos)) % (24 * 60)
    return f"{total // 60:02d}:{total % 60:02d}"


def aprender_de(ofertas, libreta: Duraciones | None = None) -> int:
    """Apunta lo que tardan los vuelos DIRECTOS que traen salida y llegada, en
    los dos sentidos. Devuelve cuantas rutas nuevas ha aprendido. Con varias
    ofertas de la misma ruta se queda la mediana: un dato raro no manda."""
    libreta = libreta or duraciones()
    vistos: dict[tuple[str, str], list[int]] = {}
    for o in ofertas:
        if getattr(o, "stops", 0) or getattr(o, "provider", "") in ("wizzair", "mixto", "escala"):
            continue
        tramos = (
            (o.origin, o.destination, o.depart_date, o.depart_time, o.arrive_time),
            (o.destination, o.origin, o.return_date or "", o.return_time, o.return_arrive_time),
        )
        for a, b, dia, sale, llega in tramos:
            if not (a and b and dia and sale and llega):
                continue
            m = minutos_de_vuelo(f"{dia}T{sale}", f"{dia}T{llega}")
            if m is None:  # aterriza al dia siguiente
                manana = (date.fromisoformat(dia) + timedelta(days=1)).isoformat()
                m = minutos_de_vuelo(f"{dia}T{sale}", f"{manana}T{llega}")
            if m:
                vistos.setdefault((a, b), []).append(m)
    nuevas = 0
    for (a, b), lista in vistos.items():
        if not libreta.hace_falta(a, b):
            continue
        lista.sort()
        libreta.apuntar(a, b, lista[len(lista) // 2])
        nuevas += 1
    return nuevas


def completar_llegadas(ofertas, libreta: Duraciones | None = None) -> list:
    """Pone la hora de llegada a las ofertas que tienen la salida y no la
    llegada, si se sabe lo que tarda la ruta. Devuelve las que ha tocado."""
    libreta = libreta or duraciones()
    tocadas = []
    for o in ofertas:
        if getattr(o, "stops", 0):
            continue
        cambio = False
        if o.depart_time and not o.arrive_time:
            o.arrive_time = llegada(o.depart_time, libreta.de(o.origin, o.destination))
            cambio |= bool(o.arrive_time)
        if o.return_time and not o.return_arrive_time:
            o.return_arrive_time = llegada(o.return_time, libreta.de(o.destination, o.origin))
            cambio |= bool(o.return_arrive_time)
        if cambio:
            tocadas.append(o)
    return tocadas


class Duraciones:
    """`{"MAD-OTP": {"min": 215, "visto": "2026-11-01"}}`, una entrada por
    sentido: la ida y la vuelta no tardan lo mismo (vientos y husos)."""

    def __init__(self, raiz: Path | str | None = None):
        from .config import DATA_DIR

        self.ruta = Path(raiz or DATA_DIR) / FICHERO
        self.datos: dict[str, dict[str, Any]] = {}
        self.sucio = False
        if self.ruta.exists():
            try:
                crudo = json.loads(self.ruta.read_text(encoding="utf-8"))
                self.datos = crudo.get("rutas", {}) if isinstance(crudo, dict) else {}
            except Exception as exc:  # noqa: BLE001 - ilegible: se vuelve a aprender
                log.warning("No se pudo leer %s (%s)", self.ruta, exc)

    @staticmethod
    def _clave(origen: str, destino: str) -> str:
        return f"{origen.upper()}-{destino.upper()}"

    def de(self, origen: str, destino: str) -> int | None:
        d = self.datos.get(self._clave(origen, destino)) or {}
        m = d.get("min")
        return int(m) if isinstance(m, (int, float)) and m > 0 else None

    def hace_falta(self, origen: str, destino: str, hoy: date | None = None) -> bool:
        """Si no se sabe, o se sabe de hace demasiado."""
        d = self.datos.get(self._clave(origen, destino))
        if not d or not self.de(origen, destino):
            return True
        try:
            visto = date.fromisoformat(str(d.get("visto", "")))
        except ValueError:
            return True
        return (hoy or date.today()) - visto > timedelta(days=CADUCIDAD)

    def apuntar(self, origen: str, destino: str, minutos: int, hoy: date | None = None) -> None:
        self.datos[self._clave(origen, destino)] = {
            "min": int(minutos),
            "visto": (hoy or date.today()).isoformat(),
        }
        self.sucio = True

    def guardar(self) -> None:
        """Solo si se ha aprendido algo: `data/` se commitea en cada barrido."""
        if not self.sucio:
            return
        self.ruta.parent.mkdir(parents=True, exist_ok=True)
        self.ruta.write_text(
            json.dumps({"rutas": dict(sorted(self.datos.items()))}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        self.sucio = False


# Una por proceso: el barrido, las busquedas guardadas y el Interrail comparten
# lo aprendido.
_DURACIONES: Duraciones | None = None


def duraciones() -> Duraciones:
    global _DURACIONES
    if _DURACIONES is None:
        _DURACIONES = Duraciones()
    return _DURACIONES


def guardar() -> None:
    if _DURACIONES is not None:
        _DURACIONES.guardar()
