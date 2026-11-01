"""Mas vuelos en el barrido y la hora de llegada de Wizz.

* WIZZ NO DECIA A QUE HORA LLEGA. El `timetable` trae la salida y nada mas, y
  sin llegada no hay «viaje real» ni horas utiles. `search/search` si la trae,
  y se le pregunta una vez por ruta: un vuelo tarda lo mismo cualquier dia.
* EL HORIZONTE SE QUEDABA A MEDIAS. Wizz guardaba doce viajes por destino para
  toda la ventana (casi siempre de los primeros meses) y Ryanair pedia una sola
  ventana de diez meses, que devuelve UN viaje por destino.
"""

from datetime import date, timedelta
from itertools import pairwise

import pytest

from tripfinder import duraciones as dur
from tripfinder.config import Route
from tripfinder.providers import ryanair as R
from tripfinder.providers import wizzair as W

RUTA = Route(origin="MAD", origin_name="Madrid")


@pytest.fixture(autouse=True)
def libreta(tmp_path, monkeypatch):
    """Cada prueba con su libreta de duraciones, lejos de `data/`."""
    nueva = dur.Duraciones(tmp_path)
    monkeypatch.setattr(dur, "_DURACIONES", nueva)
    W._cache.pop("dur_fallos", None)
    return nueva


def vuelo(dia, importe, *horas):
    return {
        "departureDate": f"{dia}T00:00:00",
        "departureDates": [f"{dia}T{h}:00" for h in horas],
        "price": {"amount": importe, "currencyCode": "EUR"},
    }


def wizz(**cfg):
    base = {"adults": 1, "nights_min": 2, "nights_max": 4, "weekend": {"outbound_weekday": 4}}
    return W.WizzairProvider({**base, **cfg})


# --------------------------------------------------------- lo que tarda
def test_los_minutos_de_vuelo_llevan_el_cambio_de_huso():
    # Madrid 06:20 -> Bucarest 10:55 (hora local de cada sitio).
    assert dur.minutos_de_vuelo("2026-11-13T06:20:00", "2026-11-13T10:55:00") == 275
    # Uno que aterriza pasada la medianoche.
    assert dur.minutos_de_vuelo("2026-11-13T22:30:00", "2026-11-14T02:15:00") == 225
    assert dur.minutos_de_vuelo("", "2026-11-14T02:15:00") is None
    assert dur.minutos_de_vuelo("2026-11-13T10:00:00", "2026-11-13T09:00:00") is None


def test_la_llegada_es_la_salida_mas_lo_que_tarda():
    assert dur.llegada("06:20", 275) == "10:55"
    assert dur.llegada("22:30", 225) == "02:15"
    # Sin uno de los dos datos no se inventa nada.
    assert dur.llegada("", 275) == ""
    assert dur.llegada("06:20", None) == ""


def test_lo_aprendido_caduca(libreta):
    assert libreta.hace_falta("MAD", "OTP")
    libreta.apuntar("MAD", "OTP", 275, hoy=date(2026, 11, 1))
    assert not libreta.hace_falta("MAD", "OTP", hoy=date(2026, 12, 1))
    assert libreta.hace_falta("MAD", "OTP", hoy=date(2027, 1, 1))
    # Cada sentido va aparte: la vuelta no tarda lo mismo.
    assert libreta.hace_falta("OTP", "MAD")


def test_se_guarda_y_se_vuelve_a_leer(tmp_path, libreta):
    libreta.apuntar("MAD", "OTP", 275)
    libreta.guardar()
    assert dur.Duraciones(tmp_path).de("MAD", "OTP") == 275


def test_la_oferta_de_wizz_sale_con_su_llegada(libreta):
    libreta.apuntar("MAD", "OTP", 275)
    libreta.apuntar("OTP", "MAD", 230)
    [o] = wizz()._casar(
        RUTA, "OTP", {"2026-12-11": vuelo("2026-12-11", 30, "06:20")},
        {"2026-12-13": vuelo("2026-12-13", 30, "21:40")}, 2,
    )
    assert (o.depart_time, o.arrive_time) == ("06:20", "10:55")
    assert (o.return_time, o.return_arrive_time) == ("21:40", "01:30")


