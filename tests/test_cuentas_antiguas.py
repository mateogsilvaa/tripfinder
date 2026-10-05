"""Las cuentas de antes de Firebase: que pasen a Firestore sin perder nada y sin
llevarse lo que no debe salir del repo, y que sigan recibiendo sus avisos hasta
que se vinculen."""

import os
from collections import Counter

import pytest

from tripfinder import cuentas_a_nube as M
from tripfinder import users as U


def cuenta(id_, user, email="", **extra):
    return U.User(
        id=id_, user=user, name=extra.pop("name", user.title()), email=email,
        salt="SAL-SECRETA", hash="HASH-SECRETO", sobre={"data": "SOBRE-SECRETO", "iv": "x"},
        created="2026-08-20", **extra,
    )


ANA = cuenta("u-1111aaaa", "ana", "Ana@Ejemplo.com", prefs={"chollos": "diario", "chollos_max_precio": 90})
BEA = cuenta("u-2222bbbb", "bea", "bea@ejemplo.com")
SIN_CORREO = cuenta("u-3333cccc", "cris")
INACTIVA = cuenta("u-4444dddd", "dani", "dani@ejemplo.com", active=False)


class Memoria:
    def __init__(self):
        self.docs = {}
        self.vinculadas = set()

    def escribir(self, docs):
        for d in docs:
            self.docs.setdefault(d["id"], {}).update(d)  # como `merge`

    def contar(self):
        c = Counter(total=len(self.docs))
        c["vinculadas"] = len(self.vinculadas)
        c["sin_vincular"] = len(self.docs) - len(self.vinculadas)
        return c


def test_el_documento_lleva_lo_justo_para_recuperar_la_cuenta():
    d = M.documento(ANA)
    assert d == {
        "id": "u-1111aaaa", "usuario": "ana", "nombre": "Ana", "correo": "ana@ejemplo.com",
        "prefs": {
            "chollos": "diario", "chollos_max_precio": 90.0,
            "seguimientos": "diario", "seguimientos_solo_novedades": False,
        },
        "activa": True, "creada": "2026-08-20",
    }


def test_no_sale_nada_de_lo_que_no_debe_salir_del_repo():
    """El hash, la sal y el sobre no valen para nada con Firebase, y el sobre
    guarda el token del sitio: no se copian."""
    d = M.documento(ANA)
    assert not {"hash", "salt", "sobre", "iterations", "site"} & set(d)
    assert "SECRETO" not in repr(d) and "SAL" not in repr(d)


def test_el_correo_se_normaliza_para_poder_compararlo():
    assert M.documento(ANA)["correo"] == "ana@ejemplo.com"
    assert M.documento(SIN_CORREO)["correo"] == ""


def test_el_simulacro_cuenta_y_no_escribe():
    a = Memoria()
    r = M.migrar([ANA, BEA, SIN_CORREO, INACTIVA], a, escribir=False)
    assert r["cuentas"] == 4 and r["con_correo"] == 3 and r["activas"] == 3 and r["escritas"] == 0
    assert a.docs == {}


def test_escribir_guarda_todas_y_lo_comprueba():
    a = Memoria()
    r = M.migrar([ANA, BEA, SIN_CORREO, INACTIVA], a, escribir=True)
    assert r["escritas"] == 4 and r["ok"] is True and set(a.docs) == {c.id for c in (ANA, BEA, SIN_CORREO, INACTIVA)}


def test_repetirlo_no_duplica_ni_borra_la_vinculacion():
    a = Memoria()
    M.migrar([ANA], a, escribir=True)
    a.docs["u-1111aaaa"]["vinculada"] = "uid-nuevo"  # lo que escribe el panel
    M.migrar([ANA], a, escribir=True)
    assert len(a.docs) == 1 and a.docs["u-1111aaaa"]["vinculada"] == "uid-nuevo"


def test_si_lo_guardado_no_cuadra_lo_dice():
    class Pierde(Memoria):
        def escribir(self, docs):
            super().escribir(docs[:-1])

    assert M.migrar([ANA, BEA], Pierde(), escribir=True)["ok"] is False


def test_el_comando_solo_imprime_recuentos(monkeypatch, capsys, tmp_path):
    from tripfinder import cli

    monkeypatch.setattr(U, "FICHERO", tmp_path / "users.json")
    U.anadir("ana", "Ana", "clave-larga-1234", email="ana@ejemplo.com")
    monkeypatch.delenv("FIREBASE_SERVICE_ACCOUNT", raising=False)
    monkeypatch.delenv("FIRESTORE_EMULATOR_HOST", raising=False)
    assert cli.main(["migrar-cuentas"]) == 0
    salida = capsys.readouterr().out
    assert "1" in salida and "Simulacro" in salida
    assert "ana" not in salida.lower().replace("cuentas", "") and "@" not in salida


