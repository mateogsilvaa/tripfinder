"""La cola de encargos: lo que se manda a GitHub, a nombre de quién y lo que no.

La lógica va contra un almacén en memoria; que el almacén de verdad (Firestore)
hace lo mismo se comprueba contra el emulador, si está levantado
(`FIRESTORE_EMULATOR_HOST`), que es lo que hace el job de Firebase del CI.
"""

import os
from datetime import UTC, datetime, timedelta

import pytest

from tripfinder import nube

AHORA = datetime(2026, 10, 1, 12, 0, tzinfo=UTC)


class Memoria:
    """Un `Almacen` de mentira: dos diccionarios."""

    def __init__(self, fichas=None, encargos=None):
        self.fichas = fichas or {}
        self.encargos = {e["id"]: dict(e) for e in (encargos or [])}

    def _estado(self, *estados):
        return [dict(e) for e in self.encargos.values() if e.get("estado") in estados]

    def pendientes(self):
        return self._estado("pendiente")

    def atascados(self):
        return self._estado("enviando")

    def tramitados(self):
        return self._estado("enviado", "error", "rechazado")

    def ficha(self, uid):
        return self.fichas.get(uid)

    def enviados_de(self, uid):
        return [e for e in self._estado("enviado", "enviando") if e.get("owner") == uid]

    def actualizar(self, id_, **campos):
        self.encargos[id_].update(campos)

    def borrar(self, id_):
        del self.encargos[id_]


def encargo(id_, owner="ana", tipo="search", payload=None, **extra):
    return {
        "id": id_,
        "tipo": tipo,
        "owner": owner,
        "payload": {"origin": "MAD", "destination": "ROM"} if payload is None else payload,
        "estado": "pendiente",
        "creado": AHORA - timedelta(minutes=5),
        **extra,
    }


FICHAS = {
    "ana": {"nombre": "Ana", "correo": "ana@x.es", "estado": "aprobado"},
    "bea": {"nombre": "Bea", "correo": "bea@x.es", "estado": "pendiente"},
    "cris": {"nombre": "Cris", "correo": "cris@x.es", "estado": "bloqueado"},
}


class Buzon:
    """Lo que se habria mandado a GitHub."""

    def __init__(self, falla=False):
        self.mandados = []
        self.falla = falla

    def __call__(self, evento, payload):
        if self.falla:
            raise RuntimeError("GitHub contestó 422 al lanzar «search»")
        self.mandados.append((evento, payload))


def pasar(almacen, buzon=None):
    buzon = buzon or Buzon()
    return nube.procesar(almacen, buzon, AHORA), buzon


def test_un_encargo_aprobado_se_manda_y_se_marca():
    a = Memoria(FICHAS, [encargo("e1")])
    cuenta, buzon = pasar(a)
    assert cuenta["enviado"] == 1
    assert [m[0] for m in buzon.mandados] == ["search"]
    assert a.encargos["e1"]["estado"] == "enviado"


def test_el_dueno_sale_de_la_ficha_y_no_del_encargo():
    # Quien lo pide puede escribir lo que quiera en el payload.
    suplantado = encargo("e1", payload={"owner": "cris", "owner_name": "Cris", "x": 1})
    a = Memoria(FICHAS, [suplantado])
    _, buzon = pasar(a)
    assert buzon.mandados[0][1]["owner"] == "ana"
    assert buzon.mandados[0][1]["owner_name"] == "Ana"
    assert buzon.mandados[0][1]["x"] == 1


def test_una_cuenta_no_aprobada_no_lanza_nada():
    a = Memoria(FICHAS, [encargo("e1", "bea"), encargo("e2", "cris"), encargo("e3", "fantasma")])
    cuenta, buzon = pasar(a)
    assert buzon.mandados == []
    assert cuenta["rechazado"] == 3
    assert {e["estado"] for e in a.encargos.values()} == {"rechazado"}


def test_un_tipo_que_no_es_de_scraper_se_rechaza():
    # Los de cuentas (user_add, admin_password…) ya no existen: no se reenvían.
    a = Memoria(FICHAS, [encargo("e1", tipo="user_add"), encargo("e2", tipo="admin_password")])
    cuenta, buzon = pasar(a)
    assert buzon.mandados == [] and cuenta["rechazado"] == 2


@pytest.mark.parametrize("tipo", sorted(nube.TIPOS))
def test_todos_los_tipos_conocidos_se_mandan(tipo):
    _, buzon = pasar(Memoria(FICHAS, [encargo("e1", tipo=tipo)]))
    assert buzon.mandados[0][0] == tipo


