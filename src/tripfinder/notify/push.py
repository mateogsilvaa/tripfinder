"""Notificaciones en el aparato (Web Push), al lado del correo.

Quien instala la web como app puede pedir que los avisos le lleguen como una
notificacion normal del movil o del ordenador, en vez de (o ademas de) por
correo. El navegador da una suscripcion —una URL del servicio de push de
Google, Apple o Mozilla y dos claves— y la web la guarda en
`usuarios/{uid}/aparatos/{id}`. Desde aqui se cifra el mensaje con esas claves
(RFC 8291, `aes128gcm`) y se firma la peticion con la clave VAPID del sitio
(RFC 8292): el servicio de push solo entrega lo que viene firmado por quien
pidio la suscripcion, y no puede leer lo que entrega.

Esta hecho a mano sobre `cryptography` y no con `pywebpush` a proposito: esa
libreria arrastra `http-ece`, que no compila en el Python del runner, y lo que
hace falta son cuarenta lineas.

Sin `VAPID_PRIVATE_KEY` no se manda nada y no pasa nada: los avisos siguen
saliendo por correo. Una suscripcion que el servicio da por muerta (404 o 410:
desinstalo la app, quito el permiso) se borra para no volver a intentarlo.
"""

from __future__ import annotations

import base64
import contextlib
import json
import logging
import os
import struct
import time
from typing import Any
from urllib.parse import urlsplit

import requests

from ..config import env, site_url

log = logging.getLogger("tripfinder")

# Lo que dura un aviso esperando en el servicio de push si el aparato esta
# apagado: un chollo de hace dos dias ya no es un chollo.
TTL = 36 * 3600
TIMEOUT = 15


def _b64(datos: bytes) -> str:
    return base64.urlsafe_b64encode(datos).rstrip(b"=").decode()


def _de_b64(texto: str) -> bytes:
    texto = texto.strip()
    return base64.urlsafe_b64decode(texto + "=" * (-len(texto) % 4))


def configurado() -> bool:
    return bool(env("VAPID_PRIVATE_KEY"))


def _clave_privada():
    from cryptography.hazmat.primitives.asymmetric import ec

    crudo = _de_b64(env("VAPID_PRIVATE_KEY"))
    return ec.derive_private_key(int.from_bytes(crudo, "big"), ec.SECP256R1())


def _publica(clave) -> bytes:
    from cryptography.hazmat.primitives import serialization

    return clave.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )


def claves_nuevas() -> tuple[str, str]:
    """Un par VAPID nuevo: (privada, publica), en base64url. La publica va en la
    web (`web/js/notificaciones.js`); la privada, al secreto VAPID_PRIVATE_KEY."""
    from cryptography.hazmat.primitives.asymmetric import ec

    clave = ec.generate_private_key(ec.SECP256R1())
    privada = clave.private_numbers().private_value.to_bytes(32, "big")
    return _b64(privada), _b64(_publica(clave))


def _hkdf(salt: bytes, ikm: bytes, info: bytes, largo: int) -> bytes:
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF

    return HKDF(algorithm=hashes.SHA256(), length=largo, salt=salt, info=info).derive(ikm)


def cifrar(mensaje: bytes, p256dh: str, auth: str, salt: bytes | None = None) -> bytes:
    """El cuerpo cifrado para un aparato, en un solo registro `aes128gcm`."""
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    suya = _de_b64(p256dh)
    secreto = _de_b64(auth)
    efimera = ec.generate_private_key(ec.SECP256R1())
    mia = _publica(efimera)
    compartido = efimera.exchange(
        ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), suya)
    )
    ikm = _hkdf(secreto, compartido, b"WebPush: info\x00" + suya + mia, 32)
    salt = salt or os.urandom(16)
    cek = _hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
    # \x02: el delimitador del ultimo (y unico) registro.
    cifrado = AESGCM(cek).encrypt(nonce, mensaje + b"\x02", None)
    return salt + struct.pack("!IB", 4096, len(mia)) + mia + cifrado