# ------------------------------------------------ a quién se le manda el aviso
class FakeDoc:
    def __init__(self, id_, datos):
        self.id, self._d = id_, datos

    def to_dict(self):
        return self._d


class FakeDB:
    def __init__(self, usuarios, antiguas):
        self.datos = {"usuarios": usuarios, "cuentas_antiguas": antiguas}

    def collection(self, nombre):
        coleccion = self.datos[nombre]

        class C:
            def stream(self_):
                return [FakeDoc(i, d) for i, d in coleccion.items()]

        return C()


def _db():
    return FakeDB(
        usuarios={
            "uid-ana": {"estado": "aprobado", "nombre": "Ana", "correo": "ana@ejemplo.com",
                        "legado": "u-1111aaaa", "prefs": {"chollos": "diario"}},
            "uid-pendiente": {"estado": "pendiente", "nombre": "P", "correo": "p@ejemplo.com"},
            "uid-bloqueada": {"estado": "bloqueado", "nombre": "B", "correo": "b@ejemplo.com"},
            "uid-sin-correo": {"estado": "aprobado", "nombre": "S"},
        },
        antiguas={
            "u-1111aaaa": {"usuario": "ana", "correo": "ana@ejemplo.com", "activa": True, "vinculada": "uid-ana"},
            "u-2222bbbb": {"usuario": "bea", "nombre": "Bea", "correo": "bea@ejemplo.com", "activa": True,
                           "prefs": {"chollos": "semanal"}},
            "u-3333cccc": {"usuario": "cris", "correo": "cris@ejemplo.com", "activa": False},
            "u-4444dddd": {"usuario": "dani", "activa": True},
        },
    )


def test_reciben_avisos_las_aprobadas_y_las_antiguas_sin_vincular():
    from tripfinder import nube

    cuentas, _ = nube.cuentas_para_avisos(_db())
    assert sorted(c.email for c in cuentas) == ["ana@ejemplo.com", "bea@ejemplo.com"]


def test_una_cuenta_antigua_sin_vincular_conserva_lo_que_habia_elegido():
    from tripfinder import nube

    cuentas, _ = nube.cuentas_para_avisos(_db())
    bea = next(c for c in cuentas if c.email == "bea@ejemplo.com")
    assert bea.id == "u-2222bbbb" and bea.prefs["chollos"] == "semanal"


def test_una_vez_vinculada_el_aviso_va_a_la_cuenta_nueva_y_no_se_duplica():
    from tripfinder import nube

    cuentas, alias = nube.cuentas_para_avisos(_db())
    assert alias == {"u-1111aaaa": "uid-ana"}
    assert [c.id for c in cuentas if c.email == "ana@ejemplo.com"] == ["uid-ana"]


def test_pendientes_bloqueadas_inactivas_y_sin_correo_no_reciben_nada():
    from tripfinder import nube

    cuentas, _ = nube.cuentas_para_avisos(_db())
    ids = {c.id for c in cuentas}
    assert not ids & {"uid-pendiente", "uid-bloqueada", "uid-sin-correo", "u-3333cccc", "u-4444dddd"}


def test_si_firestore_no_contesta_no_tumba_el_barrido():
    from tripfinder import nube

    class Roto:
        def collection(self, _):
            raise ConnectionError("sin red")

    assert nube.cuentas_para_avisos(Roto()) == ([], {})


def test_los_seguimientos_de_una_cuenta_antigua_llegan_a_su_cuenta_nueva(monkeypatch):
    """Un seguimiento hecho antes de Firebase lleva el id de antes como dueño."""
    from tripfinder import cli, nube
    from tripfinder.config import Config
    from tripfinder.watch import Watch

    cuentas, alias = nube.cuentas_para_avisos(_db())
    monkeypatch.setattr(cli, "_cuentas_con_aviso", lambda: (cuentas, alias))
    w_viejo = Watch(id="a", label="x", owner="u-1111aaaa")
    w_nuevo = Watch(id="b", label="y", owner="uid-ana")
    w_bea = Watch(id="c", label="z", owner="u-2222bbbb")
    cfg = Config(raw={"notify": {"to": "dueno@ejemplo.com"}})
    partes = cli._partes_por_dueno([(w_viejo, []), (w_nuevo, []), (w_bea, [])], cfg)
    assert [w.id for w, _ in partes["ana@ejemplo.com"]] == ["a", "b"]
    assert [w.id for w, _ in partes["bea@ejemplo.com"]] == ["c"]
    assert "dueno@ejemplo.com" not in partes


