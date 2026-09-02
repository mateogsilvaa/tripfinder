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

    // La cabecera de columnas y los puntos guia, que son el gesto del sistema.
    await expect(page.locator("#boardHead")).toBeVisible();
    await expect(page.locator(".brow .leader").first()).toBeAttached();
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
    await expect(form).toHaveClass(/candado/);
    await expect(form.locator(".candado-nota")).toContainText(/hace falta una cuenta/i);
    // Apagados de verdad, no solo con pinta de apagados.
    for (const sel of ["#fWhere", "#fMax", 'button[type="submit"]']) {
      await expect(form.locator(sel)).toBeDisabled();
    }
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
    await expect(page.locator('main a[href="./"]')).toBeVisible();
  });
});

test.describe("el armazón que comparten las páginas", () => {
  for (const [pagina, activa] of [
    ["/index.html", "hoja del día"],
    ["/buscar.html", "trazar un viaje"],
    ["/seguimientos.html", "en observación"],
  ]) {
    test(`${pagina} monta cabecera, zonas y pie`, async ({ page }) => {
      await page.goto(pagina);
      await expect(page.locator(".zona")).toHaveCount(3);
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

/* Pendiente: el test de destinos ("de seis respuestas a tres propuestas") que
   pedia la issue #32. Todavia no existe —es el trabajo de #6 a #12—, asi que
   no hay nada que comprobar. Cuando se construya, aqui va su prueba. */
