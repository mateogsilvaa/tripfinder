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
  - **Rehecha como atlas** (build 28): carta de noche por defecto y plancha impresa en
    claro, radios a 0, sin sombras ni blur, sin tarjetas —regla mayor con cuadratín
    rojo y hairlines—, puntos guía entre topónimo y cifra, graticula y neatline de
    fondo, Newsreader + Sora + Martian Mono. Sin iconos ni emoji: las acciones se
    escriben. El correo va con la misma paleta. Respeta `prefers-reduced-motion`.
  - Antes: tema oscuro cálido con troquel de billete, Fraunces + DM Mono y ámbar.
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
- [x] **#24 · Coste total de la escapada (vuelo + alojamiento)** `core` `ux`
  - Cuenta el vuelo por persona y la cama para el grupo (`party_size`).
  - AC: ✅ Bérgamo — "escapada completa para 2: 264 €, 132 € por cabeza".

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

## M8 · Lo diferencial  ✅ hecho

- [x] **#40 · Horas de viaje real** `core` `ux`
  - De aterrizar a despegar menos 8 h de sueño por noche. Entra en el score y
    permite ordenar por euros/hora.
  - AC: ✅ dos vuelos al mismo precio y fechas dan 15,2 h y 34,8 h — y ahora se distinguen.
- [x] **#41 · Horizonte largo** `core`
  - 300 días y 26 findes barridos: los chollos están a 4-8 meses, no la semana que viene.
- [ ] **#42 · Aviso de "esto es lo más barato del año"** `nice-to-have`
  - Con suficiente histórico, marcar cuando un precio es mínimo histórico de la ruta.
- [ ] **#43 · Coste total también en el listado** `ux`
  - Hoy el total sale al pedir alojamiento; podría precalcularse para el top de ofertas.

## M9 · Cuentas  ✅ hecho

- [x] **#44 · Panel con contraseña** `web` `infra`
  - `/admin.html` pide la contraseña del panel (PBKDF2-SHA256 con sal en `data/users.json`,
    calculado con WebCrypto). La primera vez se elige desde el propio panel.
  - AC: ✅ con la clave mal, el panel no se pinta; al cerrar la pestaña vuelve a pedirla.
- [x] **#45 · Alta de cuentas desde el panel** `web` `infra`
  - Crear, desactivar, borrar y cambiar contraseñas. Va por `repository_dispatch` →
    `users.yml` → `tripfinder users …`, con la sal y el hash ya calculados: la contraseña
    en claro no llega nunca al log de Actions.
  - AC: ✅ sin token de GitHub el panel lo dice y ofrece pegarlo; con token, commitea.
- [x] **#46 · Lo de cada uno, de cada uno** `web` `core`
  - Favoritos y grupo con la cuenta en la clave de `localStorage`; `owner` en seguimientos
    y búsquedas, y el id de la cuenta dentro del nombre del fichero de búsqueda.
  - AC: ✅ dos cuentas en el mismo navegador no se ven los favoritos ni los seguimientos.
- [x] **#47 · Parte diario a quien le importa** `email`
  - Cada cuenta con `email` recibe solo sus seguimientos; el resto va al buzón de siempre.
- [x] **#48 · Un solo token, cifrado con la contraseña de cada cuenta** `infra` `web`
  - El token se pega una vez en el panel y se publica cifrado (AES-GCM). Cada cuenta lleva
    un sobre con la clave maestra cerrada con su contraseña; al entrar lo abre y saca el
    token a `sessionStorage`. Ni el workflow ni el fichero publicado lo ven en claro.
  - AC: ✅ verificado en navegador — con la contraseña mal no sale token, y el payload que
    va a GitHub no contiene el token ni la contraseña.
- [x] **#49 · Sin cuenta no se escribe** `web` `ux`
  - Buscar, seguir, pedir alojamiento y guardar favoritos exigen sesión. Los formularios
    salen apagados con el motivo puesto en vez de fallar al pulsar.
- [x] **#50 · Qué correos y cada cuánto** `email` `ux`
  - Por cuenta: frecuencia de chollos (en cuanto aparezca / diario / semanal / nunca), tope
    de precio opcional, frecuencia del parte de seguimientos y "solo si hay novedades".
    El "cada cuánto" se lleva en `state.json`.
- [x] **#51 · El panel enseña qué tiene cada cuenta** `web`
  - Sus seguimientos, sus búsquedas y sus preferencias, desplegando su fila. Los favoritos
    no: viven en el navegador de cada uno y el panel no puede verlos.
