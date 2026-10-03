"""Pasar las issues a Firestore: qué se guarda, qué no, y que repetirlo no duplica.

La lógica va contra un almacén en memoria; que el de Firestore hace lo mismo se
comprueba contra el emulador, si está levantado (`FIRESTORE_EMULATOR_HOST`), que
es lo que hace el job de Firebase del CI.
"""

import os
from collections import Counter
from datetime import UTC, datetime

import pytest

from tripfinder import issues_a_nube as M


def issue(numero, titulo, cuerpo="", etiquetas=(), autor="mateogsilvaa", estado="closed", comentarios=0, **extra):
    return {
        "number": numero,
        "title": titulo,
        "body": cuerpo,
        "labels": [{"name": e} for e in etiquetas],
        "user": {"login": autor},
        "state": estado,
        "comments": comentarios,
        "created_at": "2026-09-22T10:00:00Z",
        "updated_at": "2026-09-23T10:00:00Z",
        "closed_at": "2026-09-23T10:00:00Z" if estado == "closed" else None,
        "html_url": f"https://github.com/mateogsilvaa/tripfinder/issues/{numero}",
        **extra,
    }


CHOLLO = issue(160, "[TripFinder] Manchester 86EUR ida y vuelta (-41%)", "**1** escapadas...", ["chollo"], "github-actions")
SIN_NOVEDAD = issue(161, "[TripFinder] Sin novedad en tus 1 seguimientos", "Parte diario.", ["chollo"], "github-actions")
CUENTA = issue(
    125,
    "[cuenta] mark",
    "Nombre: Mark Ejemplo\nUsuario: mark\n\nPor qué:\nMe gustaría viajar más con vosotros.\n\n---\n"
    "Pedida desde la web. Aquí abajo van el correo y la contraseña.\n",
    ["peticion-cuenta"],
    "alguien-externo",
)
SOBRE = "```tf-sobre\n{\"v\":1,\"c\":\"SECRETO-CERRADO\"}\n```"
CUENTA_CON_SOBRE = issue(
    126, "[cuenta] ana", f"Nombre: Ana\nUsuario: ana\n\nPor qué:\nQuiero entrar.\n\n---\n{SOBRE}", ["peticion-cuenta"]
)
STAY = issue(
    3,
    "[stay] ryanair-MAD-ACE-20270115",
    "Busqueda de alojamiento lanzada desde la web.\n\n```yaml\noffer_id: ryanair-MAD-ACE-20270115\n"
    "city: Lanzarote\niata: ACE\ncountry: España\ncheckin: 2027-01-15\ncheckout: 2027-01-17\n```",
    comentarios=2,
)
TAREA = issue(145, "Apartado Interrail: montar el viaje entero", "Quiero…", [], estado="open", comentarios=1)
ETIQUETADA = issue(19, "No cargar 270 KB de aeropuertos", "Por qué…", ["web", "perf"])
PR = issue(164, "Firebase: cuentas", "…", pull_request={"url": "x"})


# ----------------------------------------------------------------- clasificar
@pytest.mark.parametrize(
    ("caso", "tipo"),
    [
        (CHOLLO, "chollo"),
        (SIN_NOVEDAD, "sin_novedad"),
        (CUENTA, "peticion_cuenta"),
        (STAY, "alojamiento"),
        (TAREA, "tarea"),
        (ETIQUETADA, "tarea"),
    ],
)
def test_cada_issue_se_clasifica(caso, tipo):
    assert M.clasificar(caso) == tipo


def test_una_peticion_de_cuenta_sin_etiqueta_tambien_se_reconoce_por_el_titulo():
    # La etiqueta solo existe si el workflow llegó a ponerla.
    assert M.clasificar(issue(9, "[cuenta] bea", "Nombre: Bea")) == "peticion_cuenta"


def test_los_avisos_viejos_sin_etiqueta_se_reconocen_por_el_titulo():
    assert M.clasificar(issue(2, "[TripFinder] MAD -> Bergamo 60EUR", "x")) == "chollo"


# ------------------------------------------------------------------ documento
def test_el_documento_conserva_lo_que_tenia_la_issue():
    d = M.documento(CHOLLO, [])
    assert d["numero"] == 160 and d["tipo"] == "chollo"
    assert d["titulo"] == CHOLLO["title"] and d["cuerpo"] == CHOLLO["body"]
    assert d["estado"] == "closed" and d["etiquetas"] == ["chollo"] and d["autor"] == "github-actions"
    assert d["url"].endswith("/issues/160")
    assert d["creada"] == datetime(2026, 9, 22, 10, 0, tzinfo=UTC)
    assert d["cerrada"] == datetime(2026, 9, 23, 10, 0, tzinfo=UTC)


def test_una_issue_abierta_no_tiene_fecha_de_cierre():
    assert M.documento(TAREA, [])["cerrada"] is None


