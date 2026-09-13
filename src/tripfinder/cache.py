"""Caché de consultas en disco: no preguntar dos veces lo mismo en un barrido.

QUE PROBLEMA RESUELVE, Y CUAL NO. El provider de Google ya recuerda dentro de un
proceso lo que ha preguntado; el agujero estaba ENTRE procesos. El barrido de
`scan-flights.yml` arranca dos: primero `scan-flights` y después `watch run`,
minutos despues y en el mismo runner. Todo lo que el segundo vuelva a preguntar
son 2,5 MB otra vez, y una consulta mas contra alguien que ya nos estaba
contando las peticiones.

POR QUE VIVE EN `.cache/` Y NO EN `data/`. `data/` se commitea cada doce horas:
meter aqui el resultado de cada consulta llenaria el historico del repo de HTML
parseado, dos veces al dia, para siempre. `.cache/` esta en el `.gitignore`.

Y POR QUE NO SE PERSISTE ENTRE WORKFLOWS. Se podria guardar con `actions/cache` y
que durase entre ejecuciones, y NO se hace a proposito: una busqueda que lanza
una persona a mano es una peticion de datos frescos. Servirle el precio que
sacamos hace seis horas seria enseñar precios de anteayer callando, que es el
unico fallo que esta web no se puede permitir. Como el runner de cada workflow
es nuevo, la cache solo existe dentro de un barrido: exactamente donde es
segura, y en ningun sitio mas.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from pathlib import Path
from typing import Any

log = logging.getLogger("tripfinder")

RAIZ = Path(__file__).resolve().parent.parent.parent / ".cache" / "consultas"
# Minutos que vale una respuesta. Lo que separa a los dos procesos del barrido
# son minutos; media hora larga sobra y no llega a donde empieza a doler.
VIGENCIA = 90 * 60


def _fichero(clave: str) -> Path:
    # El nombre es un hash y no la clave: las claves llevan fechas y codigos que
    # en algun sistema de ficheros no valen, y no hace falta poder leerlas.
    return RAIZ / f"{hashlib.sha256(clave.encode()).hexdigest()[:32]}.json"


def leer(clave: str) -> Any | None:
    """Lo guardado para esa clave, o None si no hay o ya no vale."""
    p = _fichero(clave)
    try:
        if not p.exists():
            return None
        dato = json.loads(p.read_text(encoding="utf-8"))
        if time.time() - float(dato.get("t", 0)) > VIGENCIA:
            return None
        return dato.get("v")
    except Exception as exc:  # noqa: BLE001 - una cache ilegible no tumba el barrido
        log.debug("Cache: no se pudo leer %s (%s)", p.name, exc)
        return None


def guardar(clave: str, valor: Any) -> None:
    try:
        RAIZ.mkdir(parents=True, exist_ok=True)
        # Se escribe al lado y se mueve: si el proceso muere a mitad, el que
        # venga detras se encuentra el fichero entero o no se encuentra nada,
        # nunca medio JSON que no parsea.
        p = _fichero(clave)
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps({"t": time.time(), "v": valor}), encoding="utf-8")
        tmp.replace(p)
    except Exception as exc:  # noqa: BLE001 - sin cache se sigue igual, solo mas lento
        log.debug("Cache: no se pudo guardar (%s)", exc)


def limpiar() -> int:
    """Borra lo caducado. Devuelve cuantos ficheros ha quitado."""
    if not RAIZ.exists():
        return 0
    fuera = 0
    ahora = time.time()
    for p in RAIZ.glob("*.json"):
        try:
            if ahora - p.stat().st_mtime > VIGENCIA:
                p.unlink()
                fuera += 1
        except OSError:
            continue
    return fuera
