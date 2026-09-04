/* Humo de frontend: lo minimo para que un cambio que deja la web en blanco no
   llegue a main. No comprueba que este bonita, comprueba que este.

   Nada de esto toca la red: los datos salen de `tests/web/datos/` y las
   fuentes de Google se bloquean, que si no cada prueba depende de que
   fonts.googleapis.com conteste. */
const { test, expect } = require("@playwright/test");

const OFERTAS = require("./datos/offers.json");

// Sin esto cada prueba se queda esperando a Google Fonts, que ademas no hace
// falta para nada de lo que se comprueba aqui.
test.beforeEach(async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
});

test.describe("la hoja del día", () => {
  test("pinta la plancha del día y una fila por oferta", async ({ page }) => {
    await page.goto("/index.html");

    // La plancha: el toponimo grande y la cifra en rojo del mejor chollo.
    const plancha = page.locator(".ticket");
    await expect(plancha).toBeVisible();
    await expect(plancha.locator(".dest")).toHaveText(
      new RegExp(OFERTAS.offers[0].destination_name)
    );
    await expect(plancha.locator(".amount")).toContainText(
      String(Math.round(OFERTAS.offers[0].price))
    );

    // Y el resto, una entrada de indice cada una.
    await expect(page.locator(".brow")).toHaveCount(OFERTAS.offers.length - 1);

    // La cabecera de columnas, y el cuadratín de "poner en observación" el
    // primero de la fila: es lo que convierte el feed en un parte que se marca.
    await expect(page.locator("#boardHead")).toBeVisible();
    await expect(page.locator(".brow > .fav").first()).toBeAttached();
    const orden = await page.locator(".brow").first().evaluate((f) =>
      [...f.children].slice(0, 2).map((c) => c.className.split(" ")[0])
    );
    expect(orden).toEqual(["fav", "dest-cell"]);
  });

  test("el esqueleto de carga se quita cuando llegan los datos", async ({ page }) => {
    await page.goto("/index.html");
    await expect(page.locator(".ticket")).toBeVisible();
    await expect(page.locator("#cargando")).toHaveCount(0);
  });

  test("si los datos no llegan, lo dice en vez de quedarse en blanco", async ({ page }) => {
    await page.route("**/offers.json*", (r) => r.abort());
    await page.goto("/index.html");
    await expect(page.locator("#cargando")).toContainText(/no se han podido leer/i);
  });
});

test.describe("las cuentas", () => {
  test("sin sesión los formularios salen apagados y con el motivo", async ({ page }) => {
    await page.goto("/buscar.html");
    const form = page.locator("#finderForm");
    const caja = page.locator(".herramienta").first();
    await expect(form).toHaveClass(/candado/);
    // La nota va al final de la herramienta, no dentro del formulario: el
    // formulario es una rejilla de campos y una frase ahí dentro se lee como
    // un campo más. Y así queda junto al botón que explica.
    await expect(caja.locator(".candado-nota")).toContainText(/hace falta una cuenta/i);
    // Apagados de verdad, no solo con pinta de apagados. El botón de enviar
    // vive FUERA del formulario (lo enlaza `form=`), así que se comprueba
    // aparte: es justo el que un `disabled` mal puesto dejaría vivo.
    for (const sel of ["#fWhere", "#fMax"]) {
      await expect(form.locator(sel)).toBeDisabled();
    }
    await expect(page.locator('button[form="finderForm"]')).toBeDisabled();
  });
});

test.describe("la 404", () => {
  test("una dirección que no existe da la página de la web, con estilos", async ({ page }) => {
    const r = await page.goto("/esto-no-existe");
    expect(r.status()).toBe(404);
    await expect(page.locator("h1")).toContainText(/fuera de la carta/i);
    await expect(page.locator("#perdidaRef")).toContainText("/esto-no-existe");
    // Con estilos: si la hoja no cargara, el fondo seria el del navegador.
    const fondo = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(fondo).not.toBe("rgba(0, 0, 0, 0)");
    // Y una salida.
    // El camino de vuelta: al feed, que es la portada.
    await expect(page.locator('main a[href="./#feed"]')).toBeVisible();
  });
});

test.describe("el armazón que comparten las páginas", () => {
  for (const [pagina, activa] of [
    ["/index.html", "Feed"],
    ["/buscar.html", "Buscar"],
    ["/seguimientos.html", "Vuelos que sigues"],
  ]) {
    test(`${pagina} monta cabecera, zonas y pie`, async ({ page }) => {
      await page.goto(pagina);
      await expect(page.locator(".zona")).toHaveCount(4);
      await expect(page.locator(".zona.activa")).toHaveText(activa);
      await expect(page.locator("#tema")).toBeVisible();
      await expect(page.locator(".foot .build")).toBeVisible();
    });
  }

  test("sin JavaScript se dice, en vez de dejar la página muda", async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    // Sin JS no hay nada que esperar despues del HTML, y esperar al `load`
    // son doce segundos de fuentes que ademas aqui van bloqueadas.
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".sin-js")).toBeVisible();
    await ctx.close();
  });
});

test.describe("enlaces que vienen de los datos", () => {
  test("un javascript: en un deep_link sale inerte y queda apuntado", async ({ page }) => {
    // Se sirve el JSON envenenado en lugar del normal.
    await page.route("**/offers.json*", (r) =>
      r.fulfill({ path: require.resolve("./datos/offers-envenenado.json") })
    );

    const apuntes = [];
    await page.exposeFunction("__apunte", (tipo, msg) => apuntes.push(`${tipo}: ${msg}`));
    await page.addInitScript(() => {
      // El registro de errores real guarda en localStorage; aqui basta con
      // enterarse de que se ha llamado.
      window.addEventListener("DOMContentLoaded", () => {
        const original = window.tfApuntar;
        window.tfApuntar = (tipo, msg, detalle) => {
          window.__apunte(tipo, msg);
          if (original) original(tipo, msg, detalle);
        };
      });
    });

    await page.goto("/index.html");
    await expect(page.locator(".ticket")).toBeVisible();

    // Ninguno de los enlaces de la plancha apunta a javascript: ni a data:.
    const hrefs = await page.locator(".ticket a").evaluateAll((as) =>
      as.map((a) => a.getAttribute("href"))
    );
    expect(hrefs.length).toBeGreaterThan(0);
    for (const h of hrefs) {
      expect(h).not.toMatch(/^\s*(javascript|data):/i);
    }
    // El envenenado se queda en "#": enlace que no lleva a ninguna parte.
    expect(hrefs).toContain("#");

    // Y ha quedado dicho en el registro.
    await expect.poll(() => apuntes.filter((a) => a.startsWith("url:")).length).toBeGreaterThan(0);
  });

  test("los enlaces normales siguen funcionando, con path y con query", async ({ page }) => {
    await page.route("**/offers.json*", (r) =>
      r.fulfill({ path: require.resolve("./datos/offers-envenenado.json") })
    );
    await page.goto("/index.html");
    // La segunda oferta lleva una URL de Wizz con path y query: tiene que
    // llegar entera al href, sin recortes ni escapes de mas.
    const fila = page.locator(".brow").first();
    await fila.click();
    const href = await fila.locator('a[href*="wizzair.com"]').first().getAttribute("href");
    expect(href).toBe(
      "https://wizzair.com/es-es/booking/select-flight/MAD/BGY/2027-01-08?adults=1"
    );
  });
});

