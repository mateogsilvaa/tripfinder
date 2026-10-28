"""Seguir tiene las mismas preguntas que buscar.

Un seguimiento podía ser un finde, una fecha o cualquiera, y siempre desde
Madrid. Ahora apunta lo mismo que una búsqueda —origen, ventana y dos días de
la semana— y el cron lo revisa con esas mismas condiciones.
"""

from datetime import date, timedelta

from tripfinder import cli
from tripfinder import search as S
from tripfinder import watch as W


def test_revisar_pide_lo_mismo_que_se_apunto(monkeypatch):
    pedido = {}

    def falso(req, cfg, history, max_queries=45):
        pedido["req"] = req
        return S.SearchResult(request=req)

    monkeypatch.setattr(S, "run_search", falso)
    w = W.Watch(id="x", destination="Roma", origin="VLC", desde="2027-03-01", hasta="2027-03-31", dias="3-6")
    W.revisar(w, cfg=None, history={})
    req = pedido["req"]
    assert req.origin == "VLC"
    assert (req.desde, req.hasta) == ("2027-03-01", "2027-03-31")
    assert req.par_de_dias == (3, 6)


def test_los_de_antes_siguen_siendo_desde_madrid():
    w = W.Watch(id="viejo")
    assert (w.origin, w.desde, w.hasta, w.dias) == ("MAD", "", "", "")


def test_una_ventana_pasada_caduca():
    ayer = (date.today() - timedelta(days=1)).isoformat()
    manana = (date.today() + timedelta(days=1)).isoformat()
    assert W.Watch(id="a", desde="2020-01-01", hasta=ayer).caducado
    assert not W.Watch(id="b", desde="2020-01-01", hasta=manana).caducado


def test_el_formulario_llega_entero_al_seguimiento(tmp_path, monkeypatch):
    monkeypatch.setattr(W, "FICHERO", tmp_path / "watch.json")
    monkeypatch.setattr(cli, "load_config", lambda *_: type("C", (), {"party_size": 2})())
    cli.main(
        [
            "watch", "add", "--dest", "Roma", "--origin", "bcn", "--desde", "2027-03-01",
            "--hasta", "2027-03-31", "--dias", "4-0", "--any-day", "--owner", "u-12345678",
        ]
    )
    w = W._cargar()[0]
    assert (w.origin, w.desde, w.hasta, w.dias) == ("BCN", "2027-03-01", "2027-03-31", "4-0")
    # Dos seguimientos a Roma con ventanas distintas no se pisan.
    assert "20270301" in w.id and "d40" in w.id and "bcn" in w.id
