/* LO QUE SE PULSA CON EL DEDO.

   La web se mira sobre todo desde el móvil y está maquetada desde el
   escritorio, y eso se notaba en un sitio concreto: el tamaño de lo que se
   pulsa. `--tap-min: 44px` existe desde el primer día con el comentario «área
   táctil mínima, aunque se vea más pequeño», y estaba puesto en los chips, en
   las ciudades del selector y en los favoritos — pero no en la barra de arriba
   ni en los formularios, que es justo por donde se entra.

   Medido a 390 px, esto es lo que había: los desplegables de buscar, 21 px de
   alto. El campo de la cifra, 23. Los enlaces del nav, 28. El botón de cerrar
   un panel, 32. El del tema, 38. La cuenta, 42. Ninguno llegaba.

   Esta prueba recorre TODO lo que se pulsa en cada página a lo ancho de un
   móvil y exige los 44. Vale tanto la caja del elemento como la de un
   `::after` absoluto, que es el truco que el proyecto ya usaba para agrandar el
   área sin agrandar el dibujo (`.fav`, `.flap-boton`).

   Un enlace metido dentro de una frase NO entra: «¿No tienes destino en mente?
   Haz el test» es una palabra subrayada dentro de un párrafo, y estirarla a 44
   px la haría pisar los renglones de al lado. La regla es para botones y para
   enlaces que van solos. */
const { test, expect } = require("@playwright/test");

const MOVIL = { width: 390, height: 780 };
// 360 px es el móvil más estrecho que sigue en la calle.
const ESTRECHO = { width: 360, height: 740 };

/* Las páginas que hay. El tablón no es una página: vive dentro de la portada,
   y `/tablon.html` es el 404 — que es lo que esta prueba estuvo midiendo hasta
   que una captura lo enseñó. */
const PAGINAS = [
  "/index.html",
  "/buscar.html",
  "/seguimientos.html",
  "/trenes.html",
  "/404.html",
];

/* Devuelve la lista de lo que se pulsa y no llega, ya con su nombre para que el
   fallo se lea sin abrir el navegador. */
const pequenos = (page) =>
  page.evaluate(() => {
    const MIN = 44;
    // La caja real: la del elemento o la del `::after` con el que se agranda.
    const caja = (el) => {
      const b = el.getBoundingClientRect();
      let w = b.width;
      let h = b.height;
      for (const pseudo of ["::after", "::before"]) {
        const cs = getComputedStyle(el, pseudo);
        if (cs.content && cs.content !== "none" && cs.position === "absolute") {
          w = Math.max(w, parseFloat(cs.width) || 0);
          h = Math.max(h, parseFloat(cs.height) || 0);
        }
      }
      return { w, h };
    };
    // Un enlace dentro de una frase se queda fuera de la regla, a propósito.
    const enUnaFrase = (el) =>
      el.tagName === "A" && !!el.closest("p, small, figcaption, .stay-nota");
    const malos = [];
    const todos = document.querySelectorAll(
      "button, a[href], input, select, textarea, [role=button]"
    );
    todos.forEach((el) => {
      const b = el.getBoundingClientRect();
      if (!b.width && !b.height) return; // escondido
      if (el.type === "hidden" || el.closest("[hidden]")) return;
      if (enUnaFrase(el)) return;
      // Se redondea a propósito: un objetivo de 43,6 px no es un fallo, es
      // cómo cae la caja de texto en la rejilla de subpíxeles del navegador.
      const { w, h } = caja(el);
      if (Math.round(h) < MIN || Math.round(w) < MIN) {
        const que = el.className || el.id || el.tagName.toLowerCase();
        const texto = (el.textContent || el.placeholder || "").trim().slice(0, 24);
        malos.push(`${que} (${Math.round(w)}x${Math.round(h)}) "${texto}"`);
      }
    });
    return [...new Set(malos)];
  });

test.describe("con el dedo, a lo ancho de un móvil", () => {
  for (const pagina of PAGINAS) {
    test(`todo lo que se pulsa en ${pagina} llega a los 44 px`, async ({ page }) => {
      await page.setViewportSize(MOVIL);
      await page.goto(pagina, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(800);
      expect(await pequenos(page)).toEqual([]);
    });
  }

  test("y en 360 px tampoco se encoge nada", async ({ page }) => {
    await page.setViewportSize(ESTRECHO);
    await page.goto("/buscar.html", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(700);
    expect(await pequenos(page)).toEqual([]);
  });

  test("los paneles que se abren encima también", async ({ page }) => {
    // El botón de cerrar es lo primero que se busca al abrir una hoja, y era
    // de 32 px: el más pequeño de la casa justo donde más prisa hay.
    await page.setViewportSize(MOVIL);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    await page.evaluate(() => document.querySelector(".cuenta, #tfCuenta")?.click());
    await page.waitForTimeout(400);
    expect(await pequenos(page)).toEqual([]);
  });

  test("la hoja de filtros del tablón también", async ({ page }) => {
    // En móvil los nueve controles del tablón viven en una hoja que sube desde
    // abajo. Es el sitio con más cosas que tocar por centímetro de toda la web.
    await page.setViewportSize(MOVIL);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);
    await page.locator("#filtrosBtn").click();
    await expect(page.locator("#filtrosHoja")).toBeVisible();
    expect(await pequenos(page)).toEqual([]);
  });

  test("en el escritorio el dibujo no cambia", async ({ page }) => {
    // Los 44 px son para el dedo. En un escritorio con ratón, los campos de
    // buscar siguen siendo la línea fina de siempre: si esto sube, el
    // formulario compacto de la portada deja de ser compacto.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/buscar.html", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    const alto = await page.evaluate(() => {
      const s = document.querySelector(".finder-form select");
      return s ? Math.round(s.getBoundingClientRect().height) : -1;
    });
    expect(alto).toBeGreaterThan(0);
    expect(alto).toBeLessThan(40);
  });

  test("y no aparece scroll horizontal en ningún sitio", async ({ page }) => {
    // Lo que gane de alto no puede ganarlo de ancho: a 360 px, cero desborde.
    await page.setViewportSize(ESTRECHO);
    for (const pagina of PAGINAS) {
      await page.goto(pagina, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(600);
      const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(ancho, `${pagina} desborda`).toBeLessThanOrEqual(360);
    }
  });
});