test.describe("los diálogos", () => {
  /* Los tres criterios de la #23, en los dos diálogos que tiene la web
     pública. Un diálogo que deja escapar el foco no es un diálogo: con teclado
     te sales sin enterarte y sigues tabulando por la página de detrás. */

  const DIALOGOS = [
    {
      nombre: "la hoja de alojamiento",
      pagina: "/index.html",
      abrir: async (page) => {
        await page.locator("[data-stay]").first().click();
        return page.locator("[data-stay]").first();
      },
      caja: "#panel",
    },
    {
      nombre: "el selector de destinos",
      pagina: "/buscar.html",
      abrir: async (page) => {
        await page.evaluate(() =>
          document.querySelectorAll("#finderForm [disabled]").forEach((e) => (e.disabled = false))
        );
        await page.selectOption("#fWhere", "one");
        await page.click("#destBtn");
        return page.locator("#destBtn");
      },
      caja: "#destModal",
    },
  ];

  for (const d of DIALOGOS) {
    test(`${d.nombre}: el foco no se escapa al fondo`, async ({ page }) => {
      await page.goto(d.pagina);
      await d.abrir(page);
      await expect(page.locator(d.caja)).toBeVisible();

      // Se tabula mas veces de las que hay cosas dentro: si el foco se
      // escapara, en alguna vuelta acabaria fuera de la caja.
      for (let i = 0; i < 25; i++) {
        await page.keyboard.press("Tab");
        const dentro = await page.evaluate(
          (sel) => document.querySelector(sel).contains(document.activeElement),
          d.caja
        );
        expect(dentro, `tras ${i + 1} tabuladores el foco se fue fuera`).toBe(true);
      }
    });

    test(`${d.nombre}: Escape cierra y el foco vuelve a quien abrió`, async ({ page }) => {
      await page.goto(d.pagina);
      const abridor = await d.abrir(page);
      await expect(page.locator(d.caja)).toBeVisible();

      await page.keyboard.press("Escape");
      await expect(page.locator(d.caja)).toBeHidden();
      await expect(abridor).toBeFocused();
    });

    test(`${d.nombre}: el fondo queda inerte mientras está abierto`, async ({ page }) => {
      await page.goto(d.pagina);
      await d.abrir(page);
      await expect(page.locator(d.caja)).toBeVisible();
      // La cabecera es fondo: mientras hay diálogo, ni se tabula ni se lee.
      await expect(page.locator("header.masthead")).toHaveAttribute("inert", "");
      await page.keyboard.press("Escape");
      await expect(page.locator("header.masthead")).not.toHaveAttribute("inert", "");
    });
  }

  test("el de entrar (el mismo que usa el panel) también atrapa el foco", async ({ page }) => {
    await page.goto("/buscar.html");
    // El aviso del candado trae su propio boton de entrar.
    const abridor = page.locator("[data-entrar]").first();
    await abridor.click();
    const caja = page.locator("#tfModal .modal-caja");
    await expect(caja).toBeVisible();
    await expect(caja).toHaveAttribute("aria-modal", "true");

    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      const dentro = await page.evaluate(() =>
        document.querySelector("#tfModal").contains(document.activeElement)
      );
      expect(dentro, `tras ${i + 1} tabuladores el foco se fue fuera`).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(page.locator("#tfModal")).toBeHidden();
    await expect(abridor).toBeFocused();
  });

  test("el diálogo se anuncia como tal", async ({ page }) => {
    await page.goto("/index.html");
    await page.locator("[data-stay]").first().click();
    const panel = page.locator("#panel");
    await expect(panel).toHaveAttribute("role", "dialog");
    await expect(panel).toHaveAttribute("aria-modal", "true");
  });
});

test.describe("lo que está pasando se dice", () => {
  /* Las esperas aquí son largas: el alojamiento hace polling durante quince
     minutos. Quien no ve la pantalla necesita enterarse de que hay algo en
     marcha Y de cuándo ha terminado. */

  const conSesion = async (page) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("tf_sesion", JSON.stringify({ uid: "u-prueba", user: "p", name: "P" }));
        localStorage.setItem("tf_token", "ghp_de_mentira");
      } catch (e) { /* nada */ }
    });
    await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 204, body: "" }));
  };

  test("hay una región donde se anuncia, fuera de la vista pero no del lector", async ({ page }) => {
    await page.goto("/index.html");
    const region = page.locator("#tfAnuncios");
    await expect(region).toHaveAttribute("aria-live", "polite");
    await expect(region).toHaveAttribute("role", "status");
    // Escondida a la vista, pero NO con display:none: eso la escondería
    // también del lector, que es justo a quien va dirigida.
    const como = await region.evaluate((el) => {
      const c = getComputedStyle(el);
      return { display: c.display, visibility: c.visibility, ancho: el.getBoundingClientRect().width };
    });
    expect(como.display).not.toBe("none");
    expect(como.visibility).not.toBe("hidden");
    expect(como.ancho).toBeLessThan(3);
  });

  test("el alojamiento anuncia que empieza y que termina, y no se repite", async ({ page }) => {
    await conSesion(page);

    // El fichero de resultados no existe hasta la tercera vuelta del polling:
    // así se pasa por varias vueltas de verdad y se ve si repite.
    let vueltas = 0;
    await page.route("**/data/stays/*.json*", async (route) => {
      vueltas += 1;
      if (vueltas < 3) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          generated_at: "2026-09-02T11:00:00",
          stays: [
            { name: "Un sitio", provider: "airbnb", url: "https://example.com/a", price_total: 120 },
            { name: "Otro sitio", provider: "booking", url: "https://example.com/b", price_total: 140 },
          ],
        }),
      });
    });

    // Se apuntan TODOS los anuncios, no solo el último.
    const dichos = [];
    await page.exposeFunction("__dicho", (t) => dichos.push(t));
    await page.addInitScript(() => {
      window.addEventListener("DOMContentLoaded", () => {
        const obs = new MutationObserver(() => {
          const r = document.getElementById("tfAnuncios");
          if (r && r.textContent.trim()) window.__dicho(r.textContent.trim());
        });
        obs.observe(document.body, { childList: true, subtree: true, characterData: true });
      });
    });

    // El polling va cada 20 s de verdad: con el reloj falso no hay que
    // esperarse el minuto que tardarian tres vueltas.
    await page.clock.install();
    await page.goto("/index.html");
    await page.locator("[data-stay]").first().click();
    await page.locator("#launch").click();
    for (let i = 0; i < 3; i++) {
      await page.clock.runFor(21_000);
      await page.waitForTimeout(120);
    }

    await expect.poll(() => dichos.join(" | "), { timeout: 10_000 }).toMatch(/terminada/i);

    // Empieza y termina, las dos cosas.
    expect(dichos.some((d) => /buscando alojamiento/i.test(d))).toBe(true);
    expect(dichos.some((d) => /terminada.*2 alojamientos/i.test(d))).toBe(true);

    // Y el criterio que de verdad cuesta: nada dicho dos veces seguidas,
    // aunque el polling haya dado varias vueltas.
    expect(vueltas).toBeGreaterThanOrEqual(3);
    const unicos = new Set(dichos);
    expect(unicos.size).toBe(dichos.length);
  });
});

