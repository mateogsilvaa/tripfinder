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

## M5 · Robustez y calidad

- [x] **#25 · Tests de scoring y de parseo de providers** `infra`
  - 10 tests en `tests/`, `python -m pytest` en verde.
- [ ] **#26 · CI: ruff + pytest en cada PR** `infra` — abierta como [GitHub #16](https://github.com/mateogsilvaa/tripfinder/issues/16)
- [ ] **#27 · Manejo de errores por provider sin tumbar el scan** `core`
  - Parcialmente hecho: cada provider ya va en try/except; falta reportar fallos en la web.
- [ ] **#28 · Alertas si el workflow lleva N días sin encontrar nada** `infra` `nice-to-have`

---

## M10-M16 · Lo que salió de la auditoría de la web

Los siete hitos de abajo están **abiertos en GitHub** (issues #6 a #36, hitos `M10`-`M16`),
con criterios de aceptación en cada uno. El detalle —qué falla exactamente y por qué—
está en [docs/INFORME-WEB.md](INFORME-WEB.md); aquí solo va el índice.

**Ojo con los números:** de aquí abajo son los de **GitHub** (issues #6-#36), no los
del roadmap de arriba, que llegó hasta el #54. Cada issue guarda su número de roadmap en
el cuerpo.

### [M10 · El test de destinos](https://github.com/mateogsilvaa/tripfinder/milestone/1)

Un flap disimulado en el troquel `M A D` abre un test de seis preguntas, propone tres
destinos calculados en el navegador con los JSON que ya se publican, y el que aceptes se
convierte en un seguimiento con el `repository_dispatch` que ya existe: sin workflow nuevo.

- [ ] **[#6](https://github.com/mateogsilvaa/tripfinder/issues/6) · Tabla de perfiles de destino (`web/perfiles.json`)** `core` `web`
- [ ] **[#7](https://github.com/mateogsilvaa/tripfinder/issues/7) · El flap disimulado y el armazón del test** `web` `ux`
- [ ] **[#8](https://github.com/mateogsilvaa/tripfinder/issues/8) · Motor de recomendación en cliente** `web` `core`
- [ ] **[#9](https://github.com/mateogsilvaa/tripfinder/issues/9) · Las tres tarjetas de resultado, con el porqué** `web` `ux`
- [ ] **[#10](https://github.com/mateogsilvaa/tripfinder/issues/10) · «Avísame de esto» crea el seguimiento solo** `web` `core`
- [ ] **[#11](https://github.com/mateogsilvaa/tripfinder/issues/11) · Memoria del test y reentrada** `web`
- [ ] **[#12](https://github.com/mateogsilvaa/tripfinder/issues/12) · Accesibilidad del test** `ux` `accessibility`
- [ ] **[#13](https://github.com/mateogsilvaa/tripfinder/issues/13) · Marcar de dónde viene cada seguimiento** `core` `email` `nice-to-have`

### [M11 · Riesgos y correcciones](https://github.com/mateogsilvaa/tripfinder/milestone/2)

- [ ] **[#14](https://github.com/mateogsilvaa/tripfinder/issues/14) · Dejar de publicar los emails de las cuentas** `infra` `seguridad`
- [ ] **[#15](https://github.com/mateogsilvaa/tripfinder/issues/15) · El panel avisa (y arregla) los sobres que faltan** `web` `infra`
- [ ] **[#16](https://github.com/mateogsilvaa/tripfinder/issues/16) · CI: ruff + pytest en cada PR** `infra` — es la #26 de M5, que sigue abierta
- [ ] **[#17](https://github.com/mateogsilvaa/tripfinder/issues/17) · Poner al día README, ARCHITECTURE y ROADMAP** `documentation`
- [ ] **[#18](https://github.com/mateogsilvaa/tripfinder/issues/18) · `esc()` valida el esquema en las URL** `web` `seguridad`

### [M12 · Rendimiento](https://github.com/mateogsilvaa/tripfinder/milestone/3)

- [ ] **[#19](https://github.com/mateogsilvaa/tripfinder/issues/19) · No cargar 270 KB de aeropuertos en la portada** `web` `perf`
- [ ] **[#20](https://github.com/mateogsilvaa/tripfinder/issues/20) · Fuentes que no bloquean** `web` `perf`
- [ ] **[#21](https://github.com/mateogsilvaa/tripfinder/issues/21) · Versión de assets automática** `infra` `web`
- [ ] **[#22](https://github.com/mateogsilvaa/tripfinder/issues/22) · PWA instalable y ofertas en frío** `web` `nice-to-have` — es la #35

### [M13 · Accesibilidad](https://github.com/mateogsilvaa/tripfinder/milestone/4)

- [ ] **[#23](https://github.com/mateogsilvaa/tripfinder/issues/23) · Diálogos accesibles en toda la web** `ux` `accessibility`
- [ ] **[#24](https://github.com/mateogsilvaa/tripfinder/issues/24) · Anunciar lo que está pasando** `ux` `accessibility`
- [ ] **[#25](https://github.com/mateogsilvaa/tripfinder/issues/25) · Contraste y tamaño táctil** `ux` `accessibility`

### [M14 · Producto](https://github.com/mateogsilvaa/tripfinder/milestone/5)

- [ ] **[#26](https://github.com/mateogsilvaa/tripfinder/issues/26) · La portada dice qué es esto** `ux` `web`
- [ ] **[#27](https://github.com/mateogsilvaa/tripfinder/issues/27) · Cada página con su texto** `ux`
- [ ] **[#28](https://github.com/mateogsilvaa/tripfinder/issues/28) · 404 y estados vacíos** `web` `ux`
- [ ] **[#29](https://github.com/mateogsilvaa/tripfinder/issues/29) · Coste total de la escapada en el listado** `ux` `core` — es la #43

### [M15 · Mantenibilidad](https://github.com/mateogsilvaa/tripfinder/milestone/6)

- [ ] **[#30](https://github.com/mateogsilvaa/tripfinder/issues/30) · Partir `app.js` en módulos** `infra` `web`
- [ ] **[#31](https://github.com/mateogsilvaa/tripfinder/issues/31) · Una sola cabecera** `infra` `web`
- [ ] **[#32](https://github.com/mateogsilvaa/tripfinder/issues/32) · Humo de frontend en CI** `infra` `web`

### [M16 · Barrido nocturno de mitad de semana](https://github.com/mateogsilvaa/tripfinder/milestone/7)

Una busqueda que corre sola en la **noche del martes al miercoles, entre las 02:00 y las
03:00 peninsulares**, aprovechando que nadie usa la web para gastar el presupuesto de
consultas entero. La ventana cae en 00:00-01:00 UTC en verano y en 01:00-02:00 UTC en
invierno —siempre miercoles—, asi que lleva dos crons y un guardian de hora local.

- [ ] **[#33](https://github.com/mateogsilvaa/tripfinder/issues/33) · Barrido nocturno de la noche del martes al miércoles (02:00-03:00)** `infra` `scraper`
- [ ] **[#34](https://github.com/mateogsilvaa/tripfinder/issues/34) · Horas peninsulares de verdad en todos los crons** `infra` `documentation`
- [ ] **[#35](https://github.com/mateogsilvaa/tripfinder/issues/35) · El barrido nocturno recorre el mapa entero, no un trozo** `core` `scraper`
- [ ] **[#36](https://github.com/mateogsilvaa/tripfinder/issues/36) · El correo del barrido nocturno no llega a las tres de la mañana** `email` `ux`

---

## Orden sugerido para retomar

1. **#14 y #15** — son los dos que tienen consecuencias hoy: los emails publicados y la
   cuenta sin sobre, que entra pero no puede escribir.
2. **#16 y #17** — CI y documentación: baratas, y todo lo demás se apoya en ellas.
3. **#6 → #10** — el test de destinos entero, que es la mejora de producto más grande
   por esfuerzo invertido. #11, #12 y #13 lo rematan.
4. **#19, #31, #30** — rendimiento y estructura, antes de que la web crezca más.
5. **#23-#25 y #26-#28** — accesibilidad y la primera impresión.
6. **#33 → #36** — el barrido nocturno de los miércoles de madrugada, con #34 antes que
   los demás.
7. De lo viejo, lo que sigue vivo —y aquí los números **son los del roadmap**, no los de
   GitHub—: #10 (rate limiting), #13 (digest semanal), #33 (ventana de horas por destino),
   #39 (puentes y festivos) y #42 (mínimo histórico de la ruta).
