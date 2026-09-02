"""Cuentas: quien entra en la web y de quien es cada cosa.

El feed de chollos es el mismo para todo el mundo -- es un tablon publico --,
pero los favoritos, los seguimientos y las busquedas guardadas son de quien las
pide. Para separarlas hace falta saber quien esta delante, y para eso hace falta
un sitio donde vivan las cuentas: `data/users.json`, como todo lo demas aqui.

Las contrasenas NO se guardan: se guarda un PBKDF2-SHA256 con sal por cuenta.
El navegador calcula exactamente el mismo hash con WebCrypto (web/auth.js), asi
que dar de alta a alguien desde el panel y comprobarlo aqui dan el mismo
resultado y la contrasena en claro no sale nunca del navegador.

Aqui vive tambien el token con el que la web escribe en el repo, pero cifrado y
sin que este modulo pueda abrirlo. El esquema es el clasico del sobre:

    clave maestra K  --(AES-GCM)-->  token de GitHub        -> data/users.json
    contrasena de Ana --(PBKDF2)--> clave --(AES-GCM)--> K   -> su "sobre"

Cifrar y descifrar pasa siempre en el navegador (web/auth.js). Aqui solo se
guardan los sobres tal cual llegan: Python no ve el token ni la clave maestra en
ningun momento, y el fichero publicado no lleva nada en claro. Quien lea
`data/users.json` sin la contrasena de alguna cuenta no saca el token: romper un
sobre cuesta exactamente lo mismo que romper el login.

Aviso honesto sobre hasta donde llega esto: el repositorio es publico y
`data/users.json` se sirve en la web, o sea que cualquiera puede leer los hashes
y los sobres. PBKDF2 con 210.000 vueltas hace que una contrasena decente no se
saque de ahi en un rato, pero todo se apoya en que las contrasenas sean buenas:
elige contrasenas largas y que no uses en ningun otro sitio.
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
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
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
    return datetime.now(UTC).isoformat(timespec="seconds")


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


# Que correos quiere cada uno. Lo que se puede cumplir de verdad, ni una opcion
# de adorno: el scan de vuelos y el repaso de seguimientos son los dos unicos
# sitios desde los que sale un email.
FRECUENCIAS = ("cada_vez", "diario", "semanal", "nunca")

PREFS_DEFECTO: dict[str, Any] = {
    # Chollos del dia: "cada_vez" es el aviso en cuanto aparece algo excepcional.
    "chollos": "cada_vez",
    # Tope opcional para no recibir chollos que no te vas a plantear.
    "chollos_max_precio": None,
    # Parte de seguimientos. "cada_vez" aqui equivale a "diario": el cron pasa
    # una vez al dia, asi que no hay una frecuencia mayor posible.
    "seguimientos": "diario",
    # Si esta puesto, el parte solo sale cuando hay algo nuevo que contar; si no,
    # llega igualmente diciendo que se ha mirado y no habia nada.
    "seguimientos_solo_novedades": False,
}


def prefs_validas(crudo: Any) -> dict[str, Any]:
    """Normaliza lo que llega de la web. Lo que no se entienda, al valor de casa."""
    prefs = dict(PREFS_DEFECTO)
    if not isinstance(crudo, dict):
        return prefs
    for clave in ("chollos", "seguimientos"):
        valor = str(crudo.get(clave, "")).strip().lower()
        if valor in FRECUENCIAS:
            prefs[clave] = valor
    tope = crudo.get("chollos_max_precio")
    try:
        prefs["chollos_max_precio"] = float(tope) if tope not in (None, "", "0", 0) else None
    except (TypeError, ValueError):
        prefs["chollos_max_precio"] = None
    prefs["seguimientos_solo_novedades"] = bool(crudo.get("seguimientos_solo_novedades"))
    return prefs


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
    # Que correos quiere y cada cuanto.
    prefs: dict[str, Any] = field(default_factory=lambda: dict(PREFS_DEFECTO))
    # La clave maestra cifrada con SU contrasena. Es lo que le deja abrir el
    # token del sitio; una cuenta sin sobre entra en la web pero no puede
    # lanzar nada. Aqui es una caja opaca: solo el navegador sabe abrirla.
    sobre: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @property
    def puede_escribir(self) -> bool:
        """Si su sobre sigue abriendose con su contrasena de ahora."""
        return bool(self.sobre.get("data")) and not self.sobre.get("stale")

    @property
    def credencial(self) -> dict[str, Any]:
        return {"salt": self.salt, "hash": self.hash, "iterations": self.iterations}


def _vacio() -> dict[str, Any]:
    return {"updated": "", "admin": {}, "site": {}, "users": []}


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
    crudo.setdefault("site", {})
    crudo.setdefault("users", [])
    return crudo


def _guardar(datos: dict[str, Any]) -> None:
    datos["updated"] = _ahora()
    FICHERO.parent.mkdir(parents=True, exist_ok=True)
    FICHERO.write_text(json.dumps(datos, ensure_ascii=False, indent=2), encoding="utf-8")


def _hidratar(d: dict[str, Any]) -> User:
    conocidos = {k: v for k, v in d.items() if k in User.__dataclass_fields__}
    # Las cuentas creadas antes de que hubiera preferencias no las traen: se
    # rellenan con las de casa en vez de romper.
    conocidos["prefs"] = prefs_validas(conocidos.get("prefs"))
    conocidos["sobre"] = conocidos.get("sobre") or {}
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
    sobre: dict[str, Any] | None = None,
    prefs: dict[str, Any] | None = None,
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
        prefs=prefs_validas(prefs),
        sobre=dict(sobre or {}),
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
    ident: str,
    password: str = "",
    credencial: dict[str, Any] | None = None,
    sobre: dict[str, Any] | None = None,
) -> bool:
    """Cambia la contrasena y, con ella, el sobre.

    El sobre esta cifrado con la contrasena vieja: si se cambia una sin la otra,
    la cuenta entra en la web pero ya no puede abrir el token. Por eso el panel
    manda las dos cosas juntas y aqui se escriben juntas.
    """
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
            if sobre:
                d["sobre"] = dict(sobre)
            elif d.get("sobre", {}).get("data"):
                # Contrasena nueva y sobre viejo: ese sobre ya no se abre con
                # ella. No se borra (si vuelve la contrasena de antes, vuelve a
                # servir), pero se marca para que el panel lo cante en vez de
                # ensenar una cuenta que dice que puede y luego no puede.
                d["sobre"]["stale"] = True
                log.warning(
                    "%s cambia de contrasena sin sobre nuevo: se queda sin poder "
                    "lanzar nada hasta que le pongas la contrasena desde el panel",
                    d.get("user"),
                )
            tocado = True
    if tocado:
        _guardar(datos)
    return tocado


def cambiar_prefs(ident: str, prefs: dict[str, Any], email: str | None = None) -> bool:
    """Lo que una cuenta puede cambiar de si misma desde la web: sus correos.

    El email entra aqui y no en un comando aparte porque "a donde me llegan" es
    parte de la misma decision que "cuales me llegan".
    """
    datos = _cargar()
    clave = (ident or "").strip().lower()
    limpias = prefs_validas(prefs)
    tocado = False
    for d in datos["users"]:
        if clave in ((d.get("id") or "").lower(), (d.get("user") or "").lower()):
            d["prefs"] = limpias
            if email is not None:
                d["email"] = email.strip()
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


def set_admin(
    password: str = "",
    credencial: dict[str, Any] | None = None,
    sobre: dict[str, Any] | None = None,
) -> None:
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
    # El panel tambien tiene su sobre: sin el, cambiar la contrasena del panel
    # dejaria el token guardado y sin nadie que pudiera abrirlo.
    anterior = datos.get("admin", {}).get("sobre") or {}
    cred["sobre"] = dict(sobre or anterior)
    if not sobre and anterior.get("data"):
        # Igual que con las cuentas, pero aqui duele mas: dentro del sobre del
        # panel esta la clave maestra, y sin ella el token guardado no lo abre
        # nadie. Se conserva por si vuelve la contrasena vieja.
        cred["sobre"]["stale"] = True
        log.warning(
            "Contrasena del panel cambiada sin rehacer su sobre: hasta que vuelvas "
            "a poner el token desde el panel, la web no podra escribir"
        )
    datos["admin"] = cred
    _guardar(datos)
    log.info("Contrasena del panel actualizada")


def comprobar_admin(password: str) -> bool:
    return comprobar(password, _cargar().get("admin"))


# ------------------------------------------------------------ token del sitio
def set_site_token(
    token_cifrado: dict[str, Any], sobre_admin: dict[str, Any] | None = None
) -> None:
    """Guarda el token de GitHub tal y como lo cifro el navegador.

    Aqui nunca llega en claro: lo que se escribe es AES-GCM con la clave maestra,
    y esa clave solo la tienen las cuentas dentro de su sobre. Este modulo no
    puede abrirlo, y ese es justo el punto.
    """
    datos = _cargar()
    datos["site"] = {
        "token": {"iv": str(token_cifrado["iv"]), "data": str(token_cifrado["data"])},
        "updated": _ahora(),
    }
    # La clave maestra nace a la vez que el token, asi que el sobre del panel
    # llega en el mismo viaje: si no, quedaria un token que no abre nadie.
    if sobre_admin:
        datos.setdefault("admin", {})["sobre"] = dict(sobre_admin)
    _guardar(datos)
    log.info("Token del sitio guardado (cifrado)")


def hay_site_token() -> bool:
    return bool(_cargar().get("site", {}).get("token", {}).get("data"))