/* Nueve controles antes del primer vuelo dejaban el feed fuera de pantalla en
   un móvil. Arriba se quedan dos y el resto vive en una hoja que sube desde
   abajo — que es el MISMO `.controls` de escritorio, no un segundo formulario
   que haya que mantener en sintonía. Esto es lo que prueba que sigue siendo
   uno solo: lo que se toca en la hoja filtra el feed de verdad. */
test.describe("los filtros en un móvil", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("arriba solo hay buscador y «Filtros»; el resto está en la hoja", async ({ page }) => {
    await page.goto("/index.html");
    await expect(page.locator(".filtros-movil")).toBeVisible();
    await expect(page.locator("#qm")).toBeVisible();
    await expect(page.locator("#filtrosBtn")).toHaveText("Filtros");
    // La hoja existe, pero cerrada.
    await expect(page.locator("#filtrosHoja")).not.toBeVisible();
    // Y el campo de destino de dentro no se repite: ya está en la barra.
    await expect(page.locator("#q")).not.toBeVisible();
  });

  test("el buscador de la barra filtra igual que el de la hoja", async ({ page }) => {
    await page.goto("/index.html");
    await expect(page.locator(".brow").first()).toBeVisible();
    await page.fill("#qm", "zzzz");
    await expect(page.locator("#empty")).toBeVisible();
    expect(await page.inputValue("#q")).toBe("zzzz");
  });

  test("la hoja se abre, filtra y dice cuántas quedan", async ({ page }) => {
    await page.goto("/index.html");
    await expect(page.locator(".brow").first()).toBeVisible();
    await page.click("#filtrosBtn");
    await expect(page.locator("#filtrosHoja")).toBeVisible();
    await expect(page.locator("#filtrosFondo")).toBeVisible();
    await expect(page.locator("#filtrosBtn")).toHaveAttribute("aria-expanded", "true");

    // El `select` de ordenar se pulsa como fichas; el `select` sigue mandando.
    await page.locator(".hoja-chips button", { hasText: "Precio" }).first().click();
    expect(await page.inputValue("#sort")).toBe("price");
    await expect(page.locator("#filtrosBtn")).toHaveText("Filtros · 1");
    await expect(page.locator("#filtrosVer")).toContainText(/^Ver \d+ oferta/);

    await page.click("#filtrosVer");
    await expect(page.locator("#filtrosHoja")).not.toBeVisible();
    await expect(page.locator("#filtrosFondo")).not.toBeVisible();
  });

  test("«limpiar» deja los filtros como estaban al entrar", async ({ page }) => {
    await page.goto("/index.html");
    await expect(page.locator(".brow").first()).toBeVisible();
    await page.click("#filtrosBtn");
    await page.locator(".hoja-chips button", { hasText: "Fecha" }).first().click();
    await page.locator(".switch", { hasText: "Solo findes" }).click();
    await expect(page.locator("#filtrosBtn")).toHaveText("Filtros · 2");
    await page.click("#filtrosLimpiar");
    await expect(page.locator("#filtrosBtn")).toHaveText("Filtros");
    expect(await page.inputValue("#sort")).toBe("score");
    expect(await page.isChecked("#onlyWeekend")).toBe(false);
  });

  test("«escape» cierra la hoja", async ({ page }) => {
    await page.goto("/index.html");
    await expect(page.locator(".brow").first()).toBeVisible();
    await page.click("#filtrosBtn");
    await expect(page.locator("#filtrosHoja")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#filtrosHoja")).not.toBeVisible();
  });
});

test.describe("se acierta con el dedo", () => {
  /* El criterio de la #25: los botones pequeños se aciertan a la primera en un
     móvil de 320 px. Se mide con elementFromPoint, que es lo que decide de
     verdad dónde cae un dedo. El botón de seguir ya no es un cuadratín: en
     móvil es una píldora con su palabra, y el `::after` le sigue dando los
     44 px de acierto a los que son pequeños (el de la lámina, por ejemplo). */

  /* `reducedMotion` no es un atajo: el CSS lo respeta y apaga las animaciones,
     asi que la caja que se mide es la definitiva. Sin esto se medía el panel
     a mitad del deslizamiento de entrada y el toque caía donde ya no estaba.
     De paso queda probado que ese camino funciona. */
  test.use({ viewport: { width: 320, height: 640 }, hasTouch: true, reducedMotion: "reduce" });

  /* La caja del elemento cuando ha dejado de moverse. Los diálogos entran
     deslizándose y las filas con un fundido: medir a mitad de camino daba
     coordenadas de donde el botón ya no está. Se lee dos veces seguidas y se
     espera a que coincidan, que es inmune a cómo estén configuradas las
     animaciones —y por tanto no se rompe si alguien cambia una duración. */
  async function cajaQuieta(locator) {
    const leer = () =>
      locator.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, width: r.width, height: r.height };
      });
    let previa = await leer();
    for (let i = 0; i < 40; i++) {
      await new Promise((s) => setTimeout(s, 50));
      const ahora = await leer();
      if (ahora.x === previa.x && ahora.y === previa.y && ahora.width === previa.width) return ahora;
      previa = ahora;
    }
    return previa;
  }

  /* Dónde cae un dedo lo decide `elementFromPoint`, no el rectángulo. */
  const quienHayEn = (page, x, y, sel) =>
    page.evaluate(
      ([px, py, s]) => {
        const el = document.elementFromPoint(px, py);
        return { ok: !!(el && el.closest(s)), el: el ? el.id || el.className || el.tagName : "nada" };
      },
      [x, y, sel]
    );

  test("el botón de seguir tiene 44 px de acierto", async ({ page }) => {
    await page.goto("/index.html");
    const fav = page.locator(".brow .fav").first();
    await expect(fav).toBeVisible();
    await fav.scrollIntoViewIfNeeded();
    // En móvil dice lo que hace: sin la palabra nadie sabía para qué servía.
    await expect(fav.locator(".fav-txt")).toHaveText("Seguir");
    const caja = await cajaQuieta(fav);
    expect(caja.height).toBeGreaterThanOrEqual(32);

    // Pero un toque a 20 px del centro, dentro de los 44, lo acierta.
    const cx = caja.x + caja.width / 2;
    const cy = caja.y + caja.height / 2;
    for (const [dx, dy] of [[0, 0], [-18, 0], [18, 0], [0, -18], [0, 18]]) {
      const r = await quienHayEn(page, cx + dx, cy + dy, ".fav");
      expect(r.ok, `un toque a (${dx}, ${dy}) del centro cae en: ${r.el}`).toBe(true);
    }
  });

  test("quitar y cerrar también", async ({ page }) => {
    await page.goto("/index.html");
    await page.locator("[data-stay]").first().click();
    const cerrar = page.locator("#panelClose");
    await expect(cerrar).toBeVisible();

    const caja = await cajaQuieta(cerrar);
    const cx = caja.x + caja.width / 2;
    const cy = caja.y + caja.height / 2;
    // Arriba y abajo del centro, dentro de los 44 px de alto.
    for (const dy of [-18, 0, 18]) {
      const r = await quienHayEn(page, cx, cy + dy, "#panelClose");
      expect(r.ok, `un toque a ${dy}px del centro cae en: ${r.el}`).toBe(true);
    }
  });

  test("y se pulsa de verdad, no solo se toca el sitio", async ({ page }) => {
    // Con sesión, porque sin ella el cuadratín abre el login a propósito: un
    // viaje apuntado es de alguien. Aquí lo que se comprueba es que el toque
    // descentrado llega al botón y dispara su acción de verdad.
    await page.addInitScript(() => {
      try {
        localStorage.setItem("tf_sesion", JSON.stringify({ uid: "u-prueba", user: "p", name: "P" }));
      } catch (e) { /* nada */ }
    });
    await page.goto("/index.html");

    const fav = page.locator(".brow .fav").first();
    await expect(fav).toHaveAttribute("aria-pressed", "false");
    await fav.scrollIntoViewIfNeeded();
    const caja = await cajaQuieta(fav);

    // 16 px por debajo del centro: fuera del dibujo de 22 px, dentro de los 44.
    await page.touchscreen.tap(caja.x + caja.width / 2, caja.y + caja.height / 2 + 16);
    await expect(fav).toHaveAttribute("aria-pressed", "true");
  });

  test("sin sesión, ese mismo toque abre el login (que es lo que toca)", async ({ page }) => {
    await page.goto("/index.html");
    const fav = page.locator(".brow .fav").first();
    await fav.scrollIntoViewIfNeeded();
    const caja = await cajaQuieta(fav);
    await page.touchscreen.tap(caja.x + caja.width / 2, caja.y + caja.height / 2 + 16);
    // El toque llegó al botón: un viaje apuntado es de alguien.
    await expect(page.locator("#tfModal")).toBeVisible();
  });
});

