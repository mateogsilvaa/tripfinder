"""Las notificaciones del aparato: que se cifren como manda el estándar, que la
firma valga, que una suscripción muerta se borre, y que a cada cuenta le llegue
por donde pidió."""

import base64
import json

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from tripfinder import cli as C
from tripfinder import users as U
from tripfinder import watch as W
from tripfinder.config import Config
from tripfinder.models import FlightOffer
from tripfinder.notify import push


def b64(d: bytes) -> str:
    return base64.urlsafe_b64encode(d).rstrip(b"=").decode()


def de_b64(t: str) -> bytes:
    return base64.urlsafe_b64decode(t + "=" * (-len(t) % 4))


def oferta(precio: float, dest: str = "FCO") -> FlightOffer:
    return FlightOffer(
        provider="ryanair", origin="MAD", destination=dest, destination_name="Roma",
        depart_date="2026-11-13", return_date="2026-11-16", price=precio,
    )


@pytest.fixture
def vapid(monkeypatch):
    privada, publica = push.claves_nuevas()
    monkeypatch.setenv("VAPID_PRIVATE_KEY", privada)
    monkeypatch.setenv("SITE_URL", "https://ejemplo.github.io/tripfinder")
    return publica


class Aparato:
    """Lo que hace el navegador: un par de claves y un secreto de 16 bytes."""

    def __init__(self):
        self.clave = ec.generate_private_key(ec.SECP256R1())
        self.auth = b"0123456789abcdef"
        pub = self.clave.public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        )
        self.sub = {"endpoint": "https://fcm.googleapis.com/fcm/send/abc", "p256dh": b64(pub), "auth": b64(self.auth)}

    def descifrar(self, cuerpo: bytes) -> bytes:
        """RFC 8291 del lado del navegador, para comprobar el nuestro."""
        from cryptography.hazmat.primitives.kdf.hkdf import HKDF

        salt, rs, idlen = cuerpo[:16], int.from_bytes(cuerpo[16:20], "big"), cuerpo[20]
        assert rs == 4096 and idlen == 65
        suya = cuerpo[21:86]
        mia = de_b64(self.sub["p256dh"])
        compartido = self.clave.exchange(
            ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), suya)
        )

        def hkdf(s, ikm, info, n):
            return HKDF(algorithm=hashes.SHA256(), length=n, salt=s, info=info).derive(ikm)

        ikm = hkdf(self.auth, compartido, b"WebPush: info\x00" + mia + suya, 32)
        cek = hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
        nonce = hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
        claro = AESGCM(cek).decrypt(nonce, cuerpo[86:], None)
        assert claro.endswith(b"\x02")
        return claro[:-1]


def test_el_navegador_lo_descifra():
    a = Aparato()
    cuerpo = push.cifrar(b'{"titulo":"Roma por 39 \xe2\x82\xac"}', a.sub["p256dh"], a.sub["auth"])
    assert json.loads(a.descifrar(cuerpo))["titulo"] == "Roma por 39 €"


def test_la_firma_vapid_vale(vapid):
    cab = push.cabecera_vapid("https://fcm.googleapis.com/fcm/send/abc", ahora=1_000_000)
    t, k = cab.removeprefix("vapid t=").split(", k=")
    assert k == vapid
    h, c, f = t.split(".")
    reclamo = json.loads(de_b64(c))
    assert reclamo == {"aud": "https://fcm.googleapis.com", "exp": 1_000_000 + 12 * 3600,
                       "sub": "https://ejemplo.github.io/tripfinder"}
    firma = de_b64(f)
    publica = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), de_b64(k))
    der = encode_dss_signature(int.from_bytes(firma[:32], "big"), int.from_bytes(firma[32:], "big"))
    publica.verify(der, f"{h}.{c}".encode(), ec.ECDSA(hashes.SHA256()))  # lanza si no vale


class Ref:
    def __init__(self):
        self.borrado = False

    def delete(self):
        self.borrado = True