def test_los_tipos_son_los_de_las_reglas():
    """Si se añade uno en un sitio y no en el otro, el encargo se crea y nunca sale."""
    import re
    from pathlib import Path

    reglas = (Path(__file__).resolve().parent.parent / "firestore.rules").read_text(encoding="utf-8")
    en_reglas = set(re.findall(r"'(\w+)'", re.search(r"tipo in \[([^\]]*)\]", reglas).group(1)))
    assert en_reglas == set(nube.TIPOS)


def test_mas_de_diez_propiedades_es_un_error_y_no_un_422_de_github():
    diez = {f"p{i}": i for i in range(10)}  # + owner y owner_name = 12
    a = Memoria(FICHAS, [encargo("e1", payload=diez)])
    cuenta, buzon = pasar(a)
    assert buzon.mandados == [] and cuenta["error"] == 1
    assert "propiedades" in a.encargos["e1"]["motivo"]


def test_si_github_falla_se_apunta_y_los_demas_siguen():
    a = Memoria(FICHAS, [encargo("e1"), encargo("e2")])
    cuenta, _ = pasar(a, Buzon(falla=True))
    assert cuenta["error"] == 2
    assert a.encargos["e1"]["estado"] == "error"
    assert "422" in a.encargos["e1"]["motivo"]


def test_el_error_no_copia_el_contenido_del_encargo():
    secreto = {"nota": "no-debe-salir"}
    a = Memoria(FICHAS, [encargo("e1", payload=secreto)])
    pasar(a, Buzon(falla=True))
    assert "no-debe-salir" not in a.encargos["e1"]["motivo"]


def test_se_atienden_por_orden_de_llegada():
    viejo = encargo("viejo", payload={"n": 1}, creado=AHORA - timedelta(hours=1))
    nuevo = encargo("nuevo", payload={"n": 2}, creado=AHORA - timedelta(minutes=1))
    _, buzon = pasar(Memoria(FICHAS, [nuevo, viejo]))
    assert [m[1]["n"] for m in buzon.mandados] == [1, 2]


def test_el_tope_por_hora_corta_al_que_se_pasa():
    a = Memoria(FICHAS, [encargo(f"e{i}", payload={"n": i}) for i in range(nube.MAX_POR_HORA + 5)])
    cuenta, buzon = pasar(a)
    assert cuenta["enviado"] == nube.MAX_POR_HORA
    assert cuenta["rechazado"] == 5
    assert len(buzon.mandados) == nube.MAX_POR_HORA


def test_el_tope_cuenta_lo_que_ya_se_mando_antes():
    previos = [
        encargo(f"p{i}", estado="enviado", procesado=AHORA - timedelta(minutes=20))
        for i in range(nube.MAX_POR_HORA)
    ]
    a = Memoria(FICHAS, [*previos, encargo("nuevo")])
    cuenta, buzon = pasar(a)
    assert buzon.mandados == [] and cuenta["rechazado"] == 1


def test_lo_de_hace_mas_de_una_hora_ya_no_cuenta_para_el_tope():
    previos = [
        encargo(f"p{i}", estado="enviado", procesado=AHORA - timedelta(hours=2))
        for i in range(nube.MAX_POR_HORA)
    ]
    cuenta, _ = pasar(Memoria(FICHAS, [*previos, encargo("nuevo")]))
    assert cuenta["enviado"] == 1


def test_el_tope_es_por_cuenta():
    fichas = {**FICHAS, "dani": {"nombre": "Dani", "estado": "aprobado"}}
    previos = [
        encargo(f"p{i}", estado="enviado", procesado=AHORA - timedelta(minutes=5))
        for i in range(nube.MAX_POR_HORA)
    ]
    cuenta, _ = pasar(Memoria(fichas, [*previos, encargo("d", owner="dani")]))
    assert cuenta["enviado"] == 1


def test_un_enviando_viejo_se_da_por_perdido_y_no_se_reenvia():
    a = Memoria(FICHAS, [encargo("e1", estado="enviando", procesado=AHORA - timedelta(hours=1))])
    cuenta, buzon = pasar(a)
    assert cuenta["atascado"] == 1 and buzon.mandados == []
    assert a.encargos["e1"]["estado"] == "error"


def test_un_enviando_reciente_se_deja_en_paz():
    a = Memoria(FICHAS, [encargo("e1", estado="enviando", procesado=AHORA - timedelta(minutes=2))])
    cuenta, _ = pasar(a)
    assert cuenta["atascado"] == 0 and a.encargos["e1"]["estado"] == "enviando"


