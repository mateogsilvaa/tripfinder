"""La configuración de Firebase de la web: entera o vacía, nunca a medias.

`web/nube.js` lleva `apiKey` y `projectId`. Con los dos, la web usa Firebase;
con los dos vacíos, sigue con las cuentas de `data/users.json`. Con uno solo,
`nubeActiva()` da falso y la web se queda en el sistema viejo sin que nadie
sepa por qué.
"""

import re
from pathlib import Path

NUBE = (Path(__file__).resolve().parent.parent / "web" / "nube.js").read_text(encoding="utf-8")


def _campo(nombre):
    m = re.search(rf'{nombre}:\s*"([^"]*)"', NUBE.split("const NUBE_CONFIG")[1])
    assert m, f"no encuentro {nombre} en NUBE_CONFIG"
    return m.group(1)


def test_la_configuracion_esta_entera_o_vacia():
    assert bool(_campo("apiKey")) == bool(_campo("projectId"))


def test_si_hay_configuracion_tiene_la_forma_de_una_de_firebase():
    clave, proyecto = _campo("apiKey"), _campo("projectId")
    if not clave:
        return
    # Las claves de API de Google empiezan por AIza y miden 39.
    assert re.fullmatch(r"AIza[\w-]{35}", clave), "no parece una clave de API de Google"
    assert re.fullmatch(r"[a-z][a-z0-9-]{4,28}[a-z0-9]", proyecto), "no parece un id de proyecto"


def test_la_clave_no_es_la_de_una_cuenta_de_servicio():
    """Esa sí es secreta: abre todo y se salta las reglas. En el HTML solo va la
    clave web, que es pública a propósito."""
    assert "private_key" not in NUBE
    assert "BEGIN PRIVATE KEY" not in NUBE
