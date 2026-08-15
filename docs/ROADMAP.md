# Roadmap · TripFinder

Estado a 2026-08-15. Marcado `[x]` = ya implementado en este repo, `[ ]` = pendiente.
Cada issue lleva título listo para copiar/pegar en GitHub, etiquetas y criterios de aceptación.

Leyenda de etiquetas: `core` `scraper` `email` `web` `infra` `ux` `nice-to-have`

---

## M0 · Esqueleto y contrato de datos  ✅ hecho

- [x] **#1 · Estructura del repo + paquete `tripfinder`** `infra`
  - `src/tripfinder/` como paquete instalable, `requirements.txt`, `.gitignore`, `.env.example`.
  - AC: `python -m tripfinder --help` funciona en limpio.
- [x] **#2 · Modelos de datos y esquema JSON** `core`
  - `FlightOffer` y `StayOffer` en `models.py`, serialización estable a `data/*.json`.
  - AC: el `id` de una oferta es determinista (no cambia si cambia el precio).
- [x] **#3 · Configuración declarativa (`config/watchlist.yml`)** `core`
  - Orígenes, destinos (o "cualquiera"), ventana de fechas, duración, presupuesto, umbrales.
  - AC: cambiar el YAML cambia la búsqueda sin tocar código.
- [x] **#4 · Almacenamiento en ficheros + histórico de precios** `core`
  - `store.py`: `offers.json`, `history.json` (serie por ruta), `state.json` (ya notificadas).
  - AC: dos ejecuciones seguidas no duplican entradas de histórico.

## M1 · Scraper de vuelos  ✅ hecho (Ryanair) / ⚠️ Amadeus necesita claves

- [x] **#5 · Provider Ryanair (sin API key)** `scraper`
  - Endpoint público `farfnd/v4`, paginación de 20 en 20 (la API rechaza `limit` mayor) y reintentos.
  - AC: ✅ verificado — `scan-flights --dry-run` devolvió 45 ofertas reales para MAD/BCN.
- [x] **#6 · Provider Amadeus Self-Service** `scraper`
  - OAuth2 client-credentials + Flight Offers Search. Se desactiva solo si no hay claves.
  - AC: con claves en `.env` aparecen ofertas de aerolíneas no-low-cost.
- [x] **#7 · Motor de scoring de chollos** `core`
  - Descuento vs. mediana histórica de la ruta + precio/noche + presupuesto → score 0-100.
  - AC: una ruta sin histórico usa `baseline_price` del YAML y no genera falsos positivos.
- [x] **#8 · Deduplicación y anti-spam de avisos** `core`
  - No se re-notifica la misma oferta salvo que baje otro `renotify_drop_pct`.
  - AC: ejecutar dos veces seguidas envía 1 email, no 2.
- [x] **#9 · Cobertura fuera de Ryanair** `scraper`
  - Resuelto con `google_flights` (sin clave). Descartados por inviables: easyJet (403),
    Vueling y Wizz (sin buscador público), Kiwi (API cerrada a nuevos partners).
  - AC: ✅ verificado — aparecen Iberia, ITA, easyJet, Wizz Air, Brussels y Air Europa.
- [x] **#36 · Alternativas de otras compañías por oferta** `core` `ux`
  - Al quedarse con la más barata ya no se pierden las demás: van en `alternatives`.
- [ ] **#10 · Caché de peticiones + rate limiting global** `scraper`
  - Respetar `min_interval_seconds`, caché en disco de 6 h para no repetir llamadas.

## M2 · Aviso por email  ✅ hecho

- [x] **#11 · Envío SMTP (Gmail app password)** `email`
  - `notify/email.py`, `test-email` en la CLI.
  - AC: `python -m tripfinder test-email` deja un correo en la bandeja.
- [x] **#12 · Plantilla HTML del aviso** `email` `ux`
  - Precio, descuento, fechas, aerolínea, CTA a la web con la oferta abierta.
  - AC: se ve correctamente en Gmail móvil (tablas, sin CSS externo).
- [x] **#29 · Alternativas a la contraseña de aplicación de Gmail** `email`
  - `notify.method`: `resend` (API key), `smtp` o `github_issue` (sin credenciales), con
    reintento automático en cascada si el elegido falla.
- [ ] **#13 · Resumen semanal (digest)** `email` `nice-to-have`
  - Un email los domingos con el top 5 aunque no haya chollo que supere el umbral.

## M3 · Web (GitHub Pages)  ✅ hecho

