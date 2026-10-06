"""Que nada del proyecto vuelva a escribir en las issues del repositorio.

El repo es público y una issue la lee cualquiera, incluidos su autor, su cuerpo y
lo que se escribió en él. Las issues fueron el sitio donde se apuntaban avisos,
peticiones de cuenta y búsquedas; hoy eso vive en Firestore y lo que había se
copió allí (`migrar-issues.yml`). Esto es lo que impide que una refactorización
bienintencionada las reabra por una puerta lateral.
"""

from pathlib import Path

import pytest
import yaml

RAIZ = Path(__file__).resolve().parent.parent
FLUJOS = sorted((RAIZ / ".github" / "workflows").glob("*.yml"))
WEB = [p for p in (RAIZ / "web").rglob("*") if p.suffix in {".js", ".html"}]


def _on(datos):
    # PyYAML lee la clave `on` como el booleano True.
    return datos.get("on", datos.get(True)) or {}


@pytest.mark.parametrize("flujo", FLUJOS, ids=lambda p: p.name)
def test_ningun_workflow_se_dispara_por_una_issue(flujo):
    on = _on(yaml.safe_load(flujo.read_text(encoding="utf-8")))
    eventos = on if isinstance(on, dict) else dict.fromkeys([on] if isinstance(on, str) else on)
    assert "issues" not in eventos and "issue_comment" not in eventos, flujo.name


@pytest.mark.parametrize("flujo", FLUJOS, ids=lambda p: p.name)
def test_ningun_workflow_puede_escribir_issues(flujo):
    permisos = yaml.safe_load(flujo.read_text(encoding="utf-8")).get("permissions") or {}
    assert permisos.get("issues") != "write", flujo.name
    for job in (yaml.safe_load(flujo.read_text(encoding="utf-8")).get("jobs") or {}).values():
        assert (job.get("permissions") or {}).get("issues") != "write", flujo.name


def test_la_web_no_abre_issues():
    """Ningún enlace de la web lleva a `issues/new`, que es como se escribía una
    desde el navegador de quien no tiene cuenta."""
    for fichero in WEB:
        assert "/issues/new" not in fichero.read_text(encoding="utf-8"), fichero.relative_to(RAIZ)


def test_el_backend_no_llama_a_la_api_de_escribir_issues():
    raiz = RAIZ / "src" / "tripfinder"
    for fichero in raiz.rglob("*.py"):
        if fichero.name == "issues_a_nube.py":
            continue  # solo LEE las issues, para copiarlas a Firestore
        texto = fichero.read_text(encoding="utf-8")
        assert "/issues\"" not in texto and "/issues'" not in texto, fichero.name
        assert "github_issue" not in texto, fichero.name