def cabecera_vapid(endpoint: str, ahora: float | None = None) -> str:
    """`Authorization` para ese servicio de push: un JWT ES256 de doce horas."""
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

    clave = _clave_privada()
    partes = urlsplit(endpoint)
    reclamo = {
        "aud": f"{partes.scheme}://{partes.netloc}",
        "exp": int((ahora or time.time()) + 12 * 3600),
        # Apple lo exige: un mailto o una https de quien manda.
        "sub": env("VAPID_SUB") or site_url(),
    }
    cab = _b64(json.dumps({"typ": "JWT", "alg": "ES256"}, separators=(",", ":")).encode())
    cue = _b64(json.dumps(reclamo, separators=(",", ":")).encode())
    firma_der = clave.sign(f"{cab}.{cue}".encode(), ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(firma_der)
    firma = r.to_bytes(32, "big") + s.to_bytes(32, "big")
    return f"vapid t={cab}.{cue}.{_b64(firma)}, k={_b64(_publica(clave))}"


def enviar(aparato: dict[str, Any], datos: dict[str, Any]) -> int:
    """Manda un aviso a un aparato y devuelve el codigo HTTP del servicio."""
    endpoint = str(aparato.get("endpoint") or "")
    if not endpoint.startswith("https://"):
        return 400
    cuerpo = cifrar(
        json.dumps(datos, ensure_ascii=False).encode(),
        str(aparato.get("p256dh") or ""),
        str(aparato.get("auth") or ""),
    )
    r = requests.post(
        endpoint,
        data=cuerpo,
        headers={
            "Authorization": cabecera_vapid(endpoint),
            "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream",
            "TTL": str(TTL),
            "Urgency": "normal",
        },
        timeout=TIMEOUT,
    )
    return r.status_code


def aparatos_de(db: Any, uid: str) -> list[tuple[Any, dict[str, Any]]]:
    docs = db.collection("usuarios").document(uid).collection("aparatos").stream()
    return [(d.reference, d.to_dict() or {}) for d in docs]


def avisar(uid: str, datos: dict[str, Any], db: Any | None = None) -> int:
    """Manda `datos` a todos los aparatos de esa cuenta. Devuelve a cuantos llego.

    No lanza: un aviso que no sale no puede tumbar el barrido."""
    if not configurado():
        return 0
    try:
        if db is None:
            from ..nube import abrir_firestore

            db = abrir_firestore()
        aparatos = aparatos_de(db, uid)
    except Exception as exc:  # noqa: BLE001
        log.warning("No se pudieron leer los aparatos de %s: %s", uid, type(exc).__name__)
        return 0
    llegados = 0
    for ref, aparato in aparatos:
        try:
            codigo = enviar(aparato, datos)
        except Exception as exc:  # noqa: BLE001
            log.warning("Push a un aparato de %s fallo: %s", uid, type(exc).__name__)
            continue
        if codigo in (404, 410):
            # El servicio dice que esa suscripcion ya no existe.
            with contextlib.suppress(Exception):
                ref.delete()
        elif 200 <= codigo < 300:
            llegados += 1
        else:
            log.warning("Push a un aparato de %s: el servicio contesto %s", uid, codigo)
    return llegados


# ------------------------------------------------------------- lo que se dice
def _precio(o: Any) -> str:
    return f"{o.price:.0f} €"


def _dia(iso: str) -> str:
    """«2026-11-13» → «13/11», como se dice aqui."""
    return f"{iso[8:10]}/{iso[5:7]}" if len(iso) >= 10 else iso


def datos_chollos(ofertas: list[Any]) -> dict[str, Any]:
    """Titulo corto y una linea por chollo, como lo enseña el movil."""
    mejor = ofertas[0]
    nombre = mejor.destination_name or mejor.destination
    if len(ofertas) == 1:
        titulo = f"{nombre} por {_precio(mejor)}"
    else:
        titulo = f"{len(ofertas)} chollos: {nombre} desde {_precio(mejor)}"
    lineas = [
        f"{o.origin}→{o.destination_name or o.destination} {_precio(o)} · {_dia(o.depart_date)}"
        + (f" · -{o.discount_pct:.0f}%" if getattr(o, "discount_pct", 0) else "")
        for o in ofertas[:4]
    ]
    return {"titulo": titulo, "cuerpo": "\n".join(lineas), "url": f"{site_url()}/", "etiqueta": "chollos"}


def datos_seguimientos(parte: list[tuple[Any, list[Any]]]) -> dict[str, Any]:
    con = [(w, o) for w, o in parte if o]
    w, ofertas = con[0]
    nombre = w.label or w.destination or "Tu seguimiento"
    mejor = min(ofertas, key=lambda o: o.price)
    titulo = f"{nombre}: desde {_precio(mejor)}"
    if len(con) > 1:
        titulo = f"Novedades en {len(con)} seguimientos"
    lineas = [
        f"{x.label or x.destination or 'Tu seguimiento'}: {len(o)} vuelo{'s' if len(o) != 1 else ''}, "
        f"desde {_precio(min(o, key=lambda v: v.price))}"
        for x, o in con[:4]
    ]
    return {
        "titulo": titulo,
        "cuerpo": "\n".join(lineas),
        "url": f"{site_url()}/seguimientos",
        "etiqueta": "seguimientos",
    }
