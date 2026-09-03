"""El barrido de la madrugada del miércoles: la ventana, el cerrojo y el aviso
que espera a la mañana (#33, #35, #36).

Lo que se comprueba aquí no se puede comprobar de otra forma: la ventana sólo
es correcta dos veces al año (una por horario), el cerrojo sólo importa cuando
el planificador de GitHub se retrasa, y el aviso diferido sólo se nota en el
correo que llega —o no llega— a las tres de la mañana.
"""

from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
import yaml

from tripfinder.cli import aparcar_avisos, recoger_aparcados, toca_nocturno
from tripfinder.config import load_config
from tripfinder.models import FlightOffer

RAIZ = Path(__file__).resolve().parent.parent
MADRID = ZoneInfo("Europe/Madrid")
FLUJO = RAIZ / ".github" / "workflows" / "scan-nocturno.yml"


def _madrid(iso: str) -> datetime:
    return datetime.fromisoformat(iso).replace(tzinfo=MADRID)


# ---------------------------------------------------------------- la ventana
def test_en_verano_corre_una_sola_vez_dentro_de_la_ventana():
    """1 de julio de 2026 es miércoles y España va en CEST (UTC+2), así que el
    cron de las 00:17 UTC cae a las 02:17 y el de la 01:17 a las 03:17."""
    state: dict = {}
    si, _ = toca_nocturno(_madrid("2026-07-01T02:17"), state)
    assert si
    state["nocturno_semana"] = "2026-W27"
    # El segundo cron llega dentro de la ventana igual, y el cerrojo lo para.
    si, porque = toca_nocturno(_madrid("2026-07-01T03:17"), state)
    assert not si and "ya esta hecho" in porque


def test_en_invierno_corre_una_sola_vez_dentro_de_la_ventana():
    """7 de enero de 2026, miércoles, CET (UTC+1): el de las 00:17 UTC cae a la
    01:17 —fuera— y el de la 01:17 a las 02:17, dentro."""
    state: dict = {}
    si, porque = toca_nocturno(_madrid("2026-01-07T01:17"), state)
    assert not si and "fuera de la ventana" in porque
    si, _ = toca_nocturno(_madrid("2026-01-07T02:17"), state)
    assert si


def test_el_cambio_de_hora_no_obliga_a_tocar_nada():
    """El mismo par de cron acierta en las dos estaciones: es todo el motivo de
    que haya dos y un guardián en vez de uno solo."""
    for cuando in ("2026-07-01T02:17", "2026-01-07T02:17"):
        assert toca_nocturno(_madrid(cuando), {})[0], cuando


def test_un_cron_retrasado_hasta_pisar_al_otro_solo_corre_una_vez():
    state: dict = {}
    assert toca_nocturno(_madrid("2026-07-01T02:17"), state)[0]
    state["nocturno_semana"] = "2026-W27"
    assert not toca_nocturno(_madrid("2026-07-01T02:59"), state)[0]


def test_la_semana_siguiente_vuelve_a_tocar():
    state = {"nocturno_semana": "2026-W27"}
    assert toca_nocturno(_madrid("2026-07-08T02:17"), state)[0]


def test_a_mano_se_lanza_a_cualquier_hora():
    """Sin esto no habría forma de probarlo sin esperar al miércoles."""
    si, porque = toca_nocturno(_madrid("2026-07-01T16:00"), {}, manual=True)
    assert si and porque == "lanzado a mano"


def test_ni_a_mano_se_repite_la_semana():
    """El cerrojo está por encima del dispatch: 'exactamente un barrido por
    semana' es la regla, y un dispatch de más gastaría el presupuesto de
    consultas dos veces."""
    state = {"nocturno_semana": "2026-W27"}
    assert not toca_nocturno(_madrid("2026-07-01T16:00"), state, manual=True)[0]


@pytest.mark.parametrize("hora", ["00:30", "01:17", "04:00", "08:00", "23:59"])
def test_fuera_de_la_ventana_no_hace_nada(hora):
    assert not toca_nocturno(_madrid(f"2026-07-01T{hora}"), {})[0]


# ---------------------------------------------------------------- el workflow
def test_los_dos_cron_estan_puestos():
    datos = yaml.safe_load(FLUJO.read_text(encoding="utf-8"))
    crons = {c["cron"] for c in datos[True]["schedule"]}
    assert crons == {"17 0 * * 3", "17 1 * * 3"}


def test_el_minuto_no_es_cero():
    """Los cron en punto son los que más cola cogen en el planificador."""
    datos = yaml.safe_load(FLUJO.read_text(encoding="utf-8"))
    for c in datos[True]["schedule"]:
        assert c["cron"].split()[0] != "0", c


def test_los_dos_scans_no_pueden_correr_a_la_vez():
    """Mismo grupo de concurrency que scan-flights.yml, o los dos commitean en
    data/ a la vez y se pisan."""
    nocturno = yaml.safe_load(FLUJO.read_text(encoding="utf-8"))
    diario = yaml.safe_load((FLUJO.parent / "scan-flights.yml").read_text(encoding="utf-8"))
    assert nocturno["concurrency"]["group"] == diario["concurrency"]["group"]


def test_el_barrido_no_escribe_a_nadie_de_madrugada():
    texto = FLUJO.read_text(encoding="utf-8")
    assert "--diferir-avisos" in texto
    assert "--nocturno" in texto
    assert "watchlist-nocturno.yml" in texto