test.describe("lo que pide la portada", () => {
  /* La #19: cargar `airports_world.json` entero (270 KB) para sacar el
     continente de cada destino era casi medio mega de JSON, con `offers.json`
     al lado, para pintar 120 filas. */

  test("no pide el listado mundial de aeropuertos", async ({ page }) => {
    const pedidos = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.pathname.endsWith(".json")) pedidos.push(u.pathname.split("/").pop());
    });
    await page.goto("/index.html");
    await expect(page.locator(".ticket")).toBeVisible();
    await expect(page.locator("#cont option")).not.toHaveCount(1); // ya se pintó el filtro

    expect(pedidos).not.toContain("airports_world.json");
    expect(pedidos).toContain("continentes.json");
  });

  test("el filtro de continente sigue igual, con lo de largo radio incluido", async ({ page }) => {
    await page.goto("/index.html");
    await expect(page.locator(".ticket")).toBeVisible();

    // Los continentes que hay entre los destinos, y nada más.
    const opciones = await page.locator("#cont option").allTextContents();
    expect(opciones).toContain("Todos");
    expect(opciones).toContain("Europa");
    // Ningún destino del fixture es de Asia, así que no debe salir.
    expect(opciones).not.toContain("Asia");

    // Y filtra de verdad.
    const antes = await page.locator(".brow").count();
    await page.selectOption("#cont", "Europa");
    await expect(page.locator(".brow")).toHaveCount(antes);
    await expect(page.locator(".ticket")).toBeVisible();
  });

  test("el selector de destinos sí carga el listado entero, al abrirlo", async ({ page }) => {
    const pedidos = [];
    page.on("request", (r) => pedidos.push(new URL(r.url()).pathname));
    await page.goto("/buscar.html");
    await page.evaluate(() =>
      document.querySelectorAll("#finderForm [disabled]").forEach((e) => (e.disabled = false))
    );
    // Antes de abrirlo, no.
    expect(pedidos.some((p) => p.endsWith("airports_world.json"))).toBe(false);

    await page.selectOption("#fWhere", "one");
    await page.click("#destBtn");
    await expect(page.locator("#destList .ciudad").first()).toBeVisible();
    // Al abrirlo, sí: ahí hacen falta ciudad y país.
    expect(pedidos.some((p) => p.endsWith("airports_world.json"))).toBe(true);
  });
});

test.describe("las cuentas que se publican", () => {
  /* La #14: `data/users.json` llevaba el email en claro de cada cuenta y
     `pages.yml` lo copiaba tal cual al sitio. Lo que sube ahora va recortado;
     esto comprueba que con ese fichero la web sigue funcionando igual. */

  const RECORTADO = {
    updated: "2026-09-02T10:00:00+00:00",
    admin: { salt: "c2FsdA==", hash: "aGFzaA==", iterations: 210000, sobre: {} },
    site: { token: { iv: "aXY=", data: "ZGF0YQ==" } },
    users: [
      {
        id: "u-e77f874b", user: "mateo", name: "Mateo",
        salt: "c2FsdA==", hash: "aGFzaA==", iterations: 210000,
        active: true, sobre: { iv: "aXY=", data: "ZGF0YQ==" },
        prefs: { chollos: "cada_vez" },
        tiene_email: true,
      },
    ],
  };

  test("el fichero publicado no lleva ninguna dirección", async () => {
    expect(JSON.stringify(RECORTADO)).not.toContain("@");
  });

  test("con el recortado, el modal no le dice a nadie que no tiene correo", async ({ page }) => {
    await page.route("**/users.json*", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(RECORTADO) })
    );
    await page.addInitScript(() => {
      try {
        localStorage.setItem(
          "tf_sesion",
          JSON.stringify({ uid: "u-e77f874b", user: "mateo", name: "Mateo" })
        );
      } catch (e) { /* nada */ }
    });
    await page.goto("/index.html");
    await page.locator("#tfCuenta, .cuenta").first().click();

    const email = page.locator("#tfEmail");
    await expect(email).toBeVisible();
    // Vacío, porque la dirección ya no viaja...
    await expect(email).toHaveValue("");
    // ...pero diciendo la verdad: que hay una guardada.
    await expect(email).toHaveAttribute("placeholder", /ya tienes guardado/i);
    await expect(page.locator("#tfPrefsForm")).toContainText(/déjalo en blanco para no cambiarlo/i);
  });

  test("y a quien no tiene, se lo dice", async ({ page }) => {
    const sin = JSON.parse(JSON.stringify(RECORTADO));
    sin.users[0].tiene_email = false;
    await page.route("**/users.json*", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sin) })
    );
    await page.addInitScript(() => {
      try {
        localStorage.setItem(
          "tf_sesion",
          JSON.stringify({ uid: "u-e77f874b", user: "mateo", name: "Mateo" })
        );
      } catch (e) { /* nada */ }
    });
    await page.goto("/index.html");
    await page.locator("#tfCuenta, .cuenta").first().click();
    await expect(page.locator("#tfEmail")).toHaveAttribute("placeholder", /no recibes nada/i);
  });
});

