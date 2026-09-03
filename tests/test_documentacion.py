"""Que la documentación no contradiga al repo.

Los dos sitios donde uno mira para entender el sistema son el README y
`docs/ARCHITECTURE.md`. Un número desfasado ahí cuesta más que no tenerlo:
manda a alguien a buscar un cron que no existe.
"""

import re
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
DOCS = {
    "README.md": (RAIZ / "README.md").read_text(encoding="utf-8"),
    "docs/ARCHITECTURE.md": (RAIZ / "docs" / "ARCHITECTURE.md").read_text(encoding="utf-8"),
    "docs/ROADMAP.md": (RAIZ / "docs" / "ROADMAP.md").read_text(encoding="utf-8"),
}
FLUJOS = sorted(p.name for p in (RAIZ / ".github" / "workflows").glob("*.yml"))


def test_architecture_lista_todos_los_workflows():
    """El criterio de la #17. Y si mañana se añade uno, esto lo pide."""
    doc = DOCS["docs/ARCHITECTURE.md"]
    faltan = [f for f in FLUJOS if f not in doc]
    assert not faltan, f"ARCHITECTURE.md no menciona: {faltan}"


def test_architecture_no_menciona_workflows_que_ya_no_existen():
    doc = DOCS["docs/ARCHITECTURE.md"]
    sobran = [f for f in set(re.findall(r"`([a-z-]+\.yml)`", doc)) if f not in FLUJOS]
    assert not sobran, f"ARCHITECTURE.md habla de workflows que no existen: {sobran}"


@pytest.mark.parametrize("nombre", sorted(DOCS))
def test_ninguna_doc_dice_que_el_scan_va_cada_seis_horas(nombre):
    """El cron real es `0 6,18 * * *`: cada doce. El pie de la web ya lo decía
    bien mientras la documentación decía otra cosa."""
    assert not re.search(r"cron\s*\(?\s*(cada\s*)?6\s*h", DOCS[nombre], re.IGNORECASE), nombre


def test_la_frecuencia_documentada_es_la_del_cron():
    """Sacada del workflow, no de un número escrito a mano."""
    flujo = (RAIZ / ".github" / "workflows" / "scan-flights.yml").read_text(encoding="utf-8")
    horas = re.search(r'- cron: "0 ([\d,]+) \* \* \*"', flujo).group(1).split(",")
    cada = 24 // len(horas)
    assert f"cada {cada} h" in DOCS["docs/ARCHITECTURE.md"]
    assert f"cron {cada}h" in DOCS["README.md"]


def test_el_roadmap_no_cuenta_tests_a_mano():
    """Un número de tests escrito en la documentación se queda viejo a la
    semana: decía 10 cuando eran 82."""
    assert not re.search(r"\d+\s+tests\s+en\s+`tests/`", DOCS["docs/ROADMAP.md"])
