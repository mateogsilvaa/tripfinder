"""La tabla de perfiles de destino (#6).

El test de destinos necesita saber que Nápoles es ciudad y gastronomía y que
Lanzarote es playa. Ese dato no lo da ninguna API: está curado a mano, y lo que
se comprueba aquí es que no se quede atrás cuando el mapa de rutas cambie.
"""

import json
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
PERFILES = json.loads((RAIZ / "web" / "perfiles.json").read_text(encoding="utf-8"))
ETIQUETAS = {"playa", "ciudad", "naturaleza", "noche", "gastronomia"}

# La nota de cabecera del fichero, que no es un aeropuerto.
CODIGOS = {k: v for k, v in PERFILES.items() if k != "_"}


def test_todos_los_destinos_del_mapa_tienen_perfil():
    """El criterio de aceptación. Y si mañana el scan añade una ruta nueva,
    esto lo pide en vez de dejarla silenciosamente como 'ciudad'."""
    mapa = json.loads((RAIZ / "data" / "routes" / "MAD.json").read_text(encoding="utf-8"))
    faltan = sorted(c for c in mapa["destinos"] if c not in CODIGOS)
    assert not faltan, f"sin perfil: {faltan}"


def test_las_entradas_son_codigos_iata_y_etiquetas_conocidas():
    for codigo, tags in CODIGOS.items():
        assert len(codigo) == 3 and codigo.isupper(), codigo
        assert isinstance(tags, list) and tags, codigo
        assert not set(tags) - ETIQUETAS, f"{codigo}: {set(tags) - ETIQUETAS}"


def test_ningun_destino_lo_es_todo():
    """Un sitio etiquetado con las cinco cosas no dice nada: encaja con
    cualquier respuesta y deja de servir para elegir."""
    for codigo, tags in CODIGOS.items():
        assert len(tags) <= 3, f"{codigo} tiene {len(tags)} etiquetas"
        assert len(set(tags)) == len(tags), f"{codigo} repite etiqueta"


def test_la_tabla_pesa_poco():
    """Se descarga en el móvil junto a todo lo demás: por debajo de 10 KB."""
    assert (RAIZ / "web" / "perfiles.json").stat().st_size < 10 * 1024


def test_hay_de_todo_para_elegir():
    """Si el 90 % fuera 'ciudad', el test daría siempre lo mismo y la primera
    pregunta sobraría."""
    cuenta = {e: sum(1 for tags in CODIGOS.values() if e in tags) for e in ETIQUETAS}
    for etiqueta, n in cuenta.items():
        assert n >= 8, f"solo {n} destinos de {etiqueta}"


def test_el_largo_radio_tambien_esta():
    """Se puede contestar «lejos», y sin perfil todos serían 'ciudad': el motor
    devolvería Bangkok y Nueva York para quien pidió playa."""
    for codigo in ("CUN", "MIA", "BKK", "CPT", "SYD"):
        assert codigo in CODIGOS, codigo
