"""Fechas flexibles: «en marzo», «la semana del 3», «entre estos dos días».

El hueco que tapan: hasta ahora una búsqueda era o una fecha exacta o el
horizonte entero. Pero un viaje no se decide así. Se decide con unas vacaciones
de una semana concreta, o con un mes en el que libras, y dentro de eso da igual
el día: lo que se quiere es el más barato que haya ahí dentro.

Lo que se prueba aquí es lo que hace distinto a un tramo de un horizonte: que
recorta por LOS DOS lados, que dentro mira día a día (un tramo de diez días
muestreado cada quince no mira ninguno) y que la vuelta también cae dentro.
"""

from datetime import date, timedelta

from tripfinder.search import SearchRequest, _candidate_trips

FINDE = {"outbound_weekday": 4, "inbound_weekday": 6}


def pedir(**kw) -> SearchRequest:
    return SearchRequest(destination="FCO", weekend_only=False, **kw)


def hoy_mas(dias: int) -> str:
    return (date.today() + timedelta(days=dias)).isoformat()


# --------------------------------------------------------------- el recorte
def test_el_tramo_recorta_por_los_dos_lados():
    fechas = _candidate_trips(pedir(desde=hoy_mas(30), hasta=hoy_mas(40)), FINDE)
    assert fechas
    assert all(date.fromisoformat(hoy_mas(30)) <= ida for ida, _ in fechas)
    assert all(vuelta <= date.fromisoformat(hoy_mas(40)) for _, vuelta in fechas)


def test_sin_tramo_se_sigue_barriendo_el_horizonte():
    """Lo de siempre no cambia: quien no pone tramo busca hasta donde llegue."""
    fechas = _candidate_trips(pedir(months=12), FINDE)
    assert len(fechas) > 20
    assert fechas[-1][0] > date.today() + timedelta(days=300)


def test_un_tramo_corto_se_mira_dia_a_dia():
    """Diez días muestreados cada quince no miran NINGUNO: ese era el fallo."""
    fechas = _candidate_trips(pedir(desde=hoy_mas(10), hasta=hoy_mas(20)), FINDE)
    salidas = [ida for ida, _ in fechas]
    assert len(salidas) >= 8
    assert len(set(salidas)) == len(salidas)


def test_un_tramo_largo_se_muestrea_mas_suelto():
    """Y no se gastan 300 consultas en un tramo de un año."""
    fechas = _candidate_trips(pedir(desde=hoy_mas(10), hasta=hoy_mas(375)), FINDE)
    assert len(fechas) < 60


def test_un_tramo_enorme_se_barre_ENTERO():
    """Con paso fijo se miraban los primeros meses y el resto se perdía al
    truncar a 45 consultas: pedir «de aquí a un año» miraba hasta octubre."""
    fechas = _candidate_trips(pedir(desde=hoy_mas(5), hasta=hoy_mas(370)), FINDE)[:45]
    assert fechas[-1][0] > date.today() + timedelta(days=330)


def test_un_mes_entero_cabe_en_el_presupuesto_de_consultas():
    """45 es el tope que se le pasa a `run_search`; un mes tiene que caber."""
    fechas = _candidate_trips(pedir(desde=hoy_mas(40), hasta=hoy_mas(70)), FINDE)
    # Día a día: un mes son treinta consultas y el tope son cuarenta y cinco.
    assert 25 <= len(fechas) <= 45


# ------------------------------------------------------------------ findes
def test_un_mes_solo_findes_da_viernes():
    req = SearchRequest(destination="FCO", weekend_only=True, desde=hoy_mas(20), hasta=hoy_mas(50))
    fechas = _candidate_trips(req, FINDE)
    assert fechas
    assert all(ida.weekday() == 4 for ida, _ in fechas)
    assert all(vuelta.weekday() == 6 for _, vuelta in fechas)
    # Cuatro o cinco findes en treinta días, no cincuenta y dos.
    assert 3 <= len(fechas) <= 6