def test_sin_duracion_aprendida_no_hay_llegada():
    [o] = wizz()._casar(
        RUTA, "OTP", {"2026-12-11": vuelo("2026-12-11", 30, "06:20")},
        {"2026-12-13": vuelo("2026-12-13", 30, "21:40")}, 2,
    )
    assert (o.arrive_time, o.return_arrive_time) == ("", "")


class Respuesta:
    def __init__(self, codigo, datos):
        self.status_code, self._datos = codigo, datos

    def json(self):
        return self._datos


def test_se_aprende_con_una_consulta_al_buscador(monkeypatch, libreta):
    pedidas = []

    def post(ruta, cuerpo, timeout=35):
        pedidas.append((ruta, cuerpo))
        return Respuesta(200, {
            "outboundFlights": [{"departureDateTime": "2026-12-11T06:20:00", "arrivalDateTime": "2026-12-11T10:55:00"}],
            "returnFlights": [{"departureDateTime": "2026-12-13T21:40:00", "arrivalDateTime": "2026-12-14T01:30:00"}],
        })

    monkeypatch.setattr(W, "_post", post)
    monkeypatch.setattr(W, "throttle", lambda *a, **k: None)
    idas = {"2026-12-11": vuelo("2026-12-11", 30, "06:20")}
    vueltas = {"2026-12-13": vuelo("2026-12-13", 30, "21:40")}
    p = wizz()
    p._aprender_duraciones("MAD", "OTP", idas, vueltas, 2)
    assert [r for r, _ in pedidas] == ["/search/search"]
    fechas = [x["date"] for x in pedidas[0][1]["flightList"]]
    assert fechas == ["2026-12-11", "2026-12-13"]
    assert (libreta.de("MAD", "OTP"), libreta.de("OTP", "MAD")) == (275, 230)
    # Sabido ya, no se vuelve a preguntar.
    p._aprender_duraciones("MAD", "OTP", idas, vueltas, 2)
    assert len(pedidas) == 1


def test_un_buscador_cerrado_no_cuesta_una_consulta_por_destino(monkeypatch):
    llamadas = []
    monkeypatch.setattr(W, "_post", lambda *a, **k: llamadas.append(1) or Respuesta(403, None))
    monkeypatch.setattr(W, "throttle", lambda *a, **k: None)
    idas = {"2026-12-11": vuelo("2026-12-11", 30, "06:20")}
    vueltas = {"2026-12-13": vuelo("2026-12-13", 30, "21:40")}
    for destino in ["OTP", "SOF", "BUD", "WAW", "KTW", "GDN"]:
        wizz()._aprender_duraciones("MAD", destino, idas, vueltas, 2)
    assert len(llamadas) == 3


# ------------------------------------------------------ todo el horizonte
def test_wizz_reparte_los_viajes_por_mes():
    """Doce para toda la ventana se los comian los primeros meses: ahora cada
    mes guarda los suyos."""
    hoy = date(2026, 11, 2)
    idas, vueltas = {}, {}
    for i in range(0, 240, 1):
        d = hoy + timedelta(days=i)
        idas[d.isoformat()] = vuelo(d.isoformat(), 10 + i, "18:00")
        vueltas[d.isoformat()] = vuelo(d.isoformat(), 10 + i, "20:00")
    ofertas = wizz(wizz_per_month=4)._casar(RUTA, "OTP", idas, vueltas, 2)
    meses = {o.depart_date[:7] for o in ofertas}
    assert len(meses) >= 8
    assert all(sum(o.depart_date[:7] == m for o in ofertas) <= 4 for m in meses)


def test_ryanair_pide_el_horizonte_mes_a_mes(monkeypatch):
    pedidas = []

    def get_json(url, params=None, **k):
        pedidas.append(dict(params))
        return {"fares": []}

    monkeypatch.setattr(R, "get_json", get_json)
    p = R.RyanairProvider({"days_ahead": 300, "nights_min": 2, "nights_max": 4, "ryanair_window_days": 31})
    p._broad_search(Route(origin="MAD", origin_name="Madrid"))
    assert len(pedidas) == 10
    # Seguidas y sin huecos: cada tramo empieza el dia despues del anterior.
    for a, b in pairwise(pedidas):
        fin = date.fromisoformat(a["outboundDepartureDateTo"])
        assert date.fromisoformat(b["outboundDepartureDateFrom"]) == fin + timedelta(days=1)
    assert pedidas[-1]["outboundDepartureDateTo"] == (date.today() + timedelta(days=300)).isoformat()