test.describe("la escapada completa", () => {
  /* La #29: el vuelo es por persona y la cama es para el grupo. Sumarlos bien
     da el único número que decide un viaje, y hasta ahora sólo salía después
     de pedir alojamiento, que son varios minutos. */

  test("sale en el tablón sin abrir el panel de alojamiento", async ({ page }) => {
    await page.goto("/index.html");
    // MAN es la plancha del día: 55.98 de vuelo + 2 noches a 55 (por país).
    const plancha = page.locator(".ticket .escapada");
    await expect(plancha).toBeVisible();
    await expect(plancha).toHaveText(/escapada ≈ 166 €/);
    // El panel de alojamiento sigue cerrado.
    await expect(page.locator("#panel")).toBeHidden();
  });

  test("se ve que es una estimación, no un precio consultado", async ({ page }) => {
    await page.goto("/index.html");
    const e = page.locator(".ticket .escapada");
    await expect(e).toHaveText(/≈/);
    await expect(e).not.toHaveClass(/real/);
    await expect(e).toHaveAttribute("title", /estimación/i);
    // Y dice de dónde sale el número.
    await expect(e).toHaveAttribute("title", /costó dormir/i);
  });

  test("donde no hay dato de camas, no se inventa un número", async ({ page }) => {
    await page.goto("/index.html");
    // ACE (España) no está ni en destinos ni en países del fixture.
    const fila = page.locator(".brow", { has: page.locator(".iata", { hasText: "ACE" }) });
    await expect(fila).toBeVisible();
    await expect(fila.locator(".escapada")).toHaveCount(0);
    // Pero BGY sí, con su propio dato de destino: 59.98 + 2 × 72 = 204.
    const bgy = page.locator(".brow", { has: page.locator(".iata", { hasText: "BGY" }) });
    await expect(bgy.locator(".escapada")).toHaveText(/escapada ≈ 204 €/);
  });

  test("al pedir alojamiento de verdad, el número real la sustituye", async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("tf_sesion", JSON.stringify({ uid: "u-p", user: "p", name: "P" }));
        localStorage.setItem("tf_token", "ghp_de_mentira");
      } catch (e) { /* nada */ }
    });
    await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 204, body: "" }));
    // Como pasa de verdad: al abrir el panel todavía no hay nada, se lanza la
    // búsqueda, y el fichero aparece en una vuelta del polling.
    let lanzada = false;
    await page.route("**/data/stays/*.json*", (r) => {
      if (!lanzada) return r.fulfill({ status: 404, body: "" });
      return r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          offer_id: "ryanair-MAD-MAN-20261113",
          generated_at: "2026-09-02T11:00:00",
          summary: { party: 1, flights: 55.98, stay: 90, total: 145.98, per_person: 145.98 },
          stays: [{ name: "Una cama", provider: "airbnb", url: "https://example.com/a", price_total: 90 }],
        }),
      });
    });

    await page.goto("/index.html");
    await expect(page.locator(".ticket .escapada")).toHaveText(/≈ 166 €/);

    await page.clock.install();
    await page.locator("[data-stay]").first().click();
    await page.locator("#launch").click();
    lanzada = true;
    // El polling no arranca hasta que el dispatch resuelve. Sin esperar a que
    // el panel diga "Buscando…", adelantar el reloj aquí es una carrera: unas
    // veces llega antes que el `setInterval` y la prueba parpadea.
    await expect(page.locator("#panelBody")).toContainText(/buscando/i);
    await expect
      .poll(async () => {
        await page.clock.runFor(21_000);
        return page.locator(".ticket .escapada.real").count();
      })
      .toBe(1);

    const e = page.locator(".ticket .escapada");
    await expect(e).toHaveClass(/real/);
    await expect(e).toHaveText(/escapada 146 €/);
    await expect(e).not.toHaveText(/≈/);
  });
});

/* Las zonas que hasta ahora no tocaba ninguna prueba: el calendario, el
   selector de destinos y "En observación". Se escriben ANTES de partir
   `app.js` en módulos (#30): un refactor mecánico de 2.100 líneas necesita
   algo debajo que diga si se cayó algo por el camino. */

/* Cambiarse la contraseña sin pedirle nada a nadie (antes solo se podía desde
   el panel). Lo delicado no es el hash: es el SOBRE, que va cifrado con la
   contraseña vieja y hay que rehacerlo con la nueva en el mismo gesto. Si se
   mandara la credencial sin el sobre, la cuenta entraría en la web y luego no
   podría lanzar nada — que es exactamente el fallo que esto tiene que impedir. */
test.describe("cambiarse la contraseña desde la cuenta", () => {
  const VIEJA = "laquetengo7";
  const NUEVA = "laquequiero8";

  /* La ficha se fabrica EN EL NAVEGADOR con las mismas funciones que usa la
     web, así que el sobre se abre de verdad con `VIEJA`. Un sobre inventado a
     mano no se abriría y la prueba pasaría por el camino equivocado. */
  const montar = async (page, { conSobre = true } = {}) => {
    await page.addInitScript(() => {
      window.__enviados = [];
      try {
        localStorage.setItem(
          "tf_sesion",
          JSON.stringify({ uid: "u-1", user: "mateo", name: "Mateo" })
        );
        sessionStorage.setItem("tf_token_abierto", "ghp_de_mentira");
      } catch (e) { /* nada */ }
    });
    await page.route("**/api.github.com/repos/**/dispatches", async (route) => {
      const cuerpo = route.request().postData() || "{}";
      await route.fulfill({ status: 204, body: "" });
      await page.evaluate((c) => window.__enviados.push(JSON.parse(c)), cuerpo);
    });

    // Primero una página cualquiera, solo para tener `auth.js` cargado y poder
    // fabricar la ficha con sus propias funciones.
    await page.goto("/index.html");
    const ficha = await page.evaluate(async ([clave, conSobre]) => {
      const cred = await tfHash(clave);
      const maestra = "bWFlc3RyYXMtZGUtbWVudGlyYS0zMi1ieXRlcy0h";
      const sobre = conSobre ? await tfHacerSobre(clave, maestra) : null;
      return { ...cred, sobre, maestra };
    }, [VIEJA, conSobre]);

    const usuarios = {
      users: [
        {
          id: "u-1",
          user: "mateo",
          name: "Mateo",
          active: true,
          tiene_email: true,
          prefs: {},
          salt: ficha.salt,
          hash: ficha.hash,
          iterations: ficha.iterations,
          ...(ficha.sobre ? { sobre: ficha.sobre } : {}),
        },
      ],
      site: { token: { iv: "x", data: "y" } },
    };
    await page.route("**/users.json*", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(usuarios) })
    );
    await page.goto("/index.html");
    await page.locator("#tfCuenta, .cuenta").first().click();
    await expect(page.locator("#tfPrefsForm")).toBeVisible();
    return ficha;
  };

  test("manda credencial Y sobre nuevos, y el sobre se abre con la nueva", async ({ page }) => {
    const ficha = await montar(page);
    await page.fill("#tfClaveVieja", VIEJA);
    await page.fill("#tfClaveNueva", NUEVA);
    await page.fill("#tfClaveRepe", NUEVA);
    await page.click("#tfClaveForm button[type=submit]");
    await expect(page.locator("#tfClaveMsg")).toContainText(/cambiada/i, { timeout: 15000 });

    const enviados = await page.evaluate(() => window.__enviados);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].event_type).toBe("user_passwd");
    const p = enviados[0].client_payload;
    expect(p.user).toBe("mateo");
    expect(p.salt).toBeTruthy();
    expect(p.hash).toBeTruthy();
    // El sobre viaja SIEMPRE con la credencial: es la mitad que se olvidaba.
    expect(p.sobre && p.sobre.data).toBeTruthy();
    expect(p.hash).not.toBe(ficha.hash);
    expect(p.sobre.salt).not.toBe(ficha.sobre.salt);

    // Y lo que llega abre la misma clave maestra, con la contraseña nueva.
    const abierto = await page.evaluate(
      ([clave, sobre]) => tfAbrirSobre(clave, sobre),
      [NUEVA, p.sobre]
    );
    expect(abierto).toBe(ficha.maestra);
    // Con la vieja ya no.
    const conVieja = await page.evaluate(
      ([clave, sobre]) => tfAbrirSobre(clave, sobre),
      [VIEJA, p.sobre]
    );
    expect(conVieja).toBe("");
  });

  test("si la de ahora no es esa, no manda nada", async ({ page }) => {
    await montar(page);
    await page.fill("#tfClaveVieja", "meloinvento1");
    await page.fill("#tfClaveNueva", NUEVA);
    await page.fill("#tfClaveRepe", NUEVA);
    await page.click("#tfClaveForm button[type=submit]");
    await expect(page.locator("#tfClaveMsg")).toContainText(/no es esa/i, { timeout: 15000 });
    expect(await page.evaluate(() => window.__enviados)).toHaveLength(0);
  });

  test("las dos nuevas tienen que coincidir, y medir ocho", async ({ page }) => {
    await montar(page);
    await page.fill("#tfClaveVieja", VIEJA);
    await page.fill("#tfClaveNueva", "corta1");
    await page.fill("#tfClaveRepe", "corta1");
    await page.click("#tfClaveForm button[type=submit]");
    await expect(page.locator("#tfClaveMsg")).toContainText(/8 caracteres/i);

    await page.fill("#tfClaveNueva", NUEVA);
    await page.fill("#tfClaveRepe", NUEVA + "x");
    await page.click("#tfClaveForm button[type=submit]");
    await expect(page.locator("#tfClaveMsg")).toContainText(/no coinciden/i);
    expect(await page.evaluate(() => window.__enviados)).toHaveLength(0);
  });

  /* Sin sobre no hay clave maestra que volver a cerrar. Cambiar solo la
     contraseña dejaría la cuenta entrando pero sin poder lanzar nada, así que
     ni se ofrece: se manda al panel. */
  test("sin sobre no se ofrece, y se dice por qué", async ({ page }) => {
    await montar(page, { conSobre: false });
    await expect(page.locator("#tfClaveForm")).toContainText(/tiene que hacerlo el administrador/i);
    await expect(page.locator("#tfClaveVieja")).toHaveCount(0);
  });
});

