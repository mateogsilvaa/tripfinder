# Arquitectura

## Piezas

| Pieza | Dónde vive | Qué hace |
|---|---|---|
| `tripfinder.routes` | `src/tripfinder/` | El mapa: a donde se puede volar desde un origen. Se monta antes de pedir un solo precio y es quien decide los candidatos. Cache en `data/routes/<IATA>.json`. |
| `tripfinder.providers.*` | `src/tripfinder/providers/` | Buscan vuelos. Un adapter por fuente, todos devuelven `FlightOffer`. |
| `tripfinder.cache` | `src/tripfinder/` | Lo ya preguntado en este barrido, en `.cache/consultas/` (fuera del repo). Cubre el hueco ENTRE procesos: `scan-flights` y `watch run` corren seguidos en el mismo runner. No se persiste entre workflows a propósito: una búsqueda pedida a mano es una petición de datos frescos. |
| `tripfinder.rutas_vacias` | `src/tripfinder/` | El cuaderno de rutas sin vuelo (`data/rutas_vacias.json`). Apunta qué pares origen-destino llevan barridos enteros sin devolver un precio, para sondearlos una vez por barrido en vez de doce. Caduca a los 21 días y un solo precio borra la anotación. |
| `tripfinder.stays.*` | `src/tripfinder/stays/` | Buscan alojamiento. Devuelven `StayOffer`. `ranking.py` los ordena por precio **y** cercanía al centro; `centro.py` saca el centro de la ciudad de Nominatim y lo guarda en `data/centros.json` (una vez por ciudad: el centro de Roma no se mueve). |
| `tripfinder.scoring` | `src/tripfinder/` | Convierte precio + histórico en un `score` 0-100 y decide si es chollo. |
| `tripfinder.store` | `src/tripfinder/` | Persistencia en JSON dentro de `data/` (el propio repo es la base de datos). |
| `tripfinder.users` | `src/tripfinder/` | Las cuentas: `data/users.json` con un PBKDF2-SHA256 por contraseña. Lo que se publica en Pages va sin las direcciones de correo (`users publish`): la web solo necesita saber **si** hay una, no cuál. El mismo algoritmo que calcula el navegador en `web/auth.js`. |
| `tripfinder.notify` | `src/tripfinder/notify/` | Resend / SMTP / issue de GitHub + plantillas. Si el metodo elegido falla, prueba los demas. |
| `web/` | GitHub Pages | Una sola página (`index.html`) con el feed y las dos herramientas en compacto; al usarlas se amplía a `buscar.html` o `seguimientos.html`. `trenes.html` es la excepción: no pide datos a nadie —los tiempos de tren desde Madrid están en `web/js/trenes.js` y se pintan al cargar— porque Renfe publica horarios abiertos pero no precios, y un precio raspado que se queda viejo es peor que ninguno. El Interrail tiene su página, `interrail.html` (`web/js/interrail.js`, con el mapa en `web/js/interrail-datos.js`: cuarenta ciudades con su centro y sus aeropuertos, las conexiones de tren entre ellas y doce rutas hechas). Pregunta si ya tienes el pase —si lo tienes no se cuenta y manda en los días; si no, compara comprarlo con ir billete a billete—, cuándo vas y por qué ciudades quieres pasar, y con dos o más monta tu ruta en el orden que menos tren gasta (el camino más corto del mapa entre cada dos). La ruta elegida busca sola, con sesión, los dos vuelos de ida sola y pisos enteros en un recuadro alrededor del centro de cada parada (`interrail.yml`), y da el total. Lee `data/offers.json`, `data/continentes.json` (el mapa código → continente que necesita el filtro, derivado de `airports_world.json` en cada scan), `data/regiones.json` (el escalón intermedio —los Balcanes, los nórdicos—, derivado de `tripfinder.regiones`, que es su única definición), `data/stays/index.json` (qué vuelos tienen ya la cama buscada, para marcarlos en el tablón sin pedir un fichero por vuelo) y `data/stays/*.json`. Cero build: las partes comunes (`web/partes/`) las escribe `tools/montar.py` dentro de los HTML, que siguen abriéndose a doble clic. |
| `web/sw.js` | GitHub Pages | El service worker. El armazón se sirve de la caja (versionada con el hash del commit); **los datos van siempre a la red primero** y sólo se sirve la copia guardada si no hay línea, marcada con `X-TF-Cache` para que el pie lo diga. |
| `web/perfiles.json` | GitHub Pages | A qué se parece cada destino (`playa`, `ciudad`, `naturaleza`, `noche`, `gastronomia`), curado a mano. Lo usa el test de destinos; lo que falte vale como `ciudad`. |
| `web/js/` | GitHub Pages | Doce módulos ES, uno por asunto (`ofertas`, `busqueda`, `seguimientos`, `favoritos`, `alojamiento`, `precios`, `historia`, `destinos`, `calendario`, `disparador`, `quiz`, `motor`, `ampliar` —el que lleva lo escrito en la portada a la herramienta entera— y `base`, que es lo compartido). `arranque.js` es lo único que *hace* algo al cargar; `tripfinder.js` es la puerta que abren las páginas. Sin bundler: el navegador resuelve los `import`. |
| `web/auth.js` | GitHub Pages | Quién está delante: sesión, login contra `data/users.json` y el espacio de nombres de `localStorage` por cuenta. |
| `tools/` | — | Utilidades que no se publican: `montar.py` (las partes comunes de la web), `contraste.py` (auditoría de la paleta), `iconos.py` (los PNG de la aplicación instalable, generados desde la misma paleta). |
| `.github/workflows/` | GitHub Actions | Los once, en la tabla de abajo. |