# ------------------------------------------- Google, a por otras aerolineas
def _cfg():
    from pathlib import Path

    from tripfinder.config import load_config

    return load_config(Path(__file__).resolve().parent.parent / "config" / "watchlist.yml")


def test_google_pregunta_antes_por_lo_que_no_vuela_nadie(monkeypatch):
    """Repetir con Google un viaje que ya trajo Ryanair devuelve el mismo
    Ryanair. Las aerolineas nuevas salen de los destinos sin low cost."""
    from tripfinder import cli
    from tripfinder import routes as rutas
    from tripfinder.models import FlightOffer

    universo = {f"D{i:02d}": (f"Ciudad {i}", "Pais") for i in range(60)}
    monkeypatch.setattr(rutas, "destinos", lambda origen, cfg: universo)
    hoy = date.today()
    cubiertos = [f"D{i:02d}" for i in range(30)]
    found = [
        FlightOffer(provider="ryanair", origin="MAD", destination=d, depart_date=hoy.isoformat(),
                    return_date=(hoy + timedelta(days=2)).isoformat(), price=50.0)
        for d in cubiertos
    ]
    pares, _ = cli._shortlist(found, _cfg(), 40)
    contraste = [p for p in pares if p[1] == hoy]
    assert len(contraste) == 10  # un cuarto de 40
    descubrir = [p[0] for p in pares if p[1] != hoy]
    # Los treinta primeros a descubrir son los que nadie ha traido.
    assert all(d not in cubiertos for d in descubrir[:30])
    # Y repartidos por el horizonte, no en los cuatro proximos findes.
    meses = {p[1].strftime("%Y-%m") for p in pares if p[1] != hoy}
    assert len(meses) >= 5


# ---------------------------------- la llegada de Wizz, de otros directos
def test_lo_que_tarda_una_ruta_se_aprende_de_ryanair(libreta):
    from tripfinder.models import FlightOffer

    ryanair = FlightOffer(
        provider="ryanair", origin="MAD", destination="BUD", depart_date="2027-03-05",
        return_date="2027-03-07", depart_time="06:30", arrive_time="10:00",
        return_time="22:40", return_arrive_time="01:30", price=60.0,
    )
    wizz = FlightOffer(
        provider="wizzair", origin="MAD", destination="BUD", depart_date="2027-04-09",
        return_date="2027-04-11", depart_time="17:00", return_time="20:15", price=50.0,
    )
    assert dur.aprender_de([ryanair, wizz]) == 2
    # La vuelta aterriza pasada la medianoche: tarda 2 h 50, no menos de cero.
    assert (libreta.de("MAD", "BUD"), libreta.de("BUD", "MAD")) == (210, 170)
    assert dur.completar_llegadas([ryanair, wizz]) == [wizz]
    assert (wizz.arrive_time, wizz.return_arrive_time) == ("20:30", "23:05")


def test_con_escala_no_se_aprende_ni_se_inventa(libreta):
    from tripfinder.models import FlightOffer

    escala = FlightOffer(
        provider="google", origin="MAD", destination="OTP", depart_date="2027-03-05",
        depart_time="06:30", arrive_time="15:00", price=90.0, stops=1,
    )
    assert dur.aprender_de([escala]) == 0
    assert libreta.de("MAD", "OTP") is None


def test_un_429_deja_el_buscador_de_wizz_en_paz(monkeypatch):
    llamadas = []

    class Bloqueo:
        status_code, text = 429, ""

    monkeypatch.setattr(W, "_post", lambda *a, **k: llamadas.append(1) or Bloqueo())
    monkeypatch.setattr(W, "throttle", lambda *a, **k: None)
    idas = {"2026-12-11": vuelo("2026-12-11", 30, "06:20")}
    vueltas = {"2026-12-13": vuelo("2026-12-13", 30, "21:40")}
    for destino in ["OTP", "SOF", "BUD"]:
        wizz()._aprender_duraciones("MAD", destino, idas, vueltas, 2)
    assert len(llamadas) == 1
