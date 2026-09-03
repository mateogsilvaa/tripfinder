/* La portada lleva las dos herramientas en compacto; usarlas de verdad abre la
   herramienta entera. Es la decisión de estructura del rediseño: una sola
   página que se amplía, en vez de tres páginas separadas o de un cajón donde
   no cabe nada. */
const { test, expect } = require("@playwright/test");

/* `waitUntil: "domcontentloaded"` en todas las navegaciones: las tipografías
   son externas y en un entorno sin salida a internet el evento `load` no llega
   nunca. Lo que se prueba aquí es el HTML y el JS, no la descarga de Switzer. */

/* Sin cuenta los formularios salen apagados (es lo correcto: escriben en el
   repo). Para probar el ampliado hace falta una sesión. */
/* Espera a que los módulos hayan enganchado los formularios. Sin esto, un
   `click` que llega antes se traga el envío y la prueba parece rota. */
/* `waitForURL` espera un evento de navegación, y aquí la página destino no
   llega a disparar `load` (las tipografías son externas). Se mira la URL, que
   es lo único que importa. */
async function enPagina(page, fichero) {
  await page.waitForFunction(
    (f) => location.pathname.endsWith(f),
    fichero,
    { timeout: 10000 }
  );
  await page.waitForSelector("#finderForm, #watchForm", { timeout: 10000 });
}

async function listo(page) {
  await page.waitForSelector("#offers .brow", { timeout: 10000 });
}

async function conSesion(page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("tf_sesion", JSON.stringify({ uid: "u-p", user: "p", name: "P" }));
      localStorage.setItem("tf_token", "ghp_de_mentira");
    } catch (e) { /* nada */ }
  });
  await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 204, body: "" }));
}

test.describe("la ventana que se amplía", () => {
  test("las dos herramientas están en la portada, en pequeño", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#buscar #finderForm")).toBeVisible();
    await expect(page.locator("#seguir #watchForm")).toBeVisible();
    // Y el feed está encima: primero se ve lo que hay, luego se pide.
    const orden = await page.evaluate(() => {
      const y = (s) => document.querySelector(s).getBoundingClientRect().top;
      return y("#feed") < y("#buscar") && y("#buscar") < y("#observacion");
    });
    expect(orden).toBe(true);
  });

  test("buscar desde la portada abre la página de buscar con lo escrito", async ({ page }) => {
    await conSesion(page);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await listo(page);
    await page.fill("#fMax", "175");
    await page.fill("#fAdults", "3");
    await page.selectOption("#fWhen", "anytime");
    await page.click('button[form="finderForm"]');

    await enPagina(page, "buscar.html");
    // Y llega con lo que se escribió, no en blanco.
    await expect(page.locator("#fMax")).toHaveValue("175");
    await expect(page.locator("#fAdults")).toHaveValue("3");
    await expect(page.locator("#fWhen")).toHaveValue("anytime");
  });

  test("seguir desde la portada abre la página de seguimientos", async ({ page }) => {
    await conSesion(page);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await listo(page);
    await page.fill("#wMax", "95");
    await page.click('button[form="watchForm"]');
    await enPagina(page, "seguimientos.html");
    await expect(page.locator("#wMax")).toHaveValue("95");
  });

  test("la URL se limpia al llegar: recargar no relanza una búsqueda", async ({ page }) => {
    await conSesion(page);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await listo(page);
    await page.fill("#fMax", "175");
    await page.click('button[form="finderForm"]');
    await enPagina(page, "buscar.html");
    // Un barrido "donde sea" son minutos de scraping: no puede dispararse
    // solo por darle a recargar o al botón de atrás.
    await page.waitForFunction(() => !location.search, null, { timeout: 8000 });
  });

  test("abrir la herramienta a pelo no lanza nada", async ({ page }) => {
    const llamadas = [];
    await page.route("**/api.github.com/**", (r) => {
      llamadas.push(r.request().url());
      return r.fulfill({ status: 204, body: "" });
    });
    await page.goto("/buscar.html", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    expect(llamadas).toHaveLength(0);
  });

  test("en la propia herramienta el botón busca, no navega", async ({ page }) => {
    await page.goto("/buscar.html", { waitUntil: "domcontentloaded" });
    // Sin `data-ampliar`, que es lo que distingue el compacto del completo.
    expect(await page.locator("#finderForm").getAttribute("data-ampliar")).toBeNull();
    expect(await page.locator("#buscar #finderForm").count()).toBe(0);
  });

  test("el nav lleva a las dos anclas de la portada y a la página de seguimientos", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    const hrefs = await page.locator(".zona").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    expect(hrefs).toEqual(["./#feed", "./#buscar", "./#seguir", "seguimientos.html"]);
  });
});

test.describe("el sistema visual", () => {
  /* Tres reglas que el diseño se juega en cada pantalla, y que se rompen solas
     en cuanto alguien añade un bloque sin mirar. */

  test("el naranja marca el precio, no el dato de al lado", async ({ page }) => {
    /* La regla del sistema: `--accent` dice "esto ha bajado". Si además pintara
       la ciudad, la compañía o la fecha, dejaría de querer decir nada. Los
       enlaces sí van en naranja, y eso es deliberado: son lo otro en lo que se
       puede pulsar. */
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#offers .brow", { timeout: 10000 });
    const r = await page.evaluate(() => {
      const raiz = getComputedStyle(document.documentElement);
      const hex = raiz.getPropertyValue("--accent-txt").trim();
      const n = parseInt(hex.slice(1), 16);
      const naranja = `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
      const color = (s) => {
        const el = document.querySelector(s);
        return el ? getComputedStyle(el).color : null;
      };
      return {
        naranja,
        // Lo que SÍ: el descuento de la fila.
        descuento: color(".brow .price .off"),
        // Lo que NO: el dato neutro de alrededor.
        neutros: [".brow .city", ".brow .country", ".brow .airline", ".brow .when",
                  ".brow .price .cifra"].map(color),
      };
    });
    expect(r.descuento).toBe(r.naranja);
    r.neutros.forEach((c) => expect(c).not.toBe(r.naranja));
  });

  test("la manuscrita aparece con cuentagotas, no de adorno", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".brow", { timeout: 8000 });
    const cuantos = await page.evaluate(() =>
      [...document.querySelectorAll("body *")].filter((el) =>
        getComputedStyle(el).fontFamily.includes("Pinyon")
      ).length
    );
    // El logo, el titular y el rótulo del chollo, más los dos titulares de los
    // paneles. Si esto se dispara, ha dejado de ser un acento.
    expect(cuantos).toBeGreaterThan(0);
    expect(cuantos).toBeLessThan(10);
  });

  test("todo dato va en monoespaciada: precios, códigos y horas", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".brow", { timeout: 8000 });
    const fuentes = await page.evaluate(() =>
      [".brow .price .cifra", ".brow .iata", ".brow .when", ".stats dd"].map((s) => {
        const el = document.querySelector(s);
        return el ? getComputedStyle(el).fontFamily : "";
      })
    );
    fuentes.forEach((f) => expect(f).toMatch(/Plex Mono|monospace/i));
  });

  test("nada se sale por el lado en ninguna de las tres páginas", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    for (const p of ["/index.html", "/buscar.html", "/seguimientos.html"]) {
      await page.goto(p, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(500);
      const desborde = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1
      );
      expect(desborde, p).toBe(false);
    }
  });
});
