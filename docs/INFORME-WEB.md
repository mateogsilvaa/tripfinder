# Informe técnico de la web

Estado a **2026-08-26**, sobre el commit `92d6f4a`. Cubre todo lo que hay en `web/`
(las cuatro páginas, los tres scripts y la hoja de estilos), cómo se conecta con el
resto del repo, qué se puede mejorar, y tres secciones de propuesta al final: **el test
de destinos** que falta, **las 31 issues** —ya abiertas en GitHub— para dejar esto fino, y
un anexo sobre **el barrido nocturno de los miércoles de madrugada**.

Lo que se ha comprobado de verdad para escribir esto: los 82 tests de `tests/` pasan
(`python -m pytest` → 82 passed), `data/offers.json` tiene 120 ofertas vivas generadas
el 2026-08-26, hay 5 seguimientos activos, 8 búsquedas guardadas, 4 fichas de
alojamiento y 2 cuentas. Lo que no se ha podido comprobar desde aquí queda dicho como
tal.

---

## 1. Qué es la web, en una frase

Un frontend **estático, sin build y sin dependencias** publicado en GitHub Pages que
lee los JSON que commitea GitHub Actions, y que cuando hay que escribir algo (una
búsqueda, un seguimiento, una cuenta) no llama a ningún servidor: llama a la API de
GitHub con un token cifrado en el propio repo y deja que un workflow haga el trabajo.

No hay backend. El repositorio **es** la base de datos, y Actions **es** el backend.

## 2. Mapa de ficheros

| Fichero | Líneas | Qué es |
|---|---:|---|
| `web/index.html` | 143 | Chollos del día: el tablón público |
| `web/buscar.html` | 147 | Búsqueda avanzada bajo demanda |
| `web/seguimientos.html` | 145 | Seguimientos diarios + favoritos |
| `web/admin.html` | 815 | Panel: cuentas, token, huérfanos, registro de errores |
| `web/app.js` | 1.996 | Toda la lógica de las tres páginas públicas |
| `web/auth.js` | 666 | Cuentas, criptografía, sesión y el disparador de workflows |
| `web/log.js` | 120 | Registro de errores del navegador + interruptor de tema |
| `web/styles.css` | 1.166 | Dos temas sobre un solo juego de tokens |

**Peso en crudo**: 76 KB de JS + 51 KB de CSS + ~24 KB de HTML, sin minificar y sin
comprimir. A eso se suman los datos: `offers.json` (176 KB) y `airports_world.json`
(270 KB), que la portada pide los dos.

## 3. Todo lo que tiene la web

### 3.1 Chollos del día (`index.html`)

El tablón público: lo ve igual quien entre con cuenta y quien entre sin ella.

- **Cabecera de panel de salidas** con el troquel `M A D`, la etiqueta de sección y el
  indicador "en vivo".
- **Estadísticas vivas** (`#stats`): ofertas vivas, mejor descuento, precio mínimo,
  cuántas son escapada de finde y cuándo se actualizó.
- **Billete grande** (`heroTicket`) para el mejor chollo: troquelado, con código de
  barras, ida y vuelta con horas, y el precio en grande.
- **Panel de salidas** (`boardRow`) para el resto: una fila por vuelo, desplegable, con
  el detalle completo dentro (`detalleHTML`).
- **Filtros**: texto libre sobre ciudad/IATA/país, tope de precio con `range` que se
  ajusta solo al máximo real del día, continente (cruzando con `airports_world.json`),
  personas, orden (mejor chollo / más viaje por euro / más barato / sale antes),
  "una por destino" y "solo findes".
- **Selector de personas** que multiplica el precio de una persona y lo marca con `≈`,
  con el total grande y el por-persona debajo (`precioHTML`, `reparto`).
- **Histórico por ruta** (`historiaHTML`): al abrir un vuelo se dibuja la curva de esa
  ruta desde `history.json` y se da un veredicto de una línea — *"barato: normalmente
  está entre 119 y 211 €"*—, con serie separada para findes (`RUTA|finde`).
- **Alternativas de otras compañías** en la propia tarjeta cuando dos aerolíneas hacen
  el mismo viaje.
- **Aviso de hidden city** cuando la oferta es de bajarse en la escala, con las tres
  advertencias (solo ida, sin maleta facturada, riesgo).
- **Enlaces de reserva**: el deep link del proveedor, el botón de la aerolínea cuando
  existe (easyJet, Vueling, Transavia, Volotea) y "Comparar en eDreams" con la ruta ya
  puesta.
- **Deep link `?offer=<id>`**: el email enlaza a una oferta concreta; si los filtros la
  ocultarían, `ensureVisible` los relaja antes de resaltarla.
- **Errores del último scan** en un `<details>` cuando `offers.json` trae `errors`.
- **Panel lateral de alojamiento** con polling: abre issue prerrellenada, espera el
  JSON cada 20 s hasta 15 min, y pinta hoteles/Airbnb + el **coste total de la escapada**
  (*"escapada completa para 2: 264 €, 132 € por cabeza"*).

### 3.2 Búsqueda avanzada (`buscar.html`)

- Formulario con cuatro decisiones: **dónde** (donde sea / un sitio concreto), **cuándo**
  (un finde cualquiera / fechas exactas / cualquier fecha), noches, meses vista, tope y
  personas. El formulario **se reconfigura solo** según lo que elijas (`syncFinder`), y
  cada combinación tiene su frase de ayuda (`HINTS`).