emulador = pytest.mark.skipif(
    not os.environ.get("FIRESTORE_EMULATOR_HOST"), reason="hace falta el emulador de Firestore"
)


@emulador
def test_contra_el_emulador_se_copia_se_repite_y_no_se_pisa_la_vinculacion():
    from tripfinder.nube import abrir_firestore

    db = abrir_firestore()
    # Otras pruebas del mismo run dejan cuentas en el emulador: se parte de cero.
    for coleccion in (M.COLECCION, "usuarios"):
        for d in db.collection(coleccion).stream():
            d.reference.delete()
    a = M.AlmacenFirestore(db)
    assert M.migrar([ANA, BEA], a, escribir=True)["ok"] is True
    db.collection(M.COLECCION).document("u-1111aaaa").update({"vinculada": "uid-ana"})
    assert M.migrar([ANA, BEA], a, escribir=True)["guardado"] == {"total": 2, "vinculadas": 1, "sin_vincular": 1}
    guardada = db.collection(M.COLECCION).document("u-1111aaaa").get().to_dict()
    assert guardada["vinculada"] == "uid-ana" and guardada["correo"] == "ana@ejemplo.com"
    assert "hash" not in guardada and "sobre" not in guardada and "salt" not in guardada

    from tripfinder import nube

    db.collection("usuarios").document("uid-ana").set(
        {"estado": "aprobado", "nombre": "Ana", "correo": "ana@ejemplo.com", "legado": "u-1111aaaa"}
    )
    cuentas, alias = nube.cuentas_para_avisos(db)
    assert alias == {"u-1111aaaa": "uid-ana"}
    assert sorted(c.id for c in cuentas) == ["u-2222bbbb", "uid-ana"]


# ----------------------------------- lo de antes sigue siendo de su dueño nuevo
def test_el_encargo_de_una_cuenta_vinculada_lleva_los_dos_ids():
    """Lo de antes lleva el id viejo como dueño: sin él, no podría borrarlo."""
    from datetime import UTC, datetime

    from tripfinder import nube

    enviados = []

    class A:
        def ficha(self, uid):
            return {"nombre": "Ana", "estado": "aprobado", "legado": "u-1111aaaa"}

        def enviados_de(self, uid):
            return []

        def actualizar(self, *a, **k):
            pass

    e = {"id": "e1", "tipo": "unwatch", "owner": "uid-ana", "payload": {"id": "roma"}}
    estado, _ = nube._tramitar(A(), lambda t, p: enviados.append(p), e, datetime.now(UTC))
    assert estado == "enviado" and enviados[0]["owner"] == "uid-ana,u-1111aaaa"


def test_una_cuenta_vinculada_borra_su_seguimiento_de_antes(tmp_path, monkeypatch):
    from tripfinder import watch as W

    monkeypatch.setattr(W, "FICHERO", tmp_path / "watch.json")
    monkeypatch.setattr(W, "DATA_DIR", tmp_path)
    W.anadir(W.Watch(id="roma", label="Roma", owner="u-1111aaaa"))
    # Con solo el id nuevo, es de otra persona: no se borra.
    assert W.borrar("roma", "uid-ana") is False
    # Con los dos, sí.
    assert W.borrar("roma", "uid-ana,u-1111aaaa") is True


def test_otra_cuenta_no_borra_lo_de_alguien_aunque_lleve_dos_ids(tmp_path, monkeypatch):
    from tripfinder import watch as W

    monkeypatch.setattr(W, "FICHERO", tmp_path / "watch.json")
    monkeypatch.setattr(W, "DATA_DIR", tmp_path)
    W.anadir(W.Watch(id="roma", label="Roma", owner="u-1111aaaa"))
    assert W.borrar("roma", "uid-otra,u-9999zzzz") is False


def test_una_cuenta_vinculada_borra_su_busqueda_de_antes(tmp_path):
    import json

    from tripfinder.store import Store

    s = Store(tmp_path)
    s.searches_dir.mkdir(parents=True, exist_ok=True)
    (s.searches_dir / "mad-roma.json").write_text(json.dumps({"owner": "u-1111aaaa", "request": {}}))
    assert s.delete_search("mad-roma", "uid-otra") is False
    assert s.delete_search("mad-roma", "uid-ana,u-1111aaaa") is True


def test_lo_que_se_crea_sale_a_nombre_de_la_cuenta_nueva():
    from tripfinder.util import ids_de_dueno, primer_dueno

    assert primer_dueno("uid-ana,u-1111aaaa") == "uid-ana"
    assert ids_de_dueno("uid-ana, u-1111aaaa ,") == ["uid-ana", "u-1111aaaa"]
    assert primer_dueno("") == "" and primer_dueno(None) == "" and ids_de_dueno(None) == []
