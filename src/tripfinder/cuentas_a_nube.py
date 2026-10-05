"""Copia las cuentas de antes de Firebase a Firestore, para que nadie pierda nada.

Antes de Firebase, las cuentas vivían en `data/users.json`, que es público. Esto
copia de cada una lo que hace falta para que su dueño la recupere con su cuenta
nueva, en `cuentas_antiguas/<id>`:

    usuario, nombre, correo, prefs, activa, creada

y NADA más. Ni el hash de la contraseña, ni el sobre, ni el token del sitio: las
cuentas nuevas se autentican con Firebase y esos datos no sirven para nada allí.

El id es el de siempre (`u-1a2b3c4d`) a propósito: es el `owner` de sus
seguimientos y de sus búsquedas guardadas, así que al vincular la cuenta nueva
con esta, todo eso vuelve a ser suyo sin tocar un solo fichero de `data/`.

Mientras una cuenta antigua no esté vinculada, sigue recibiendo sus avisos por
correo desde aquí (`nube.cuentas_para_avisos`): no pierde nada por tardar en
entrar con Firebase.

Se puede repetir las veces que haga falta. Se escribe con `merge`, así que volver
a pasarlo no borra la marca `vinculada` que pone el panel al vincular.

El log de un repositorio público lo lee cualquiera: solo salen recuentos.
"""

from __future__ import annotations

from collections import Counter
from typing import Any, Protocol

from . import users as U

COLECCION = "cuentas_antiguas"


class Almacen(Protocol):
    def escribir(self, docs: list[dict[str, Any]]) -> None: ...

    def contar(self) -> Counter[str]: ...


def documento(cuenta: U.User) -> dict[str, Any]:
    """Lo que se copia de una cuenta. Lo que no está aquí, no sale del repo."""
    return {
        "id": cuenta.id,
        "usuario": cuenta.user,
        "nombre": cuenta.name or cuenta.user,
        "correo": (cuenta.email or "").strip().lower(),
        "prefs": U.prefs_validas(cuenta.prefs),
        "activa": bool(cuenta.active),
        "creada": cuenta.created or "",
    }


class AlmacenFirestore:
    def __init__(self, db: Any) -> None:
        self.db = db

    def escribir(self, docs: list[dict[str, Any]]) -> None:
        lote = self.db.batch()
        for d in docs:
            ref = self.db.collection(COLECCION).document(d["id"])
            # `merge`: no pisa `vinculada`, que escribe el panel, ni nada que se
            # haya añadido después.
            lote.set(ref, {k: v for k, v in d.items() if k != "id"}, merge=True)
        lote.commit()

    def contar(self) -> Counter[str]:
        cuenta: Counter[str] = Counter()
        for d in self.db.collection(COLECCION).stream():
            datos = d.to_dict() or {}
            cuenta["total"] += 1
            cuenta["vinculadas" if datos.get("vinculada") else "sin_vincular"] += 1
        return cuenta


def migrar(cuentas: list[U.User], almacen: Almacen | None, escribir: bool) -> dict[str, Any]:
    docs = [documento(c) for c in cuentas]
    resumen: dict[str, Any] = {
        "cuentas": len(docs),
        "con_correo": sum(1 for d in docs if d["correo"]),
        "activas": sum(1 for d in docs if d["activa"]),
        "escritas": 0,
        "ok": True,
    }
    if not escribir:
        return resumen
    if almacen is None:
        raise RuntimeError("Sin almacén no se puede escribir")
    almacen.escribir(docs)
    resumen["escritas"] = len(docs)
    guardado = almacen.contar()
    resumen["guardado"] = dict(guardado)
    # Puede haber más guardadas que enviadas, nunca menos.
    resumen["ok"] = guardado.get("total", 0) >= len(docs)
    return resumen