def test_avisar_borra_las_suscripciones_muertas(vapid, monkeypatch):
    vivo, muerto = Ref(), Ref()
    monkeypatch.setattr(push, "aparatos_de", lambda db, uid: [(vivo, Aparato().sub), (muerto, Aparato().sub)])
    codigos = iter([201, 410])
    enviados = []

    class R:
        def __init__(self, c):
            self.status_code = c

    def post(url, data, headers, timeout):
        enviados.append(headers)
        return R(next(codigos))

    monkeypatch.setattr(push.requests, "post", post)
    assert push.avisar("ana", {"titulo": "x"}, db=object()) == 1
    assert muerto.borrado and not vivo.borrado
    assert enviados[0]["Content-Encoding"] == "aes128gcm"
    assert enviados[0]["Authorization"].startswith("vapid t=")


def test_sin_clave_no_se_manda_nada(monkeypatch):
    monkeypatch.delenv("VAPID_PRIVATE_KEY", raising=False)
    monkeypatch.setattr(push, "aparatos_de", lambda *a: pytest.fail("no debería leer nada"))
    assert push.avisar("ana", {"titulo": "x"}, db=object()) == 0


def test_textos():
    d = push.datos_chollos([oferta(39), oferta(55)])
    assert d["titulo"] == "2 chollos: Roma desde 39 €"
    assert d["cuerpo"].splitlines()[0] == "MAD→Roma 39 € · 13/11"
    s = push.datos_seguimientos([(W.Watch(id="a", label="Lisboa"), [oferta(80), oferta(60)]), (W.Watch(id="b"), [])])
    assert s["titulo"] == "Lisboa: desde 60 €"
    assert s["url"].endswith("/seguimientos")


# ------------------------------------------------------- por dónde le llega
CFG = Config(raw={"notify": {"to": "", "buzon_fijo": False}})


def cuenta(uid: str, canal: str, **prefs):
    return U.User(id=uid, user=uid, email=f"{uid}@example.com",
                  prefs=U.prefs_validas({"avisos": True, "canal": canal, **prefs}))


@pytest.fixture
def cuentas(monkeypatch):
    lista = [cuenta("correo", "correo"), cuenta("app", "app"), cuenta("ambos", "ambos")]
    monkeypatch.setattr(C, "_cuentas_con_aviso", lambda: (lista, {}))
    return lista


def test_cada_canal_lo_suyo(cuentas):
    correos = C._reparto_de_chollos([oferta(30)], [oferta(30)], CFG, {}, 6)
    assert set(correos) == {"correo@example.com", "ambos@example.com"}
    al_movil = C._reparto_push([oferta(30)], [oferta(30)], {}, 6)
    assert set(al_movil) == {"app", "ambos"}


def test_el_movil_lleva_su_propia_cuenta_de_dias(cuentas):
    for u in cuentas:
        u.prefs["chollos"] = "diario"
    hoy = C.date.today().isoformat()
    state = {"digest": {C.clave_aparato("ambos"): hoy}}
    assert set(C._reparto_push([oferta(30)], [], state, 6)) == {"app"}
    # El correo de «ambos» no se entera de que el móvil ya recibió lo suyo.
    assert "ambos@example.com" in C._reparto_de_chollos([oferta(30)], [], CFG, state, 6)


def test_seguimientos_en_el_movil_solo_con_novedad(cuentas):
    estado = [
        (W.Watch(id="1", owner="app"), [oferta(40)]),
        (W.Watch(id="2", owner="ambos"), []),
        (W.Watch(id="3", owner="correo"), [oferta(40)]),
    ]
    assert set(C._partes_push(estado, {})) == {"app"}
    assert set(C._partes_por_dueno(estado, CFG, {})) == {"ambos@example.com", "correo@example.com"}


def test_canal_raro_vuelve_al_correo():
    assert U.prefs_validas({"canal": "paloma"})["canal"] == "correo"
    assert U.prefs_validas({})["canal"] == "correo"