- **Selector de destino** modal: lista completa de `airports_world.json` agrupada por
  país, buscable escribiendo, con el **país entero seleccionable** ("todo el país · 12
  aeropuertos").
- **Calendario propio** de 12 meses, primer clic ida y segundo vuelta, compartido entre
  buscador y seguimientos (`CALS`).
- **Lanzar la búsqueda** manda un `repository_dispatch` de tipo `search`; el workflow
  `custom-search.yml` la ejecuta (~8 min si es "donde sea") y publica
  `data/searches/<slug>.json`.
- **Búsquedas guardadas** con su índice, desplegables, con sus resultados dentro, y
  botón de borrar (`delete_search`).
- **Búsquedas pendientes**: mientras el workflow trabaja, la búsqueda queda apuntada en
  `localStorage` con su reloj; a los 18 minutos se marca como colgada en vez de
  desaparecer.

### 3.3 Lo que sigues (`seguimientos.html`)

- **Seguir un viaje**: el mismo formulario adaptativo, pero no busca ahora — se apunta
  y lo revisa el cron. Avisa cuando entra en el tope **o cuando baja un 8% de su propio
  mínimo histórico** (`merece_aviso`).
- **Lista de seguimientos** con lo último encontrado dentro (aunque no merezca aviso:
  así se ve que está trabajando), mejor precio visto, cuándo se revisó, y botón de
  quitar.
- **Favoritos**: la ☆ de cualquier vuelo lo guarda en el navegador con el precio al que
  lo marcaste. Cada vez que la web vuelve a ver ese vuelo —en los chollos, en una
  búsqueda guardada o en un seguimiento— compara y **canta el cambio arriba del todo**
  en las tres páginas (`refrescarAvisoFavs`), con sparkline de la evolución.

### 3.4 Panel (`admin.html`)

- Puerta con contraseña propia (PBKDF2-SHA256, 210.000 vueltas, WebCrypto); la primera
  vez la eliges ahí mismo.
- **Alta, baja, desactivación y cambio de contraseña** de cuentas, vía
  `repository_dispatch` → `users.yml`. La contraseña en claro nunca sale del navegador:
  al workflow le llegan sal y hash ya calculados.
- **El token del sitio**: se pega una vez, se cifra con AES-GCM bajo una clave maestra y
  se publica cifrado. Cada cuenta lleva su "sobre" con esa clave maestra cerrada con su
  contraseña.
- **Huérfanos**: detecta lo que no tiene dueño y lo asigna a una cuenta.
- **Ficha de cada cuenta**: sus seguimientos, sus búsquedas y sus preferencias de correo.
- **Registro de errores**: lo que `log.js` ha ido guardando en ese navegador, exportable
  a CSV, copiable, y con un botón que trae además los fallos de Actions.

### 3.5 Sistemas transversales

| Sistema | Dónde | Cómo funciona |
|---|---|---|
| **Cuentas** | `auth.js` | Login contra `data/users.json`, PBKDF2-SHA256 en el navegador. Sesión en `localStorage`, token abierto en `sessionStorage`. |
| **Sobres cifrados** | `auth.js` | `contraseña → PBKDF2 → clave → AES-GCM → clave maestra → AES-GCM → token`. Python nunca ve nada en claro. |
| **Disparador** | `auth.js::tfDispatch` | `POST /repos/<repo>/dispatches` con el token. Traduce 401/403/404 a un mensaje que dice exactamente qué permiso falta. |
| **Namespacing por cuenta** | `auth.js::tfClave` | Cada cosa guardada en el navegador lleva la cuenta en la clave: `tf_favoritos:u-1a2b3c4d`. Dos cuentas en el mismo navegador no se ven nada. |
| **Candado de formularios** | `app.js::candarFormularios` | Sin sesión los formularios se ven, pero salen apagados y con el botón de entrar al lado. |
| **Dos temas** | `log.js` + `styles.css` | Tokens semánticos; el tema se aplica en un `<script>` del `<head>` antes de pintar; al cambiar se corta la transición de todo para que no haya charco de colores. |
| **Registro de errores** | `log.js` | Envuelve `window.fetch` y captura `error`/`unhandledrejection`. Ignora a propósito los 404 de `data/*.json`, que son el estado normal del polling. |

## 4. Cómo se comporta por dentro

**Lectura**: todo `fetchJSON` va con `cache: no-store` y un `?t=<timestamp>`, porque
Pages cachea agresivo y aquí siempre se quiere lo último.

**Escritura**: nada se escribe directamente. La web manda un `repository_dispatch` y el
workflow correspondiente aplica el cambio, commitea y relanza Pages. `watch.yml` y
`users.yml` reintentan hasta cinco veces resincronizando con `origin/main` entre
intentos, porque tres cambios seguidos arrancaban desde el mismo fichero y se pisaban.

**Esperas**: el alojamiento hace polling cada 20 s durante 15 minutos; las búsquedas se
guardan como pendientes hasta 18 minutos; tras apuntar un seguimiento se recarga la
lista a los 45 s.

**Una sola bolsa de JS para tres páginas**: `app.js` se carga entero en las tres y usa
`on()`/`existe()` para no explotar cuando un selector no está en esa página. Funciona,
pero es la razón de que el fichero pese 76 KB en todas.

## 5. Lo que puede mejorar

### 5.1 Riesgos y cosas mal (prioridad alta)

1. **Los emails de las cuentas se publican.** `pages.yml` copia `data/*` entero al
   sitio, y `data/users.json` incluye `email` en claro de cada cuenta. La web necesita
   de ese fichero el id, el nombre, la sal, el hash y el sobre — **el email no lo usa
   para nada**, lo usa el cron desde el repo. Hoy cualquiera que abra
   `…github.io/tripfinder/data/users.json` lee las dos direcciones. Se arregla
   publicando una versión recortada.
2. **La cuenta principal no puede escribir.** En `data/users.json`, `u-bccb1f1e`
   (`mateogsilvaa`) tiene `"sobre": {}`. Es el caso que el README describe —cuenta
   creada antes de guardar el token— y significa que esa cuenta entra y ve la web pero
   **no puede lanzar nada**. La otra cuenta sí tiene sobre. El panel debería cantarlo en
   rojo y ofrecer arreglarlo en un clic, no dejarlo para que se descubra al pulsar un
   botón que no hace nada.
3. **No hay CI.** Los 82 tests están y pasan, pero ningún workflow los ejecuta. Un
   parser de scraping que se rompe se descubre cuando el correo llega vacío.
4. **Documentación desfasada.** El README y `ARCHITECTURE.md` dicen "cron cada 6 h"; el
   cron real es `0 6,18 * * *`, es decir cada 12 h — y el pie de la web lo dice bien.
   `ROADMAP.md` dice "10 tests en `tests/`" cuando hay 82. Son los dos sitios donde uno
   mira para entender el sistema.
5. **`esc()` no valida esquemas de URL.** Escapa caracteres, pero un `deep_link` que
   empezara por `javascript:` sobreviviría intacto dentro de un `href`. Hoy esos campos
   los generan nuestros propios providers, así que es hardening, no un agujero abierto;
   aun así es una línea de código.

### 5.2 Rendimiento

6. **270 KB de aeropuertos en la portada.** `index.html` carga
   `airports_world.json` entero **solo para saber en qué continente cae cada IATA**. Un
   `data/continentes.json` derivado (código → continente) baja eso a unos pocos KB. El
   listado completo solo hace falta al abrir el selector de destinos, y ahí ya se carga
   bajo demanda.
7. **Tres familias de Google Fonts** con seis pesos, en `<link>` bloqueante, en las
   cuatro páginas. Sin `font-display: swap` explícito el texto puede quedarse invisible
   mientras cargan.
8. **Cache-busting a mano.** `?v=27` aparece en 12 sitios y `build 27` en cuatro pies de
   página. Es cuestión de tiempo que uno se quede en 26 y alguien vea CSS viejo.
9. **Sin `manifest.json` ni service worker.** Para algo que se consulta desde el móvil
   varias veces por semana, instalable y con la última tanda de ofertas en frío sería
   una mejora real (es la #35 del roadmap).
10. **`app.js` entero en las tres páginas.** `seguimientos.html` carga el motor de
    filtros de la portada, y la portada carga el calendario que no usa.

### 5.3 Accesibilidad

11. **Los modales no atrapan el foco.** `#destModal` y los del panel se abren sin
    `aria-modal`, sin mover el foco al diálogo y sin devolverlo al botón que lo abrió al
    cerrar. Con teclado te sales del diálogo sin darte cuenta.
12. **El panel de alojamiento tampoco.** Se abre con `Escape` sin gestionar y el fondo
    sigue siendo tabulable.
13. **Los estados de espera no se anuncian.** "buscando… tarda 2–3 min", el polling de
    alojamiento y la llegada de resultados no van en regiones vivas (`#favAviso` sí lo
    está, y es el ejemplo a copiar).
14. **`--faint` (#737a88 sobre #ece6da)** ronda el 4,2:1: pasa AA para texto grande, no
    para texto pequeño, y ahí es justo donde se usa (metadatos de filas).
15. **`<a id="favoritos-ancla"></a>`** es un enlace vacío sin `href`; debería ser un id
    en la sección.
16. **Sin `<noscript>`.** Sin JS la página no enseña absolutamente nada, ni siquiera un
    "esto necesita JavaScript".

### 5.4 Producto y UX

17. **La portada no explica qué es esto.** Un recién llegado ve un tablón de ofertas y
    tres pestañas, pero nada le dice qué gana entrando, ni por dónde empezar si no tiene
    un destino en la cabeza. **Es la carencia más gorda y es la que ataca la sección 6.**
18. **Todo pide que ya sepas lo que quieres.** Buscar y seguir exigen destino, tope,
    noches, meses y personas antes de devolver nada. Quien no lo tiene decidido se queda
    en el tablón.
19. **Las tres páginas repiten el mismo lede** ("Viernes por la tarde fuera, domingo por
    la tarde de vuelta…") y la misma `<meta description>`. En "Lo que sigues" no viene a
    cuento.
20. **No hay 404.** Una URL mal escrita da la página de GitHub, no la de la web.
21. **No hay estado de carga.** Entre que se pide `offers.json` y se pinta, la página
    está vacía sin decir que está trabajando.
22. **Coste total solo al pedir alojamiento** (es la #43 del roadmap): el número que de
    verdad decide un viaje no aparece en el listado.

### 5.5 Mantenibilidad

23. **`app.js` son 2.000 líneas en un solo fichero** con nueve responsabilidades
    distintas. Está bien comentado —muy bien, de hecho: los comentarios explican por qué,
    no qué—, pero ya cuesta encontrar dónde tocar.
24. **La cabecera está copiada cuatro veces.** Header, nav, panel de alojamiento, modal
    de destinos y pie viven duplicados en los cuatro HTML. Un cambio de nav son cuatro
    ediciones y una oportunidad de olvidarse de una.
25. **Cero tests de frontend** y ningún linter de JS/CSS.
26. **Sin Open Graph ni Twitter cards**: compartir el enlace por WhatsApp no enseña nada.

---

## 6. Propuesta: el botón disimulado y el test de destinos

### 6.1 La idea

Hoy la web te pregunta *"¿a dónde quieres ir?"*. La mitad de las veces la respuesta
honesta es *"no lo sé, sorpréndeme"*, y ahí la web no tiene nada que ofrecer más allá de
mirar el tablón. El test cubre justo ese hueco: **seis preguntas rápidas, tres destinos
propuestos, y de ahí a que te llegue información sola.**

Y lo mejor: **no hace falta backend nuevo**. El ciclo completo —seguimiento diario,
revisión por cron, correo con el parte— ya está construido y funcionando. Lo único que
falta es la puerta de entrada.

### 6.2 El botón, y por qué disimulado

No va como un banner ni como un CTA gordo. Va **dentro del troquel del panel de
salidas**, en la cabecera que ya comparten las tres páginas: detrás de `M A D` aparece
un cuarto flap con un `?`. En reposo es un flap más, del mismo color y el mismo tamaño
que los otros tres. Al pasar por encima gira como los de un panel de salidas de verdad
y muestra `¿?`. Al pulsarlo, se abre el test.

```
   ┌───┬───┬───┬───┐
   │ M │ A │ D │ ? │   ← el cuarto flap: el destino desconocido
   └───┴───┴───┴───┘
```

Encaja con el lenguaje visual (el destino que aún no sabes), es descubrible sin ser
ruidoso, y **no ocupa sitio nuevo en móvil**, que es donde el espacio de la cabecera ya
va justo.

- Va en las tres páginas públicas, porque el `.board` es común.
- Accesible aunque sea discreto: `<button>` real, `aria-label="Descubrir tu destino
  ideal"`, alcanzable por tabulación, con `:focus-visible` visible.
- Quien nunca lo pulse no pierde nada; quien lo pulse una vez y no quiera repetir, tiene
  el resultado guardado y el flap enseña un punto.

### 6.3 El test

Seis preguntas, **una por pantalla**, en el mismo modal que ya existe para el selector de
destinos. Al elegir una respuesta se avanza solo —sin botón "siguiente"—, con la
transición de flap entre pregunta y pregunta. Barra de progreso con el troquel del
billete. Se puede volver atrás. Se responde con el ratón, con el dedo o con el teclado
(`1`-`4` para elegir, `←` para volver, `Esc` para salir). **Menos de 30 segundos de
principio a fin.**

| # | Pregunta | Respuestas | Qué mueve |
|---|---|---|---|
| 1 | ¿Qué te apetece? | ciudad y museos · playa y calor · montaña y aire libre · salir de noche · comer bien | perfil (`tags`) |
| 2 | ¿Cuánto tiempo? | un finde justo · un puente de 3–4 noches · me da igual | `nights`, `weekend` |
| 3 | ¿Cuánto quieres gastarte en el vuelo? | menos de 50 € · menos de 100 € · menos de 200 € · lo que haga falta | `max_price` |
| 4 | ¿Cuántos vais? | yo solo · dos · 3–4 · más de 4 | `adults` |
| 5 | ¿Te importa llegar de noche si es más barato? | quiero horas allí · me da igual, que sea barato | pesos precio/horas |
| 6 | ¿Cuándo? | en los próximos 3 meses · de aquí a 6 · cuando sea, avísame | `months` |

Opcional, según qué salga en la 1: **¿cerca o lejos?** (Europa / me da igual aunque sea
largo) → filtra `long_haul`.

### 6.4 Cómo salen los tres destinos

**Todo en el navegador, con datos que ya se publican.** Cero peticiones nuevas a
proveedores, cero espera.

*Fuentes*: `data/offers.json` (las 120 ofertas vivas), `data/history.json` (para el
veredicto de precio), `data/routes/MAD.json` (el mapa de destinos con ciudad y país) y
**una tabla nueva y pequeña**, `web/perfiles.json`, que asocia cada IATA del mapa a sus
etiquetas: `playa`, `ciudad`, `naturaleza`, `noche`, `gastronomia`. Son ~105 destinos,
un fichero curado a mano de unas cien líneas: el único dato que hay que crear.

*Filtros duros* (lo que el usuario ha dicho que no):

- precio (× personas) por encima del tope → fuera
- noches fuera del rango elegido → fuera
- si pidió finde y la oferta no es `weekend` → fuera
- `long_haul` según la pregunta opcional
- fecha de salida fuera del horizonte de meses → fuera

*Puntuación* (lo que decide el orden):

```
puntos =  0.45 · afinidad_tags        // cuánto encaja con lo que dijo en la 1
        + 0.25 · precio_relativo      // qué margen deja bajo su tope
        + 0.20 · horas_utiles         // useful_hours normalizado
        + 0.10 · score                // el score de chollo que ya calcula scoring.py
```

Los pesos se mueven con la pregunta 5: si contesta "que sea barato", `horas_utiles` baja
a 0.05 y `precio_relativo` sube a 0.40.

*Diversidad*: se coge la mejor, y para la segunda y la tercera **se descarta el mismo
país** y a poder ser el mismo perfil. Sin esto, "playa + barato" devuelve Bérgamo, Milán
y Turín, que para el usuario es una sola propuesta repetida.

*Si no salen tres*: se relaja el tope en pasos del 20% y las que entren así salen
marcadas — *"un poco por encima de tu tope: 118 € en vez de 100 €"*—. Si aun así no hay
tres, se enseñan las que haya y se dice por qué: *"con menos de 50 € y playa solo hay
una ahora mismo; apúntala y te avisamos cuando salgan más"*.

### 6.5 Las tres tarjetas

Cada una es un billete pequeño, con el mismo lenguaje que el resto de la web:

- **Ciudad y país**, con el IATA en el troquel.
- **Precio** con el tratamiento de siempre: total grande y por persona debajo cuando van
  varios, con `≈` si es estimado.
- **Fechas y horas útiles**: *"vie 16:30 → dom 22:50 · 34,8 h allí"*.
- **Veredicto histórico** reutilizando `historiaHTML`: *"barato: normalmente está entre
  119 y 211 €"*.
- **El porqué, en una línea**: *"te sale porque dijiste playa, dos noches y no querías
  madrugar"*. Esto es lo que hace que el test se sienta inteligente y no aleatorio.
- Dos botones: **"Ver el vuelo"** (el deep link de siempre) y **"Avísame de esto"**.

### 6.6 "Avísame de esto" → seguimiento automático

Aquí está el enganche, y es donde la propuesta se vuelve barata de implementar: **el
botón crea un seguimiento con el mecanismo que ya existe.**

```js
const r = await dispatch("watch", {
  ...comoDueno(),
  dest:        destino.ciudad,          // "Nápoles"
  label:       "Test · Nápoles · hasta 90 € · 2 pers.",
  max_price:   respuestas.tope,
  months:      respuestas.meses,
  adults:      respuestas.personas,
  weekend:     respuestas.finde ? "si" : "no",
  origen:      "test",                  // para poder distinguirlos después
});
```

Eso dispara `watch.yml` → `tripfinder watch add` → `data/watch.json` → commit → Pages.
**No hay que tocar ningún workflow.** A partir de ahí:

- El seguimiento aparece en **"Lo que sigues"** como uno más, con su etiqueta `Test ·`.
- El cron de `scan-flights.yml` lo revisa en su paso "Revisar seguimientos", dos veces al
  día.
- Cuando aparece algo dentro del tope —o algo que baja un 8% del mejor precio visto— entra
  en el **parte de seguimientos** que se manda al correo de esa cuenta, según sus
  preferencias (`prefs.seguimientos`).

Se pueden aceptar las tres propuestas: cada una es un seguimiento independiente.

*Confirmación inmediata*: la tarjeta se marca en el sitio —"apuntado · se revisa cada
día"— con enlace a `seguimientos.html`, y se recarga la lista a los 45 s, igual que hace
hoy el formulario de seguir.

### 6.7 Sin cuenta

**El test se hace sin cuenta.** Es un cálculo local, no escribe nada, y cerrarlo detrás
de un login mataría justo lo que lo hace útil: que un recién llegado descubra qué hace
esta web en treinta segundos.

Lo que sí exige cuenta es el "avísame", porque escribe en el repo. Al pulsarlo sin
sesión sale la caja de siempre (`avisoDeCuenta` / `cajaAcceso`) con el botón de entrar,
**y las respuestas y los tres resultados quedan guardados**: al volver de entrar, el test
sigue donde estaba y el botón funciona. Sin eso, el usuario tendría que rehacerlo, y no
lo va a rehacer.

### 6.8 Memoria y reentrada

- `tf_quiz:<uid>` guarda respuestas, resultados y fecha.
- Quien ya lo hizo, al pulsar el flap ve directamente sus tres destinos con un
  **"volver a hacerlo"** debajo.
- Los resultados se recalculan contra el `offers.json` del día, así que **las tres
  propuestas se actualizan solas** aunque las respuestas sean de hace dos semanas.
- Un punto discreto en el flap indica "tienes resultados esperando".

### 6.9 Lo que hay que tocar

| Fichero | Cambio |
|---|---|
| `web/perfiles.json` | **nuevo** · IATA → etiquetas de perfil |
| `web/quiz.js` | **nuevo** · el test entero (~350 líneas), cargado en las tres páginas |
| `web/styles.css` | el flap secreto, las pantallas de pregunta y las tarjetas de resultado |
| `index/buscar/seguimientos.html` | el `<button>` del flap y el `<script src="quiz.js">` |
| `web/app.js` | exponer `precioHTML`, `historiaHTML` y `dispatch` para reutilizarlos |
| `src/tripfinder/watch.py` | opcional: campo `source` en `Watch` para saber de dónde vino |

Ni un workflow nuevo, ni un secreto nuevo, ni una llamada de red nueva.

---

## 7. Issues que hay que abrir

**Estas 31 issues están abiertas en GitHub desde el 26/08/2026: [#6 a #32](https://github.com/mateogsilvaa/tripfinder/issues), repartidas en los seis hitos
`M10`–`M15`.** El número que abre cada entrada es el suyo en GitHub, y el cuerpo de
la issue guarda además su número de roadmap, que sigue donde lo dejó `docs/ROADMAP.md`
(última: #54). Cada una lleva etiquetas, por qué existe, qué entra dentro, criterios de aceptación
y esfuerzo aproximado (S = una tarde, M = un par de días, L = más).

| Hito | Issues | Qué agrupa |
|---|---|---|
| [M10 · El test de destinos](https://github.com/mateogsilvaa/tripfinder/milestone/1) | #6–#13 | El botón disimulado, las tres propuestas y el seguimiento automático |
| [M11 · Riesgos y correcciones](https://github.com/mateogsilvaa/tripfinder/milestone/2) | #14–#18 | Lo que tiene consecuencias hoy |
| [M12 · Rendimiento](https://github.com/mateogsilvaa/tripfinder/milestone/3) | #19–#22 | Lo que la web pide y no necesita |
| [M13 · Accesibilidad](https://github.com/mateogsilvaa/tripfinder/milestone/4) | #23–#25 | Foco, anuncios y contraste |
| [M14 · Producto](https://github.com/mateogsilvaa/tripfinder/milestone/5) | #26–#29 | La primera impresión |
| [M15 · Mantenibilidad](https://github.com/mateogsilvaa/tripfinder/milestone/6) | #30–#32 | Estructura y red de seguridad |
| [M16 · Barrido nocturno](https://github.com/mateogsilvaa/tripfinder/milestone/7) | #33–#36 | Una búsqueda sola, de madrugada, a mitad de semana |

### M10 · El test de destinos

---

**[#6](https://github.com/mateogsilvaa/tripfinder/issues/6) · Tabla de perfiles de destino (`web/perfiles.json`)** `core` `web` · **S**

*Por qué*: el test necesita saber que Nápoles es ciudad y gastronomía y que Lanzarote es
playa. Ese dato no existe en ningún sitio del repo.

*Qué*: fichero JSON con una entrada por IATA de `data/routes/MAD.json` (105 destinos) y
una lista de etiquetas de entre `playa`, `ciudad`, `naturaleza`, `noche`, `gastronomia`.
Curado a mano; los que falten se tratan como `ciudad` por defecto.

*AC*: los 105 destinos del mapa de MAD tienen entrada; un test comprueba que todo IATA
presente en `offers.json` resuelve a al menos una etiqueta o al valor por defecto, sin
lanzar.

---

**[#7](https://github.com/mateogsilvaa/tripfinder/issues/7) · El flap disimulado y el armazón del test** `web` `ux` · **M**

*Por qué*: es la puerta de entrada para quien no sabe a dónde quiere ir.

*Qué*: cuarto flap `?` en el `.board` de las tres páginas; `web/quiz.js` con el modal, la
máquina de estados de las seis preguntas, la barra de progreso, el avance automático al
elegir, el volver atrás y la animación de flap entre pantallas. Respeta
`prefers-reduced-motion`.

*AC*: se abre desde las tres páginas; se completa entero con ratón, con dedo y con
teclado; en 320 px de ancho no se corta nada; con `prefers-reduced-motion` no hay giro.

*Depende de*: nada.

---

**[#8](https://github.com/mateogsilvaa/tripfinder/issues/8) · Motor de recomendación en cliente** `web` `core` · **M**

*Por qué*: convertir seis respuestas en tres destinos concretos, sin pedir nada a nadie.

*Qué*: filtros duros (tope, noches, finde, largo radio, horizonte), puntuación ponderada
(afinidad · precio · horas útiles · score), pesos que se mueven con la pregunta 5,
diversidad por país, y relajado progresivo del tope cuando no salen tres.

*AC*: con `offers.json` de ejemplo, un perfil "playa, 2 noches, menos de 100 €, 2
personas" devuelve tres destinos de tres países distintos, todos ≤ 100 € por persona;
con un tope imposible devuelve lo que haya con el aviso de tope relajado, nunca una
lista vacía sin explicación. Tests unitarios de la función de puntuación.

*Depende de*: #6 · *Tabla de perfiles de destino*.

---

**[#9](https://github.com/mateogsilvaa/tripfinder/issues/9) · Las tres tarjetas de resultado, con el porqué** `web` `ux` · **M**

*Por qué*: una recomendación sin motivo se lee como aleatoria y no se acepta.

*Qué*: billete pequeño por destino con precio (reutilizando `precioHTML`), fechas, horas
útiles, veredicto histórico (`historiaHTML`), la frase del porqué generada a partir de
las respuestas que más pesaron, y los botones "Ver el vuelo" y "Avísame de esto".

*AC*: cada tarjeta enseña una frase de porqué distinta y correcta según las respuestas;
el precio respeta el selector de personas; el veredicto sale cuando hay histórico de esa
ruta y se omite limpiamente cuando no lo hay.

*Depende de*: #8 · *Motor de recomendación en cliente*.

---

**[#10](https://github.com/mateogsilvaa/tripfinder/issues/10) · "Avísame de esto" crea el seguimiento solo** `web` `core` · **S**

*Por qué*: es el remate del test — sin esto, son tres tarjetas bonitas que no hacen nada.

*Qué*: el botón manda `dispatch("watch", …)` con los campos derivados de las respuestas y
un `label` prefijado `Test ·`; confirmación en la propia tarjeta; recarga de la lista a
los 45 s; se pueden aceptar las tres.

*AC*: aceptar una propuesta crea un seguimiento visible en "Lo que sigues" con el dueño
correcto; el cron lo revisa en la siguiente pasada; aceptar las tres crea tres
seguimientos con ids distintos. Sin sesión, sale la caja de entrar y **las respuestas
sobreviven al login**.

*Depende de*: #9 · *Las tres tarjetas de resultado*.

---

**[#11](https://github.com/mateogsilvaa/tripfinder/issues/11) · Memoria del test y reentrada** `web` · **S**

*Qué*: `tf_quiz:<uid>` con respuestas, resultados y fecha; al reabrir, resultados
recalculados contra el `offers.json` de hoy; "volver a hacerlo"; punto en el flap cuando
hay resultados guardados; adopción de un test hecho sin cuenta al entrar (igual que
`tfAdoptarAnonimos` hace con los favoritos).

*AC*: cerrar la pestaña y volver enseña los tres destinos sin repetir el test, y con los
precios del día actual.

*Depende de*: #8 · *Motor de recomendación en cliente*.

---

**[#12](https://github.com/mateogsilvaa/tripfinder/issues/12) · Accesibilidad del test** `ux` `a11y` · **S**

*Qué*: `role="dialog"` + `aria-modal="true"`, foco al abrir y devuelto al flap al cerrar,
foco atrapado dentro, cada pregunta anunciada en una región viva, `Esc` para salir,
`:focus-visible` en todas las respuestas, contraste AA en las tarjetas.

*AC*: recorrido completo con lector de pantalla y solo teclado, sin salirse del diálogo
ni perder el foco.

*Depende de*: #7 · *El flap disimulado y el armazón del test*.

---

**[#13](https://github.com/mateogsilvaa/tripfinder/issues/13) · Marcar de dónde viene cada seguimiento** `core` `email` `nice-to-have` · **S**

*Qué*: campo `source` en `Watch`, propagado desde el payload; el panel y el parte diario
lo enseñan. Sirve para saber si el test sirve de algo.

*AC*: `tripfinder watch list` distingue los que vienen del test; los existentes sin el
campo siguen cargando sin error.

---

### M11 · Riesgos y correcciones

---

**[#14](https://github.com/mateogsilvaa/tripfinder/issues/14) · Dejar de publicar los emails de las cuentas** `infra` `seguridad` · **S**

*Por qué*: `pages.yml` copia `data/*` al sitio y `data/users.json` lleva el email de cada
cuenta en claro. La web no lo necesita: lo usa el cron, desde el repo.

*Qué*: en `pages.yml`, generar un `users.json` recortado para el sitio (id, user, name,
salt, hash, iterations, active, sobre, site) y publicar ese; el completo se queda en el
repo. Alternativa: separar `data/users.public.json` y que `auth.js` lea ese.

*AC*: `curl …github.io/tripfinder/data/users.json | grep @` no devuelve nada; login,
panel y sobres siguen funcionando igual.

---

**[#15](https://github.com/mateogsilvaa/tripfinder/issues/15) · El panel avisa (y arregla) los sobres que faltan** `web` `infra` · **S**

*Por qué*: ahora mismo `u-bccb1f1e` tiene `"sobre": {}`. Esa cuenta entra pero no puede
escribir, y lo descubre pulsando un botón que no responde.

*Qué*: el panel marca en rojo toda cuenta sin sobre o con sobre `stale`, explica qué
significa ("esta cuenta no puede lanzar búsquedas") y ofrece "darle acceso" en un clic,
que es fijarle contraseña nueva y fabricarle el sobre. Y en la web, si al abrir sesión no
hay sobre, decirlo al entrar en vez de al fallar.

*AC*: con una cuenta sin sobre, el panel lo canta al cargar; tras "darle acceso" esa
cuenta lanza un seguimiento correctamente.

---

**[#16](https://github.com/mateogsilvaa/tripfinder/issues/16) · CI: ruff + pytest en cada PR** `infra` · **S** *(roadmap #26, abierta desde M5)*

*Qué*: workflow que corre `ruff check` y `python -m pytest` en push y PR. Hoy hay 82
tests y nada los ejecuta.

*AC*: un PR que rompe un test sale en rojo antes de mezclarse.

---

**[#17](https://github.com/mateogsilvaa/tripfinder/issues/17) · Poner al día README, ARCHITECTURE y ROADMAP** `docs` · **S**

*Qué*: el cron es `0 6,18 * * *` (cada 12 h, no cada 6); los tests son 82, no 10; añadir
`watch.yml`, `users.yml` y `custom-search.yml` a la tabla de piezas de
`ARCHITECTURE.md`; marcar en el roadmap lo que ya está hecho.

*AC*: ningún número del README contradice al repo.

---

**[#18](https://github.com/mateogsilvaa/tripfinder/issues/18) · `esc()` valida esquema en las URL** `web` `seguridad` · **S**

*Qué*: un `escURL()` que solo deja pasar `http:`, `https:` y `mailto:`, usado en todos los
`href` y `src` que vienen de datos.

*AC*: un `deep_link` con `javascript:` en un JSON de prueba se pinta como enlace inerte y
queda apuntado en el registro de errores.

---

### M12 · Rendimiento

---

**[#19](https://github.com/mateogsilvaa/tripfinder/issues/19) · No cargar 270 KB de aeropuertos en la portada** `web` `perf` · **S**

*Qué*: generar `data/continentes.json` (código → continente) en el scan y que `index`
use ese. `airports_world.json` se sigue cargando, pero solo al abrir el selector de
destinos.

*AC*: la portada baja de ~450 KB de JSON a menos de 200 KB; el filtro de continente
sigue idéntico.

---

**[#20](https://github.com/mateogsilvaa/tripfinder/issues/20) · Fuentes que no bloquean** `web` `perf` · **S**

*Qué*: `display=swap` explícito, recortar pesos a los que se usan de verdad y valorar
alojarlas en el repo (Pages las sirve igual de rápido y desaparece la dependencia de un
tercero).

*AC*: sin flash de texto invisible; el texto se lee desde el primer pintado.

---

**[#21](https://github.com/mateogsilvaa/tripfinder/issues/21) · Versión de assets automática** `infra` `web` · **S**

*Qué*: que `pages.yml` calcule el `?v=` (hash o número de commit) y lo sustituya al
montar el sitio, incluido el `build N` del pie.

*AC*: publicar un cambio de CSS lo aplica sin tocar 12 sitios a mano; el pie enseña el
build real.

---

**[#22](https://github.com/mateogsilvaa/tripfinder/issues/22) · PWA instalable y ofertas en frío** `web` `nice-to-have` · **M** *(roadmap #70, era la #35)*

*Qué*: `manifest.json`, iconos, y un service worker que sirva la última tanda de ofertas
sin red.

*AC*: se instala en el móvil y abre con los últimos datos aunque no haya cobertura.

---

### M13 · Accesibilidad

---

**[#23](https://github.com/mateogsilvaa/tripfinder/issues/23) · Diálogos accesibles en toda la web** `ux` `a11y` · **M**

*Qué*: aplicar a `#destModal`, al panel de alojamiento y a los modales del panel lo mismo
que pide la #61: `aria-modal`, foco atrapado, foco devuelto, `Escape` en todos, fondo no
tabulable.

*AC*: ningún diálogo deja escapar el foco al fondo; cerrar devuelve el foco a quien
abrió.

---

**[#24](https://github.com/mateogsilvaa/tripfinder/issues/24) · Anunciar lo que está pasando** `ux` `a11y` · **S**

*Qué*: `aria-live` en los estados de espera (búsqueda lanzada, polling de alojamiento,
seguimiento apuntado) y `aria-busy` mientras se pinta.

*AC*: con lector de pantalla se entera uno de que la búsqueda está en marcha y de cuándo
ha terminado.

---

**[#25](https://github.com/mateogsilvaa/tripfinder/issues/25) · Contraste y tamaño táctil** `ux` `a11y` · **S**

*Qué*: subir `--faint` hasta 4,5:1 en ambos temas y garantizar 44×44 px en los botones
pequeños (☆, ✕, flap del test).

*AC*: auditoría de contraste sin fallos en texto pequeño; los botones se aciertan con el
dedo a la primera.

---

### M14 · Producto

---

**[#26](https://github.com/mateogsilvaa/tripfinder/issues/26) · La portada dice qué es esto** `ux` `web` · **S**

*Qué*: una línea sobre el tablón que explique el trato ("te avisamos cuando un viaje baja
de lo que suele costar") y, al lado, la mención discreta al test para quien no tenga
destino en la cabeza.

*AC*: alguien que entra por primera vez sabe en cinco segundos qué hace la web y qué
puede hacer él.

*Depende de*: #7 · *El flap disimulado y el armazón del test*.

---

**[#27](https://github.com/mateogsilvaa/tripfinder/issues/27) · Cada página con su texto** `ux` · **S**

*Qué*: lede y `<meta description>` propios de "Búsqueda avanzada" y "Lo que sigues", en
vez del de la portada repetido.

---

**[#28](https://github.com/mateogsilvaa/tripfinder/issues/28) · 404 y estados vacíos** `web` `ux` · **S**

*Qué*: `web/404.html` con la identidad de la web y vuelta al tablón; esqueleto de carga
mientras llega `offers.json`; `<noscript>` explicando que hace falta JavaScript.

*AC*: una URL inventada cae en una página de TripFinder; entrar con la red lenta no
enseña una página en blanco.

---

**[#29](https://github.com/mateogsilvaa/tripfinder/issues/29) · Coste total en el listado** `ux` `core` · **M** *(roadmap #77, era la #43)*

*Qué*: precalcular una estimación de escapada completa para el top de ofertas, para que
el número que decide el viaje no exija pedir alojamiento antes.

---

### M15 · Mantenibilidad

---

**[#30](https://github.com/mateogsilvaa/tripfinder/issues/30) · Partir `app.js` en módulos** `infra` `web` · **M**

*Qué*: `precios.js`, `favoritos.js`, `ofertas.js`, `alojamiento.js`, `busqueda.js`,
`seguimientos.js`, `calendario.js` con módulos ES nativos (Pages los sirve sin build).
Cada página carga lo suyo.

*AC*: la portada deja de cargar el calendario y el motor de búsquedas; ningún cambio de
comportamiento.

---

**[#31](https://github.com/mateogsilvaa/tripfinder/issues/31) · Una sola cabecera** `infra` `web` · **M**

*Qué*: header, nav, panel, modal y pie en un parcial, ensamblado al montar el sitio en
`pages.yml` (o inyectado por JS, aceptando el coste). Hoy están copiados cuatro veces.

*AC*: cambiar una entrada del nav es una sola edición.

*Depende de*: nada, pero conviene hacerla antes que #26 y que el flap del test, o se
toca el mismo HTML dos veces.

---

**[#32](https://github.com/mateogsilvaa/tripfinder/issues/32) · Humo de frontend en CI** `infra` `web` · **M**

*Qué*: dos o tres pruebas con Playwright: la portada pinta ofertas del JSON de ejemplo,
el test devuelve tres destinos, y el candado de formularios se activa sin sesión.

*AC*: un cambio que deja la portada en blanco no llega a `main`.

*Depende de*: #16 · *CI: ruff + pytest en cada PR*.

---

### M16 · Barrido nocturno de mitad de semana

Ver el anexo (sección 8) para el porqué de la hora y de la dificultad.

---

**[#33](https://github.com/mateogsilvaa/tripfinder/issues/33) · Barrido nocturno de la noche del martes al miércoles (02:00–03:00)** `infra` `scraper` · **S**

*Por qué*: pedido expreso. Y es buena hora: nadie usa la web, el presupuesto de consultas
se puede gastar entero y lo que salga está en el correo el miércoles por la mañana.

*Qué*: un `scan-nocturno.yml` con **los dos crons** que hacen falta para clavar la ventana
todo el año (`17 0 * * 3` en verano, `17 1 * * 3` en invierno), un guardián que solo deja
trabajar al que cae dentro de las 02:00–03:00 peninsulares, y un cerrojo semanal para que
un retraso de GitHub no dispare los dos. El minuto no es `0` a propósito: los cron en
punto son los que más cola cogen.

*AC*: un miércoles de verano y otro de invierno corre una sola vez y dentro de la ventana;
al cambiar la hora en marzo y octubre no hay que tocar nada; `workflow_dispatch` lo lanza
a cualquier hora para poder probarlo.

---

**[#34](https://github.com/mateogsilvaa/tripfinder/issues/34) · Horas peninsulares de verdad en todos los crons** `infra` `documentation` · **S**

*Por qué*: `scan-flights.yml` dice `# 08:00 y 20:00 hora peninsular` y eso solo es cierto
medio año: en invierno son las 07:00 y las 19:00.

*Qué*: elegir regla —doble cron con guardián, o comentario honesto— y aplicarla a los tres
workflows programados. Para el scan de cada 12 h basta la segunda; para el nocturno hace
falta la primera.

*AC*: ningún comentario de cron afirma una hora local que solo vale medio año, y la regla
queda escrita en `ARCHITECTURE.md`.

---

**[#35](https://github.com/mateogsilvaa/tripfinder/issues/35) · El barrido nocturno recorre el mapa entero, no un trozo** `core` `scraper` · **M**

*Por qué*: si hace lo mismo que el de las 08:00, no aporta nada. Lo que lo justifica es
gastar el presupuesto que de día no se puede gastar: hoy son 40 consultas y el resto del
mapa se baraja con la fecha como semilla.

*Qué*: un `config/watchlist-nocturno.yml` —el CLI ya acepta `--config`, así que no hace
falta tocar código— con `max_queries` cerca de 110 y `min_interval_seconds` **más alto**,
no más bajo: nadie espera, y espaciar es lo que evita que Google devuelva páginas vacías.
Y decidir si se desactiva el barajado o se siembra con la semana.

*AC*: consulta bastantes más destinos que el diario y se ve en el log; si Google capa,
queda en `errors` y se ve en la web; dos scans nunca corren a la vez.

*Depende de*: #33.

---

**[#36](https://github.com/mateogsilvaa/tripfinder/issues/36) · El correo del barrido nocturno no llega a las tres de la mañana** `email` `ux` · **S**

*Por qué*: con `chollos: cada_vez`, que es lo que tienen las dos cuentas, un barrido a las
02:00 manda el correo a las 03:00. La gracia es que el chollo esté esperando por la mañana.

*Qué*: o aviso diferido —el nocturno marca lo encontrado como pendiente y el scan de la
mañana lo manda— o avisar en el momento solo lo excepcional, subiendo su `min_score`. No
vale con `--no-email` a secas: el scan de la mañana solo avisa de lo que no está en
`state.json`, y el nocturno ya lo habrá apuntado allí.

*AC*: lo encontrado a las 02:00 llega por la mañana; no se pierde ni se duplica ningún
aviso; las preferencias de cada cuenta se siguen respetando.

*Depende de*: #33.

---

### Orden sugerido

1. **#14 y #15** — son los dos que tienen consecuencias hoy: un dato publicado que no
   debería y una cuenta que no puede escribir.
2. **#16 y #17** — CI y documentación: baratas, y a partir de ahí todo lo demás se
   apoya en ellas.
3. **#6 → #10** — el test entero, que es la mejora de producto más grande por
   esfuerzo invertido. #11, #12 y #13 lo rematan.
4. **#19, #31, #30** — rendimiento y estructura, antes de que la web crezca más.
5. **#23-#25 y #26-#28** — accesibilidad y la primera impresión.
6. **#33 → #36** — el barrido nocturno. Va aquí y no antes porque #34 (las horas
   peninsulares) conviene tenerla resuelta primero, y porque #35 depende de saber si
   Google aguanta 110 consultas desde una IP de Actions.
7. El resto, por gusto.

---

## 8. Anexo · El barrido nocturno de mitad de semana

Un encargo aparte del resto del informe: **que se corra una búsqueda sola en la noche del
martes al miércoles, entre las 2 y las 3 de la madrugada.** Es el hito
[M16](https://github.com/mateogsilvaa/tripfinder/milestone/7), issues #33 a #36.

### Por qué esa hora tiene sentido

No es capricho. A esa hora **nadie está usando la web**, y eso cambia lo que se puede
hacer: el scan diario está capado a 40 consultas a Google porque corre desde una IP de
Actions cada 12 horas y conviene no forzar, mientras que la búsqueda a mano se permite
110 porque es una sola tirada. El barrido nocturno se parece más a lo segundo que a lo
primero: una tirada, sin nadie esperando, con todo el tiempo del mundo para espaciar las
peticiones. Y lo que encuentre está en el correo cuando te levantas.

### Por qué es más difícil de lo que parece

**GitHub programa en UTC y España cambia la hora.** La ventana pedida cae en sitios
distintos según la estación:

| | Ventana local | En UTC | Día en UTC |
|---|---|---|---|
| Verano (CEST, UTC+2) | 02:00–03:00 | **00:00–01:00** | miércoles |
| Invierno (CET, UTC+1) | 02:00–03:00 | **01:00–02:00** | miércoles |

Lo bueno: en las dos estaciones sigue siendo miércoles en UTC, así que el día de la semana
del cron no cambia (`* * 3`) y no hay que preocuparse de que la noche del martes se
convierta en otro día al convertir. Lo malo: la hora sí cambia, y **un solo cron acierta
medio año y falla el otro medio**. Por eso el diseño lleva dos crons y un guardián que
mira la hora en `Europe/Madrid`: así, cuando cambie la hora en marzo y en octubre, no hay
que tocar nada.

Esto no es un problema nuevo del nocturno, solo lo hace visible: `scan-flights.yml` ya
dice hoy `# 08:00 y 20:00 hora peninsular` y en invierno son las 07:00 y las 19:00. De ahí
que #34 vaya en este mismo hito.

**Y el planificador de GitHub no es puntual.** Los workflows programados se encolan y se
retrasan, sobre todo los que caen en punto, que es cuando los programa todo el mundo. Por
eso el cron va a `:17` y no a `:00`, y por eso el guardián acepta también las 03. "Entre
las 2 y las 3" se puede dejar clavado casi siempre; garantizarlo al minuto, no —y quien
diga lo contrario no ha visto la cola de Actions un lunes.

### Lo que no se ha decidido aquí

Dos cosas quedan explícitamente abiertas en las issues, porque son decisiones tuyas y no
del informe:

1. **Qué busca exactamente.** Se ha diseñado como un scan completo con el presupuesto
   ampliado —la lectura natural de "una búsqueda"—, no como una búsqueda concreta a un
   destino fijo. Si lo que quieres es lo segundo (por ejemplo, vigilar de madrugada una
   ruta que te interesa), el hito cambia poco: `#35` se convierte en "qué destino" y el
   resto sigue igual.
2. **Si avisa de madrugada o por la mañana.** `#36` propone las dos opciones y recomienda
   la primera, pero suena el móvil de quien decida.