def test_la_peticion_de_cuenta_saca_nombre_usuario_y_motivo():
    d = M.documento(CUENTA, [])
    assert d["datos"] == {
        "nombre": "Mark Ejemplo",
        "usuario": "mark",
        "porque": "Me gustaría viajar más con vosotros.",
        "con_sobre": False,
    }
    assert d["autor"] == "alguien-externo"


def test_el_sobre_cerrado_no_se_copia_y_se_anota_que_estaba():
    d = M.documento(CUENTA_CON_SOBRE, [])
    assert "SECRETO-CERRADO" not in d["cuerpo"] and "tf-sobre" not in d["cuerpo"]
    assert "[sobre cerrado: no copiado]" in d["cuerpo"]
    assert d["datos"]["con_sobre"] is True
    assert "SECRETO-CERRADO" not in repr(d)


def test_el_sobre_tampoco_se_cuela_por_un_comentario():
    d = M.documento(CUENTA_CON_SOBRE, [{"user": {"login": "x"}, "body": SOBRE, "created_at": "2026-09-22T11:00:00Z"}])
    assert "SECRETO-CERRADO" not in repr(d)


def test_la_busqueda_de_alojamiento_saca_sus_datos():
    assert M.documento(STAY, [])["datos"] == {
        "offer_id": "ryanair-MAD-ACE-20270115",
        "city": "Lanzarote",
        "iata": "ACE",
        "country": "España",
        "checkin": "2027-01-15",
        "checkout": "2027-01-17",
    }


def test_los_comentarios_se_guardan_con_autor_y_fecha():
    cs = [
        {"user": {"login": "github-actions"}, "body": "Resultados…", "created_at": "2026-08-15T20:41:00Z"},
        {"user": None, "body": "otro", "created_at": "2026-08-15T20:42:00Z"},
    ]
    d = M.documento(STAY, cs)
    assert d["comentarios_total"] == 2
    assert d["comentarios"][0] == {
        "autor": "github-actions",
        "cuerpo": "Resultados…",
        "creado": datetime(2026, 8, 15, 20, 41, tzinfo=UTC),
    }
    assert d["comentarios"][1]["autor"] == ""


def test_un_cuerpo_gigante_se_corta_y_se_avisa():
    d = M.documento(issue(1, "t", "x" * (M.MAX_CUERPO + 10)), [])
    assert len(d["cuerpo"]) == M.MAX_CUERPO and d["cortada"] is True


def test_una_issue_vacia_no_rompe():
    d = M.documento({"number": 7, "title": None, "body": None, "labels": None, "user": None}, [])
    assert d["numero"] == 7 and d["cuerpo"] == "" and d["tipo"] == "tarea" and d["creada"] is None


# ------------------------------------------------------------------- GitHub
class Respuesta:
    def __init__(self, datos, estado=200):
        self._datos, self.status_code = datos, estado

    def json(self):
        return self._datos


def test_se_leen_todas_las_paginas_y_se_quitan_los_pull_requests(monkeypatch):
    todas = [issue(n, f"t{n}") for n in range(1, 131)] + [PR]
    visto = []

    def get(url, headers, params, timeout):
        visto.append(params["page"])
        i = (params["page"] - 1) * 100
        return Respuesta(todas[i : i + 100])

    monkeypatch.setattr(M.requests, "get", get)
    r = M.leer_issues("o/r", "token")
    assert len(r) == 130 and all("pull_request" not in i for i in r)
    assert visto == [1, 2]


def test_si_github_falla_el_error_no_copia_el_cuerpo(monkeypatch):
    monkeypatch.setattr(M.requests, "get", lambda *a, **k: Respuesta({"message": "contenido privado"}, 403))
    with pytest.raises(RuntimeError) as err:
        M.leer_issues("o/r", "token")
    assert "403" in str(err.value) and "privado" not in str(err.value)


# --------------------------------------------------------------------- migrar
class Memoria:
    def __init__(self):
        self.docs = {}
        self.escrituras = 0

    def escribir(self, docs):
        for d in docs:
            self.docs[d["numero"]] = d
            self.escrituras += 1

    def contar_por_tipo(self):
        return Counter(d["tipo"] for d in self.docs.values())


TODAS = [CHOLLO, SIN_NOVEDAD, CUENTA, CUENTA_CON_SOBRE, STAY, TAREA, ETIQUETADA]


def sin_comentarios(_):
    return [{"user": {"login": "a"}, "body": "c", "created_at": "2026-09-22T11:00:00Z"}]


def test_el_simulacro_cuenta_y_no_escribe():
    a = Memoria()
    r = M.migrar(TODAS, sin_comentarios, a, escribir=False)
    assert r["issues"] == 7 and r["escritas"] == 0 and a.docs == {}
    assert r["por_tipo"] == {"chollo": 1, "sin_novedad": 1, "peticion_cuenta": 2, "alojamiento": 1, "tarea": 2}