- [x] **#14 · Frontend estático que lee `data/offers.json`** `web`
  - Sin build, sin dependencias. Tarjetas de oferta, filtros, orden por score.
  - AC: abre `web/index.html` en local y muestra las ofertas del JSON.
- [x] **#15 · Deep link `?offer=<id>`** `web` `ux`
  - El email enlaza a la oferta concreta y la web la abre resaltada.
- [x] **#16 · Workflow de despliegue a Pages** `infra`
  - AC: cada push a `main` publica `web/` + `data/`.
- [x] **#17 · Identidad visual propia** `web` `ux`
  - Tema oscuro cálido, tarjetas con troquel de billete, Fraunces + DM Mono, grano y
    animación de entrada escalonada. Respeta `prefers-reduced-motion`.
- [x] **#34 · Bug: el panel de alojamiento no se cerraba** `web`
  - `.panel` tenía `display:flex`, que ganaba al atributo `hidden`. Ahora `[hidden]` es global.
- [ ] **#35 · PWA instalable** `web` `nice-to-have`

## M4 · Alojamiento bajo demanda  ✅ hecho el circuito / ⚠️ Airbnb es best-effort

- [x] **#18 · Disparador desde la web → Issue prerrellenada** `web` `infra`
  - Botón "Buscar alojamiento" abre `issues/new` con el `offer_id` y la etiqueta.
  - AC: no hay ningún token en el cliente.
- [x] **#19 · Workflow `stay-request.yml` (`on: issues`)** `infra`
  - Ejecuta el scan, commitea `data/stays/<offer_id>.json`, comenta y cierra la issue.
- [x] **#20 · Adapter Airbnb** `scraper`
  - Lee el estado embebido de la página de resultados; degrada a deep link si falla.
  - AC: ✅ verificado — 18 alojamientos con precio, valoración e imagen para Agadir.
  - Ojo: sin país, Airbnb geolocaliza mal (ver README). El país viaja desde el vuelo.
- [x] **#21 · Adapter hoteles (Amadeus Hotel Search)** `scraper`
- [x] **#22 · Deep links Booking/Kayak (sin scraping)** `scraper`
- [x] **#23 · Vista de alojamientos en la web con polling** `web`
  - AC: tras lanzar la búsqueda, la web muestra resultados sin recargar a mano.
- [ ] **#24 · Coste total del viaje (vuelo + alojamiento) y reordenado** `core` `ux`

## M6 · Escapada de fin de semana  ✅ hecho

- [x] **#30 · Barrido semana a semana en Ryanair** `scraper`
  - Una consulta por viernes con filtro de hora en la API, en vez de filtrar a posteriori.
  - AC: ✅ verificado — 98 de 123 ofertas encajan viernes tarde → domingo tarde.
- [x] **#31 · Presupuesto e histórico propios del finde** `core`
  - `max_price_weekend`, `baseline_price_weekend` y serie `RUTA|finde` separada.
  - AC: ✅ Oporto vie 16:30 → dom 22:50 por 61 € aparece como chollo; antes no salía ninguno.
- [x] **#32 · La web muestra día, hora y distintivo de finde** `web` `ux`
- [ ] **#33 · Ventana de horas por destino** `nice-to-have`
  - Para vuelos largos quizá interese salir antes del viernes; hoy la ventana es global.

## M7 · Filosofía escapada  ✅ hecho

- [x] **#37 · Viajes de 2 a 4 noches** `core`
  - Fuera de vacaciones no renta irse 8 días: `nights_max: 4`.
- [x] **#38 · Nombre de ciudad por IATA** `core`
  - Google devuelve solo el código; sin esto la búsqueda de alojamiento buscaría "MXP".
- [ ] **#39 · Puentes y festivos** `nice-to-have`
  - Detectar jueves-domingo cuando el viernes es festivo en Madrid.

## M5 · Robustez y calidad

- [x] **#25 · Tests de scoring y de parseo de providers** `infra`
  - 10 tests en `tests/`, `python -m pytest` en verde.
- [ ] **#26 · CI: ruff + pytest en cada PR** `infra`
- [ ] **#27 · Manejo de errores por provider sin tumbar el scan** `core`
  - Parcialmente hecho: cada provider ya va en try/except; falta reportar fallos en la web.
- [ ] **#28 · Alertas si el workflow lleva N días sin encontrar nada** `infra` `nice-to-have`

---

## Orden sugerido para retomar

1. #10 (rate limiting) — evita que te bloqueen antes de escalar providers.
2. #24 (coste total) — es lo que de verdad decide un viaje.
3. #26 (CI) — barato y evita regresiones en los parsers.
4. #9 / #13 / #17 — cuando lo demás esté estable.
