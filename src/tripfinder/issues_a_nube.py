"""Pasa lo que hay en las issues a Firestore.

Las issues fueron durante meses el sitio donde se apuntaba todo: los avisos de
chollo, las peticiones de cuenta, las búsquedas de alojamiento y la lista de
tareas. El repo es público y ahí lo lee cualquiera; en Firestore las reglas
dejan esa colección cerrada para el navegador y solo entra y sale la cuenta de
servicio.

Una issue es un documento (`issues/<número>`), con el mismo contenido que tenía:
título, cuerpo, etiquetas, quién la abrió, fechas, estado y comentarios. A eso se
le añade `tipo`, que dice de qué clase es, y en las que llevan datos pensados
para una máquina (una petición de cuenta, una búsqueda de alojamiento) esos datos
sacados ya en campos, en `datos`.

Se puede repetir las veces que haga falta: el id es el número, así que volver a
pasarlo reescribe lo mismo en vez de duplicar.

Lo que NO hace, a propósito:

- No abre ningún sobre. Una petición de cuenta puede traer el correo y la
  contraseña cerrados con la clave pública del panel; abrirlos es cosa del
  navegador (`web/auth.js`) y Python no sabe, así que ese bloque no se copia. Solo
  queda anotado que lo había (`datos.con_sobre`).
- No imprime nada de lo que contienen. El log de un workflow de un repo público
  lo lee cualquiera, y una petición de cuenta lleva un nombre y un usuario:
  solo salen recuentos.
- No toca las issues. Ni las cierra ni las borra.
"""

from __future__ import annotations

import logging
import re
from collections import Counter
from collections.abc import Iterable
from datetime import UTC, datetime
from typing import Any, Protocol

import requests

from .config import env, repo_slug

log = logging.getLogger("tripfinder")

API = "https://api.github.com"
COLECCION = "issues"

# Lo que cabe en un documento de Firestore es 1 MiB. Un comentario no se acerca,
# pero el de un workflow con resultados sí podría crecer: se corta con aviso.
MAX_CUERPO = 50_000
MAX_COMENTARIOS = 100

TIPOS = ("chollo", "sin_novedad", "peticion_cuenta", "alojamiento", "tarea")

# El bloque cerrado de una petición de cuenta: ```tf-sobre ... ```
_SOBRE = re.compile(r"```tf-sobre\s.*?```", re.DOTALL)


class Almacen(Protocol):
    """Lo mínimo que hace falta de la base de datos, para poder probar todo lo
    demás sin red."""

    def escribir(self, docs: list[dict[str, Any]]) -> None: ...

    def contar_por_tipo(self) -> Counter[str]: ...


# ----------------------------------------------------------------- clasificar
def clasificar(issue: dict[str, Any]) -> str:
    titulo = str(issue.get("title") or "")
    etiquetas = {str(e.get("name") if isinstance(e, dict) else e) for e in issue.get("labels") or []}
    if titulo.startswith("[cuenta]") or "peticion-cuenta" in etiquetas:
        return "peticion_cuenta"
    if titulo.startswith("[stay]"):
        return "alojamiento"
    if "chollo" in etiquetas or titulo.startswith("[TripFinder]"):
        # El parte diario sin nada que contar: solo trae el título.
        return "sin_novedad" if "Sin novedad" in titulo else "chollo"
    return "tarea"


def _campo(cuerpo: str, nombre: str) -> str:
    m = re.search(rf"^{re.escape(nombre)}:[ \t]*(.*)$", cuerpo, re.MULTILINE)
    return m.group(1).strip() if m else ""


def _peticion_de_cuenta(cuerpo: str) -> dict[str, Any]:
    porque = ""
    m = re.search(r"^Por qué:[ \t]*\n(.*?)(?:\n\s*---|\Z)", cuerpo, re.MULTILINE | re.DOTALL)
    if m:
        porque = m.group(1).strip()
    return {
        "nombre": _campo(cuerpo, "Nombre"),
        "usuario": _campo(cuerpo, "Usuario"),
        "porque": porque,
        "con_sobre": bool(_SOBRE.search(cuerpo)),
    }