## Los workflows

| Workflow | Se dispara | Qué hace |
| --- | --- | --- |
| `scan-flights.yml` | cron cada 12 h, o a mano | El barrido: busca vuelos, puntúa contra el histórico, avisa por correo y publica `data/`. Después revisa los seguimientos. |
| `scan-nocturno.yml` | cron la madrugada del miércoles, o a mano | El barrido de las 02:00–03:00 peninsulares: el mapa entero de Google (110 consultas a 7 s, `config/watchlist-nocturno.yml`) sin escribir a nadie. Lo que encuentra se aparca en `state.json` y lo manda el scan de la mañana. |
| `custom-search.yml` | `repository_dispatch: search` | Una búsqueda concreta pedida desde la web: destino, fechas y tope. Las fechas pueden ser exactas o una **ventana** (`--desde`/`--hasta`: un mes, los findes de un mes, o un tramo), El **origen** puede no ser Madrid. Todo eso viaja agrupado en `client_payload.viaje` porque `repository_dispatch` solo admite diez propiedades de primer nivel. Escribe `data/searches/<slug>.json`. |
| `stay-request.yml` | `repository_dispatch: stay`, o una issue `[stay] …` | Busca cama para unas fechas exactas. Escribe `data/stays/<offer_id>.json`. |
| `interrail.yml` | `repository_dispatch: interrail` | Busca los dos vuelos de una ruta de Interrail —de ida sola, en Ryanair, probando los aeropuertos de alrededor de cada ciudad— y alojamiento entero —nada de habitaciones— en cada parada, en un recuadro alrededor del centro que manda la web (Airbnb y Holidu entienden `ne_lat/ne_lng/sw_lat/sw_lng`) y descartando lo que quede a más de 2,5 km, todo en un solo encargo: uno por parada perdería los del medio, porque GitHub solo guarda una ejecución en espera por cola. Escribe `data/interrail/ir-vuelo-*.json` y `data/stays/ir-*.json`. |
| `watch.yml` | `repository_dispatch: watch / unwatch / delete_search` | Apunta, quita o borra: sólo toca `data/watch.json` y `data/searches/`. Acepta lotes. |
| `users.yml` | `repository_dispatch: user_* / admin_* / site_token / claim` | Las cuentas: altas, contraseñas, preferencias, el token del sitio cifrado y el **buzón** (`admin_buzon`): el par de claves con el que quien pide una cuenta cierra su correo y su contraseña y el panel las abre. La pública se publica; la privada va cifrada con la clave maestra, igual que el token. |
| `pages.yml` | push a `main` sobre `web/`, `data/` o `tools/montar.py` | Monta el sitio: comprueba las partes, sella la versión, quita lo que no es página y publica sin los emails. |
| `limpiar-avisos.yml` | cron diario, o a mano | Cierra las issues de aviso con más de siete días. Los avisos salen por issue cuando el correo no puede (hoy, siempre que el destinatario no sea el dueño de la clave de Resend) y se acumulaban hasta dejar el tracker inservible: 33 abiertas el 13 de septiembre. Sólo toca las del bot con la etiqueta `chollo`. |
| `peticion-cuenta.yml` | una issue nueva, o a mano | Pone la etiqueta `peticion-cuenta` a las issues `[cuenta] …`, y crea la etiqueta si no existía. La dirección con la que la web abre la petición ya lleva `labels=`, pero GitHub sólo pinta una etiqueta que YA EXISTE y si no la ignora en silencio. La cola del panel no depende de esto: filtra por el título. |
| `probar-correo.yml` | a mano | Manda un chollo de mentira para saber si las credenciales del correo han quedado bien **sin esperar al barrido de las 08:00**. Cuenta caracteres de cada secreto, nunca los imprime. |
| `ci.yml` | cada push y cada pull request | Lo que decide si algo entra: ruff, pytest, montaje, contraste, oxlint y humo de frontend. |

## La hora de los cron

Los `schedule` de GitHub Actions **van en UTC y no saben de horarios de verano**,
así que un comentario del tipo `# 08:00 hora peninsular` sólo es cierto medio
año: en invierno (CET, UTC+1) esa misma línea son las 07:00.

La regla para cualquier cron que se añada:

- **Si una hora arriba o abajo da igual** —el scan cada doce horas, por
  ejemplo— se deja un solo `cron` y el comentario dice las dos horas:
  `# 08:00 y 20:00 en verano, 07:00 y 19:00 en invierno`. Cuesta cero y no
  engaña a quien lo lea.
- **Si la ventana importa de verdad** —un barrido que tiene que caer entre las
  02:00 y las 03:00 peninsulares— hacen falta **dos `cron` y un guardián**: se
  programan las dos horas UTC posibles y el primer paso del job comprueba la
  hora local de Europa/Madrid y se sale si no toca. Cuesta un job que a veces
  no hace nada, y a cambio la hora está clavada todo el año.

El segundo caso ya existe: `scan-nocturno.yml` lleva los dos cron (`17 0 * * 3`
y `17 1 * * 3`) y el guardián es `python -m tripfinder nocturno --marcar`, que
además apunta la semana ISO en `data/state.json` (`nocturno_semana`). Sin ese
cerrojo, un cron retrasado hasta la hora del otro haría correr los dos: el
planificador de GitHub no es puntual, y por eso el minuto tampoco es `0`.

El guardián acepta las horas **02 y 03** peninsulares, no sólo la 02. Es una
concesión a ese mismo retraso: un cron de las 02:17 que llega a las 03:05 sigue
siendo el barrido de esa semana, y perderlo entero por veinte minutos de cola
sale más caro que hacerlo un rato más tarde.

Lo que no vale es un solo cron con un comentario que afirme una hora local sin
decir de qué estación habla: `tests/test_crons.py` lo comprueba.


## Flujo de datos

1. **Cron (cada 12 h)** → `scan-flights`. Se monta el mapa de destinos del origen
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
- **"Nunca ha estado tan barato" no es lo mismo que "−40%".** El descuento se mide contra la
  mediana, así que una ruta que lleva meses cara luce un sello enorme sin estar barata, y una
  ruta siempre barata no luce ninguno aunque hoy toque suelo. `scoring.marcar_minimo` marca la
  otra pregunta —la que hace reservar— con el histórico entero y pidiendo 14 días distintos antes
  de atreverse a decirlo. Lo calcula el backend para que la insignia pueda salir en la lista sin
  bajarse los 60 kB de `history.json`.
- **Contra el histórico se compara por persona.** `price` es el total del grupo y el histórico va
  por persona: sin esto, una búsqueda para dos daba 240 € contra un histórico de 120 y no salía
  descuento nunca. El sello no significaba nada justo para quien busca en pareja.
- **La consulta más barata es la que no se hace.** Buscar "Estonia" a doce meses eran doce
  consultas a Kuressaare, doce a Kärdla, doce a Pärnu y doce a Tartu: 48 páginas de 2,5 MB para
  cero tarifas, porque desde Madrid no se vuela a ninguno. Dos ventanas en blanco bastan para
  dejar ese destino en ese barrido (`google.sondas_vacias`), y lo aprendido queda en
  `rutas_vacias.json`. No es una lista negra: la ruta se sigue sondeando una vez por barrido, para
  enterarnos el día que exista.
- **Un muro no es una ruta sin vuelos.** Cuando Google capa no lo dice: sirve una página de 4 kB y
  calla. Esa página no cuenta como "aquí no hay vuelos" —si contara, el día que nos capen
  apuntaríamos media Europa como vacía—. Se espera cada vez más, se reintenta una vez con sigilo
  (Scrapling, y solo si está instalado: sin él `stealth=True` repite la misma petición) y, tras
  `google.tope_muros` seguidos, se deja de preguntar durante `google.descanso_segundos`. El
  descanso es del **proceso**, no del provider: un barrido levanta un provider por búsqueda
  guardada y antes cada una volvía a darse contra la misma pared.

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