- [x] **#52 · Cada uno ve lo suyo, y solo lo suyo** `web`
  - Lo que no tiene dueño deja de verse (antes salía para todos, y la primera persona
    en entrar se encontraba los seguimientos de otro). El panel avisa de cuántas cosas
    hay sin dueño y las asigna a una cuenta.
- [x] **#53 · Móvil y entrar sin errores** `ux`
  - Botón para ver la contraseña, reintento sin espacios sobrantes al pegarla, botón
    que se apaga mientras comprueba (el PBKDF2 tarda un segundo largo en un móvil
    viejo), barra y modales rehechos para 320-390 px, y el enlace al panel fuera del pie.
- [ ] **#54 · Recuperar contraseña sin pasar por el panel** `nice-to-have`
  - Hoy, si alguien la olvida, se la cambias tú desde el panel (y eso le rehace el sobre).
    No hay email de reseteo porque no hay servidor que lo mande de forma fiable.

## M10-M16 · Auditoría de la web  🚧 en curso

De la auditoría salieron 31 tareas (issues #6 a #36). Lo cerrado hasta ahora,
todo en la rama `claude/tripfinder-nuevo-diseno-kbnsrk`:

- [x] **#14 · Dejar de publicar los emails de las cuentas** `seguridad`
- [x] **#16 · CI: ruff + pytest en cada PR** `infra`
- [x] **#17 · Poner al día README, ARCHITECTURE y ROADMAP** `documentation`
- [x] **#18 · `esc()` valida el esquema en las URL** `seguridad`
- [x] **#19 · No cargar 270 KB de aeropuertos en la portada** `perf`
  - De ~450 KB a 190 KB de JSON en la portada.
- [x] **#20 · Fuentes que no bloquean** `perf`
- [x] **#21 · Versión de assets automática** `infra`
  - La sella `pages.yml` con el hash del commit; en el repo vale `dev`.
- [x] **#23 · Diálogos accesibles en toda la web** `accessibility`
- [x] **#24 · Anunciar lo que está pasando** `accessibility`
- [x] **#25 · Contraste y tamaño táctil** `accessibility`
  - `tools/contraste.py` audita la paleta en CI; 44 px de área táctil.
- [x] **#26 · La portada dice qué es esto** `ux`
- [x] **#27 · Cada página con su texto** `ux`
- [x] **#28 · 404 y estados vacíos** `ux`
- [x] **#29 · Coste total de la escapada en el listado** `core` `ux`
- [x] **#31 · Una sola cabecera** `infra`
  - Las partes comunes en `web/partes/`, montadas por `tools/montar.py`.
- [x] **#32 · Humo de frontend en CI** `infra`
- [x] **#34 · Horas peninsulares de verdad en todos los crons** `infra`

Y el sistema de diseño nuevo —el atlas— por encima de todo eso.

Lo que queda: el test de destinos (#6-#12, que es una funcionalidad entera y no
un arreglo), partir `app.js` (#30), el barrido nocturno (#33, #35, #36), y
#13, #15 y #22.


## M5 · Robustez y calidad

- [x] **#25 · Tests de scoring y de parseo de providers** `infra`
  - Suite en `tests/`, con `ruff` y `pytest` en cada push y cada PR (`ci.yml`).
    Sin número aquí a propósito: cualquiera que se escriba se queda viejo a la
    semana. Lo que hay es lo que salga de `python -m pytest`.
- [x] **#26 · CI: ruff + pytest en cada PR** `infra`
  - `ci.yml` en cada push y cada PR, con dos trabajos: **backend** (ruff, pytest y
    `montar --check`) y **web** (oxlint y humo de frontend con Playwright).
  - Reglas de ruff elegidas a mano en `pyproject.toml` y versión clavada en
    `requirements-dev.txt`: las de por defecto cambian entre releases y dejarían
    el repo en rojo sin que nadie toque nada. Las dos apagadas van con su motivo.
  - Humo: nueve pruebas sobre Chromium sin red, con el JSON de ejemplo del repo.
    Comprobado que una portada rota (sin filas, o con un error de sintaxis) las
    pone en rojo. Falta la del test de destinos, que no existe todavía.
- [ ] **#27 · Manejo de errores por provider sin tumbar el scan** `core`
  - Parcialmente hecho: cada provider ya va en try/except; falta reportar fallos en la web.
- [ ] **#28 · Alertas si el workflow lleva N días sin encontrar nada** `infra` `nice-to-have`

---

## Orden sugerido para retomar

1. #10 (rate limiting) — evita que te bloqueen antes de escalar providers.
2. #24 (coste total) — es lo que de verdad decide un viaje.
3. ~~#26 (CI)~~ — hecho: ruff, pytest y humo de frontend en cada PR.
4. #9 / #13 / #17 — cuando lo demás esté estable.
