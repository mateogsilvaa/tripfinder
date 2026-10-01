"""La base de datos (Firebase) y la cola de encargos.

La web es estática y el repo público: no hay dónde guardar una cuenta, un correo
ni lo que busca cada cual sin que lo lea cualquiera. Firebase pone ese sitio:
Authentication para entrar y Firestore para guardar, con reglas
(`firestore.rules`) que dejan a cada persona ver solo lo suyo.

Lo que la web NO puede hacer es arrancar un scraper: eso corre en GitHub Actions.
Antes lo hacía con un token de GitHub cifrado dentro de `users.json`; ahora no
lleva ningún token. Apunta un *encargo* en Firestore (`encargos/{id}`) y este
módulo, desde un cron, lo recoge y levanta el workflow que toque:

    navegador --(reglas)--> encargos/{id} --(cron, cuenta de servicio)--> dispatch

Quien manda el encargo no decide de quién es. El dueño y su nombre se leen de la
ficha de la cuenta en Firestore, no de lo que traiga el encargo: las reglas ya
impiden pedirlo a nombre de otro, y aquí se vuelve a poner por si acaso.

Con la cuenta de servicio (`FIREBASE_SERVICE_ACCOUNT`, un secreto de GitHub) se
salta las reglas: esa clave abre TODO, así que nunca se imprime ni se escribe a
disco, y los mensajes de error no llevan nunca el contenido de un encargo.
"""

from __future__ import annotations

import json
import logging
import os
from collections.abc import Callable, Iterable
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

import requests

from .config import env, repo_slug

log = logging.getLogger("tripfinder")

# Los mismos de `firestore.rules`. Si se añade uno, va en los dos sitios: las
# reglas lo dejan pedir y aquí se sabe a qué workflow corresponde.
TIPOS = frozenset({"search", "stay", "interrail", "watch", "unwatch", "delete_search"})

# GitHub admite diez propiedades de primer nivel en un dispatch y el 422 que
# devuelve no dice cuál sobra. Se cuenta aquí, igual que en la web.
TOPE_PROPIEDADES = 10

# Un tope por cuenta y hora: las reglas no pueden contar, y un bucle en el
# navegador de alguien con acceso se llevaría los minutos de Actions de todos.
MAX_POR_HORA = 30

# `enviando` es el instante entre apuntar que se va a mandar y mandarlo. Si el
# proceso muere ahí, el encargo se queda así; pasado este rato se da por perdido
# en vez de reenviarlo, que sería arriesgarse a lanzar dos veces la misma búsqueda.
CADUCA_ENVIANDO = timedelta(minutes=30)

# Lo ya tramitado se borra pasada una semana: Firestore cobra por lo que se
# guarda y a nadie le sirve un encargo de hace un mes.
GUARDAR_TRAMITADOS = timedelta(days=7)


class Almacen(Protocol):
    """Lo mínimo que hace falta de la base de datos. Está aquí, y no escrito
    directamente contra Firestore, para poder probar la lógica sin red."""

    def pendientes(self) -> list[dict[str, Any]]: ...

    def atascados(self) -> list[dict[str, Any]]: ...

    def tramitados(self) -> list[dict[str, Any]]: ...

    def ficha(self, uid: str) -> dict[str, Any] | None: ...

    def enviados_de(self, uid: str) -> list[dict[str, Any]]: ...

    def actualizar(self, id_: str, **campos: Any) -> None: ...

    def borrar(self, id_: str) -> None: ...


# ---------------------------------------------------------------- Firestore
def abrir_firestore() -> Any:
    """El cliente de Firestore, o un error que dice qué falta (sin su valor)."""
    from google.cloud import firestore  # import tardío: pesa y solo se usa aquí

    if os.environ.get("FIRESTORE_EMULATOR_HOST"):
        from google.auth.credentials import AnonymousCredentials

        return firestore.Client(
            project=env("FIREBASE_PROJECT", "demo-tripfinder"),
            credentials=AnonymousCredentials(),
        )
    crudo = env("FIREBASE_SERVICE_ACCOUNT")
    if not crudo:
        raise RuntimeError("Falta FIREBASE_SERVICE_ACCOUNT (el JSON de la cuenta de servicio)")
    try:
        info = json.loads(crudo)
    except ValueError:
        # Sin `from err` a propósito: el mensaje de json.loads cita un trozo del
        # texto, y el texto es la clave.
        raise RuntimeError("FIREBASE_SERVICE_ACCOUNT no es un JSON válido") from None
    return firestore.Client.from_service_account_info(info)


class AlmacenFirestore:
    def __init__(self, db: Any) -> None:
        self.db = db

    def _por_estado(self, estados: Iterable[str]) -> list[dict[str, Any]]:
        from google.cloud.firestore_v1.base_query import FieldFilter

        salida: list[dict[str, Any]] = []
        for estado in estados:
            consulta = self.db.collection("encargos").where(filter=FieldFilter("estado", "==", estado))
            for d in consulta.stream():
                salida.append({**d.to_dict(), "id": d.id})
        return salida

    def pendientes(self) -> list[dict[str, Any]]:
        return self._por_estado(["pendiente"])

    def atascados(self) -> list[dict[str, Any]]:
        return self._por_estado(["enviando"])

    def tramitados(self) -> list[dict[str, Any]]:
        return self._por_estado(["enviado", "error", "rechazado"])

    def ficha(self, uid: str) -> dict[str, Any] | None:
        d = self.db.collection("usuarios").document(uid).get()
        return d.to_dict() if d.exists else None

    def enviados_de(self, uid: str) -> list[dict[str, Any]]:
        from google.cloud.firestore_v1.base_query import FieldFilter

        consulta = self.db.collection("encargos").where(filter=FieldFilter("owner", "==", uid))
        return [
            {**d.to_dict(), "id": d.id}
            for d in consulta.stream()
            if (d.to_dict() or {}).get("estado") in ("enviado", "enviando")
        ]

    def actualizar(self, id_: str, **campos: Any) -> None:
        self.db.collection("encargos").document(id_).update(campos)

    def borrar(self, id_: str) -> None:
        self.db.collection("encargos").document(id_).delete()


