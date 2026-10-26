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

# Lo que puede hacer cada plan. Gratis ve los chollos y los recibe por correo;
# premium, además, lanza scrapers. Una ficha aprobada sin `plan` es de antes de
# abrir la web —la de un conocido— y cuenta como premium, igual que en las reglas.


# Premium existe pero todavía no se exige: con esto apagado, cualquier cuenta
# aprobada lanza scrapers. Va a juego con `firestore.rules` y `web/nube.js`.
PREMIUM_OBLIGATORIO = False


def plan_de(ficha: dict[str, Any] | None) -> str:
    return str((ficha or {}).get("plan") or "premium")


def es_premium(ficha: dict[str, Any] | None) -> bool:
    return bool(ficha) and ficha.get("estado") == "aprobado" and plan_de(ficha) == "premium"


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

    def fichas_pendientes(self) -> list[dict[str, Any]]: ...

    def abrir_ficha(self, uid: str) -> None: ...


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

    def fichas_pendientes(self) -> list[dict[str, Any]]:
        from google.cloud.firestore_v1.base_query import FieldFilter

        consulta = self.db.collection("usuarios").where(filter=FieldFilter("estado", "==", "pendiente"))
        return [{**d.to_dict(), "id": d.id} for d in consulta.stream()]

    def abrir_ficha(self, uid: str) -> None:
        self.db.collection("usuarios").document(uid).update({"estado": "aprobado", "plan": "gratis"})


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
    cuenta = {"enviado": 0, "rechazado": 0, "error": 0, "atascado": 0, "borrado": 0, "abiertas": 0}

    # La web es abierta: lo que quede `pendiente` —de antes de abrirla, o de una
    # web vieja en la caché de algún navegador— pasa a gratis. Antes de los
    # encargos, para que nadie se quede esperando una aprobación que ya no existe.
    for f in almacen.fichas_pendientes():
        almacen.abrir_ficha(f["id"])
        cuenta["abiertas"] += 1

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
    # Las reglas ya exigen una cuenta premium al crearlo, pero entre crearlo y
    # llegar aquí pueden haberla bloqueado o haberle quitado el premium.
    if not ficha or ficha.get("estado") != "aprobado":
        return cerrar("rechazado", "la cuenta no está aprobada")
    if PREMIUM_OBLIGATORIO and not es_premium(ficha):
        return cerrar("rechazado", "la cuenta es gratis: lanzar búsquedas es de premium")
    if tipo == "interrail" and (e.get("payload") or {}).get("ruta") == "tuya" and not es_premium(ficha):
        return cerrar("rechazado", "el Interrail a medida es de premium")

    # Lo que se acaba de mandar en esta misma pasada ya cuenta: `cerrar` lo ha
    # apuntado como enviado con `procesado = ahora`, así que sale en la consulta.
    hace_una_hora = ahora - timedelta(hours=1)
    recientes = sum(
        1 for o in almacen.enviados_de(uid) if (_instante(o.get("procesado")) or ahora) >= hace_una_hora
    )
    if recientes >= MAX_POR_HORA:
        return cerrar("rechazado", f"más de {MAX_POR_HORA} encargos en una hora")

    payload = dict(e.get("payload") or {})
    # El dueño sale de la ficha, nunca del encargo. Si la cuenta se vinculó con una
    # de antes de Firebase, lleva los dos ids (el nuevo primero): lo de antes lleva
    # el viejo, y sin él no podría borrar sus seguimientos ni sus búsquedas.
    legado = str(ficha.get("legado") or "").strip()
    payload["owner"] = f"{uid},{legado}" if legado else uid
    payload["owner_name"] = str(ficha.get("nombre") or "")
    if len(payload) > TOPE_PROPIEDADES:
        return cerrar("error", f"{len(payload)} propiedades y GitHub admite {TOPE_PROPIEDADES}")

    almacen.actualizar(e["id"], estado="enviando", procesado=ahora)
    try:
        enviar(tipo, payload)
    except Exception as err:  # noqa: BLE001 - un encargo roto no frena a los demás
        return cerrar("error", str(err))
    return cerrar("enviado")


