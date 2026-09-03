"""Que ningún comentario de cron afirme una hora local que sólo es cierta medio año.

Los `schedule` de GitHub van en UTC y no saben de horarios de verano. Un
`# 08:00 hora peninsular` al lado de un cron es verdad de marzo a octubre y
mentira el resto. La regla completa está en `docs/ARCHITECTURE.md`.
"""

import re
from pathlib import Path

import pytest
import yaml

RAIZ = Path(__file__).resolve().parent.parent
FLUJOS = sorted((RAIZ / ".github" / "workflows").glob("*.yml"))

# "hora peninsular", "hora española", "hora local"… al lado de un cron.
AFIRMA_LOCAL = re.compile(r"hora\s+(peninsular|espa|local)", re.IGNORECASE)


def _lineas_de_cron(texto: str) -> list[tuple[int, str]]:
    return [(i, ln) for i, ln in enumerate(texto.splitlines(), 1) if "- cron:" in ln]


@pytest.mark.parametrize("flujo", FLUJOS, ids=lambda p: p.name)
def test_ningun_cron_afirma_una_hora_local_en_su_linea(flujo):
    for numero, linea in _lineas_de_cron(flujo.read_text(encoding="utf-8")):
        assert not AFIRMA_LOCAL.search(linea), (
            f"{flujo.name}:{numero} dice una hora local al lado del cron, y eso "
            "sólo es cierto medio año. Ver docs/ARCHITECTURE.md."
        )


@pytest.mark.parametrize("flujo", FLUJOS, ids=lambda p: p.name)
def test_los_cron_son_validos(flujo):
    """Cinco campos y minutos/horas dentro de rango: un cron mal escrito no
    falla, simplemente no se dispara nunca."""
    for numero, linea in _lineas_de_cron(flujo.read_text(encoding="utf-8")):
        expr = linea.split("- cron:", 1)[1].split("#")[0].strip().strip("\"'")
        campos = expr.split()
        assert len(campos) == 5, f"{flujo.name}:{numero}: {expr!r} no tiene cinco campos"
        for valor in campos[0].split(","):
            if valor.isdigit():
                assert 0 <= int(valor) <= 59, f"{flujo.name}:{numero}: minuto {valor}"
        for valor in campos[1].split(","):
            if valor.isdigit():
                assert 0 <= int(valor) <= 23, f"{flujo.name}:{numero}: hora {valor}"


def test_la_regla_esta_escrita():
    """El criterio de aceptación: que el siguiente cron que se añada la siga."""
    doc = (RAIZ / "docs" / "ARCHITECTURE.md").read_text(encoding="utf-8")
    assert "## La hora de los cron" in doc
    assert "UTC" in doc and "guardián" in doc


@pytest.mark.parametrize("flujo", FLUJOS, ids=lambda p: p.name)
def test_todos_los_workflows_tienen_timeout(flujo):
    """Sin él, un job colgado se queda hasta el límite de 6 horas de GitHub."""
    datos = yaml.safe_load(flujo.read_text(encoding="utf-8"))
    for nombre, job in (datos.get("jobs") or {}).items():
        assert "timeout-minutes" in job, f"{flujo.name}: el job '{nombre}' no tiene timeout"