/* EL PANEL EN UN MÓVIL.

   El panel reusa dos clases del feed —`.controls` para su fila de botones y
   `.brow` para sus filas de cuenta—, y el rediseño de móvil convirtió la
   primera en una hoja que sube desde abajo (`display:none` hasta que se abre)
   y le dio a la segunda la maqueta de una fila de vuelo. Resultado: en
   cualquier móvil el panel se quedaba SIN «crear cuenta», sin «cambiar la
   contraseña del panel» y sin «cerrar», y las filas de cuenta salían
   descolocadas. Esto es lo que impide que vuelva a pasar. */
test.describe("el panel de administración en un móvil", () => {
  const CLAVE = "unaclavelarga1";

  async function panelAbierto(page, enviados) {
    await page.route("**/api.github.com/repos/**/dispatches", (r) => {
      enviados.push(JSON.parse(r.request().postData() || "{}"));
      return r.fulfill({ status: 204, body: "" });
    });
    await page.addInitScript(() => {
      try { localStorage.setItem("tf_token", "ghp_de_mentira"); } catch (e) { /* nada */ }
    });
    // Primera pasada solo para tener `auth.js` y fabricar la ficha con sus
    // propias funciones: un sobre inventado a mano no se abriría.
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    const d = await page.evaluate(async (clave) => {
      const maestra = "bWFlc3RyYS1kZS1tZW50aXJhLTMyLWJ5dGVzLWFxdWk=";
      return { cred: await tfHash(clave), sobre: await tfHacerSobre(clave, maestra) };
    }, CLAVE);
    const users = {
      admin: { ...d.cred, sobre: d.sobre },
      site: { token: { iv: "x", data: "y" } },
      users: [{ id: "u-1", user: "mateo", name: "Mateo", active: true, tiene_email: true,
                prefs: {}, ...d.cred, sobre: d.sobre }],
      watches: [], searches: [],
    };
    await page.route("**/users.json*", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(users) })
    );
    await page.route("**/watch.json*", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: '{"watches":[]}' })
    );
    await page.route("**/searches/index.json*", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: '{"searches":[]}' })
    );
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await page.fill("#pass", CLAVE);
    await page.click("#puertaBtn");
    await expect(page.locator("#panelAdmin")).toBeVisible({ timeout: 25000 });
  }

  for (const [nombre, ancho] of [["a 390 px", 390], ["a 1280 px", 1280]]) {
    test(`los botones del panel se ven ${nombre}`, async ({ page }) => {
      await page.setViewportSize({ width: ancho, height: 900 });
      await panelAbierto(page, []);
      for (const id of ["#nuevaCuenta", "#cambiarAdmin", "#recargar", "#cerrar"]) {
        await expect(page.locator(id), `${id} ${nombre}`).toBeVisible();
      }
    });
  }

  /* La fila de cuenta reusa `.brow`, así que hereda la maqueta de móvil del
     feed —pensada para destino, precio, fechas y compañía— por orden en la
     hoja. Aquí no se cayó nada, pero la fila quedaba a merced de un cambio en
     el feed: esto le da su propia maqueta y la fija. */
  test("la fila de una cuenta tiene su propia maqueta, no la del feed", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await panelAbierto(page, []);
    const fila = page.locator(".cuenta-row").first();
    await expect(fila).toBeVisible();
    const sitios = await fila.evaluate((el) => {
      const caja = (s) => {
        const n = el.querySelector(s);
        if (!n) return null;
        const r = n.getBoundingClientRect();
        return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width) };
      };
      return { sello: caja(".iata"), nombre: caja(".dest-cell"), botones: caja(".favacc") };
    });
    // Nombre a la izquierda, sello a la derecha, botones debajo y a lo ancho
    // de los dos: con la maqueta del feed se quedaban en la primera columna.
    expect(sitios.nombre.x).toBeLessThan(sitios.sello.x);
    expect(sitios.botones.y).toBeGreaterThan(sitios.nombre.y);
    expect(sitios.botones.w).toBeGreaterThanOrEqual(
      sitios.sello.x + sitios.sello.w - sitios.nombre.x
    );
  });

  /* El botón de cambiar la contraseña del panel, pulsado de verdad: que abra,
     que mande `admin_password` y que mande el sobre con él —sin sobre, el
     token se queda sin llave. */
  test("cambiar la contraseña del panel manda credencial y sobre", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    const enviados = [];
    await panelAbierto(page, enviados);
    await page.click("#cambiarAdmin");
    await page.fill("#aPass", "otraclavelarga2");
    await page.click("#formModal button[type=submit]");
    await expect(page.locator("#modalMsg")).toHaveCount(0, { timeout: 25000 });
    expect(enviados).toHaveLength(1);
    expect(enviados[0].event_type).toBe("admin_password");
    expect(enviados[0].client_payload.hash).toBeTruthy();
    expect(enviados[0].client_payload.sobre.data).toBeTruthy();
  });

  /* EL FALLO QUE NO SE VE. `mandar()` escribe el resultado en `#avisoCuentas`,
     que está arriba del panel y por tanto DEBAJO del velo del modal. Si el
     dispatch falla —sin token, token caducado, 403— el modal se queda con
     «Guardando…» para siempre y la explicación, con su caja para pegar un
     token nuevo, se pinta donde no se ve ni se alcanza. Desde dentro se lee
     como «el botón no hace nada». */
  test("un dispatch fallido se cuenta DENTRO del modal, no detrás", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await panelAbierto(page, []);
    // Sin token no se puede escribir: es el caso más común de los tres.
    await page.evaluate(() => {
      try { localStorage.removeItem("tf_token"); } catch (e) { /* nada */ }
    });
    await page.click("#cambiarAdmin");
    await page.fill("#aPass", "otraclavelarga2");
    await page.click("#formModal button[type=submit]");
    const msg = page.locator("#modalMsg");
    await expect(msg).not.toHaveText(/guardando/i, { timeout: 25000 });
    await expect(msg).toContainText(/token/i);
    // Y la caja para pegar el token está donde se puede usar: dentro.
    await expect(page.locator("#formModal #tokenInput")).toBeVisible();
    await expect(page.locator("#formModal button[type=submit]")).toBeEnabled();
  });

  /* Y la caja tiene que SERVIR: pegar el token ahí y volver a darle sin salir
     del modal. Antes ni se veía; verla y que no funcione sería lo mismo. */
  test("con el token pegado ahí mismo, el segundo intento sale", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const enviados = [];
    await panelAbierto(page, enviados);
    await page.evaluate(() => {
      try { localStorage.removeItem("tf_token"); } catch (e) { /* nada */ }
    });
    await page.click("#cambiarAdmin");
    await page.fill("#aPass", "otraclavelarga2");
    await page.click("#formModal button[type=submit]");
    await expect(page.locator("#formModal #tokenInput")).toBeVisible({ timeout: 25000 });
    expect(enviados).toHaveLength(0);

    await page.fill("#formModal #tokenInput", "ghp_pegado_a_mano");
    await page.click("#formModal #tokenSave");
    await page.click("#formModal button[type=submit]");
    await expect(page.locator("#modalMsg")).toHaveCount(0, { timeout: 25000 });
    expect(enviados.map((e) => e.event_type)).toEqual(["admin_password"]);
  });

  /* Un fallo dentro del formulario tiene que decirse. Antes cualquier
     excepción dejaba "Guardando…" en pantalla para siempre, que se lee como
     "el botón no hace nada". */
  test("si algo revienta, el formulario lo dice en vez de quedarse pensando", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await panelAbierto(page, []);
    await page.evaluate(() => {
      window.tfHacerSobre = () => Promise.reject(new Error("crypto de mentira"));
    });
    await page.click("#cambiarAdmin");
    await page.fill("#aPass", "otraclavelarga2");
    await page.click("#formModal button[type=submit]");
    await expect(page.locator("#modalMsg")).toContainText(/crypto de mentira/i, { timeout: 25000 });
    await expect(page.locator("#formModal button[type=submit]")).toBeEnabled();
  });
});

