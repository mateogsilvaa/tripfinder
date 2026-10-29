"""La búsqueda de un HOP deja sus resultados en `resultados/busqueda-<clave>`,
para que el grupo los vea en cuanto acaba sin esperar a GitHub Pages."""

from tripfinder import cli, nube


def test_con_clave_publica_el_resultado(monkeypatch):
    hechos = []
    monkeypatch.setattr(nube, "hay_firebase", lambda: True)
    monkeypatch.setattr(nube, "publicar_resultado", lambda clave, datos: hechos.append((clave, datos)))
    cli._publicar_busqueda("abc123-lq9x", {"offers": []})
    assert hechos == [("busqueda-abc123-lq9x", {"offers": []})]


def test_sin_clave_o_con_una_rara_no_publica_nada(monkeypatch):
    hechos = []
    monkeypatch.setattr(nube, "hay_firebase", lambda: True)
    monkeypatch.setattr(nube, "publicar_resultado", lambda clave, datos: hechos.append(clave))
    for clave in ["", "../usuarios/x", "A B", "x" * 81]:
        cli._publicar_busqueda(clave, {})
    assert hechos == []
