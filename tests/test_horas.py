"""Las horas que prefieres: salir por la mañana, volver por la tarde.

Lo que se pidió: «poder regular la hora de salida y llegadas si tienes
preferencia, en el buscador y en el seguidor de vuelos». Son cuatro franjas
opcionales —salida y llegada de la ida, salida y llegada de la vuelta— y lo que
no cae dentro se descarta, salvo que no se sepa la hora."""

from tripfinder import search as S
from tripfinder.models import FlightOffer


def oferta(**horas):
    base = {
        "provider": "ryanair",
        "origin": "MAD",
        "destination": "FCO",
        "depart_date": "2027-03-05",
        "return_date": "2027-03-08",
        "price": 80.0,
    }
    return FlightOffer(**base, **horas)


def test_las_cuatro_franjas_se_leen_en_orden():
    assert S.franjas_horarias("6-12,,16-24,") == [(6, 12), None, (16, 24), None]
    assert S.franjas_horarias("") == [None, None, None, None]


def test_lo_mal_escrito_es_me_da_igual():
    assert S.franjas_horarias("mañana,25-30,8-8,0-24") == [None, None, None, None]
    assert S.normalizar_horas("mañana,,,") == ""
    assert S.normalizar_horas(" 6 - 12 ,,,") == "6-12,,,"


def test_una_franja_puede_cruzar_la_medianoche():
    assert S.en_franja("23:30", (22, 6))
    assert S.en_franja("05:59", (22, 6))
    assert not S.en_franja("06:00", (22, 6))


def test_el_final_de_la_franja_no_entra():
    assert S.en_franja("06:00", (6, 12))
    assert not S.en_franja("12:00", (6, 12))


def test_se_filtra_por_las_cuatro_horas():
    franjas = S.franjas_horarias("6-12,,16-24,")
    assert S.en_sus_horas(oferta(depart_time="07:10", return_time="18:40"), franjas)
    assert not S.en_sus_horas(oferta(depart_time="15:10", return_time="18:40"), franjas)
    assert not S.en_sus_horas(oferta(depart_time="07:10", return_time="09:00"), franjas)


def test_sin_hora_conocida_no_se_descarta():
    assert S.en_sus_horas(oferta(), S.franjas_horarias("6-12,,16-24,"))


def test_dos_busquedas_con_horas_distintas_son_dos_ficheros():
    a = S.SearchRequest(destination="FCO", horas="6-12,,,")
    b = S.SearchRequest(destination="FCO", horas="16-24,,,")
    c = S.SearchRequest(destination="FCO")
    assert len({a.slug, b.slug, c.slug}) == 3