test.describe("el calendario", () => {
  const abrir = async (page) => {
    await page.goto("/buscar.html");
    await page.evaluate(() =>
      document.querySelectorAll("#finderForm [disabled]").forEach((e) => (e.disabled = false))
    );
    await page.selectOption("#fWhen", "exact");
    await page.click("#dateBtn");
    await expect(page.locator("#cal")).toBeVisible();
  };

  test("pinta meses con sus días", async ({ page }) => {
    await abrir(page);
    await expect(page.locator("#cal .mes").first()).toBeVisible();
    const meses = await page.locator("#cal .mes").count();
    expect(meses).toBeGreaterThanOrEqual(3);
    // Lunes a domingo, en cada mes.
    await expect(page.locator("#cal .mes").first().locator(".semana i")).toHaveCount(7);
    expect(await page.locator("#cal .dia").count()).toBeGreaterThan(80);
  });

  test("elegir dos días deja un rango marcado y lo escribe en el campo", async ({ page }) => {
    await abrir(page);
    const dias = page.locator("#cal .dia:not([disabled])");
    await dias.nth(0).click();
    await dias.nth(6).click();
    await expect(page.locator("#cal .dia.extremo")).toHaveCount(2);
    expect(await page.locator("#cal .dia.dentro").count()).toBeGreaterThan(0);
    await expect(page.locator("#fDepart")).not.toHaveValue("");
    await expect(page.locator("#fReturn")).not.toHaveValue("");
  });

  test("se esconde cuando dejas de pedir fechas exactas", async ({ page }) => {
    await abrir(page);
    await page.selectOption("#fWhen", "weekend");
    await expect(page.locator("#cal")).toBeHidden();
  });
});

test.describe("el selector de destinos", () => {
  const abrir = async (page) => {
    await page.goto("/buscar.html");
    await page.evaluate(() =>
      document.querySelectorAll("#finderForm [disabled]").forEach((e) => (e.disabled = false))
    );
    await page.selectOption("#fWhere", "one");
    await page.click("#destBtn");
    await expect(page.locator("#destList .ciudad").first()).toBeVisible();
  };

  test("agrupa por país y deja elegir el país entero", async ({ page }) => {
    await abrir(page);
    expect(await page.locator("#destList .pais").count()).toBeGreaterThan(1);
    await expect(page.locator("#destList .pais-todo").first()).toBeVisible();
  });

  test("filtra según escribes", async ({ page }) => {
    await abrir(page);
    const antes = await page.locator("#destList .ciudad").count();
    await page.fill("#destSearch", "Bergamo");
    await expect
      .poll(() => page.locator("#destList .ciudad").count())
      .toBeLessThan(antes);
    await expect(page.locator("#destList .ciudad").first()).toContainText(/bergamo/i);
  });

  test("elegir una ciudad la pone en el formulario y cierra", async ({ page }) => {
    await abrir(page);
    await page.fill("#destSearch", "Bergamo");
    await page.locator("#destList .ciudad").first().click();
    await expect(page.locator("#destModal")).toBeHidden();
    await expect(page.locator("#fDest")).toHaveValue(/BGY|Bergamo/i);
    await expect(page.locator("#destBtn")).toContainText(/bergamo/i);
  });
});

test.describe("En observación", () => {
  const conSesion = async (page) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("tf_sesion", JSON.stringify({ uid: "u-p", user: "p", name: "P" }));
        localStorage.setItem("tf_token", "ghp_de_mentira");
        localStorage.setItem(
          "tf_favoritos:u-p",
          JSON.stringify({
            "ryanair-MAD-BGY-20270108": {
              id: "ryanair-MAD-BGY-20270108", origin: "MAD", destination: "BGY",
              destination_name: "Bergamo", destination_country: "Italia",
              depart_date: "2027-01-08", return_date: "2027-01-10", nights: 2,
              airline: "Ryanair", adults: 1, deep_link: "https://example.com",
              desde: 1, precio_inicial: 80, precio_visto: 60, visto_en: "2026-09-02",
              historia: [{ d: "2026-08-28", p: 80 }, { d: "2026-09-02", p: 60 }],
              cambio: null,
            },
          })
        );
      } catch (e) { /* nada */ }
    });
    await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 204, body: "" }));
  };

  test("la lista enseña lo apuntado, con su curva y su diferencia", async ({ page }) => {
    await conSesion(page);
    await page.goto("/seguimientos.html");
    const fila = page.locator(".favrow").first();
    await expect(fila).toBeVisible();
    await expect(fila.locator(".city")).toHaveText("Bergamo");
    await expect(fila.locator(".spark")).toBeVisible();
    await expect(fila.locator(".delta")).toContainText(/−20 €/);
    await expect(page.locator(".watch-head")).toContainText(/vuelos que sigues/i);
  });

  test("quitar uno lo saca de la lista", async ({ page }) => {
    await conSesion(page);
    await page.goto("/seguimientos.html");
    await expect(page.locator(".favrow")).toHaveCount(1);
    await page.locator(".favrow [data-desfav]").click();
    await expect(page.locator(".favrow")).toHaveCount(0);
    await expect(page.locator(".vacio")).toContainText(/dale a seguir/i);
  });

  test("sin nada apuntado, dice qué hacer en vez de quedarse en blanco", async ({ page }) => {
    await page.goto("/seguimientos.html");
    await expect(page.locator("#favoritos")).toContainText(/dale a seguir|cuenta/i);
  });
});