# ------------------------------------------- a quién se le manda cada aviso
def cuentas_para_avisos(db: Any | None = None) -> tuple[list[Any], dict[str, str]]:
    """Las cuentas que reciben avisos y quién es quién, desde Firestore.

    Devuelve `(cuentas, alias)`:

    - `cuentas`: las cuentas nuevas aprobadas MÁS las de antes de Firebase que
      todavía no se han vinculado. Estas últimas siguen recibiendo sus avisos con
      lo que eligieron: no pierden nada por tardar en entrar con Firebase.
    - `alias`: de cada cuenta antigua vinculada, a qué cuenta nueva corresponde.
      Los seguimientos viejos llevan como `owner` el id de antes, y con esto el
      parte llega igual a su dueño.

    Si Firestore no contesta, devuelve vacío en vez de tumbar el barrido: el aviso
    al buzón de la configuración sigue saliendo.
    """
    from . import users as U

    try:
        db = db or abrir_firestore()
        cuentas: list[Any] = []
        alias: dict[str, str] = {}
        for d in db.collection("usuarios").stream():
            f = d.to_dict() or {}
            if f.get("estado") != "aprobado" or not f.get("correo"):
                continue
            # Con la web abierta cualquiera se registra con cualquier dirección:
            # a una cuenta gratis solo se le escribe si ha demostrado que el
            # correo es suyo. Si no, registrarse con el correo de otro sería
            # una forma gratis de mandarle spam desde nuestro Gmail.
            if plan_de(f) == "gratis" and f.get("verificado") is not True:
                continue
            cuentas.append(
                U.User(
                    id=d.id,
                    user=str(f.get("nombre") or d.id),
                    name=str(f.get("nombre") or ""),
                    email=str(f["correo"]),
                    prefs=U.prefs_validas(f.get("prefs")),
                )
            )
            if f.get("legado"):
                alias[str(f["legado"])] = d.id
        for d in db.collection("cuentas_antiguas").stream():
            f = d.to_dict() or {}
            if f.get("vinculada") or not f.get("activa", True) or not f.get("correo"):
                continue
            cuentas.append(
                U.User(
                    id=d.id,
                    user=str(f.get("usuario") or d.id),
                    name=str(f.get("nombre") or ""),
                    email=str(f["correo"]),
                    prefs=U.prefs_validas(f.get("prefs")),
                )
            )
        return cuentas, alias
    except Exception as exc:  # noqa: BLE001 - un fallo aqui no puede tumbar el barrido
        motivo = type(exc).__name__
        log.warning("No se pudieron leer las cuentas de Firestore (%s): sin avisos por cuenta", motivo)
        return [], {}


# ------------------------------------------- resultados, sin esperar a Pages
# Un resultado (las camas de un vuelo, de una parada del Interrail) se escribe
# en `data/` y se publica con la web: commit, push y despliegue de Pages, uno o
# tres minutos más de espera con la búsqueda ya terminada. Copiado aquí, la web
# lo lee en cuanto existe. Lo de `data/` sigue siendo el original: esto es un
# atajo, y si falla no pasa nada.
#
# Va como texto JSON en un solo campo y no como mapa de Firestore: es lo que la
# web ya sabe leer, y un mapa con tipos por campo pesaría el triple.
TOPE_RESULTADO = 900_000  # Firestore admite 1 MiB por documento
GUARDAR_RESULTADOS = timedelta(days=3)


def id_resultado(clave: str) -> str:
    return "".join(c if c.isalnum() or c in "-_." else "_" for c in clave)[:200]


def publicar_resultado(clave: str, datos: dict[str, Any], db: Any | None = None) -> bool:
    """Copia un resultado a `resultados/{clave}`. Nunca lanza: es un atajo."""
    texto = json.dumps(datos, ensure_ascii=False, separators=(",", ":"))
    if len(texto.encode()) > TOPE_RESULTADO:
        log.info("Resultado %s demasiado grande para Firestore: solo en data/", clave)
        return False
    try:
        db = db or abrir_firestore()
        db.collection("resultados").document(id_resultado(clave)).set(
            {"json": texto, "creado": datetime.now(UTC)}
        )
        return True
    except Exception as exc:  # noqa: BLE001 - sin atajo, la web espera a Pages
        log.warning("No se pudo copiar el resultado a Firestore (%s)", type(exc).__name__)
        return False


def borrar_resultados_viejos(db: Any, ahora: datetime | None = None) -> int:
    """Lo de hace más de tres días ya está en Pages: fuera de Firestore."""
    from google.cloud.firestore_v1.base_query import FieldFilter

    corte = (ahora or datetime.now(UTC)) - GUARDAR_RESULTADOS
    n = 0
    for d in db.collection("resultados").where(filter=FieldFilter("creado", "<", corte)).stream():
        d.reference.delete()
        n += 1
    return n


def hay_firebase() -> bool:
    return bool(os.environ.get("FIREBASE_SERVICE_ACCOUNT") or os.environ.get("FIRESTORE_EMULATOR_HOST"))
