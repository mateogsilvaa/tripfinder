"""Que la paleta se pueda leer, en los dos temas.

El texto mas pequeño de la web son las versalitas mono a 9.5px, y es justo
donde va `--faint`: los metadatos de las filas, las etiquetas de los campos,
el pie. Ahi 4.5:1 no es un adorno.

Esto no comprueba unos valores escritos a mano: lee los tokens de
`web/styles.css`, asi que si alguien aclara un color de mas, salta.
"""

import importlib.util
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("contraste", RAIZ / "tools" / "contraste.py")
contraste = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(contraste)


def test_ningun_texto_baja_de_aa():
    fallos = contraste.revisar()
    detalle = "\n".join(f"  {t}: --{tinta} sobre --{fondo} = {r:.2f}:1" for t, tinta, fondo, r in fallos)
    assert not fallos, f"por debajo de {contraste.AA_NORMAL}:1:\n{detalle}"


@pytest.mark.parametrize("tema", ["claro", "oscuro"])
def test_los_dos_temas_tienen_paleta(tema):
    """Si el parser dejara de encontrar los tokens, la prueba de arriba pasaria
    sin comprobar nada. Esto es lo que evita esa auditoria vacia."""
    p = contraste.paletas()[tema]
    for token in contraste.TINTAS + contraste.FONDOS:
        assert token in p, f"falta --{token} en el tema {tema}"
        assert p[token].startswith("#")


def test_la_cuenta_de_contraste_es_la_de_wcag():
    """Los dos extremos conocidos: identicos dan 1:1, blanco y negro dan 21:1."""
    assert contraste.contraste("#000000", "#000000") == pytest.approx(1.0, abs=0.01)
    assert contraste.contraste("#ffffff", "#000000") == pytest.approx(21.0, abs=0.01)