/* Pendiente: el test de destinos ("de seis respuestas a tres propuestas") que
   pedia la issue #32. Todavia no existe —es el trabajo de #6 a #12—, asi que
   no hay nada que comprobar. Cuando se construya, aqui va su prueba. */

test.describe("una cuenta sin sobre", () => {
  /* La #15: `sobre: {}` es la cuenta creada antes de que se guardara el token
     del sitio. Entra, ve la web entera y no puede lanzar nada; hasta ahora eso
     se descubría pulsando un botón que no respondía. */

  // Un PBKDF2-SHA256 de verdad, 210.000 vueltas, para "contrasena-de-prueba":
  // el login lo comprueba de verdad y con un hash inventado no pasaría de ahí.
  const CLAVE = "contrasena-de-prueba";
  const CRED = {
    salt: "c2FsdHNhbHRzYWx0c2FsdA==",
    hash: "+dTM2oibHvvE3dv2WBRYGo12oDapcDgbAGG17J66+58=",
    iterations: 210000,
  };

  const usuarios = (sobre) => ({
    updated: "2026-09-03T10:00:00+00:00",
    admin: { ...CRED, sobre: {} },
    site: { token: { iv: "aXY=", data: "ZGF0YQ==" } },
    users: [
      {
        id: "u-sinsobre", user: "mateo", name: "Mateo", ...CRED,
        active: true, sobre, prefs: {}, tiene_email: true,
      },
    ],
  });

  async function entrar(page, sobre) {
    await page.route("**/users.json*", (r) =>
      r.fulfill({
        status: 200, contentType: "application/json", body: JSON.stringify(usuarios(sobre)),
      })
    );
    await page.goto("/index.html");
    await page.locator("#tfCuenta, .cuenta").first().click();
    await page.fill("#tfLoginUser", "mateo");
    await page.fill("#tfLoginPass", CLAVE);
    await page.click("#tfLoginForm button[type=submit]");
  }

  test("la web lo dice al entrar, no al fallar el primer botón", async ({ page }) => {
    await entrar(page, {});
    const msg = page.locator("#tfLoginMsg");
    await expect(msg).toContainText(/no tiene sobre/i);
    await expect(msg).toContainText(/no lanzar búsquedas ni seguir viajes|no puedes/i);
    // Y dice dónde se arregla, que es la mitad del aviso.
    await expect(msg).toContainText(/panel/i);
  });

  test("un sobre viejo se distingue de no tener sobre", async ({ page }) => {
    await entrar(page, { iv: "aXY=", data: "ZGF0YQ==", stale: true });
    await expect(page.locator("#tfLoginMsg")).toContainText(/de un token anterior/i);
  });

  test("avisar no impide entrar: el botón lo dice y entra", async ({ page }) => {
    await entrar(page, {});
    const boton = page.locator("#tfLoginForm button[type=submit]");
    await expect(boton).toHaveText(/entendido, entrar/i);
    await boton.click();
    await expect(page.locator("#tfLoginForm")).toBeHidden();
    await expect(page.locator("#tfCuenta, .cuenta").first()).toContainText(/mateo/i);
  });

  test("con su sobre en regla no se avisa de nada", async ({ page }) => {
    await entrar(page, { iv: "aXY=", data: "ZGF0YQ==" });
    // El token no llega a abrirse (los datos son de mentira), pero el aviso es
    // otro: el problema es el token del sitio, no la cuenta.
    const msg = page.locator("#tfLoginMsg");
    await expect(msg).toContainText(/token del sitio/i);
    await expect(msg).not.toContainText(/no tiene sobre/i);
  });
});

test.describe("la aplicación instalable", () => {
  /* La #22. Lo que se comprueba no es que funcione sin red: es que no MIENTA
     cuando funciona sin red. Enseñar la tanda de anteayer con el aspecto de la
     de esta mañana es peor que no abrir. */

  // El único sitio donde el worker está encendido (ver playwright.config.js).
  test.use({ serviceWorkers: "allow" });

  const registrado = (page) =>
    page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
      timeout: 15000,
    });

  test("se registra en la portada y no en el panel", async ({ page }) => {
    await page.goto("/index.html");
    await registrado(page);
    const alcance = await page.evaluate(async () => {
      const r = await navigator.serviceWorker.getRegistration();
      return r ? r.scope : "";
    });
    expect(alcance).toContain("/");

    // El panel escribe en el repo con un token: ahí no se instala nada.
    await page.goto("/admin.html");
    expect(await page.locator('link[rel="manifest"]').count()).toBe(0);
  });

  test("el manifiesto se sirve y se lee", async ({ page }) => {
    await page.goto("/index.html");
    const href = await page.locator('link[rel="manifest"]').getAttribute("href");
    const r = await page.request.get(new URL(href, page.url()).toString());
    expect(r.ok()).toBe(true);
    const m = await r.json();
    expect(m.display).toBe("standalone");
    expect(m.icons.length).toBeGreaterThan(1);
  });

  /* `context.setOffline` no vale aquí: corta la red de la PÁGINA, y las
     peticiones de datos las hace el service worker, que se queda con línea. La
     cobertura se corta en el servidor de pruebas, que es donde de verdad se
     nota. */
  const cobertura = (page, si) => page.request.get(`/__corte?on=${si ? 0 : 1}`);

  test("sin cobertura, abre con la última tanda y lo dice", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await registrado(page);
    // Una vuelta más para que el worker, ya controlando, guarde los datos.
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".brow").first()).toBeVisible();

    await cobertura(page, false);
    try {
      await page.goto("/index.html", { waitUntil: "domcontentloaded" });
      // Los datos siguen ahí…
      await expect(page.locator(".brow").first()).toBeVisible();
      // …y el pie no disimula de dónde salen.
      await expect(page.locator("#frescura")).toContainText(/sin conexión/i);
      await expect(page.locator("#frescura")).toHaveClass(/viejo/);
    } finally {
      await cobertura(page, true);
    }
  });

  test("con cobertura gana la red, no la caja", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await registrado(page);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#frescura")).toContainText(/levantamiento/);
    // Con línea nunca se etiqueta como guardado, aunque la copia esté ahí.
    await expect(page.locator("#frescura")).not.toContainText(/sin conexión/i);
    const marca = await page.evaluate(async () => {
      const r = await fetch(`data/offers.json?t=${Date.now()}`, { cache: "no-store" });
      return r.headers.get("X-TF-Cache");
    });
    expect(marca).toBeNull();
  });

  test("y en cuanto vuelve la línea, se deja de avisar", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await registrado(page);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".brow").first()).toBeVisible();

    await cobertura(page, false);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#frescura")).toContainText(/sin conexión/i);

    await cobertura(page, true);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#frescura")).toContainText(/levantamiento/);
  });
});