# ----------------------------------------------------------- la config heredada
def test_el_nocturno_hereda_lo_que_no_cambia():
    """Copiar las ~300 líneas de watchlist.yml garantizaba que los dos ficheros
    se separaran en cuanto se tocara uno."""
    base = load_config(RAIZ / "config" / "watchlist.yml")
    noche = load_config(RAIZ / "config" / "watchlist-nocturno.yml")
    assert noche.providers == base.providers
    assert len(noche.routes) == len(base.routes)
    assert noche.notify == base.notify
    assert noche.city_names == base.city_names
    assert "hereda" not in noche.raw


def test_el_nocturno_mira_mucho_mas_y_mas_despacio():
    """Más consultas es lo que justifica el barrido; más despacio es lo que
    evita que Google devuelva páginas vacías."""
    base = load_config(RAIZ / "config" / "watchlist.yml").search["google"]
    noche = load_config(RAIZ / "config" / "watchlist-nocturno.yml").search["google"]
    assert noche["max_queries"] > base["max_queries"] * 2
    assert noche["min_interval_seconds"] > base["min_interval_seconds"]


def test_el_diario_sigue_con_sus_cuarenta_consultas():
    """El criterio de aceptación de la #35: este cambio no toca al de las 08:00."""
    base = load_config(RAIZ / "config" / "watchlist.yml").search["google"]
    assert base["max_queries"] == 40
    assert base["min_interval_seconds"] == 4


def test_heredar_en_circulo_se_queja(tmp_path):
    (tmp_path / "a.yml").write_text("hereda: b.yml\nparty_size: 1\n")
    (tmp_path / "b.yml").write_text("hereda: a.yml\nparty_size: 2\n")
    with pytest.raises(ValueError, match="vueltas en circulo"):
        load_config(tmp_path / "a.yml")


def test_una_lista_se_pisa_entera(tmp_path):
    """Si `providers: [ryanair]` significara 'Ryanair además de los de siempre',
    no habría forma de quitar uno."""
    (tmp_path / "base.yml").write_text("providers: [a, b, c]\nsearch: {x: 1, y: 2}\n")
    (tmp_path / "hijo.yml").write_text("hereda: base.yml\nproviders: [a]\nsearch: {y: 9}\n")
    c = load_config(tmp_path / "hijo.yml")
    assert c.raw["providers"] == ["a"]
    assert c.raw["search"] == {"x": 1, "y": 9}


# ------------------------------------------------------- el aviso que espera
def _oferta(dest="BGY", precio=60.0) -> FlightOffer:
    return FlightOffer(
        provider="ryanair", origin="MAD", destination=dest,
        depart_date="2026-11-13", return_date="2026-11-15", price=precio, score=92,
    )


def test_lo_encontrado_de_madrugada_va_marcado():
    """Para poder ver con el tiempo si esa hora encuentra cosas que las otras no."""
    o = _oferta()
    assert o.nocturno is False
    o.nocturno = True
    assert FlightOffer.from_dict(o.to_dict()).nocturno is True


def test_un_aviso_aparcado_sobrevive_al_json():
    """Se guardan en state.json como diccionarios y vuelven a salir enteros: si
    se perdiera algo por el camino, el correo de la mañana llegaría cojo."""
    o = _oferta()
    o.nocturno = True
    vuelta = FlightOffer.from_dict(o.to_dict())
    assert vuelta.id == o.id
    assert (vuelta.price, vuelta.destination, vuelta.score) == (o.price, o.destination, o.score)


def test_el_barrido_de_madrugada_aparca_en_vez_de_escribir():
    """Criterio de la #36: un chollo de las 02:00 llega por la mañana."""
    state: dict = {}
    nuevas = aparcar_avisos(state, [_oferta("BGY"), _oferta("DUB", 99.0)])
    assert len(nuevas) == 2
    assert {o.destination for o in recoger_aparcados(state)} == {"BGY", "DUB"}


def test_lo_aparcado_no_se_cuenta_dos_veces():
    """Ni dos barridos seguidos ni una recogida repetida lo duplican."""
    state: dict = {}
    aparcar_avisos(state, [_oferta("BGY")])
    otra_vez = aparcar_avisos(state, [_oferta("BGY"), _oferta("DUB", 99.0)])
    assert [o.destination for o in otra_vez] == ["DUB"]
    assert len(state["avisos_pendientes"]) == 2
    assert len(recoger_aparcados(state)) == 2


def test_sin_barrido_de_madrugada_no_hay_nada_que_recoger():
    assert recoger_aparcados({}) == []
    assert recoger_aparcados({"avisos_pendientes": []}) == []


def test_un_aviso_ilegible_no_tumba_el_scan():
    """`state.json` lo escriben dos workflows distintos: si uno lo deja a medias,
    el scan de la mañana tiene que mandar lo que sí entienda, no morirse."""
    state = {"avisos_pendientes": [_oferta("BGY").to_dict(), {"esto": "no es una oferta"}]}
    recogidos = recoger_aparcados(state)
    assert [o.destination for o in recogidos] == ["BGY"]


def test_lo_aparcado_no_se_borra_al_recogerlo():
    """Sólo se borra cuando de verdad salió el correo: si falla el SMTP, el
    chollo sigue esperando en vez de perderse."""
    state: dict = {}
    aparcar_avisos(state, [_oferta("BGY")])
    recoger_aparcados(state)
    assert len(state["avisos_pendientes"]) == 1
