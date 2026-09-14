"""Que los tres sitios que hablan del título de una petición digan lo mismo.

Una petición de cuenta es una issue titulada `[cuenta] <usuario>`. Ese título lo
ESCRIBE la web (`web/js/cuenta.js`) y lo LEEN otros dos: la cola del panel
(`web/admin.html`) y el workflow que pone la etiqueta. No hay nada que los ate:
si mañana alguien cambia el prefijo en uno, los otros dos dejan de encontrar las
peticiones y no falla nada —simplemente la cola sale vacía y las issues entran
sin etiquetar, que es justo el fallo que no se ve hasta que alguien pide una
cuenta de verdad—.
"""

from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CUENTA_JS = (RAIZ / "web" / "js" / "cuenta.js").read_text(encoding="utf-8")
ADMIN = (RAIZ / "web" / "admin.html").read_text(encoding="utf-8")
FLUJO = (RAIZ / ".github" / "workflows" / "peticion-cuenta.yml").read_text(encoding="utf-8")


def test_la_web_titula_la_peticion_con_el_prefijo():
    assert "[cuenta] ${datos.user}" in CUENTA_JS


def test_el_panel_busca_ese_mismo_prefijo():
    """Y anclado al principio: `un [cuenta] en medio` no es una petición."""
    assert r"/^\[cuenta\]/i" in ADMIN


def test_el_workflow_busca_ese_mismo_prefijo():
    assert r'test("^\\[cuenta\\]"; "i")' in FLUJO


def test_la_cola_no_depende_de_la_etiqueta():
    """GitHub sólo pinta una etiqueta que YA EXISTE: si no existe, ignora el
    `labels=` de la dirección sin decir nada. Si la cola filtrara por etiqueta,
    saldría siempre vacía sin que nada pareciera roto."""
    assert "labels=peticion-cuenta&state=open" not in ADMIN
    assert "/issues?state=open" in ADMIN


def test_el_workflow_se_asegura_de_que_la_etiqueta_existe():
    assert "/repos/$REPO/labels" in FLUJO


def test_la_peticion_no_lleva_ninguna_direccion():
    """La issue es pública. `users.json` se publica sin emails y el despliegue
    falla si se cuela una arroba; pedirlo aquí sería la misma fuga por otra
    puerta."""
    cuerpo = CUENTA_JS[CUENTA_JS.index("function cuerpoPeticion") : CUENTA_JS.index("function urlPeticion")]
    assert "@" not in cuerpo
    assert "email" not in cuerpo.lower() or "no se pide" in cuerpo.lower()
