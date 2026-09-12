"""El cuaderno de rutas sin vuelo: a donde ya sabemos que no se va.

EL PROBLEMA, medido en un barrido real (12 sep 2026). Pedir "Estonia" abre los
cinco aeropuertos del pais, y buscar a doce meses son doce ventanas de fechas:
sesenta consultas a Google. Cuatro de esos aeropuertos son Kuressaare, Kardla,
Parnu y Tartu, que no tienen —ni han tenido nunca— vuelo desde Madrid. Cuarenta
y ocho paginas de 2,5 MB, cuatro minutos de barrido y cero tarifas, dos veces al
dia, todos los dias. Y lo peor no es el tiempo: al final de ese mismo barrido
Google empezo a devolver paginas vacias (`0 tarifas en 24 consultas`), o sea que
las consultas tiradas se pagan con las que si importaban.

LO QUE HACE ESTE FICHERO. Apunta que rutas llevan barridos enteros sin devolver
un solo precio. Una ruta apuntada no se deja de mirar: se le hace UNA sonda por
barrido en vez de doce. Asi, el dia que Ryanair estrene Madrid-Tartu, aparece en
el barrido siguiente y no catorce dias despues.

TRES CAUTELAS, que son lo que separa esto de un filtro que esconde vuelos:

* Una pagina vacia porque nos han capado NO cuenta. Eso lo distingue el
  provider, que sabe si lo que recibio era un muro o una ruta sin vuelos.
* Hacen falta `UMBRAL` barridos seguidos en blanco, no una consulta suelta.
* Lo apuntado caduca a las `CADUCIDAD` dias y se vuelve a mirar entero. Hay
  rutas de temporada —Madrid-Split en invierno no existe y en julio si— y una
  lista negra sin fecha de caducidad las perderia para siempre.

Un precio, uno solo, borra la anotacion: la ruta esta viva.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from pathlib import Path
from typing import Any

log = logging.getLogger("tripfinder")

FICHERO = "rutas_vacias.json"
# Barridos seguidos en blanco antes de bajar a una sonda por barrido.
UMBRAL = 2
# Cuanto dura lo apuntado. Pasado eso se vuelve a mirar la ruta entera.
CADUCIDAD = 21


class Cuaderno:
    """Lo que sabemos de las rutas que no devuelven nada.

    Se lee al empezar el barrido y se guarda al terminar; entre medias vive en
    memoria, que es donde el provider lo consulta cientos de veces.
    """

    def __init__(self, raiz: Path | str | None = None):
        from .config import DATA_DIR

        self.ruta = Path(raiz or DATA_DIR) / FICHERO
        self.datos: dict[str, dict[str, Any]] = {}
        self.sucio = False
        # Que rutas se han apuntado YA en este barrido. Sin esto, las dos sondas
        # de un mismo barrido contarian como dos barridos y el umbral no
        # significaria nada.
        self._apuntadas: set[str] = set()
        self._cargar()

    # -- disco -----------------------------------------------------------
    def _cargar(self) -> None:
        if not self.ruta.exists():
            return
        try:
            import json

            crudo = json.loads(self.ruta.read_text(encoding="utf-8"))
            self.datos = crudo.get("rutas", {}) if isinstance(crudo, dict) else {}
        except Exception as exc:  # noqa: BLE001 - un cuaderno ilegible no tumba el barrido
            log.warning("No se pudo leer %s (%s): se empieza de cero", self.ruta, exc)
            self.datos = {}

    def guardar(self) -> None:
        """Escribe solo si hay algo que escribir.

        El barrido commitea `data/` cada doce horas: un fichero que cambia de
        formato pero no de contenido seria ruido en cada commit.
        """
        if not self.sucio:
            return
        import json

        self._olvidar_caducadas()
        self.ruta.parent.mkdir(parents=True, exist_ok=True)
        self.ruta.write_text(
            json.dumps(
                {"generado": date.today().isoformat(), "rutas": dict(sorted(self.datos.items()))},
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        self.sucio = False

    def _olvidar_caducadas(self) -> None:
        limite = date.today() - timedelta(days=CADUCIDAD)
        for clave, dato in list(self.datos.items()):
            if _fecha(dato.get("ultima")) < limite:
                del self.datos[clave]

    # -- consulta --------------------------------------------------------
    @staticmethod
    def clave(origen: str, destino: str) -> str:
        return f"{(origen or '').upper()}-{(destino or '').upper()}"

    def vacia(self, origen: str, destino: str) -> bool:
        """Si esta ruta lleva barridos sin dar un solo precio."""
        dato = self.datos.get(self.clave(origen, destino))
        if not dato:
            return False
        if _fecha(dato.get("ultima")) < date.today() - timedelta(days=CADUCIDAD):
            return False  # ya caducó: se mira entera otra vez
        return int(dato.get("barridos", 0)) >= UMBRAL

    def barridos(self, origen: str, destino: str) -> int:
        return int(self.datos.get(self.clave(origen, destino), {}).get("barridos", 0))

    # -- anotacion -------------------------------------------------------
    def apuntar_vacia(self, origen: str, destino: str) -> None:
        """Este barrido no ha sacado nada de esta ruta. Una vez por barrido."""
        clave = self.clave(origen, destino)
        if clave in self._apuntadas:
            return
        self._apuntadas.add(clave)
        dato = self.datos.get(clave)
        if dato and _fecha(dato.get("ultima")) >= date.today() - timedelta(days=CADUCIDAD):
            dato["barridos"] = int(dato.get("barridos", 0)) + 1
        else:
            dato = {"barridos": 1}
        dato["ultima"] = date.today().isoformat()
        self.datos[clave] = dato
        self.sucio = True

    def apuntar_viva(self, origen: str, destino: str) -> None:
        """Un precio, y la ruta deja de estar apuntada. Uno basta."""
        clave = self.clave(origen, destino)
        self._apuntadas.discard(clave)
        if self.datos.pop(clave, None) is not None:
            self.sucio = True


def _fecha(iso: str | None) -> date:
    try:
        return date.fromisoformat(str(iso)[:10])
    except ValueError:
        return date.min


# El cuaderno es uno por proceso: el barrido entero —scan, largo radio y las
# busquedas guardadas de cada cuenta— comparte lo aprendido, y se escribe una
# sola vez al final.
_CUADERNO: Cuaderno | None = None


def cuaderno() -> Cuaderno:
    global _CUADERNO
    if _CUADERNO is None:
        _CUADERNO = Cuaderno()
    return _CUADERNO


def guardar() -> None:
    if _CUADERNO is not None:
        _CUADERNO.guardar()
