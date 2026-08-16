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
```

## Estado

Ver [docs/ROADMAP.md](docs/ROADMAP.md) para hitos e issues. Detalle técnico en
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Buscador personalizado

Los chollos automaticos responden a "que hay barato ahora". El buscador responde a
lo contrario: **"quiero ir a Roma un finde por menos de 120 €, avisame cuando se
pueda"**. Recorre fin de semana a fin de semana hasta 12 meses vista y guarda el
resultado en la web.

Desde la web se rellena el formulario (destino, tope, noches, meses, personas) y se
abre una issue `[buscar] ...` que dispara `custom-search.yml`. En local:

```bash
python -m tripfinder search --dest Roma --max-price 120 --nights 2-3 --months 12
```

## Lo que no te da ningun comparador

Buscadores de vuelos hay cientos. Estas dos cosas no las hace ninguno, y son las
que deciden si una escapada merece la pena:

**1. Horas de viaje real.** Un vuelo que aterriza a las 23:55 y vuelve el domingo a
las 07:10 cuesta lo mismo que uno que llega el viernes a las 18:40 y vuelve el
domingo a las 21:30 — pero el primero te deja **15 h** en destino y el segundo **35 h**.
TripFinder calcula las horas despierto en destino (de aterrizar a despegar, menos
8 h de sueno por noche), las puntua en el score y te deja ordenar por **euros por
hora de viaje**. Es la diferencia entre un finde y un aeropuerto.

**2. Coste real de la escapada.** El vuelo es por persona, el alojamiento es para
todo el grupo: sumarlos bien da el unico numero que importa. Cuando pides
alojamiento para una oferta, la web te responde con *"escapada completa para 2:
264 €, 132 € por cabeza"*, desglosado en vuelos y cama. Ningun comparador cruza
las dos cosas porque cada uno vive de vender una.

## De donde salen los precios

| Provider | Clave | Que aporta |
|---|---|---|
| `ryanair` | ninguna | Barrido de findes, tarifas base. Es quien mas gana en rutas low cost. |
| `google_flights` | ninguna | **Todas las aerolineas**: Iberia, Vueling, Air Europa, ITA, easyJet, Wizz, TAP… Contrasta los destinos y fechas que ya han salido y se queda con lo que mejora. |
| `scrapling` | ninguna | No es un provider: es el fetcher que usan los scrapers de alojamiento. Habla por curl_cffi imitando el TLS y las cabeceras de un Chrome real, que es lo que miran los antibot. Si no esta instalado, se cae a `requests` y todo sigue. |
| `amadeus` | gratuita | Refuerzo por GDS para rutas con escala. Se desactiva solo si no hay claves. |

Cuando dos companias ofrecen el mismo viaje, gana la mas barata y **las demas se guardan
como alternativa** en la tarjeta (`también Wizz Air 66 €`), en vez de desaparecer.

Lo que **no** se puede usar, comprobado: easyJet responde 403 a cualquier peticion
automatizada, Vueling y Wizz no exponen buscador publico, y Kiwi cerro su API abierta
(ahora exige clave de partner).

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
- La etiqueta `stay-request` es opcional: el workflow se dispara por el prefijo `[stay] ` del
  titulo, asi que funciona aunque no hayas creado la etiqueta en el repo.

## Aviso legal

Se usan APIs públicas/oficiales siempre que existen (Amadeus, endpoints públicos de Ryanair).
Para Booking.com **no se scrapea**: se generan deep links de búsqueda. Respeta los ToS de cada
sitio y no bajes `min_interval_seconds` en `config/watchlist.yml`.