def _busqueda_de_alojamiento(cuerpo: str) -> dict[str, Any]:
    bloque = re.search(r"```ya?ml\s*\n(.*?)```", cuerpo, re.DOTALL)
    texto = bloque.group(1) if bloque else ""
    datos: dict[str, Any] = {}
    for clave in ("offer_id", "city", "iata", "country", "checkin", "checkout"):
        valor = _campo(texto, clave)
        if valor:
            datos[clave] = valor
    return datos


def _fecha(valor: Any) -> datetime | None:
    if not valor:
        return None
    return datetime.fromisoformat(str(valor)).astimezone(UTC)


def _cortar(texto: Any) -> tuple[str, bool]:
    texto = str(texto or "")
    return (texto[:MAX_CUERPO], True) if len(texto) > MAX_CUERPO else (texto, False)


def documento(
    issue: dict[str, Any], comentarios: list[dict[str, Any]], ahora: datetime | None = None
) -> dict[str, Any]:
    """El documento de una issue, listo para guardar."""
    tipo = clasificar(issue)
    cuerpo = str(issue.get("body") or "")
    datos: dict[str, Any] = {}
    if tipo == "peticion_cuenta":
        datos = _peticion_de_cuenta(cuerpo)
        # El sobre no se copia: Python no puede abrirlo y no sirve para nada aquí.
        cuerpo = _SOBRE.sub("[sobre cerrado: no copiado]", cuerpo)
    elif tipo == "alojamiento":
        datos = _busqueda_de_alojamiento(cuerpo)

    cuerpo, cortado = _cortar(cuerpo)
    salida_comentarios = []
    for c in comentarios[:MAX_COMENTARIOS]:
        texto, c_cortado = _cortar(c.get("body"))
        # El cuerpo de una petición de cuenta puede repetirse en un comentario.
        salida_comentarios.append(
            {
                "autor": str((c.get("user") or {}).get("login") or ""),
                "cuerpo": _SOBRE.sub("[sobre cerrado: no copiado]", texto),
                "creado": _fecha(c.get("created_at")),
                **({"cortado": True} if c_cortado else {}),
            }
        )

    doc: dict[str, Any] = {
        "numero": int(issue["number"]),
        "tipo": tipo,
        "titulo": str(issue.get("title") or ""),
        "cuerpo": cuerpo,
        "estado": str(issue.get("state") or "").lower(),
        "etiquetas": sorted(
            str(e.get("name") if isinstance(e, dict) else e) for e in issue.get("labels") or []
        ),
        "autor": str((issue.get("user") or {}).get("login") or ""),
        "creada": _fecha(issue.get("created_at")),
        "actualizada": _fecha(issue.get("updated_at")),
        "cerrada": _fecha(issue.get("closed_at")),
        "url": str(issue.get("html_url") or ""),
        "comentarios": salida_comentarios,
        "comentarios_total": len(comentarios),
        "migrada": ahora or datetime.now(UTC),
    }
    if cortado:
        doc["cortada"] = True
    if datos:
        doc["datos"] = datos
    return doc


# ------------------------------------------------------------------- GitHub
def _cabeceras(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}


def _paginas(url: str, token: str, params: dict[str, Any] | None = None) -> Iterable[dict[str, Any]]:
    pagina = 1
    while True:
        consulta = {**(params or {}), "per_page": 100, "page": pagina}
        r = requests.get(url, headers=_cabeceras(token), params=consulta, timeout=30)
        if r.status_code != 200:
            # El cuerpo de la respuesta no se copia: puede citar contenido.
            raise RuntimeError(f"GitHub contestó {r.status_code} al leer {url.removeprefix(API)}")
        lote = r.json()
        yield from lote
        if len(lote) < 100:
            return
        pagina += 1