def test_escribir_guarda_todas_y_comprueba_lo_guardado():
    a = Memoria()
    r = M.migrar(TODAS, sin_comentarios, a, escribir=True)
    assert r["escritas"] == 7 and r["ok"] is True
    assert set(a.docs) == {160, 161, 125, 126, 3, 145, 19}
    assert r["guardado_por_tipo"]["peticion_cuenta"] == 2


def test_solo_se_piden_comentarios_a_las_issues_que_los_tienen():
    pedidos = []
    M.migrar(TODAS, lambda i: pedidos.append(i["number"]) or [], Memoria(), escribir=False)
    assert sorted(pedidos) == [3, 145]


def test_repetirlo_no_duplica():
    a = Memoria()
    M.migrar(TODAS, sin_comentarios, a, escribir=True)
    M.migrar(TODAS, sin_comentarios, a, escribir=True)
    assert len(a.docs) == 7 and a.escrituras == 14


def test_si_lo_guardado_no_cuadra_lo_dice():
    class Pierde(Memoria):
        def escribir(self, docs):
            super().escribir(docs[:-1])  # se deja una por el camino

    r = M.migrar(TODAS, sin_comentarios, Pierde(), escribir=True)
    assert r["ok"] is False


def test_escribir_sin_almacen_es_un_error():
    with pytest.raises(RuntimeError):
        M.migrar(TODAS, sin_comentarios, None, escribir=True)


# ------------------------------------------------------------------------ CLI
def test_el_comando_solo_imprime_recuentos(monkeypatch, capsys):
    """El log de un repo público lo lee cualquiera: ni el nombre ni el usuario de
    una petición de cuenta pueden salir."""
    from tripfinder import cli

    monkeypatch.setattr(M, "leer_issues", lambda repo, token: TODAS)
    monkeypatch.setattr(M, "leer_comentarios", lambda repo, token, n: [])
    monkeypatch.setenv("GITHUB_TOKEN", "t")
    monkeypatch.delenv("FIREBASE_SERVICE_ACCOUNT", raising=False)
    assert cli.main(["migrar-issues"]) == 0
    salida = capsys.readouterr().out
    assert "7" in salida and "Simulacro" in salida
    for secreto in ("Mark", "mark", "Ana", "alguien-externo", "Lanzarote", "Manchester", "SECRETO"):
        assert secreto not in salida


def test_el_comando_escribe_y_sale_en_verde(monkeypatch, capsys):
    from tripfinder import cli

    a = Memoria()
    monkeypatch.setattr(M, "leer_issues", lambda repo, token: TODAS)
    monkeypatch.setattr(M, "leer_comentarios", lambda repo, token, n: [])
    monkeypatch.setattr(M, "AlmacenFirestore", lambda db: a)
    monkeypatch.setattr("tripfinder.nube.abrir_firestore", lambda: object())
    monkeypatch.setenv("GITHUB_TOKEN", "t")
    assert cli.main(["migrar-issues", "--escribir"]) == 0
    salida = capsys.readouterr().out
    assert "Escritas: 7" in salida and "cuadra" in salida
    assert len(a.docs) == 7


def test_sin_token_de_github_dice_que_falta(monkeypatch):
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    monkeypatch.delenv("GH_TOKEN", raising=False)
    with pytest.raises(RuntimeError, match="GITHUB_TOKEN"):
        M.ejecutar(escribir=False)


# ----------------------------------------------------------- Firestore de verdad
emulador = pytest.mark.skipif(
    not os.environ.get("FIRESTORE_EMULATOR_HOST"), reason="hace falta el emulador de Firestore"
)


@emulador
def test_el_almacen_de_firestore_guarda_cuenta_y_se_puede_repetir():
    from tripfinder.nube import abrir_firestore

    db = abrir_firestore()
    a = M.AlmacenFirestore(db)
    for ref in db.collection(M.COLECCION).stream():
        ref.reference.delete()

    r = M.migrar(TODAS, sin_comentarios, a, escribir=True)
    assert r["ok"] is True and r["guardado_por_tipo"]["tarea"] == 2
    M.migrar(TODAS, sin_comentarios, a, escribir=True)
    assert sum(a.contar_por_tipo().values()) == 7

    guardada = db.collection(M.COLECCION).document("126").get().to_dict()
    assert guardada["datos"]["con_sobre"] is True and "SECRETO-CERRADO" not in repr(guardada)
    assert guardada["creada"] == datetime(2026, 9, 22, 10, 0, tzinfo=UTC)
    assert db.collection(M.COLECCION).document("3").get().to_dict()["comentarios_total"] == 1