def test_lo_tramitado_se_borra_a_la_semana():
    viejo = encargo("v", estado="enviado", procesado=AHORA - timedelta(days=8))
    reciente = encargo("r", estado="enviado", procesado=AHORA - timedelta(days=1))
    a = Memoria(FICHAS, [viejo, reciente])
    cuenta, _ = pasar(a)
    assert cuenta["borrado"] == 1 and set(a.encargos) == {"r"}


def test_sin_encargos_no_pasa_nada():
    cuenta, buzon = pasar(Memoria(FICHAS))
    assert sum(cuenta.values()) == 0 and buzon.mandados == []


# --------------------------------------------------------------- credenciales
def test_sin_cuenta_de_servicio_se_dice_que_falta_y_no_su_valor(monkeypatch):
    monkeypatch.delenv("FIRESTORE_EMULATOR_HOST", raising=False)
    monkeypatch.delenv("FIREBASE_SERVICE_ACCOUNT", raising=False)
    with pytest.raises(RuntimeError, match="Falta FIREBASE_SERVICE_ACCOUNT"):
        nube.abrir_firestore()


def test_un_json_roto_no_enseña_la_clave_en_el_error(monkeypatch):
    monkeypatch.delenv("FIRESTORE_EMULATOR_HOST", raising=False)
    monkeypatch.setenv("FIREBASE_SERVICE_ACCOUNT", '{"private_key": "SECRETA", roto')
    with pytest.raises(RuntimeError) as err:
        nube.abrir_firestore()
    assert "SECRETA" not in str(err.value)
    assert err.value.__cause__ is None and err.value.__suppress_context__


def test_el_dispatch_sin_token_falla_con_un_mensaje_claro(monkeypatch):
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    monkeypatch.delenv("GH_TOKEN", raising=False)
    with pytest.raises(RuntimeError, match="GITHUB_TOKEN"):
        nube.despachar_github("search", {})


def test_el_dispatch_no_copia_la_respuesta_de_github(monkeypatch):
    class R:
        status_code = 422
        text = "payload con datos privados"

    monkeypatch.setenv("GITHUB_TOKEN", "t")
    monkeypatch.setattr(nube.requests, "post", lambda *a, **k: R())
    with pytest.raises(RuntimeError) as err:
        nube.despachar_github("search", {"x": 1})
    assert "privados" not in str(err.value) and "422" in str(err.value)


def test_el_dispatch_manda_el_evento_y_el_payload(monkeypatch):
    visto = {}

    class R:
        status_code = 204

    def post(url, headers, json, timeout):
        visto.update(url=url, json=json, auth=headers["Authorization"])
        return R()

    monkeypatch.setenv("GITHUB_TOKEN", "t")
    monkeypatch.setattr(nube.requests, "post", post)
    nube.despachar_github("watch", {"a": 1})
    assert visto["url"].endswith("/dispatches")
    assert visto["json"] == {"event_type": "watch", "client_payload": {"a": 1}}


# ------------------------------------------------------- el almacén de verdad
emulador = pytest.mark.skipif(
    not os.environ.get("FIRESTORE_EMULATOR_HOST"), reason="hace falta el emulador de Firestore"
)


@emulador
def test_el_almacen_de_firestore_hace_lo_mismo_que_el_de_memoria():
    import uuid

    db = nube.abrir_firestore()
    a = nube.AlmacenFirestore(db)
    uid = f"u-{uuid.uuid4().hex[:8]}"
    db.collection("usuarios").document(uid).set({"nombre": "Eva", "correo": "eva@x.es", "estado": "aprobado"})
    ref = db.collection("encargos").document()
    ref.set(
        {
            "tipo": "stay",
            "owner": uid,
            "payload": {"offer": "abc"},
            "estado": "pendiente",
            "creado": datetime.now(UTC) - timedelta(minutes=1),
        }
    )
    visto = Buzon()
    cuenta = nube.procesar(a, visto, datetime.now(UTC))
    assert cuenta["enviado"] >= 1
    assert ("stay", {"offer": "abc", "owner": uid, "owner_name": "Eva"}) in visto.mandados
    hecho = ref.get().to_dict()
    assert hecho["estado"] == "enviado" and "procesado" in hecho
    assert any(e["id"] == ref.id for e in a.enviados_de(uid))
    # Pasada una semana, se borra.
    nube.procesar(a, visto, datetime.now(UTC) + timedelta(days=8))
    assert not ref.get().exists
