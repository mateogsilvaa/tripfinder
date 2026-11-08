"""¿Sigue en pie lo guardado en un HOP? Se mira cada vuelo guardado otra vez y
se apunta en la propuesta, para que la tarjeta lo diga."""

from datetime import date

from tripfinder import revisar_hop as R

HOY = date(2026, 11, 8)


def test_un_euro_no_es_noticia():
    assert R.estado_de(55, 56, "2027-01-23", HOY) == "en_pie"
    assert R.estado_de(55, 62, "2027-01-23", HOY) == "sube"
    assert R.estado_de(55, 40, "2027-01-23", HOY) == "baja"


def test_sin_plaza_y_vuelos_pasados():
    assert R.estado_de(55, None, "2027-01-23", HOY) == "agotado"
    assert R.estado_de(55, 50, "2026-11-01", HOY) == "pasado"


def test_ida_con_una_compania_y_vuelta_con_otra():
    assert R.companias("Ryanair + Wizz Air") == ("Ryanair", "Wizz Air")
    assert R.companias("Wizz Air") == ("Wizz Air", "Wizz Air")


def test_el_precio_de_hoy_suma_ida_y_vuelta_de_cada_compania():
    pedidas = []

    def precio(prov, o, d, dia):
        pedidas.append((prov, o, d, dia))
        return {"ryanair": 20.0, "wizzair": 30.0}[prov]

    p = {"origen": "MAD", "iata": "BUD", "ida": "2027-01-23", "vuelta": "2027-01-25", "compania": "Ryanair + Wizz Air"}
    assert R.precio_actual(p, precio) == 50.0
    assert pedidas == [("ryanair", "MAD", "BUD", "2027-01-23"), ("wizzair", "BUD", "MAD", "2027-01-25")]


def test_otras_companias_no_se_miran():
    p = {"iata": "BSL", "ida": "2027-01-28", "vuelta": "2027-01-31", "compania": "easyJet"}
    assert R.precio_actual(p, lambda *a: 1 / 0) == ""


def test_sin_plaza_un_dia_es_agotado():
    p = {"iata": "BUD", "ida": "2027-01-23", "vuelta": "2027-01-25", "compania": "Ryanair"}
    assert R.precio_actual(p, lambda prov, o, d, dia: None if d == "MAD" else 20.0) is None


# -- contra una base de datos de mentira -----------------------------------
class Doc:
    def __init__(self, datos):
        self.datos = datos
        self.reference = self
        self.cambios = {}

    def to_dict(self):
        return self.datos

    def update(self, cambios):
        self.cambios.update(cambios)


class Coleccion:
    def __init__(self, docs):
        self.docs = docs

    def where(self, filter=None):
        return self

    def stream(self):
        return iter(self.docs)


class Hop:
    def __init__(self, propuestas):
        self.reference = self
        self.propuestas = propuestas

    def collection(self, nombre):
        return Coleccion(self.propuestas)


class Db:
    def __init__(self, hops):
        self.hops = hops

    def collection(self, nombre):
        return Coleccion(self.hops)


def test_revisar_apunta_lo_que_ha_visto_en_cada_propuesta():
    sube = Doc({"tipo": "vuelo", "iata": "BUD", "ida": "2027-01-23", "vuelta": "2027-01-25", "compania": "Ryanair",
                "precio": 40.0})
    igual = Doc({"tipo": "vuelo", "iata": "OPO", "ida": "2027-01-23", "vuelta": "2027-01-25", "compania": "Ryanair",
                 "precio": 40.0})
    otra = Doc({"tipo": "vuelo", "iata": "BSL", "ida": "2027-01-23", "vuelta": "2027-01-25", "compania": "easyJet",
                "precio": 40.0})
    db = Db([Hop([sube, igual, otra])])
    precios = {"BUD": 25.0, "OPO": 20.0}

    def precio(prov, o, d, dia):
        return precios.get(d) or precios.get(o)

    cuenta = R.revisar(db, HOY, precio)
    assert sube.cambios["vigente"]["estado"] == "sube"
    assert sube.cambios["vigente"]["precio"] == 50.0
    assert igual.cambios["vigente"]["estado"] == "en_pie"
    assert otra.cambios == {}
    assert cuenta["mirados"] == 2 and cuenta["sin_mirar"] == 1
