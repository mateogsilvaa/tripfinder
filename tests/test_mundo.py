"""El mapa del mundo de cada cuenta, guardado donde no se pierda.

Antes vivía solo en `localStorage`: cambiabas de navegador y se iba un mapa que
había costado un rato marcar. Ahora se guarda en el repositorio, que es la
única base de datos que tiene esta web — y como el repositorio es público,
guardarlo es publicarlo. Eso no se disimula: es justo lo que permite mirar el
mapa de los demás, y quien no quiera se queda con el suyo en el navegador.

Lo que se vigila aquí: que un mapa sea de quien es (el identificador acaba
siendo un nombre de fichero y viene de fuera), que lo que se escribe sean
países y no lo que llegue, y que dejar de guardarlo borre el fichero de verdad.
"""

from __future__ import annotations

import json

import pytest

from tripfinder import mundo as M


@pytest.fixture(autouse=True)
def carpeta(tmp_path, monkeypatch):
    """Cada prueba, su carpeta: esto escribe ficheros de verdad."""
    monkeypatch.setattr(M, "CARPETA", tmp_path / "mundos")
    monkeypatch.setattr(M, "INDICE", tmp_path / "mundos" / "index.json")
    return tmp_path / "mundos"


def indice(carpeta) -> list[dict]:
    return json.loads((carpeta / "index.json").read_text(encoding="utf-8"))["mundos"]


# ------------------------------------------------------------- guardar
def test_guardar_y_volver_a_leer(carpeta):
    M.guardar("u-abc123", ["ES", "FR", "IT"], "Mateo")
    leido = M.leer("u-abc123")
    assert leido["paises"] == ["ES", "FR", "IT"]
    assert leido["owner_name"] == "Mateo"


def test_el_fichero_se_llama_como_la_cuenta(carpeta):
    M.guardar("u-abc123", ["ES"])
    assert (carpeta / "u-abc123.json").exists()


def test_quien_no_lo_ha_guardado_no_tiene_nada(carpeta):
    assert M.leer("u-nadie0") is None


def test_el_nombre_que_ya_tenia_no_se_pierde_por_un_encargo_sin_nombre(carpeta):
    """Un encargo sin `owner_name` no puede dejar anónimo a quien ya se llamaba
    de algo: en la lista aparecería como «Alguien» de un día para otro."""
    M.guardar("u-abc123", ["ES"], "Mateo")
    M.guardar("u-abc123", ["ES", "PT"], "")
    assert M.leer("u-abc123")["owner_name"] == "Mateo"


# --------------------------------------------------------- lo que entra
def test_solo_entran_codigos_de_pais():
    assert M.limpiar_paises(["ES", "españa", "fr", "", None, "XXX", 7]) == ["ES", "FR"]


def test_se_ordenan_y_no_se_repiten():
    """Ordenado a propósito: así el fichero solo cambia cuando cambia el mapa.
    Un commit por reordenar lo mismo es un despliegue de Pages para nada."""
    assert M.limpiar_paises(["IT", "ES", "IT", "es"]) == ["ES", "IT"]


def test_una_cadena_tambien_vale():
    """Es lo que manda el workflow: `--paises ES,FR,IT`."""
    assert M.limpiar_paises("ES,FR,IT") == ["ES", "FR", "IT"]


def test_una_lista_absurda_no_llena_el_disco():
    enorme = [f"{a}{b}" for a in "ABCDEFGHIJKLMNOPQRST" for b in "ABCDEFGHIJKLMNOPQRSTUVWXYZ"]
    assert len(M.limpiar_paises(enorme)) <= M.MAX_PAISES


def test_lo_que_no_es_una_lista_no_es_nada():
    assert M.limpiar_paises({"ES": True}) == []
    assert M.limpiar_paises(None) == []


# ----------------------------------------------------------- de quién es
@pytest.mark.parametrize(
    "malo",
    ["", "u-", "../../etc/passwd", "u-abc/../otro", "admin", "u-ABCDEF", "u-abc123.json"],
)
def test_un_identificador_inventado_no_toca_el_disco(malo, carpeta):
    """El `owner` llega de fuera y acaba siendo un nombre de fichero."""
    with pytest.raises(ValueError):
        M.guardar(malo, ["ES"])
    assert not list(carpeta.glob("*.json")) if carpeta.exists() else True


def test_leer_con_un_identificador_invalido_devuelve_nada():
    assert M.leer("../../data/users") is None


# ---------------------------------------------------------------- borrar
def test_dejar_de_guardarlo_borra_el_fichero(carpeta):
    """Y no lo deja vacío: quien dijo «esto ya no» seguiría saliendo en la
    lista, con cero países y la fecha del día en que lo quitó."""
    M.guardar("u-abc123", ["ES"], "Mateo")
    assert M.borrar("u-abc123") is True
    assert not (carpeta / "u-abc123.json").exists()
    assert M.leer("u-abc123") is None


def test_borrar_lo_que_no_hay_no_es_un_error(carpeta):
    assert M.borrar("u-abc123") is False


def test_al_borrar_desaparece_de_la_lista(carpeta):
    M.guardar("u-abc123", ["ES"], "Mateo")
    M.guardar("u-def456", ["FR", "IT"], "Otra")
    M.borrar("u-abc123")
    assert [m["o"] for m in indice(carpeta)] == ["u-def456"]


# ----------------------------------------------------------------- lista
def test_la_lista_dice_quien_y_cuantos(carpeta):
    M.guardar("u-abc123", ["ES", "FR"], "Mateo")
    lista = indice(carpeta)
    assert lista[0]["o"] == "u-abc123"
    assert lista[0]["n"] == "Mateo"
    assert lista[0]["c"] == 2


def test_la_lista_va_de_mas_mundo_a_menos(carpeta):
    M.guardar("u-abc123", ["ES"], "Uno")
    M.guardar("u-def456", ["FR", "IT", "PT"], "Dos")
    assert [m["n"] for m in indice(carpeta)] == ["Dos", "Uno"]


def test_la_lista_no_se_cuenta_a_si_misma(carpeta):
    M.guardar("u-abc123", ["ES"], "Mateo")
    M.reindexar()
    assert [m["o"] for m in indice(carpeta)] == ["u-abc123"]


def test_un_mapa_roto_no_tumba_la_lista(carpeta):
    M.guardar("u-abc123", ["ES"], "Mateo")
    (carpeta / "u-roto999.json").write_text("{no es json", encoding="utf-8")
    assert [m["o"] for m in indice(carpeta)] == ["u-abc123"]


def test_sin_nadie_la_lista_esta_pero_vacia(carpeta):
    """Vacía y no ausente: la web distingue «nadie ha guardado el suyo» de «no
    se ha podido leer la lista»."""
    M.reindexar()
    assert indice(carpeta) == []


def test_la_lista_no_lleva_nada_que_no_sea_el_mapa(carpeta):
    """Esto se publica: lo que no haga falta para elegir a quién mirar, fuera.
    Nada de correos ni de nada que la cuenta no haya puesto aquí."""
    M.guardar("u-abc123", ["ES"], "Mateo")
    assert set(indice(carpeta)[0]) == {"o", "n", "c", "u"}
