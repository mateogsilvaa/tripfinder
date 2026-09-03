# Arquitectura

## Piezas

| Pieza | Dónde vive | Qué hace |
|---|---|---|
| `tripfinder.routes` | `src/tripfinder/` | El mapa: a donde se puede volar desde un origen. Se monta antes de pedir un solo precio y es quien decide los candidatos. Cache en `data/routes/<IATA>.json`. |
| `tripfinder.providers.*` | `src/tripfinder/providers/` | Buscan vuelos. Un adapter por fuente, todos devuelven `FlightOffer`. |
| `tripfinder.stays.*` | `src/tripfinder/stays/` | Buscan alojamiento. Devuelven `StayOffer`. |
| `tripfinder.scoring` | `src/tripfinder/` | Convierte precio + histórico en un `score` 0-100 y decide si es chollo. |
| `tripfinder.store` | `src/tripfinder/` | Persistencia en JSON dentro de `data/` (el propio repo es la base de datos). |
| `tripfinder.users` | `src/tripfinder/` | Las cuentas: `data/users.json` con un PBKDF2-SHA256 por contraseña. Lo que se publica en Pages va sin las direcciones de correo (`users publish`): la web solo necesita saber **si** hay una, no cuál. El mismo algoritmo que calcula el navegador en `web/auth.js`. |
| `tripfinder.notify` | `src/tripfinder/notify/` | Resend / SMTP / issue de GitHub + plantillas. Si el metodo elegido falla, prueba los demas. |
| `web/` | GitHub Pages | Lee `data/offers.json`, `data/continentes.json` (el mapa código → continente que necesita el filtro, derivado de `airports_world.json` en cada scan) y `data/stays/*.json`. Cero build: las partes comunes (`web/partes/`) las escribe `tools/montar.py` dentro de los HTML, que siguen abriéndose a doble clic. |
| `web/auth.js` | GitHub Pages | Quién está delante: sesión, login contra `data/users.json` y el espacio de nombres de `localStorage` por cuenta. |
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

## Cuentas

El tablón de chollos es el mismo para todo el mundo (`offers.json` no tiene dueño).
Lo que sí es de cada uno:

| Qué | Dónde vive | Cómo se separa |
|---|---|---|
| Favoritos y precio al que los marcaste | `localStorage` del navegador | La clave lleva la cuenta: `tf_favoritos:u-1a2b3c4d` |
| Personas del selector de grupo | `localStorage` | `tf_grupo:<id>` |
| Seguimientos | `data/watch.json` | Campo `owner` en cada uno |
| Búsquedas guardadas | `data/searches/*.json` | Campo `owner`, y el id de la cuenta entra en el nombre del fichero |
| Parte diario de seguimientos | email | Cada cuenta al suyo si tiene `email`; el resto, al buzón de `notify.to` |
| Qué correos y cada cuánto | `prefs` en `data/users.json` | Lo aplica `_reparto_de_chollos` y `_partes_por_dueno` en `cli.py`; el "cada cuánto" se lleva en `state.json` (`digest`, `watch_digest`) |

Lo que no tiene `owner` es de antes de que hubiera cuentas y **no lo ve nadie**: la
primera versión lo enseñaba a todos "porque ya se hacía así", y el resultado fue que
la primera persona en entrar se encontró los seguimientos de otro. El panel los
detecta y los asigna a una cuenta (`tripfinder claim --owner`). Lo que además
necesita cuenta es **escribir**: buscar, seguir un viaje, pedir alojamiento o guardar
un favorito.

### El token, cifrado con sobres

La web escribe en el repo con un token de GitHub, y ese token no puede ir en
claro en un sitio público. Se guarda cifrado y solo lo abren las cuentas:

```
   clave maestra K  ── AES-GCM ──►  token         (data/users.json → "site")
   contraseña de Ana ── PBKDF2 ──► clave ── AES-GCM ──► K   (su ficha → "sobre")
```

- Todo el cifrado ocurre en `web/auth.js` con WebCrypto. Python nunca ve el token
  ni la clave maestra: `users.py` guarda cajas opacas y punto.
- El token se pega una vez en el panel. Al crear una cuenta o cambiarle la
  contraseña, el panel —que tiene K abierta en memoria— le fabrica su sobre.
- Rotar el token no invalida los sobres: se vuelve a cifrar con la misma K.
- La sal del sobre es **distinta** de la del login. Con la misma, la clave del
  sobre serían los mismos bits que el hash publicado al lado y abrirlo saldría
  gratis.
- Cambiar una contraseña sin rehacer el sobre lo marca `stale`, para que el panel
  lo cante en vez de enseñar una cuenta que dice que puede y luego no puede.

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
- **Todo cuelga de la contraseña.** El repo es público y `data/users.json` se publica con la
  web: los hashes y los sobres los lee cualquiera. PBKDF2-SHA256 con 210.000 vueltas y sal por
  cuenta hace cara la fuerza bruta, pero el diseño entero se apoya en que las contraseñas sean
  largas y no reutilizadas. Con eso, ni se saca el token ni se suplanta a nadie; sin eso, las dos
  cosas.
- **El token se pega una vez, no se reparte.** Antes cada persona tenía que crear el suyo y
  pegarlo en su navegador. Ahora lo pone el administrador en el panel, va cifrado en el repo y
  cada cuenta lo abre con su contraseña al entrar. Es lo que permite que la web sea usable por
  alguien que no tiene (ni quiere) cuenta de GitHub.
- **La contraseña se hashea en el navegador.** El panel manda al workflow la sal y el hash, nunca
  la clave: los logs de Actions se guardan noventa días y los ve cualquiera que pase por el repo.
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
