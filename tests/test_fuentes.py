"""Que no se descargue ni un peso que el CSS no use, y que el texto se lea ya.

Es una comprobacion que se puede hacer sola: los pesos que pide la URL de
Google Fonts salen del HTML, y los que usa el CSS salen del CSS. Si alguien
añade un `font-weight` nuevo sin pedirlo —o pide uno y no lo usa— esto lo dice.
"""

import re
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
CSS = (RAIZ / "web" / "styles.css").read_text(encoding="utf-8")
CABEZA = (RAIZ / "web" / "partes" / "cabeza.html").read_text(encoding="utf-8")

# --font-display -> Newsreader, --font-sans -> Sora, --font-mono -> Martian Mono
FAMILIAS = {"display": "Newsreader", "sans": "Sora", "mono": "Martian+Mono"}


def _pedidos(familia: str) -> set[str]:
    """Los pesos ROMANOS que la URL pide para esa familia."""
    m = re.search(rf"family={re.escape(familia)}:([^&\"]+)", CABEZA)
    assert m, f"la URL no pide {familia}"
    eje = m.group(1)
    if eje.startswith("ital,"):
        # `ital,opsz,wght@0,6..72,200;1,6..72,300` -> los que empiezan por "0,"
        return {t.split(",")[-1] for t in eje.split("@")[1].split(";") if t.startswith("0,")}
    return set(eje.split("@")[1].split(";"))


def _cursivas(familia: str) -> set[str]:
    m = re.search(rf"family={re.escape(familia)}:([^&\"]+)", CABEZA)
    eje = m.group(1)
    if not eje.startswith("ital,"):
        return set()
    return {t.split(",")[-1] for t in eje.split("@")[1].split(";") if t.startswith("1,")}


def _usados(alias: str) -> set[str]:
    """Los pesos con los que el CSS usa esa familia."""
    return {m.group(1) for m in re.finditer(rf"font:\s*(\d{{3}})[^;]*var\(--font-{alias}\)", CSS)}


@pytest.mark.parametrize("alias,familia", sorted(FAMILIAS.items()))
def test_no_se_pide_ningun_peso_que_no_se_use(alias, familia):
    sobran = _pedidos(familia) - _usados(alias)
    assert not sobran, f"{familia}: se piden {sorted(sobran)} y el CSS no los usa"


@pytest.mark.parametrize("alias,familia", sorted(FAMILIAS.items()))
def test_no_se_usa_ningun_peso_que_no_se_pida(alias, familia):
    """El otro lado: un peso que el CSS pide y la fuente no trae lo sintetiza
    el navegador, y se nota."""
    faltan = _usados(alias) - _pedidos(familia)
    assert not faltan, f"{familia}: el CSS usa {sorted(faltan)} y la URL no los pide"


def test_la_cursiva_pedida_es_la_que_se_usa():
    """Solo hay una cursiva en toda la web: el titular."""
    usadas = {
        m.group(1)
        for m in re.finditer(r"font-style:\s*italic;\s*font-weight:\s*(\d{3})", CSS)
    }
    assert usadas, "si esto se vacia, hay que quitar la cursiva de la URL"
    assert _cursivas("Newsreader") == usadas


def test_las_fuentes_no_bloquean_el_primer_pintado():
    """`media="print"` + onload: la hoja no frena el pintado, y `display=swap`
    hace que el texto se lea desde el primer momento con la fuente de sistema
    en lugar de quedarse invisible."""
    assert 'media="print"' in CABEZA
    assert "this.media='all'" in CABEZA
    assert CABEZA.count("display=swap") == 3  # preload, stylesheet y noscript
    assert "<noscript>" in CABEZA, "sin JS tiene que cargarlas igual"
