"""Cuentas: quien entra en la web y de quien es cada cosa.

El feed de chollos es el mismo para todo el mundo -- es un tablon publico --,
pero los favoritos, los seguimientos y las busquedas guardadas son de quien las
pide. Para separarlas hace falta saber quien esta delante, y para eso hace falta
un sitio donde vivan las cuentas: `data/users.json`, como todo lo demas aqui.

Las contrasenas NO se guardan: se guarda un PBKDF2-SHA256 con sal por cuenta.
El navegador calcula exactamente el mismo hash con WebCrypto (web/auth.js), asi
que dar de alta a alguien desde el panel y comprobarlo aqui dan el mismo
resultado y la contrasena en claro no sale nunca del navegador.

Aviso honesto sobre hasta donde llega esto: el repositorio es publico y
`data/users.json` se sirve en la web, o sea que cualquiera puede leer los hashes.
PBKDF2 con 210.000 vueltas hace que una contrasena decente no se saque de ahi en
un rato, pero esto separa espacios de trabajo entre gente que se conoce; no
guarda secretos frente a un desconocido con ganas. Lo unico que de verdad cierra
la puerta a escribir es el token de GitHub, que solo tienes tu.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import logging
import re
import secrets
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any

from .config import DATA_DIR

log = logging.getLogger("tripfinder")

FICHERO = DATA_DIR / "users.json"

# Mismo numero en web/auth.js. Si sube aqui, sube alli: los hashes viejos siguen
# valiendo porque cada cuenta guarda con cuantas vueltas se calculo el suyo.
ITERACIONES = 210_000
LONGITUD = 32  # bytes de la clave derivada

_USUARIO_OK = re.compile(r"^[a-z0-9._-]{3,24}$")


def _ahora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _b64(crudo: bytes) -> str:
    return base64.b64encode(crudo).decode("ascii")


def _debase64(texto: str) -> bytes:
    return base64.b64decode(texto.encode("ascii"))


def hashear(password: str, salt: str = "", iteraciones: int = ITERACIONES) -> dict[str, Any]:
    """Deriva la contrasena. Devuelve lo que se guarda en el fichero."""
    sal = _debase64(salt) if salt else secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), sal, iteraciones, LONGITUD)
    return {"salt": _b64(sal), "hash": _b64(dk), "iterations": iteraciones}


def comprobar(password: str, guardado: dict[str, Any] | None) -> bool:
    """Compara en tiempo constante contra lo guardado."""
    if not guardado or not guardado.get("hash") or not guardado.get("salt"):
        return False
    try:
        calculado = hashear(
            password, guardado["salt"], int(guardado.get("iterations") or ITERACIONES)
        )
    except (ValueError, TypeError, binascii.Error):
        return False
    return hmac.compare_digest(calculado["hash"], str(guardado["hash"]))


@dataclass
class User:
    id: str
    user: str  # el nombre con el que entra, en minusculas
    name: str = ""  # como se le llama en la web
    email: str = ""  # opcional: a donde van sus avisos
    salt: str = ""
    hash: str = ""
    iterations: int = ITERACIONES
    created: str = ""
    active: bool = True

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @property
    def credencial(self) -> dict[str, Any]:
        return {"salt": self.salt, "hash": self.hash, "iterations": self.iterations}


def _vacio() -> dict[str, Any]:
    return {"updated": "", "admin": {}, "users": []}


def _cargar() -> dict[str, Any]:
    if not FICHERO.exists():
        return _vacio()
    try:
        crudo = json.loads(FICHERO.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        log.warning("data/users.json ilegible; se empieza de cero")
        return _vacio()
    if not isinstance(crudo, dict):
        return _vacio()
    crudo.setdefault("admin", {})
    crudo.setdefault("users", [])
    return crudo


def _guardar(datos: dict[str, Any]) -> None:
    datos["updated"] = _ahora()
    FICHERO.parent.mkdir(parents=True, exist_ok=True)
    FICHERO.write_text(json.dumps(datos, ensure_ascii=False, indent=2), encoding="utf-8")


def _hidratar(d: dict[str, Any]) -> User:
    conocidos = {k: v for k, v in d.items() if k in User.__dataclass_fields__}
    return User(**conocidos)


def listar(incluir_inactivos: bool = True) -> list[User]:
    return [
        u
        for u in (_hidratar(d) for d in _cargar().get("users", []))
        if incluir_inactivos or u.active
    ]


def buscar(ident: str) -> User | None:
    """Por id o por nombre de usuario; da igual como lo escribas."""
    clave = (ident or "").strip().lower()
    for u in listar():
        if clave in (u.id.lower(), u.user.lower()):
            return u
    return None


def nuevo_id() -> str:
    existentes = {u.id for u in listar()}
    while True:
        ident = f"u-{secrets.token_hex(4)}"
        if ident not in existentes:
            return ident


def anadir(
    user: str,
    name: str = "",
    password: str = "",
    email: str = "",
    credencial: dict[str, Any] | None = None,
    uid: str = "",
) -> User:
    """Da de alta una cuenta.

    O se pasa `password` (uso local desde la terminal) o se pasa `credencial`,
    que es lo que manda el panel: el navegador ya ha hecho el PBKDF2 y aqui solo
    llega la sal y el hash, nunca la contrasena.
    """
    nombre_login = (user or "").strip().lower()
    if not _USUARIO_OK.match(nombre_login):
        raise ValueError(
            "El usuario debe tener entre 3 y 24 caracteres y solo letras, numeros, punto, guion o guion bajo."
        )
    datos = _cargar()
    if any((u.get("user") or "").lower() == nombre_login for u in datos["users"]):
        raise ValueError(f"Ya existe una cuenta con el usuario '{nombre_login}'.")

    if credencial:
        cred = {
            "salt": str(credencial["salt"]),
            "hash": str(credencial["hash"]),
            "iterations": int(credencial.get("iterations") or ITERACIONES),
        }
    elif password:
        cred = hashear(password)
    else:
        raise ValueError("Hace falta una contrasena (o el hash ya calculado).")

    u = User(
        id=uid or nuevo_id(),
        user=nombre_login,
        name=(name or nombre_login).strip(),
        email=(email or "").strip(),
        salt=cred["salt"],
        hash=cred["hash"],
        iterations=cred["iterations"],
        created=_ahora(),
        active=True,
    )
    datos["users"].append(u.to_dict())
    _guardar(datos)
    log.info("Cuenta creada: %s (%s)", u.user, u.id)
    return u


def borrar(ident: str) -> bool:
    datos = _cargar()
    clave = (ident or "").strip().lower()
    quedan = [
        d
        for d in datos["users"]
        if clave not in ((d.get("id") or "").lower(), (d.get("user") or "").lower())
    ]
    if len(quedan) == len(datos["users"]):
        return False
    datos["users"] = quedan
    _guardar(datos)
    return True


def activar(ident: str, activo: bool) -> bool:
    """Desactivar deja la cuenta y sus seguimientos donde estan, pero no deja entrar."""
    datos = _cargar()
    clave = (ident or "").strip().lower()
    tocado = False
    for d in datos["users"]:
        if clave in ((d.get("id") or "").lower(), (d.get("user") or "").lower()):
            d["active"] = bool(activo)
            tocado = True
    if tocado:
        _guardar(datos)
    return tocado


def cambiar_password(
    ident: str, password: str = "", credencial: dict[str, Any] | None = None
) -> bool:
    datos = _cargar()
    clave = (ident or "").strip().lower()
    cred = (
        {
            "salt": str(credencial["salt"]),
            "hash": str(credencial["hash"]),
            "iterations": int(credencial.get("iterations") or ITERACIONES),
        }
        if credencial
        else hashear(password)
    )
    tocado = False
    for d in datos["users"]:
        if clave in ((d.get("id") or "").lower(), (d.get("user") or "").lower()):
            d.update(cred)
            tocado = True
    if tocado:
        _guardar(datos)
    return tocado


def autenticar(user: str, password: str) -> User | None:
    """Lo que hace la web al entrar, aqui para poder probarlo sin navegador."""
    u = buscar(user)
    if not u or not u.active:
        return None
    return u if comprobar(password, u.credencial) else None


# --------------------------------------------------------------------- admin
def hay_admin() -> bool:
    return bool(_cargar().get("admin", {}).get("hash"))


def set_admin(password: str = "", credencial: dict[str, Any] | None = None) -> None:
    """La contrasena del panel. Es una sola: el panel es tuyo, no de las cuentas."""
    datos = _cargar()
    cred = (
        {
            "salt": str(credencial["salt"]),
            "hash": str(credencial["hash"]),
            "iterations": int(credencial.get("iterations") or ITERACIONES),
        }
        if credencial
        else hashear(password)
    )
    cred["updated"] = _ahora()
    datos["admin"] = cred
    _guardar(datos)
    log.info("Contrasena del panel actualizada")


def comprobar_admin(password: str) -> bool:
    return comprobar(password, _cargar().get("admin"))
