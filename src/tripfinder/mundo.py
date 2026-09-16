"""El mapa de donde ha estado cada uno, guardado para que no se pierda.

Hasta ahora esto vivia solo en `localStorage`: cambiabas de navegador o
limpiabas el historial y se iba un mapa que habias tardado un rato en marcar.
Y no habia forma de ver el de nadie mas, que es la mitad de la gracia de tener
un mapa asi.

DONDE SE GUARDA, Y QUE SIGNIFICA ESO. En `data/mundos/<uid>.json`, dentro del
repositorio, que es la unica base de datos que tiene esta web. El repositorio
es PUBLICO y `data/` se publica entero en Pages, asi que guardar el mapa es
publicarlo: no hay un termino medio donde quede a salvo en un servidor
nuestro, porque no hay servidor nuestro. Por eso se guarda solo si se pide, se
puede dejar de guardar —y entonces el fichero se borra— y la pantalla lo dice
con esas palabras en vez de prometer una privacidad que no existe.

Lo que SI se cuida es que un mapa sea de quien es: el fichero se llama como la
cuenta y el identificador se valida antes de tocar el disco, para que un
`owner` inventado desde fuera no pueda escribir donde no debe.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import UTC, datetime
from typing import Any

from .config import DATA_DIR

log = logging.getLogger("tripfinder")

CARPETA = DATA_DIR / "mundos"
INDICE = CARPETA / "index.json"

# `u-` y ocho dígitos hexadecimales es lo que genera `users.nuevo_id`. Esto no
# es cosmetica: el identificador viene de fuera y acaba siendo un nombre de
# fichero, asi que cualquier cosa con `/` o `..` dentro se queda en la puerta.
ES_CUENTA = re.compile(r"^u-[0-9a-f]{4,32}$")

# Dos letras mayusculas: los codigos ISO del propio mapa. Lo que no lo sea no
# pinta ningun pais, asi que no tiene por que llegar al disco.
ES_PAIS = re.compile(r"^[A-Z]{2}$")

# El mundo son ~250 paises y territorios. El tope no defiende de un usuario,
# defiende de un encargo con basura dentro.
MAX_PAISES = 400


def _ahora() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def limpiar_paises(crudo: Any) -> list[str]:
    """Deja solo codigos ISO validos, sin repetidos y ordenados.

    Ordenados a proposito: asi el fichero solo cambia cuando cambia el mapa, y
    no cada vez que alguien marca los mismos paises en otro orden. Un commit
    por nada es un despliegue de Pages por nada.
    """
    if isinstance(crudo, str):
        crudo = crudo.replace(",", " ").split()
    if not isinstance(crudo, (list, tuple, set)):
        return []
    vistos = {str(p).strip().upper() for p in crudo}
    return sorted(p for p in vistos if ES_PAIS.match(p))[:MAX_PAISES]


def ruta(uid: str) -> Any:
    if not ES_CUENTA.match(str(uid or "")):
        raise ValueError(f"Identificador de cuenta invalido: {uid!r}")
    return CARPETA / f"{uid}.json"


def leer(uid: str) -> dict[str, Any] | None:
    """El mapa de una cuenta, o None si no lo ha guardado."""
    try:
        p = ruta(uid)
    except ValueError:
        return None
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        log.warning("El mapa de %s no se puede leer, se ignora", uid)
        return None


def guardar(uid: str, paises: Any, nombre: str = "") -> dict[str, Any]:
    """Escribe el mapa de una cuenta y rehace el indice."""
    p = ruta(uid)
    limpios = limpiar_paises(paises)
    # El nombre que ya tuviera manda sobre un nombre vacio: un encargo sin
    # `owner_name` no puede dejar anonimo a quien ya se llamaba de algo.
    anterior = leer(uid) or {}
    datos = {
        "owner": uid,
        "owner_name": str(nombre or anterior.get("owner_name") or "").strip()[:60],
        "paises": limpios,
        "actualizado": _ahora(),
    }
    CARPETA.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(datos, ensure_ascii=False, indent=2), encoding="utf-8")
    reindexar()
    return datos


def borrar(uid: str) -> bool:
    """Dejar de guardarlo es que el fichero DESAPAREZCA, no que se quede vacio.

    Si se quedara un `[]` publicado, quien dijo "esto ya no" seguiria saliendo
    en la lista, con cero paises y con la fecha del dia en que se borro.
    """
    p = ruta(uid)
    if not p.exists():
        reindexar()
        return False
    p.unlink()
    reindexar()
    return True


def reindexar() -> dict[str, Any]:
    """La lista de mapas guardados, para poder ofrecerlos sin abrirlos todos."""
    mundos = []
    for f in sorted(CARPETA.glob("*.json")) if CARPETA.exists() else []:
        if f.name == "index.json":
            continue
        try:
            datos = json.loads(f.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        paises = datos.get("paises") or []
        mundos.append(
            {
                "o": datos.get("owner") or f.stem,
                "n": datos.get("owner_name") or "",
                "c": len(paises),
                "u": datos.get("actualizado") or "",
            }
        )
    # De mas a menos mundo: la lista se lee como una clasificacion, que es como
    # se mira esto cuando hay mas de uno.
    mundos.sort(key=lambda m: (-m["c"], m["n"].lower()))
    payload = {"generated_at": _ahora(), "mundos": mundos}
    CARPETA.mkdir(parents=True, exist_ok=True)
    INDICE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload
