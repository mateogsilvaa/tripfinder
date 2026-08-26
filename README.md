# ✈️ TripFinder

Buscador automático de chollos de vuelo con aviso por email y, cuando una oferta te interesa,
búsqueda bajo demanda de alojamiento (hoteles + Airbnb) para esas fechas exactas.

Todo corre **gratis sobre GitHub**: Actions como scheduler/backend y Pages como web.

```
                 ┌──────────────────────── GitHub Actions (cron 6h) ─────────────────────────┐
                 │  scan-flights.yml → tripfinder scan-flights                                │
                 │     · providers: Ryanair (sin API key) + Amadeus (opcional)                │
                 │     · scoring vs. histórico de precios  →  data/offers.json (commit)       │
                 │     · si hay chollo nuevo → email a mateogonsilva@gmail.com (SMTP Gmail)   │
                 └───────────────────────────────────────────────────────────────────────────┘
                                          │ commit
                                          ▼
   Email  ──►  https://mateogsilvaa.github.io/tripfinder  (Pages, lee data/*.json)
                                          │
                        "Me interesa → buscar alojamiento"
                                          │  (abre una Issue prerrellenada)
                                          ▼
                 ┌──────────────────── GitHub Actions (on: issues) ──────────────────────────┐
                 │  stay-request.yml → tripfinder scan-stays --offer-id …                     │
                 │     · Airbnb + hoteles (Amadeus) + deep links Booking/Kayak                │
                 │     · data/stays/<offer_id>.json (commit) + comentario en la issue         │
                 └───────────────────────────────────────────────────────────────────────────┘
```

**Por qué issues como cola:** GitHub Pages es estático, no puede ejecutar el scraper. Abrir una
issue desde el navegador es el único disparador gratuito, autenticado y sin exponer ningún token
en el cliente. La web hace polling del JSON de resultados.

## Puesta en marcha

1. `pip install -r requirements.txt`
2. Copia `.env.example` a `.env` y pon tu `RESEND_API_KEY`
   (alta gratuita en [resend.com](https://resend.com), 3.000 emails/mes; es una API key
   revocable, no la contraseña de tu correo).
3. Edita `config/watchlist.yml` con tus aeropuertos y umbrales.
4. Prueba en local:

```bash
python -m tripfinder scan-flights --dry-run
```

5. En GitHub: `Settings → Secrets and variables → Actions` añade `RESEND_API_KEY`
   y opcionalmente `AMADEUS_CLIENT_ID` / `AMADEUS_CLIENT_SECRET`.
6. `Settings → Pages → Source: GitHub Actions`.
7. `Settings → Actions → General → Workflow permissions: Read and write`.
8. Abre `/admin.html` en la web publicada, pon la contraseña del panel (la primera
   vez la eliges tú) y pega ahí tu token de GitHub: se guarda cifrado y las cuentas
   lo abren solas. Desde ahí creas las cuentas de quien vaya a usarla:
   ver [Cuentas y panel](#cuentas-y-panel).

## Como te llegan los avisos

`notify.method` en `config/watchlist.yml` elige el transporte, y si falla se prueban los demas
automaticamente para no perder un chollo por un problema de credenciales:

| Metodo | Credencial | Notas |
|---|---|---|
| `resend` (por defecto) | `RESEND_API_KEY` | API key revocable, 3.000 emails/mes gratis. El remitente de pruebas `onboarding@resend.dev` funciona sin dominio propio, pero solo puede escribirte a ti. |
| `smtp` | `SMTP_USER` + `SMTP_PASSWORD` | Gmail exige contraseña de aplicación (y 2FA activo). |
| `github_issue` | ninguna | El workflow abre una issue con el chollo y GitHub te manda el email. Cero configuración. |

## Comandos

```bash
python -m tripfinder scan-flights            # busca vuelos, guarda y notifica
python -m tripfinder scan-flights --dry-run  # no escribe ni envía email
python -m tripfinder scan-stays --offer-id RYR-MAD-FCO-20260910
python -m tripfinder test-email                    # usa notify.method
python -m tripfinder test-email --method github_issue

python -m tripfinder users list                    # cuentas de la web
python -m tripfinder users add --user ana --name Ana --password ... --email ana@…
python -m tripfinder users set-admin --password ...   # la contraseña del panel
python -m tripfinder users prefs --user ana --prefs '{"chollos":"semanal"}' 
```

## Estado

Ver [docs/ROADMAP.md](docs/ROADMAP.md) para hitos e issues. Detalle técnico en
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Auditoría de la web —qué tiene, qué falla
y qué issues abrir— en [docs/INFORME-WEB.md](docs/INFORME-WEB.md).

## Cuentas y panel

Los chollos del día son un tablón público: los ve igual todo el que entre. Todo
lo demás —buscar, seguir un viaje, pedir alojamiento, guardar un favorito— se
apunta a nombre de alguien, así que **sin cuenta no se puede**. Los formularios
se ven, pero salen apagados y con el botón de entrar al lado.

**El panel** (`/admin.html`, enlazado abajo del todo en cada página) pide una
contraseña. La primera vez que entras no hay ninguna: la pones ahí mismo. Desde
dentro se crean las cuentas, se cambian contraseñas, se desactivan, y se ve de un
vistazo qué tiene cada una: sus seguimientos, sus búsquedas guardadas y sus
preferencias de correo. Sus favoritos no, y no es una decisión de diseño: viven
en el navegador de cada uno y no se publican en ningún sitio, así que el panel no
puede verlos.

**Entrar** se hace con el botón de la barra de arriba, en cualquier página. El campo
de la contraseña lleva un botón para verla —escribir a ciegas en un móvil una
contraseña que te han pasado por WhatsApp es la mitad de los "no me deja entrar"— y
si al pegarla se cuela un espacio delante o detrás, se reintenta sin él antes de dar
error.

| Qué | Sin cuenta | Con cuenta |
|---|---|---|
| Chollos del día | se ven | los mismos: es un tablón, no cambia |
| Favoritos y su histórico de precio | — | uno por cuenta, en el mismo navegador |
| Seguimientos | — | cada uno los suyos |
| Búsquedas guardadas | — | un fichero por persona |
| Lanzar búsquedas y alojamiento | — | sí |
| Correos | — | los que elija cada uno |

### Qué correos y cada cuánto

Cada cuenta lo decide en su propio botón (arriba a la derecha → tu nombre):

| | Opciones |
|---|---|
| **Chollos del día** | en cuanto aparezca · como mucho uno al día · un resumen a la semana · ninguno |
| …y solo si bajan de | un tope en € opcional, para no recibir lo que no te vas a plantear |
| **Parte de tus seguimientos** | el de cada día · un resumen a la semana · ninguno |
| Solo si hay novedades | calla el parte los días en que se ha mirado y no había nada |

Con "en cuanto aparezca" llega lo que ha salido nuevo hoy. Con un resumen diario
o semanal llega **lo mejor que hay vivo** en ese momento, no solo lo del día que
toca: si no, un resumen de los martes se perdería los chollos de los otros seis
días. El buzón de `notify.to` en el YAML sigue recibiendo lo de siempre, salvo
que ya exista una cuenta con ese mismo email.

### El token: uno solo, y cifrado

La web escribe en el repositorio (una búsqueda es un commit), y para eso hace
falta un token de GitHub. **No hay que repartirlo ni pegarlo en cada navegador**:
se pega **una vez** en el panel y se publica cifrado.

```
   clave maestra K  ── AES-GCM ──►  token de GitHub        ← data/users.json
   tu contraseña ── PBKDF2 ──► clave ── AES-GCM ──► K      ← tu "sobre"
```

Al entrar, tu contraseña abre tu sobre, el sobre da la clave maestra y esa abre
el token. Cifrar y descifrar pasa entero en el navegador: ni el workflow ni el
log de Actions ven nunca el token en claro, y en `data/users.json` solo hay dos
cajas cerradas. **Quien mire el código de la web no saca el token si no tiene la
contraseña de alguna cuenta**, y forzar un sobre cuesta lo mismo que forzar el
login: PBKDF2-SHA256 con 210.000 vueltas y sal propia.

El token descifrado vive en `sessionStorage`: al cerrar la pestaña desaparece y
hay que volver a entrar. En disco solo queda lo cifrado.

Detalles que conviene saber:

- **Cambiar el token** (porque lo revocaste) es pegar el nuevo en el panel. Los
  sobres siguen valiendo, así que nadie tiene que cambiar de contraseña.
- **Una cuenta creada antes de guardar el token** no tiene sobre: entra y ve la
  web, pero no puede lanzar nada. Se arregla poniéndole una contraseña nueva
  desde el panel, que es lo que le entrega su sobre.
- **Cambiar una contraseña desde la terminal** (`tripfinder users passwd`) deja
  el sobre viejo, que ya no abre: el panel marca esa cuenta en rojo. Los cambios
  de contraseña, mejor desde el panel.
- **Si pierdes la contraseña del panel**, se pierde la clave maestra: hay que
  poner el token otra vez y volver a dar contraseña a cada cuenta.

### Hasta dónde llega esto

Conviene decirlo claro: el repositorio es público y `data/users.json` se publica
con la web, así que **los hashes y los sobres los puede leer cualquiera**. Todo
lo de arriba se apoya en una sola cosa: que las contraseñas sean buenas. Con una
contraseña larga y que no uses en ningún otro sitio, sacar de ahí el token o
suplantar a alguien es carísimo; con "1234", no. Elige bien las que reparte el
panel.

Y lo que sí es un límite duro: el token es de escritura sobre el repo. Cualquiera
que **tenga cuenta** puede, si se lo propone, usarlo para escribir en él. Está
pensado para gente que se conoce; si un día alguien sobra, desactiva su cuenta,
revoca el token en GitHub y pega uno nuevo en el panel.

## Buscador personalizado

Los chollos automaticos responden a "que hay barato ahora". El buscador responde a
lo contrario: **"quiero ir a Roma un finde por menos de 120 €, avisame cuando se
pueda"**. Recorre fin de semana a fin de semana hasta 12 meses vista y guarda el
resultado en la web.

Acepta el codigo IATA, una ciudad, **un pais entero** ("Alemania") o **un continente**
("Asia", "America"). Para un continente no se preguntan los 956 aeropuertos que tiene
Asia en el listado: se usan los hubs que ya estan elegidos a mano en `long_haul.destinations`
y `city_names`. Los nombres se comparan sin acentos y con una tabla de alias, porque
`airports_world.json` guarda los paises en español pero las ciudades en ingles a medias
("New York", "Seoul", "Sepang" por Kuala Lumpur): sin eso, escribir "Nueva York" o "Tokio"
no encontraba nada.

Una busqueda "donde sea" tarda **unos 8 minutos**: son ~105 destinos y a Google se le
pregunta uno a uno. La web hace polling durante 15 minutos.

Desde la web se rellena el formulario (destino, tope, noches, meses, personas) y se
abre una issue `[buscar] ...` que dispara `custom-search.yml`. En local:

```bash
python -m tripfinder search --dest Roma --max-price 120 --nights 2-3 --months 12
```

## Dos temas

La web va **en oscuro por defecto**: el panel de salidas de siempre, negro cálido y
ámbar. Con el botón de la esquina se pasa al papel de billete impreso —fondo manila
con la trama de seguridad, tinta azul, sello de goma y los datos en monoespaciada—.
La elección se guarda en el navegador y se aplica en un `<script>` del `<head>`,
antes de pintar, para que no pegue el fogonazo al entrar de noche.

Por eso el claro es un estado con nombre (`data-tema="claro"`) y no la ausencia de
atributo: si "sin atributo" siguiera significando claro, la primera pintada sería
blanca en todas las visitas.

Todo el CSS usa tokens semanticos (`--paper`, `--card`, `--ink`, `--azul`, `--sello`),
asi que el tema oscuro son los mismos tokens con valores de noche mas cuatro cosas
estructurales: la trama del papel, los degradados del fondo, el troquelado y las filas
del panel.

## Lo que no te da ningun comparador

Buscadores de vuelos hay cientos. Estas dos cosas no las hace ninguno, y son las
que deciden si una escapada merece la pena:

**1. Horas de viaje real.** Un vuelo que aterriza a las 23:55 y vuelve el domingo a
las 07:10 cuesta lo mismo que uno que llega el viernes a las 18:40 y vuelve el
domingo a las 21:30 — pero el primero te deja **15 h** en destino y el segundo **35 h**.
TripFinder calcula las horas despierto en destino (de aterrizar a despegar, menos
8 h de sueno por noche), las puntua en el score y te deja ordenar por **euros por
hora de viaje**. Es la diferencia entre un finde y un aeropuerto.

**2. Cada precio dice a cuanta gente cubre.** Cada `FlightOffer` guarda su campo
`adults`, porque "240 €" tanto puede ser lo que pagas tu como lo que pagais los
cuatro, y esa duda es justo la que hace perder un chollo. Cuando va mas de uno, la
web ensena el **total** grande y el **por persona** debajo. El scan diario busca
para una persona a proposito (asi el historico de una ruta es comparable de un dia
para otro); el selector de personas de la portada multiplica esa cifra y lo marca
con `≈`, que es una estimacion honesta y no un precio consultado.

**3. Favoritos que vigilan el precio.** La ☆ de cualquier vuelo lo guarda en tu
navegador junto con lo que valia al marcarlo. Cada vez que la web vuelve a ver ese
vuelo —en los chollos, dentro de una busqueda guardada o en lo que devolvio un
seguimiento— compara con el ultimo precio visto y, si ha cambiado, lo canta arriba
del todo. No hace falta servidor: el precio ya viaja en los JSON que publica
Actions, lo unico que faltaba era acordarse.

**4. Contra su propio historico.** `data/history.json` lleva meses acumulando el
precio de cada ruta y la web no lo miraba. Ahora, al abrir un vuelo, se dibuja la
curva de esa ruta y se dice donde cae el precio de hoy: *"barato: normalmente esta
entre 119 y 211 €"*. Es la diferencia entre creerse un `−50%` y saber si lo es.

**5. Coste real de la escapada.** El vuelo es por persona, el alojamiento es para
todo el grupo: sumarlos bien da el unico numero que importa. Cuando pides
alojamiento para una oferta, la web te responde con *"escapada completa para 2:
264 €, 132 € por cabeza"*, desglosado en vuelos y cama. Ningun comparador cruza
las dos cosas porque cada uno vive de vender una.

## De donde salen los precios

| Provider | Clave | Que aporta |
|---|---|---|
| `ryanair` | ninguna | Barrido de findes y tarifas base. Es quien mas gana en rutas low cost. |
| `wizzair` | ninguna | Su tabla de horarios: el precio mas barato de cada dia. Es **la unica** via a Bucarest, Sofia, Tirana, Cluj o Timisoara desde Madrid. |
| `google_flights` | ninguna | **Todas las aerolineas**: Iberia, Vueling, Air Europa, ITA, easyJet, TAP, Tarom, Aer Lingus… Es quien cubre el mapa donde no llega ninguna API. Cuando la compania tiene web propia que se puede enlazar, la oferta sale ademas con su boton de reserva. |
| `scrapling` | ninguna | No es un provider: es el fetcher que usan los scrapers de alojamiento. Habla por curl_cffi imitando el TLS y las cabeceras de un Chrome real, que es lo que miran los antibot. Si no esta instalado, se cae a `requests` y todo sigue. |
| `amadeus` | gratuita | Refuerzo por GDS para rutas con escala. Se desactiva solo si no hay claves. |

### Primero el mapa, despues los precios

El fallo gordo que tenia el buscador era el orden. **Quien decidia los destinos era
Ryanair**: se le preguntaban las tarifas de una fecha, contestaba con doce destinos
y solo esos doce se contrastaban despues con Google. Todo lo que Ryanair no volaba
ese dia no es que saliera caro — es que no llegaba a existir como candidato. De ahi
que una busqueda "donde sea" para el 6 de noviembre devolviera seis resultados
mientras Skyscanner enseñaba Pisa, Bucarest, Milan o Turin mas baratos.

Ahora `routes.py` monta primero el **mapa de destinos** desde el origen, que las
aerolineas publican gratis y de una sola peticion:

| Fuente | Peticiones | Destinos desde MAD |
|---|---|---|
| `searchWidget/routes` de Ryanair | 1 | 65, con ciudad y pais ya en español |
| `asset/map` de Wizz Air | 1 | 28 (sin contar sus codigos de ciudad) |
| `city_names` del YAML | 0 | los de bandera: Stuttgart, Ginebra, Estambul… |

Union: **105 destinos**, cacheados 14 dias en `data/routes/MAD.json`. Y solo despues
se piden precios de todos ellos. Ryanair y Wizz responden por API para sus rutas; a
Google se le pregunta destino a destino, gastando las consultas primero en aquellos
de los que no se tiene ni un precio (que es donde estaba el agujero) y guardando un
cuarto del presupuesto para contrastar lo que ya ha salido barato.

Cuando dos companias ofrecen el mismo viaje, gana la mas barata y **las demas se guardan
como alternativa** en la tarjeta (`también Wizz Air 66 €`), en vez de desaparecer.

Lo que **no** se puede usar, comprobado: Vueling no expone buscador publico y Kiwi
cerro su API abierta (ahora exige clave de partner).

### easyJet: precio por Google, reserva en su web

easyJet esta detras de un WAF que responde **403 a cualquier peticion que no venga
de un navegador**, y no solo a su API: tambien a su portada y a sus paginas de ruta.
Probado con `curl_cffi` imitando el TLS de Chrome, con cookies de sesion previas y
con la cabecera de origen correcta — 403 en los tres casos, y desde una IP de
Actions seria peor. `GetLowestDailyFares` esta ademas bloqueado por path en el
borde, que es la forma que tiene Akamai de decir que ese endpoint lo conoce mucha
gente.

Asi que el reparto queda:

* **El precio** lo pone Google Flights, que si publica las tarifas de easyJet
  (comprobado en MAD–BSL y MAD–GVA). Para que esas rutas se lleguen a preguntar,
  sus destinos desde Madrid estan declarados en `city_names`.
* **La reserva** va a `easyjet.com/es/vuelos-baratos/<ORI>/<DES>`, su pagina de
  ruta por IATA, que abierta en un navegador funciona perfectamente. Sale como un
  boton aparte ("Reservar en easyJet") junto al enlace de siempre: si algun dia
  cambian el formato, el enlace normal sigue ahi.

Lo mismo aplica a Vueling, Transavia y Volotea, en `providers/links.py`.

### eDreams Prime y otras tarifas con login

No se pueden scrapear y no se va a intentar: harian falta las credenciales del
usuario guardadas como secreto del repo. Lo que si hace la web es ofrecer un boton
"Comparar en eDreams" con ruta y fechas ya puestas; se abre en **tu** navegador,
con tu sesion, y ahi si sale tu precio de socio.

## Escapada de fin de semana

El caso de uso principal es **salir el viernes por la tarde y volver el domingo por la tarde**.
La búsqueda general de Ryanair devuelve la tarifa más barata por destino, que casi nunca cae en
finde, así que el provider hace además un **barrido semana a semana**: una consulta por cada
viernes del horizonte, con filtro de hora (`outboundDepartureTimeFrom`) en la propia API.

Esos vuelos valen sistemáticamente más que uno de un martes cualquiera, así que se puntúan
contra **su propia referencia**: `max_price_weekend` y `baseline_price_weekend` por ruta, y una
serie de histórico separada (`MAD-OPO|finde`). Sin eso, mezclar findes y días sueltos falsearía
las dos medias y no aparecería ninguna escapada.

```yaml
search:
  weekend:
    mode: prefer          # prefer = las prioriza | only = solo findes | off = ignora el día
    outbound_weekday: 4   # viernes
    outbound_after: "15:00"
    outbound_before: "22:00"
    inbound_weekday: 6    # domingo
    inbound_after: "15:00"
    bonus: 18             # puntos extra en el score
```

## Notas de implementacion verificadas (2026-08-15, con datos reales)

- **Ryanair** rechaza `limit > 20` con `{"code":"InvalidLimit"}`: el provider pagina de 20 en 20
  (`max_results_per_route` en el YAML). Requiere `market` y `adultPaxCount`.
- **Airbnb** embebe los resultados en `<script id="data-deferred-state-0">` como objetos
  `StaySearchResult`; el id del anuncio viaja en base64 en `demandStayListing.id`.
  El pais es obligatorio para desambiguar: buscar solo "Agadir" devuelve casas en Canarias,
  mientras que `Agadir--Marruecos` acierta. Por eso `destination_country` viaja desde el vuelo
  hasta la busqueda de alojamiento.
- **Google Flights** sirve los resultados renderizados en el HTML si la busqueda va
  codificada en el parametro `tfs` (un protobuf en base64, generado a mano en
  `providers/google_flights.py`, sin dependencias). Hace falta mandar una cookie `SOCS`
  de consentimiento no personalizado: sin ella solo llega el muro de cookies.
  Cada resultado trae un `aria-label` en texto plano con precio, aerolinea, hora y
  escalas — parsear eso aguanta mucho mejor que perseguir clases CSS ofuscadas.
- Ryanair sí acepta filtro de hora (`outboundDepartureTimeFrom` / `...TimeTo`), lo que permite
  pedir solo salidas de viernes por la tarde sin traerse el día entero.
- **Wizz Air envenena su propia sesion.** `search/timetable` deja puesta una cookie
  que invalida la siguiente llamada: la segunda peticion en adelante responde
  `400 {"handlerError":"InvalidProtocol"}`. Reutilizando la sesion, de las 72
  consultas de un scan solo contestaba la primera y Wizz aportaba practicamente
  nada. Con un `cookies.clear()` detras de cada peticion responden todas
  (comprobado: 5/5 y 28/28).
- **Wizz tiene dos formatos de enlace y solo uno funciona.** El de parametros
  (`select-flight?departureStation=MAD&arrivalStation=OTP&...`) abre la pagina de
  reserva con las fechas puestas pero **sin la ruta**: sale un formulario vacio y
  parece que el boton no lleva a ningun sitio. El que hay que usar es el de por
  path: `select-flight/MAD/OTP/2026-11-06/2026-11-09/2/0/0/null`, que llega con
  Madrid → Bucarest ya seleccionado. Comprobado en navegador con las dos URLs.

- **El precio de la tabla de horarios de Wizz es por persona** y se rie del
  `adultCount` que le mandes: 1, 2 y 3 pasajeros devuelven la misma cifra. El resto
  de providers dan el total del grupo, asi que hay que multiplicarlo o Wizz sale a
  mitad de precio que nadie y se come las primeras posiciones de la lista.
- **Google Flights aguanta mas de lo que ponia aqui**: 30 consultas seguidas con 4 s
  entre medias, 30 respuestas con precio (medido el 2026-08-17 desde una IP
  domestica). La busqueda a mano gasta hasta `max_queries_search` (110) porque es
  una sola tirada; el scan automatico se queda en `max_queries` (40), que corre cada
  6 h desde una IP de Actions y conviene no forzar.
- La etiqueta `stay-request` es opcional: el workflow se dispara por el prefijo `[stay] ` del
  titulo, asi que funciona aunque no hayas creado la etiqueta en el repo.

## Aviso legal

Se usan APIs públicas/oficiales siempre que existen (Amadeus, endpoints públicos de Ryanair).
Para Booking.com **no se scrapea**: se generan deep links de búsqueda. Respeta los ToS de cada
sitio y no bajes `min_interval_seconds` en `config/watchlist.yml`.