def test_los_findes_del_tramo_caen_dentro():
    req = SearchRequest(destination="FCO", weekend_only=True, desde=hoy_mas(20), hasta=hoy_mas(50))
    primero = date.fromisoformat(hoy_mas(20))
    ultimo = date.fromisoformat(hoy_mas(50))
    for ida, vuelta in _candidate_trips(req, FINDE):
        assert primero <= ida and vuelta <= ultimo


def test_un_finde_que_empieza_el_mismo_dia_cuenta():
    """Si el tramo empieza en viernes, ese viernes es el primero, no el de dentro
    de una semana: el usuario ha dicho justo ese día."""
    hoy = date.today()
    viernes = hoy + timedelta(days=(4 - hoy.weekday()) % 7 or 7)
    req = SearchRequest(
        destination="FCO",
        weekend_only=True,
        desde=viernes.isoformat(),
        hasta=(viernes + timedelta(days=9)).isoformat(),
    )
    assert _candidate_trips(req, FINDE)[0][0] == viernes


# ------------------------------------------------------------- los bordes
def test_un_tramo_que_empezo_ayer_empieza_manana():
    """Lo de antes de hoy no se vende, y pedirlo devolvía fechas muertas."""
    fechas = _candidate_trips(pedir(desde=hoy_mas(-30), hasta=hoy_mas(10)), FINDE)
    assert all(ida > date.today() for ida, _ in fechas)


def test_un_tramo_sin_final_es_de_aqui_en_adelante():
    fechas = _candidate_trips(pedir(desde=hoy_mas(200), months=12), FINDE)
    assert fechas
    assert all(ida >= date.fromisoformat(hoy_mas(200)) for ida, _ in fechas)


def test_un_tramo_mas_corto_que_las_noches_sigue_dando_algo():
    """Tres días con dos noches mínimas: mejor salir el último día y volver
    fuera que decirle al usuario que no hay nada."""
    fechas = _candidate_trips(pedir(desde=hoy_mas(10), hasta=hoy_mas(11)), FINDE)
    assert fechas


def test_un_tramo_al_reves_no_tumba_la_busqueda():
    fechas = _candidate_trips(pedir(desde=hoy_mas(40), hasta=hoy_mas(10)), FINDE)
    assert fechas
    assert all(ida >= date.fromisoformat(hoy_mas(40)) for ida, _ in fechas)


def test_una_fecha_de_pega_no_tumba_la_busqueda():
    """Lo que llega de la web puede ser cualquier cosa; se cae al horizonte."""
    fechas = _candidate_trips(pedir(desde="el mes que viene", months=6), FINDE)
    assert len(fechas) > 5


def test_la_fecha_exacta_sigue_mandando_sobre_el_tramo():
    fechas = _candidate_trips(
        pedir(depart=hoy_mas(60), return_date=hoy_mas(63), desde=hoy_mas(10), hasta=hoy_mas(20)),
        FINDE,
    )
    assert fechas == [
        (date.fromisoformat(hoy_mas(60)), date.fromisoformat(hoy_mas(63))),
    ]


# -------------------------------------------------------------- el fichero
def test_dos_meses_distintos_son_dos_ficheros():
    """Sin esto marzo pisaba a febrero y en la web parecía que se borraban."""
    marzo = pedir(desde="2027-03-01", hasta="2027-03-31").slug
    abril = pedir(desde="2027-04-01", hasta="2027-04-30").slug
    assert marzo != abril


def test_el_mismo_mes_con_findes_y_sin_ellos_son_dos_busquedas():
    entero = SearchRequest(
        destination="FCO", weekend_only=False, desde="2027-03-01", hasta="2027-03-31"
    )
    findes = SearchRequest(
        destination="FCO", weekend_only=True, desde="2027-03-01", hasta="2027-03-31"
    )
    assert entero.slug != findes.slug


def test_el_tramo_viaja_en_el_fichero_guardado():
    """La web lee `request` para volver a pintar lo que se pidió."""
    d = pedir(desde="2027-03-01", hasta="2027-03-31").to_dict()
    assert d["desde"] == "2027-03-01"
    assert d["hasta"] == "2027-03-31"
