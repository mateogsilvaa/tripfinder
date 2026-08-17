# Arquitectura

## Piezas

| Pieza | Dónde vive | Qué hace |
|---|---|---|
| `tripfinder.routes` | `src/tripfinder/` | El mapa: a donde se puede volar desde un origen. Se monta antes de pedir un solo precio y es quien decide los candidatos. Cache en `data/routes/<IATA>.json`. |
| `tripfinder.providers.*` | `src/tripfinder/providers/` | Buscan vuelos. Un adapter por fuente, todos devuelven `FlightOffer`. |
| `tripfinder.stays.*` | `src/tripfinder/stays/` | Buscan alojamiento. Devuelven `StayOffer`. |
| `tripfinder.scoring` | `src/tripfinder/` | Convierte precio + histórico en un `score` 0-100 y decide si es chollo. |
| `tripfinder.store` | `src/tripfinder/` | Persistencia en JSON dentro de `data/` (el propio repo es la base de datos). |
| `tripfinder.notify` | `src/tripfinder/notify/` | Resend / SMTP / issue de GitHub + plantillas. Si el metodo elegido falla, prueba los demas. |
| `web/` | GitHub Pages | Lee `data/offers.json` y `data/stays/*.json`. Cero build. |
| `.github/workflows/` | GitHub Actions | Cron de vuelos, cola de alojamiento vía issues, deploy de Pages. |

## Flujo de datos

1. **Cron (cada 6 h)** → `scan-flights`. Se monta el mapa de destinos del origen
   (`routes.destinos`) y cada provider habilitado busca según `config/watchlist.yml`.
   Ryanair y Wizz barren sus propias rutas por API; Google Flights cubre el resto del
   mapa, una consulta por destino y fecha, con el presupuesto de `google.max_queries`.
   Como ese presupuesto no da para los 105 destinos en una tanda, el orden se baraja
   usando la fecha como semilla: cada scan mira un trozo distinto y en unos días se ha
   recorrido el mapa entero.
2. Se normaliza todo a `FlightOffer` y se calcula `score` contra `data/history.json`.
3. Las ofertas que superan `min_score` **y** no están en `state.json` generan email.
4. Se commitean `data/offers.json` y `data/history.json` → Pages se redespliega solo.
5. El usuario pulsa *Buscar alojamiento* → se abre una issue `[stay] <offer_id>`.
6. `stay-request.yml` reacciona, corre `scan-stays`, commitea `data/stays/<offer_id>.json`,
   comenta el resumen en la issue y la cierra.
7. La web hace polling de ese JSON (cada 20 s, 15 min máx) y pinta los alojamientos.

## Decisiones

- **El repo como base de datos.** No hay servidor ni Postgres: el histórico son commits, lo que
  además da versionado gratis de precios.
- **`id` determinista.** `PROVIDER-ORIGEN-DESTINO-FECHAIDA` sin el precio, para poder seguir una
  misma ruta/fecha a lo largo del tiempo y detectar bajadas.
- **Issues como cola de trabajo.** Ver README: es el único disparador gratis desde una web
  estática que no obliga a publicar un token.
- **Escapada de finde como consulta, no como filtro.** Filtrar a posteriori no sirve: la API
  devuelve la tarifa mas barata por destino y esa casi nunca es de viernes. Se pregunta por cada
  fin de semana, y esas ofertas se puntuan contra su propio historico (`RUTA|finde`).
- **Fallo tolerado por provider.** Un adapter que revienta se registra y se ignora; el scan sigue.
- **Nada de scraping agresivo.** Booking se resuelve con deep links; Airbnb es best-effort con
  degradado a deep link. Un `User-Agent` honesto y un intervalo mínimo entre peticiones.

## Extender con un provider nuevo

```python
# src/tripfinder/providers/mifuente.py
from .base import FlightProvider, register

@register("mifuente")
class MiFuente(FlightProvider):
    requires = ("MIFUENTE_TOKEN",)          # secretos necesarios; si faltan, se desactiva solo

    def search(self, route, window) -> list[FlightOffer]:
        ...
```

Basta con importarlo en `providers/__init__.py` y añadirlo a `providers:` en el YAML.