def leer_issues(repo: str, token: str) -> list[dict[str, Any]]:
    """Todas las issues, abiertas y cerradas. La API de issues también devuelve
    los pull requests (son issues por dentro): se quitan."""
    orden = {"state": "all", "sort": "created", "direction": "asc"}
    todas = _paginas(f"{API}/repos/{repo}/issues", token, orden)
    return [i for i in todas if "pull_request" not in i]


def leer_comentarios(repo: str, token: str, numero: int) -> list[dict[str, Any]]:
    return list(_paginas(f"{API}/repos/{repo}/issues/{numero}/comments", token))


# ---------------------------------------------------------------- Firestore
class AlmacenFirestore:
    def __init__(self, db: Any) -> None:
        self.db = db

    def escribir(self, docs: list[dict[str, Any]]) -> None:
        # Un lote admite 500 escrituras; con margen.
        for i in range(0, len(docs), 400):
            lote = self.db.batch()
            for d in docs[i : i + 400]:
                lote.set(self.db.collection(COLECCION).document(str(d["numero"])), d)
            lote.commit()

    def contar_por_tipo(self) -> Counter[str]:
        cuenta: Counter[str] = Counter()
        for d in self.db.collection(COLECCION).select(["tipo"]).stream():
            cuenta[str((d.to_dict() or {}).get("tipo") or "")] += 1
        return cuenta


# --------------------------------------------------------------------- todo
def migrar(
    issues: list[dict[str, Any]],
    comentarios_de: Any,
    almacen: Almacen | None,
    escribir: bool,
) -> dict[str, Any]:
    """Prepara los documentos y, si `escribir`, los guarda y comprueba lo guardado.

    Devuelve el resumen (solo números). Si lo guardado no cuadra con lo que se
    mandó, lo dice en `ok`."""
    docs = [documento(i, comentarios_de(i) if i.get("comments") else []) for i in issues]
    esperado = Counter(d["tipo"] for d in docs)
    resumen: dict[str, Any] = {
        "issues": len(docs),
        "por_tipo": {t: esperado.get(t, 0) for t in TIPOS if esperado.get(t, 0)},
        "comentarios": sum(d["comentarios_total"] for d in docs),
        "escritas": 0,
        "ok": True,
    }
    if not escribir:
        return resumen
    if almacen is None:
        raise RuntimeError("Sin almacén no se puede escribir")
    almacen.escribir(docs)
    resumen["escritas"] = len(docs)
    guardado = almacen.contar_por_tipo()
    # Lo guardado puede ser MÁS que lo mandado (otra pasada de antes con otras
    # issues) pero nunca menos: si falta algo, no está hecho.
    resumen["ok"] = all(guardado.get(t, 0) >= n for t, n in esperado.items())
    resumen["guardado_por_tipo"] = {t: n for t, n in sorted(guardado.items()) if n}
    return resumen


def ejecutar(escribir: bool) -> dict[str, Any]:
    token = env("GITHUB_TOKEN") or env("GH_TOKEN")
    if not token:
        raise RuntimeError("Falta GITHUB_TOKEN (solo existe dentro de Actions)")
    repo = repo_slug()
    issues = leer_issues(repo, token)

    almacen: AlmacenFirestore | None = None
    if escribir or env("FIREBASE_SERVICE_ACCOUNT"):
        from .nube import abrir_firestore

        almacen = AlmacenFirestore(abrir_firestore())

    resumen = migrar(issues, lambda i: leer_comentarios(repo, token, int(i["number"])), almacen, escribir)
    if not escribir and almacen is not None:
        # Aunque no se escriba, se comprueba que la cuenta de servicio entra: es
        # lo primero que falla, y mejor saberlo ahora que a media migración.
        resumen["firestore"] = "accesible"
        resumen["ya_guardadas"] = sum(almacen.contar_por_tipo().values())
    return resumen
