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
- [ ] **#9 · Provider Kiwi/Skyscanner vía API afiliada** `scraper` `nice-to-have`
  - Requiere alta como afiliado. Aporta cobertura fuera de Ryanair.
  - AC: se registra en el `ProviderRegistry` sin tocar el resto.
- [ ] **#10 · Caché de peticiones + rate limiting global** `scraper`
  - Respetar `min_interval_seconds`, caché en disco de 6 h para no repetir llamadas.

## M2 · Aviso por email  ✅ hecho

- [x] **#11 · Envío SMTP (Gmail app password)** `email`
  - `notify/email.py`, `test-email` en la CLI.
  - AC: `python -m tripfinder test-email` deja un correo en la bandeja.
- [x] **#12 · Plantilla HTML del aviso** `email` `ux`
  - Precio, descuento, fechas, aerolínea, CTA a la web con la oferta abierta.
  - AC: se ve correctamente en Gmail móvil (tablas, sin CSS externo).
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
- [ ] **#17 · Modo oscuro + PWA instalable** `web` `nice-to-have`

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
