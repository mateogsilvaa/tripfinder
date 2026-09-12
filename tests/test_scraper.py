"""Lo que el scraper NO tiene que hacer: preguntar de mas y darse contra el muro.

Estas pruebas no miran si se parsea bien una tarifa —eso es `test_providers`—
sino el gasto: cuantas paginas se descargan para averiguar lo mismo. En un
barrido real (12 sep 2026) eso era casi la mitad del trabajo tirada: doce
consultas a cada aeropuerto sin vuelos y, al final, Google devolviendo muros a
todo lo que quedaba.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from tripfinder import rutas_vacias
from tripfinder.config import Route
from tripfinder.models import FlightOffer
from tripfinder.providers import google_flights as gf

RUTA = Route(origin="MAD", origin_name="Madrid")


@pytest.fixture(autouse=True)
def _sin_castigo():
    """El castigo y la memoria son de modulo —el barrido entero los comparte—,
    asi que sin limpiarlos una prueba dejaria capada o servida a la siguiente."""
    gf._MURO_HASTA = 0.0
    gf._MEMORIA.clear()
    yield
    gf._MURO_HASTA = 0.0
    gf._MEMORIA.clear()


@pytest.fixture
def cuaderno(tmp_path, monkeypatch):
    c = rutas_vacias.Cuaderno(tmp_path)
    monkeypatch.setattr(rutas_vacias, "_CUADERNO", c)
    return c


def _provider(respuestas, **gcfg):
    """Un provider cuyas consultas contesta `respuestas(dest)`.

    Devolver [] es "esta ruta no tiene vuelos"; `MURO` es "no nos contestan",
    que es lo que hay que distinguir.
    """
    p = gf.GoogleFlightsProvider({"google": {"min_interval_seconds": 0, **gcfg}})
    p.pedidas = []

    def falso(route, dest, out_date, in_date):
        p.pedidas.append((dest, out_date))
        salida = respuestas(dest)
        p.ultimo_muro = salida is MURO
        return [] if p.ultimo_muro else salida

    p._one_search = falso
    return p


MURO = object()


def _oferta(dest: str, dia: date) -> FlightOffer:
    return FlightOffer(
        provider="google", origin="MAD", destination=dest,
        depart_date=dia.isoformat(), price=99.0,
    )


def _ventanas(dest: str, cuantas: int = 12) -> list[tuple[str, date, date]]:
    hoy = date.today()
    return [
        (dest, hoy + timedelta(days=7 * i), hoy + timedelta(days=7 * i + 2))
        for i in range(cuantas)
    ]


# -- no insistir con un destino sin vuelos --------------------------------
def test_dos_ventanas_en_blanco_bastan_para_dejar_ese_destino(cuaderno):
    """Doce consultas a Tartu daban lo mismo que dos: nada."""
    p = _provider(lambda dest: [])
    p.shortlist = _ventanas("TAY")
    p.limite = 99
    assert p.search(RUTA) == []
    assert len(p.pedidas) == 2
    assert p.stats["saltadas"] == 10


def test_lo_ahorrado_se_gasta_en_lo_que_si_vuela(cuaderno):
    """El presupuesto cuenta consultas, no candidatas. Si contara candidatas,
    ahorrarse diez paginas de Tartu solo serviria para terminar antes."""
    hoy = date.today()
    # Como las reparte la busqueda: por fecha, alternando destinos.
    pares = []
    for i in range(12):
        for dest in ("TAY", "FCO"):
            pares.append((dest, hoy + timedelta(days=7 * i), hoy + timedelta(days=7 * i + 2)))

    p = _provider(lambda dest: [] if dest == "TAY" else [_oferta(dest, hoy)])
    p.shortlist, p.limite = pares, 6
    p.search(RUTA)
    pedidas = [d for d, _ in p.pedidas]
    assert len(pedidas) == 6
    assert pedidas.count("TAY") == 2  # dos sondas y se deja
    assert pedidas.count("FCO") == 4  # el resto del presupuesto, a donde hay vuelos


def test_un_destino_con_vuelos_se_mira_entero(cuaderno):
    """Lo contrario tambien tiene que valer: donde hay precios, se barre todo."""
    p = _provider(lambda dest: [_oferta(dest, date.today())])
    p.shortlist = _ventanas("FCO")
    p.limite = 99
    assert len(p.search(RUTA)) == 12
    assert len(p.pedidas) == 12


def test_lo_vacio_queda_apuntado_y_el_barrido_siguiente_solo_sondea(cuaderno):
    """Tras dos barridos en blanco, la ruta baja a una sonda por barrido: no se
    abandona —el dia que exista el vuelo hay que verlo— pero deja de costar
    doce paginas."""
    for _ in range(rutas_vacias.UMBRAL):
        cuaderno._apuntadas.clear()
        p = _provider(lambda dest: [])
        p.shortlist, p.limite = _ventanas("TAY"), 99
        p.search(RUTA)

    assert cuaderno.vacia("MAD", "TAY")
    cuaderno._apuntadas.clear()
    p = _provider(lambda dest: [])
    p.shortlist, p.limite = _ventanas("TAY"), 99
    p.search(RUTA)
    assert len(p.pedidas) == 1


def test_un_precio_resucita_la_ruta(cuaderno):
    """Ryanair estrena Madrid-Tartu: se borra lo apuntado y se vuelve a barrer."""
    cuaderno.apuntar_vacia("MAD", "TAY")
    cuaderno._apuntadas.clear()
    cuaderno.apuntar_vacia("MAD", "TAY")
    assert cuaderno.vacia("MAD", "TAY")

    cuaderno._apuntadas.clear()
    p = _provider(lambda dest: [_oferta(dest, date.today())])
    p.shortlist, p.limite = _ventanas("TAY"), 99
    p.search(RUTA)
    assert not cuaderno.vacia("MAD", "TAY")


def test_lo_apuntado_caduca(cuaderno):
    """Hay rutas de temporada: Madrid-Split no existe en enero y en julio si.
    Una lista negra sin caducidad las perderia para siempre."""
    viejo = (date.today() - timedelta(days=rutas_vacias.CADUCIDAD + 1)).isoformat()
    cuaderno.datos["MAD-SPU"] = {"barridos": 9, "ultima": viejo}
    assert not cuaderno.vacia("MAD", "SPU")


# -- distinguir "no hay vuelos" de "no nos contestan" ----------------------
def test_un_muro_no_apunta_la_ruta_como_vacia(cuaderno):
    """Lo importante de todo esto: el dia que Google cape, no podemos apuntar
    media Europa como 'sin vuelos' y dejar de mirarla."""
    p = _provider(lambda dest: MURO, tope_muros=99)
    p.shortlist, p.limite = _ventanas("FCO"), 99
    p.search(RUTA)
    assert not cuaderno.vacia("MAD", "FCO")
    assert cuaderno.barridos("MAD", "FCO") == 0


def test_tras_varios_muros_se_deja_de_preguntar(cuaderno):
    """Insistir contra el muro no trae ni una tarifa y alarga el castigo."""
    p = _provider(lambda dest: [], tope_muros=3)
    # El muro lo pone el propio provider, como hace `_descargar`.
    def con_muro(route, dest, out_date, in_date):
        p.pedidas.append((dest, out_date))
        p.ultimo_muro = True
        p.muros_seguidos += 1
        if p.muros_seguidos >= p._tope_muros():
            gf._castigar(600)
            p.bloqueado = True
        return []

    p._one_search = con_muro
    p.shortlist, p.limite = _ventanas("FCO", 20), 99
    p.search(RUTA)
    assert len(p.pedidas) == 3


def test_el_castigo_lo_heredan_las_busquedas_siguientes(cuaderno):
    """Cada busqueda guardada levanta su propio provider. Si el castigo viviera
    en el objeto, la primera se comia el muro y la segunda empezaba de cero
    contra la misma pared."""
    gf._castigar(600)
    p = _provider(lambda dest: [_oferta(dest, date.today())])
    p.shortlist, p.limite = _ventanas("FCO"), 99
    assert p.search(RUTA) == []
    assert p.pedidas == []
    assert p.bloqueado


# -- no preguntar dos veces lo mismo --------------------------------------
def test_la_misma_consulta_no_se_descarga_dos_veces(monkeypatch):
    """Dos cuentas siguiendo el mismo destino el mismo finde eran dos descargas
    de 2,5 MB para la misma respuesta."""
    p = gf.GoogleFlightsProvider({"google": {"min_interval_seconds": 0}})
    descargas = []

    def falsa(tfs, dest, out_date):
        descargas.append(dest)
        return "<html>" + "x" * 30000 + "</html>"

    monkeypatch.setattr(p, "_descargar", falsa)
    hoy = date.today()
    p._one_search(RUTA, "FCO", hoy, hoy + timedelta(days=2))
    p._one_search(RUTA, "FCO", hoy, hoy + timedelta(days=2))
    assert descargas == ["FCO"]
    assert p.stats["repetidas"] == 1


def test_lo_servido_de_memoria_son_copias(monkeypatch):
    """Quien la pide la puntua y la retoca: dos busquedas con el mismo objeto se
    pisarian el score."""
    p = gf.GoogleFlightsProvider({"google": {"min_interval_seconds": 0}})
    hoy = date.today()
    recuerdo = ("MAD", "FCO", hoy, hoy, 1)
    p.memoria[recuerdo] = [_oferta("FCO", hoy)]
    primera = p._one_search(RUTA, "FCO", hoy, hoy)
    primera[0].price = 1.0
    segunda = p._one_search(RUTA, "FCO", hoy, hoy)
    assert segunda[0].price == 99.0


# -- el cuaderno en disco --------------------------------------------------
def test_el_cuaderno_no_escribe_si_no_ha_aprendido_nada(tmp_path):
    """El barrido commitea `data/` cada doce horas: un fichero que cambia sin
    cambiar nada seria ruido en cada commit."""
    c = rutas_vacias.Cuaderno(tmp_path)
    c.guardar()
    assert not c.ruta.exists()


def test_el_cuaderno_se_relee_tal_cual(tmp_path):
    c = rutas_vacias.Cuaderno(tmp_path)
    c.apuntar_vacia("MAD", "TAY")
    c.guardar()
    otro = rutas_vacias.Cuaderno(tmp_path)
    assert otro.barridos("MAD", "TAY") == 1


def test_un_cuaderno_ilegible_no_tumba_el_barrido(tmp_path):
    (tmp_path / rutas_vacias.FICHERO).write_text("{ esto no es json")
    assert rutas_vacias.Cuaderno(tmp_path).datos == {}


def test_dos_sondas_del_mismo_barrido_cuentan_como_una(tmp_path):
    """Si contaran como dos, el umbral de barridos no significaria nada."""
    c = rutas_vacias.Cuaderno(tmp_path)
    c.apuntar_vacia("MAD", "TAY")
    c.apuntar_vacia("MAD", "TAY")
    assert c.barridos("MAD", "TAY") == 1


# -- la descarga, con su muro y su reintento -------------------------------
def _sin_esperas(monkeypatch):
    monkeypatch.setattr(gf.time, "sleep", lambda _s: None)


def test_una_pagina_buena_se_devuelve_y_reinicia_la_cuenta(monkeypatch):
    _sin_esperas(monkeypatch)
    buena = "<html>" + "x" * 30000 + "</html>"
    monkeypatch.setattr(gf, "get_text", lambda *a, **k: buena)
    p = gf.GoogleFlightsProvider({"google": {}})
    p.muros_seguidos = 2
    assert p._descargar("tfs", "FCO", date.today()) == buena
    assert p.muros_seguidos == 0


def test_un_muro_se_reintenta_una_vez_con_sigilo(monkeypatch):
    """El sigilo (TLS y cabeceras de un Chrome real) es lo unico que a veces lo
    salta. Una vez: insistir mas es alargar el castigo."""
    _sin_esperas(monkeypatch)
    monkeypatch.setattr(gf, "hay_sigilo", lambda: True)
    intentos = []

    def falso(url, **kw):
        intentos.append(kw.get("stealth", False))
        return "<html>" + "x" * 30000 + "</html>" if kw.get("stealth") else "muro"

    monkeypatch.setattr(gf, "get_text", falso)
    p = gf.GoogleFlightsProvider({"google": {}})
    assert p._descargar("tfs", "FCO", date.today()) is not None
    assert intentos == [False, True]
    assert p.muros_seguidos == 0


def test_sin_scrapling_no_se_reintenta(monkeypatch):
    """Sin sigilo instalado, `stealth=True` repite la MISMA peticion con
    requests: 2,5 MB a la basura y una peticion mas contra quien ya nos capaba."""
    _sin_esperas(monkeypatch)
    monkeypatch.setattr(gf, "hay_sigilo", lambda: False)
    intentos = []
    monkeypatch.setattr(gf, "get_text", lambda url, **kw: intentos.append(kw) or "muro")
    p = gf.GoogleFlightsProvider({"google": {}})
    assert p._descargar("tfs", "FCO", date.today()) is None
    assert len(intentos) == 1
    assert p.stats["muros"] == 1


def test_el_muro_espera_cada_vez_mas(monkeypatch):
    monkeypatch.setattr(gf, "hay_sigilo", lambda: False)
    monkeypatch.setattr(gf, "get_text", lambda *a, **k: "muro")
    esperas = []
    monkeypatch.setattr(gf.time, "sleep", esperas.append)
    p = gf.GoogleFlightsProvider({"google": {"tope_muros": 99}})
    for _ in range(4):
        p._descargar("tfs", "FCO", date.today())
    assert esperas == [5, 10, 20, 40]


# -- repartir el presupuesto: descubrir y contrastar -----------------------
def test_el_prefijo_de_candidatas_lleva_de_los_dos_tipos():
    """Quien corta la lista es el presupuesto de consultas, y no se sabe por
    donde va a cortar: si las de contrastar fueran al final, cualquier corte se
    las llevaria enteras y no se mejoraria ni un precio."""
    from tripfinder.search import _google_candidatas

    hoy = date.today()
    fechas = [(hoy + timedelta(days=7 * i), hoy + timedelta(days=7 * i + 2)) for i in range(4)]
    universo = {f"D{i:02d}": (f"Ciudad {i}", "Pais") for i in range(10)}
    # De tres destinos ya tenemos precio: esos son los de contrastar.
    encontradas = {
        f"x{i}": _oferta(f"D{i:02d}", fechas[0][0]) for i in range(3)
    }
    presupuesto = 20
    salida = _google_candidatas(universo, fechas, encontradas, presupuesto, candidatas=presupuesto * 3)

    # Diez destinos por cuatro ventanas: cuarenta candidatas, y las devuelve
    # todas porque caben en el triple del presupuesto.
    assert len(salida) == 40
    ya_tienen = {o.destination for o in encontradas.values()}
    prefijo = salida[:presupuesto]
    contrastadas = [c for c in prefijo if c[0] in ya_tienen and c[1] == fechas[0][0]]
    assert contrastadas, "el presupuesto se gasta entero en descubrir"
    assert len(contrastadas) < presupuesto, "no se descubre nada nuevo"


def test_preparar_mas_candidatas_no_cambia_lo_que_se_contrasta():
    """El bloque de contrastar se mide sobre las CONSULTAS. Si se midiera sobre
    las candidatas, preparar el triple significaria contrastar el triple y
    descubrir lo mismo de siempre."""
    from pathlib import Path as _P

    from tripfinder.cli import _shortlist
    from tripfinder.config import load_config

    cfg = load_config(_P(__file__).resolve().parent.parent / "config" / "watchlist.yml")
    hoy = date.today()
    encontradas = []
    for i in range(40):
        o = _oferta(f"D{i:02d}", hoy)
        o.return_date = (hoy + timedelta(days=2)).isoformat()
        encontradas.append(o)

    antes, _ = _shortlist(encontradas, cfg, 40)
    ahora, _ = _shortlist(encontradas, cfg, 120, consultas=40)
    conocidos = {o.destination for o in encontradas}
    assert sum(1 for p in antes[:40] if p[0] in conocidos) == sum(
        1 for p in ahora[:40] if p[0] in conocidos
    )