# ------------------------------------------------------------------ GitHub
def despachar_github(evento: str, payload: dict[str, Any]) -> None:
    """Levanta el workflow que escucha `evento`. Con el GITHUB_TOKEN del propio
    workflow vale: `repository_dispatch` es de los pocos eventos que ese token SÍ
    puede disparar (los demás no encadenan workflows)."""
    token = env("GITHUB_TOKEN") or env("GH_TOKEN")
    if not token:
        raise RuntimeError("Falta GITHUB_TOKEN (solo existe dentro de Actions)")
    r = requests.post(
        f"https://api.github.com/repos/{repo_slug()}/dispatches",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
        json={"event_type": evento, "client_payload": payload},
        timeout=30,
    )
    if r.status_code != 204:
        # El cuerpo de la respuesta puede citar el payload: no se copia.
        raise RuntimeError(f"GitHub contestó {r.status_code} al lanzar «{evento}»")


# ------------------------------------------------------------------ la cola
def _instante(valor: Any) -> datetime | None:
    if isinstance(valor, datetime):
        return valor if valor.tzinfo else valor.replace(tzinfo=UTC)
    return None


def _desde_el_principio(e: dict[str, Any]) -> datetime:
    return _instante(e.get("creado")) or datetime.min.replace(tzinfo=UTC)


def procesar(
    almacen: Almacen,
    enviar: Callable[[str, dict[str, Any]], None] = despachar_github,
    ahora: datetime | None = None,
) -> dict[str, int]:
    """Recoge los encargos pendientes y los manda. Devuelve cuántos de cada cosa.

    Nada de lo que falle aquí tumba la pasada: un encargo roto no puede dejar sin
    atender a los que vienen detrás."""
    ahora = ahora or datetime.now(UTC)
    cuenta = {"enviado": 0, "rechazado": 0, "error": 0, "atascado": 0, "borrado": 0}

    for e in almacen.atascados():
        desde = _instante(e.get("procesado")) or _desde_el_principio(e)
        if ahora - desde > CADUCA_ENVIANDO:
            almacen.actualizar(e["id"], estado="error", motivo="se quedó a medias", procesado=ahora)
            cuenta["atascado"] += 1

    for e in sorted(almacen.pendientes(), key=_desde_el_principio):
        estado, motivo = _tramitar(almacen, enviar, e, ahora)
        cuenta[estado] += 1
        log.info("Encargo %s: %s%s", e["id"][:8], estado, f" ({motivo})" if motivo else "")

    for e in almacen.tramitados():
        hecho = _instante(e.get("procesado")) or _desde_el_principio(e)
        if ahora - hecho > GUARDAR_TRAMITADOS:
            almacen.borrar(e["id"])
            cuenta["borrado"] += 1
    return cuenta


def _tramitar(
    almacen: Almacen,
    enviar: Callable[[str, dict[str, Any]], None],
    e: dict[str, Any],
    ahora: datetime,
) -> tuple[str, str]:
    def cerrar(estado: str, motivo: str = "") -> tuple[str, str]:
        almacen.actualizar(e["id"], estado=estado, motivo=motivo[:200], procesado=ahora)
        return estado, motivo

    tipo = e.get("tipo")
    if tipo not in TIPOS:
        return cerrar("rechazado", "tipo desconocido")

    uid = e.get("owner")
    ficha = almacen.ficha(uid) if isinstance(uid, str) and uid else None
    # Las reglas ya exigen una cuenta aprobada al crearlo, pero entre crearlo y
    # llegar aquí pueden haberla bloqueado.
    if not ficha or ficha.get("estado") != "aprobado":
        return cerrar("rechazado", "la cuenta no está aprobada")

    # Lo que se acaba de mandar en esta misma pasada ya cuenta: `cerrar` lo ha
    # apuntado como enviado con `procesado = ahora`, así que sale en la consulta.
    hace_una_hora = ahora - timedelta(hours=1)
    recientes = sum(
        1 for o in almacen.enviados_de(uid) if (_instante(o.get("procesado")) or ahora) >= hace_una_hora
    )
    if recientes >= MAX_POR_HORA:
        return cerrar("rechazado", f"más de {MAX_POR_HORA} encargos en una hora")

    payload = dict(e.get("payload") or {})
    # El dueño sale de la ficha, nunca del encargo.
    payload["owner"] = uid
    payload["owner_name"] = str(ficha.get("nombre") or "")
    if len(payload) > TOPE_PROPIEDADES:
        return cerrar("error", f"{len(payload)} propiedades y GitHub admite {TOPE_PROPIEDADES}")

    almacen.actualizar(e["id"], estado="enviando", procesado=ahora)
    try:
        enviar(tipo, payload)
    except Exception as err:  # noqa: BLE001 - un encargo roto no frena a los demás
        return cerrar("error", str(err))
    return cerrar("enviado")
