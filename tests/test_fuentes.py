"""Que no se descargue ni un peso que el CSS no use, y que el texto se lea ya.

Es una comprobación que se puede hacer sola: los pesos que piden las URLs de
las tipografías salen del HTML, y los que usa el CSS salen del CSS. Si alguien
añade un `font-weight` nuevo sin pedirlo —o pide uno y no lo usa— esto lo dice.

Son dos proveedores distintos y con dos sintaxis distintas: Switzer viene de
Fontshare (`f[]=switzer@400,500,600,700`) y Pinyon Script e IBM Plex Mono de
Google (`family=IBM+Plex+Mono:wght@400;500;600`).
"""

import re
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
CSS = (RAIZ / "web" / "styles.css").read_text(encoding="utf-8")
CABEZA = (RAIZ / "web" / "partes" / "cabeza.html").read_text(encoding="utf-8")

# El alias del token -> cómo se llama la familia en la URL de su proveedor.
# `display` y `sans` son la misma cara (Switzer): uno es el nombre semántico
# del titular y el otro el del texto, y comprobar los dos sería contar dos
# veces lo mismo.
GOOGLE = {"mono": "IBM+Plex+Mono"}
FONTSHARE = {"sans": "switzer"}


def _pedidos_google(familia: str) -> set[str]:
    m = re.search(rf"family={re.escape(familia)}:wght@([\d;]+)", CABEZA)
    assert m, f"la URL no pide {familia}"
    return set(m.group(1).split(";"))


def _pedidos_fontshare(familia: str) -> set[str]:
    m = re.search(rf"f\[\]={re.escape(familia)}@([\d,]+)", CABEZA)
    assert m, f"la URL no pide {familia}"
    return set(m.group(1).split(","))


def _pedidos(alias: str) -> set[str]:
    if alias in GOOGLE:
        return _pedidos_google(GOOGLE[alias])
    return _pedidos_fontshare(FONTSHARE[alias])


def _usados(alias: str) -> set[str]:
    """Los pesos con los que el CSS usa esa familia.

    Dos formas: la abreviada (`font: 600 13px var(--font-mono)`) y el par
    suelto (`font-weight: 700` junto a un `font-family`). Switzer es la cara
    por defecto del `body`, así que sus pesos se declaran casi siempre sueltos.
    """
    pesos = {
        m.group(1) for m in re.finditer(rf"font:\s*(\d{{3}})[^;]*var\(--font-{alias}\)", CSS)
    }
    if alias == "sans":
        # La cara del cuerpo: todo `font-weight` de la hoja es suyo salvo los
        # que van dentro de una declaración `font:` de otra familia.
        pesos |= set(re.findall(r"font-weight:\s*(\d{3})", CSS))
        pesos |= {
            m.group(1)
            for m in re.finditer(r"font:\s*(\d{3})[^;]*var\(--font-display\)", CSS)
        }
    return pesos


@pytest.mark.parametrize("alias", sorted({**GOOGLE, **FONTSHARE}))
def test_no_se_pide_ningun_peso_que_no_se_use(alias):
    sobran = _pedidos(alias) - _usados(alias)
    assert not sobran, f"{alias}: se piden {sorted(sobran)} y el CSS no los usa"


@pytest.mark.parametrize("alias", sorted({**GOOGLE, **FONTSHARE}))
def test_no_se_usa_ningun_peso_que_no_se_pida(alias):
    """El otro lado: un peso que el CSS pide y la fuente no trae lo sintetiza
    el navegador, y se nota."""
    faltan = _usados(alias) - _pedidos(alias)
    assert not faltan, f"{alias}: el CSS usa {sorted(faltan)} y la URL no los pide"


def test_la_manuscrita_va_en_su_unico_peso():
    """Pinyon Script solo existe en regular: pedirle un peso sería pedirle al
    navegador que lo invente, y una manuscrita falseada se ve a un metro."""
    assert "family=Pinyon+Script&" in CABEZA
    assert not re.search(r"family=Pinyon\+Script:wght", CABEZA)
    usados = {
        m.group(1)
        for m in re.finditer(r"font-weight:\s*(\d{3});[^}]*var\(--font-script\)", CSS)
    }
    assert usados <= {"400"}, f"la manuscrita se usa en {sorted(usados)}"


def test_la_manuscrita_se_usa_con_cuentagotas():
    """Es el acento de la marca. Si apareciera en veinte sitios dejaría de
    significar nada; el diseño la usa en el logo, dos titulares y el kicker."""
    veces = CSS.count("var(--font-script)")
    assert 1 <= veces <= 6, f"la manuscrita se declara {veces} veces"


def test_las_fuentes_no_bloquean_el_primer_pintado():
    """`media="print"` + onload: la hoja no frena el pintado, y `display=swap`
    hace que el texto se lea desde el primer momento con la fuente de sistema
    en lugar de quedarse invisible."""
    assert 'media="print"' in CABEZA
    assert "this.media='all'" in CABEZA
    # Dos proveedores, cada uno con preload, stylesheet y noscript.
    assert CABEZA.count("display=swap") == 6
    assert "<noscript>" in CABEZA, "sin JS tiene que cargarlas igual"


def test_se_preconecta_a_los_dos_proveedores():
    """Sin el preconnect, el navegador descubre el dominio al parsear el
    `<link>` y se come el DNS y el TLS antes de empezar a bajar nada."""
    for host in ("api.fontshare.com", "fonts.googleapis.com", "fonts.gstatic.com"):
        assert f'rel="preconnect" href="https://{host}"' in CABEZA, host
