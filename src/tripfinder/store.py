"""Persistencia en JSON dentro de data/. El repo es la base de datos."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Any

from .config import DATA_DIR
from .models import FlightOffer, StayOffer

MAX_HISTORY_PER_ROUTE = 400


class Store:
    def __init__(self, root: Path | str = DATA_DIR):
        self.root = Path(root)
        self.stays_dir = self.root / "stays"
        self.searches_dir = self.root / "searches"
        self.root.mkdir(parents=True, exist_ok=True)
        self.stays_dir.mkdir(parents=True, exist_ok=True)
        self.searches_dir.mkdir(parents=True, exist_ok=True)

    # -- helpers ---------------------------------------------------------
    def _read(self, name: str, default: Any) -> Any:
        p = self.root / name
        if not p.exists():
            return default
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return default

    def _write(self, name: str, payload: Any) -> None:
        p = self.root / name
        p.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    # -- ofertas ---------------------------------------------------------
    def load_offers(self) -> list[FlightOffer]:
        raw = self._read("offers.json", {"offers": []})
        return [FlightOffer.from_dict(o) for o in raw.get("offers", [])]

    def save_offers(
        self,
        offers: list[FlightOffer],
        errors: list[str] | None = None,
        fuentes: dict[str, Any] | None = None,
    ) -> None:
        """El tablon publicado, y de donde ha salido.

        `fuentes` es el parte del barrido: cuantas tarifas ha puesto cada
        proveedor y cuantas consultas se ahorraron o se comieron un muro. Sin
        eso, una tanda floja y una tanda capada se ven exactamente igual desde
        fuera —pocas ofertas— y no hay forma de saber cual de las dos fue.
        """
        self._write(
            "offers.json",
            {
                "generated_at": date.today().isoformat(),
                "count": len(offers),
                "errors": errors or [],
                "fuentes": fuentes or {},
                "offers": [o.to_dict() for o in offers],
            },
        )

    # -- continentes -----------------------------------------------------
    def save_continents(self) -> dict[str, str] | None:
        """El mapa codigo -> continente que necesita la portada, y nada mas.

        La portada solo usa `airports_world.json` para saber en que continente
        cae cada destino y poder pintar el filtro. Cargar 270 KB para eso —mas
        los 180 de `offers.json`— era casi medio mega de JSON para pintar 120
        filas, en un movil y antes de ver nada.

        Se guarda AGRUPADO POR CONTINENTE y con los codigos pegados en una sola
        cadena, no como `{"MAD": "Europa", ...}`. Suena raro y es a proposito:
        el mapa plano son 61 KB porque repite el nombre del continente 3.270
        veces; asi son 10 KB. El nombre del continente se escribe seis veces en
        total y los codigos IATA siempre miden tres letras, asi que partir la
        cadena de tres en tres es todo lo que hay que hacer para leerlo.

        Devuelve el mapa plano (util para los tests), o None si no esta el
        listado mundial: es un fichero estatico del repo, no algo que el scan
        genere, y sin el no hay nada que derivar.
        """
        mundial = self.root / "airports_world.json"
        if not mundial.exists():
            return None
        try:
            crudo = json.loads(mundial.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return None

        plano = {a["code"]: a["cont"] for a in crudo if a.get("code") and a.get("cont")}
        agrupado: dict[str, list[str]] = {}
        for codigo, continente in plano.items():
            agrupado.setdefault(continente, []).append(codigo)

        self._write(
            "continentes.json",
            {c: "".join(sorted(codigos)) for c, codigos in sorted(agrupado.items())},
        )
        self._save_regions(crudo)
        return plano

    def _save_regions(self, crudo: list[dict]) -> None:
        """El mismo truco para las regiones: «los Balcanes», «los nórdicos».

        Se deriva de `regiones.REGIONES`, que es la UNICA definicion: si se
        escribieran a mano tambien en el navegador, el dia que se añada una
        region la web y el backend dirian cosas distintas y nadie lo notaria
        hasta que alguien filtrara y no le saliera nada.

        Mismo formato que los continentes —codigos pegados de tres en tres—
        por lo mismo: el mapa plano repetiria el nombre de la region una vez
        por aeropuerto.
        """
        from .regiones import REGIONES, nombre_bonito

        de_pais: dict[str, list[str]] = {}
        for region, paises in REGIONES.items():
            dentro = set(paises)
            for a in crudo:
                if a.get("code") and a.get("pais") in dentro:
                    de_pais.setdefault(region, []).append(a["code"])

        # `n` es como se enseña y `c` los codigos: la clave va sin tildes porque
        # es lo que se teclea, y el desplegable no puede poner "El caucaso".
        self._write(
            "regiones.json",
            {
                r: {"n": nombre_bonito(r), "c": "".join(sorted(set(codigos)))}
                for r, codigos in sorted(de_pais.items())
            },
        )

    # -- camas ------------------------------------------------------------
    def save_beds(self, minimo_muestras: int = 3) -> dict[str, Any]:
        """Lo que cuesta una cama por noche, sacado de lo ya buscado.

        El vuelo es por persona y la cama es para el grupo: sumarlos bien da el
        unico numero que decide un viaje. Hoy ese numero solo aparece DESPUES
        de pedir alojamiento, que es un workflow de varios minutos, asi que
        quien mira el tablon no lo ve nunca.

        Aqui se destila lo que ya se busco alguna vez —`data/stays/*.json`— en
        una mediana de precio por noche, por destino y por pais. La mediana y
        no la media: un atico de 400 EUR entre veinte anuncios de 50 no puede
        mover la estimacion de todos.

        Lo que NO hace: inventarse un valor por defecto para los destinos que
        nadie ha buscado todavia. Un numero igual para todos no informa, y
        ademas parece que sabe algo. Donde no hay dato, no hay estimacion; y la
        cobertura crece sola cada vez que alguien pide alojamiento.
        """
        carpeta = self.root / "stays"
        por_destino: dict[str, list[float]] = {}
        por_pais: dict[str, list[float]] = {}
        nombres: dict[str, str] = {}
        # Y de paso, QUE VIAJES tienen ya la cama buscada. Se recorre la misma
        # carpeta, asi que sale gratis, y es lo que permite que el tablon marque
        # esas filas sin pedir un fichero por vuelo.
        hechos: dict[str, dict[str, Any]] = {}

        for f in sorted(carpeta.glob("*.json")) if carpeta.exists() else []:
            # El indice vive en la misma carpeta y no es una busqueda: sin esto
            # se contaria a si mismo y aparecia un viaje llamado "index".
            if f.name == "index.json":
                continue
            try:
                datos = json.loads(f.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue
            oferta = datos.get("offer") or {}
            identificador = datos.get("offer_id") or f.stem
            resumen = datos.get("summary") or {}
            hechos[identificador] = {
                "n": oferta.get("destination_name") or oferta.get("destination") or "",
                "d": oferta.get("depart_date") or datos.get("checkin") or "",
                "c": len(datos.get("stays") or []),
                # El precio de la escapada entera, si se calculo. Con esto la
                # fila puede decir el numero REAL sin abrir el panel: hasta
                # ahora solo lo sabia quien ya lo habia abierto en esa sesion.
                "t": round(float(resumen.get("total") or 0), 2),
            }
            codigo = oferta.get("destination")
            if not codigo:
                continue
            noches = max(1, int(oferta.get("nights") or 1))

            # Por noche, y del EXTREMO BARATO. Airbnb devuelve desde una
            # habitacion compartida hasta un chalet: en Lanzarote la lista va de
            # 28 a 405 EUR la noche, asi que la mediana del catalogo estimaria
            # un viaje que nadie hace. El numero que luego sustituye a esto
            # —`_trip_summary`— coge la cama mas barata, asi que la estimacion
            # tiene que medir lo mismo o el "real" pareceria una rebaja.
            #
            # Los tres mas baratos y la mediana de esos tres: un solo minimo es
            # un anuncio suelto que puede ser cualquier cosa.
            noche = sorted(
                s.get("price_per_night") or (s["price_total"] / noches)
                for s in datos.get("stays", [])
                if s.get("price_total") or s.get("price_per_night")
            )
            if not noche:
                continue
            baratos = noche[:3]
            por_destino.setdefault(codigo, []).extend(baratos)
            if oferta.get("destination_country"):
                por_pais.setdefault(oferta["destination_country"], []).extend(baratos)
            if oferta.get("destination_name"):
                nombres[codigo] = oferta["destination_name"]

        def _mediana(xs: list[float]) -> float:
            xs = sorted(xs)
            mitad = len(xs) // 2
            return xs[mitad] if len(xs) % 2 else (xs[mitad - 1] + xs[mitad]) / 2

        payload = {
            "generated_at": date.today().isoformat(),
            "destinos": {
                c: {"noche": round(_mediana(v), 2), "muestras": len(v), "nombre": nombres.get(c, "")}
                for c, v in sorted(por_destino.items())
                if len(v) >= minimo_muestras
            },
            "paises": {
                p: {"noche": round(_mediana(v), 2), "muestras": len(v)}
                for p, v in sorted(por_pais.items())
                if len(v) >= minimo_muestras
            },
        }
        self._write("camas.json", payload)
        self._write(
            "stays/index.json",
            {"generated_at": date.today().isoformat(), "viajes": hechos},
        )
        return payload

    # -- historico de precios -------------------------------------------
    def load_history(self) -> dict[str, list[dict]]:
        return self._read("history.json", {})

    def record_prices(self, offers: list[FlightOffer]) -> dict[str, list[dict]]:
        """Anade el precio de hoy por ruta. Idempotente dentro del mismo dia.

        Se graba POR PERSONA, no el total del grupo. El barrido busca para uno,
        asi que hasta hoy daba igual; el dia que `adults` del YAML cambie, una
        serie con totales de dos personas al lado de totales de una no se puede
        comparar con nada, y el historico entero deja de valer hacia atras.
        """
        history = self.load_history()
        today = date.today().isoformat()
        for o in offers:
            series = history.setdefault(o.history_key, [])
            unidad = o.price_per_person
            if any(e["d"] == today and abs(e["p"] - unidad) < 0.01 for e in series):
                continue
            series.append({"d": today, "p": round(unidad, 2)})
            del series[:-MAX_HISTORY_PER_ROUTE]
        self._write("history.json", history)
        return history

    def save_search(self, payload: dict[str, Any]) -> Path:
        """Guarda una busqueda y refresca el indice que lee la web."""
        p = self.searches_dir / f"{payload['slug']}.json"
        p.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

        indice = []
        for f in sorted(self.searches_dir.glob("*.json")):
            if f.name == "index.json":
                continue
            try:
                d = json.loads(f.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue
            indice.append(
                {
                    "slug": d.get("slug"),
                    "label": d.get("label"),
                    "count": d.get("count", 0),
                    "generated_at": d.get("generated_at"),
                    "best_price": min((o["price"] for o in d.get("offers", [])), default=None),
                    # Sin esto la web tendria que abrir las 30 busquedas para
                    # saber cuales son tuyas antes de pintar la lista.
                    "owner": d.get("owner") or (d.get("request") or {}).get("owner", ""),
                    "owner_name": d.get("owner_name")
                    or (d.get("request") or {}).get("owner_name", ""),
                }
            )
        (self.searches_dir / "index.json").write_text(
            json.dumps({"searches": indice}, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return p

    def delete_search(self, slug: str, owner: str = "") -> bool:
        """Borra una busqueda guardada y rehace el indice.

        Con `owner` solo borra las suyas (y las que no son de nadie, de antes de
        que hubiera cuentas): la lista de la web enseña los slugs de todos, y
        sin esto bastaria con uno para borrar la busqueda de otra persona.
        """
        f = self.searches_dir / f"{slug}.json"
        if not f.exists():
            return False
        if owner:
            try:
                datos = json.loads(f.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                datos = {}
            dueno = datos.get("owner") or (datos.get("request") or {}).get("owner", "")
            if dueno and dueno != owner:
                return False
        f.unlink()
        # save_search reconstruye el indice entero, asi que basta con reescribir
        # cualquiera de las que quedan; si no queda ninguna, indice vacio.
        restantes = [x for x in self.searches_dir.glob("*.json") if x.name != "index.json"]
        if restantes:
            self.save_search(json.loads(restantes[0].read_text(encoding="utf-8")))
        else:
            (self.searches_dir / "index.json").write_text(
                json.dumps({"searches": []}, ensure_ascii=False, indent=2), encoding="utf-8"
            )
        return True

    def claim_searches(self, owner: str, owner_name: str = "") -> int:
        """Lo mismo que watch.reclamar, para las busquedas guardadas."""
        tocadas = 0
        ultima = None
        for f in self.searches_dir.glob("*.json"):
            if f.name == "index.json":
                continue
            try:
                datos = json.loads(f.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue
            if datos.get("owner") or (datos.get("request") or {}).get("owner"):
                continue
            datos["owner"] = owner
            datos["owner_name"] = owner_name
            if isinstance(datos.get("request"), dict):
                datos["request"]["owner"] = owner
                datos["request"]["owner_name"] = owner_name
            f.write_text(json.dumps(datos, ensure_ascii=False, indent=2), encoding="utf-8")
            ultima = datos
            tocadas += 1
        # save_search rehace el indice entero, que es lo que lee la web para
        # saber de quien es cada busqueda sin abrirlas todas.
        if ultima:
            self.save_search(ultima)
        return tocadas

    def purge_expired_stays(self) -> int:
        """Los alojamientos scrapeados se quedan hasta que pasa la fecha del viaje.

        Nada de caducar por antiguedad: si la escapada es en enero, esos precios
        siguen siendo utiles en diciembre. Solo se borra lo que ya no sirve.
        """
        hoy = date.today().isoformat()
        borrados = 0
        for f in self.stays_dir.glob("*.json"):
            if f.name == "index.json":
                continue
            try:
                datos = json.loads(f.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue
            if (datos.get("checkout") or "9999") < hoy:
                f.unlink()
                borrados += 1
        return borrados

    # -- estado de notificaciones ---------------------------------------
    def load_state(self) -> dict[str, Any]:
        return _sin_correos(self._read("state.json", {"notified": {}}))

    def save_state(self, state: dict[str, Any]) -> None:
        self._write("state.json", _sin_correos(state))

    # -- alojamientos ----------------------------------------------------
    # -- interrail ---------------------------------------------------------
    @property
    def interrail_dir(self) -> Path:
        d = self.root / "interrail"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def save_vuelo_interrail(self, payload: dict[str, Any]) -> Path:
        """El vuelo de entrada o de salida de una ruta de Interrail."""
        p = self.interrail_dir / f"{payload['id']}.json"
        p.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return p

    def save_indice_interrail(self) -> list[str]:
        """Que vuelos hay buscados. Lo lee la web para no pedir a ciegas un
        fichero por ruta y comerse un 404 por cada una. Es un derivado: se
        rehace recorriendo la carpeta."""
        ids = sorted(f.stem for f in self.interrail_dir.glob("*.json") if f.name != "index.json")
        (self.interrail_dir / "index.json").write_text(
            json.dumps({"generated_at": date.today().isoformat(), "vuelos": ids}, indent=2),
            encoding="utf-8",
        )
        return ids

    def save_stays(self, offer_id: str, offer: FlightOffer | None, stays: list[StayOffer],
                   checkin: str, checkout: str, errors: list[str] | None = None,
                   summary: dict[str, Any] | None = None) -> Path:
        p = self.stays_dir / f"{offer_id}.json"
        p.write_text(
            json.dumps(
                {
                    "offer_id": offer_id,
                    "offer": offer.to_dict() if offer else None,
                    "checkin": checkin,
                    "checkout": checkout,
                    "generated_at": date.today().isoformat(),
                    "summary": summary or {},
                    "errors": errors or [],
                    "stays": [s.to_dict() for s in stays],
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        return p


def _sin_correos(state: dict[str, Any]) -> dict[str, Any]:
    """Las fechas de "ultimo correo" por buzon, con el buzon en hash.

    Los `state.json` viejos llevan la direccion de cada cuenta como clave; se
    pasan a `clave_buzon` al leerlos y al guardarlos, asi que el siguiente scan
    ya los deja limpios sin tener que migrar nada a mano.
    """
    from .util import clave_buzon

    for campo in ("digest", "watch_digest"):
        viejo = state.get(campo)
        if not isinstance(viejo, dict):
            continue
        nuevo: dict[str, Any] = {}
        for k, v in viejo.items():
            clave = clave_buzon(k) if "@" in str(k) else k
            # Si convivian las dos formas, gana la fecha mas reciente.
            nuevo[clave] = max(str(v), str(nuevo.get(clave, "")))
        state[campo] = nuevo
    return state
