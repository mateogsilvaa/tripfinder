/* La web, para quien llega por primera vez.

   Antes la cabecera llevaba un punto que latía con «en vivo», tres letras (M A D)
   y un «?» que nadie sabía para qué servía, y el menú hablaba de «Feed» y de
   «Vuelos que sigues». Esto vigila que no vuelva: cada cosa tiene que decir lo que
   es con palabras. */
const { test, expect } = require("@playwright/test");

const PAGINAS = ["/index.html", "/buscar.html", "/seguimientos.html", "/interrail.html"];

for (const pagina of PAGINAS) {
  test.describe(pagina, () => {
    test("la cabecera no lleva nada críptico", async ({ page }) => {
      await page.goto(pagina);
      await expect(page.locator(".board-live")).toHaveCount(0);
      await expect(page.locator(".flaps")).toHaveCount(0);
      await expect(page.locator(".topbar")).not.toContainText("en vivo");
      // El test de destinos tiene nombre: es un botón que se lee.
      await expect(page.locator("#tfDescubrir")).toContainText(/ayúdame a elegir|dónde ir/i);
    });

    test("el menú dice lo que hay en cada sitio", async ({ page }) => {
      await page.goto(pagina);
      await expect(page.locator(".zonas a")).toHaveText(["Chollos", "Buscar", "Mis avisos", "Interrail"]);
    });

    test("el pie lleva la privacidad", async ({ page }) => {
      await page.goto(pagina);
      await expect(page.locator(".foot a.foot-enlace")).toHaveAttribute("href", "privacidad.html");
    });
  });
}

test("la portada explica en tres pasos qué es esto", async ({ page }) => {
  await page.goto("/index.html");
  const pasos = page.locator(".como-pasos li");
  await expect(pasos).toHaveCount(3);
  await expect(pasos.nth(0)).toContainText("Mira los chollos");
  await expect(pasos.nth(1)).toContainText("Apunta el que te interese");
  await expect(pasos.nth(2)).toContainText("Te escribimos cuando baje");
});

test("la portada no repite lo mismo en dos párrafos", async ({ page }) => {
  await page.goto("/index.html");
  const texto = await page.locator("header.masthead").innerText();
  // Un titular, una frase y una línea con la acción: no tres párrafos de lo mismo.
  expect(texto.split("\n").filter((l) => l.trim().length > 60).length).toBeLessThanOrEqual(2);
});

test("el test de destinos sigue abriéndose desde su botón con nombre", async ({ page }) => {
  await page.goto("/index.html");
  await page.locator("#tfDescubrir").click();
  await expect(page.locator(".quiz-pregunta")).toBeVisible();
});

test.describe("sin cuenta", () => {
  test("el aviso de «hace falta una cuenta» está ENCIMA del formulario", async ({ page }) => {
    await page.goto("/buscar.html");
    const nota = page.locator(".herramienta .candado-nota");
    await expect(nota).toBeVisible();
    await expect(nota).toContainText("hace falta una cuenta");
    const [yNota, yForm] = await Promise.all([
      nota.evaluate((el) => el.getBoundingClientRect().top),
      page.locator("#finderForm").evaluate((el) => el.getBoundingClientRect().top),
    ]);
    expect(yNota).toBeLessThan(yForm);
    // Con sus dos puertas, con palabras que se entienden.
    await expect(nota.locator("[data-entrar]")).toHaveText("Entrar");
    await expect(nota.locator("[data-pedir-cuenta]")).toHaveText("Crear cuenta");
  });
});

test.describe("la página de privacidad", () => {
  test("cuenta qué se guarda, qué se ve y qué no existe", async ({ page }) => {
    await page.goto("/privacidad.html");
    await expect(page.locator("h1")).toContainText("Qué guardamos");
    // `textContent`: `innerText` devuelve los titulillos en MAYÚSCULAS por el CSS.
    const texto = (await page.locator("main").textContent()).replace(/\s+/g, " ");
    for (const frase of [
      "Tu cuenta",
      "Tus avisos",
      "Lo que buscas y lo que sigues",
      "Favoritos y test de destinos",
      "Lo que no hay",
      "Borrar tu cuenta",
    ]) {
      expect(texto).toContain(frase);
    }
    // La parte incómoda, dicha: lo que se sigue es público.
    expect(texto).toContain("se ve públicamente");
    expect(texto).toContain("sin tu correo");
    // Y los terceros, sin esconderlos.
    expect(texto).toContain("Google Fonts");
  });

  test("tiene menú, vuelta a los chollos y el tema", async ({ page }) => {
    await page.goto("/privacidad.html");
    await expect(page.locator(".zonas a")).toHaveCount(4);
    await expect(page.locator("#tema")).toBeVisible();
    await page.locator("main a.btn.primary").click();
    await expect(page).toHaveURL(/\/(index\.html)?(#.*)?$/);
  });

  test("no cuela ningún correo ni nombre de nadie", async ({ page }) => {
    await page.goto("/privacidad.html");
    expect(await page.content()).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });
});

test.describe("en el móvil", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("la cabecera cabe y el botón del test se lee", async ({ page }) => {
    await page.goto("/index.html");
    const sobra = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(sobra).toBeLessThanOrEqual(0);
    await expect(page.locator("#tfDescubrir")).toBeVisible();
    await expect(page.locator("#tfDescubrir")).toContainText("¿Dónde ir?");
  });

  test("los tres pasos se apilan", async ({ page }) => {
    await page.goto("/index.html");
    const xs = await page.locator(".como-pasos li").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
    expect(new Set(xs).size).toBe(1);
  });
});

for (const ancho of [430, 390, 360, 320]) {
  test(`a ${ancho} px la marca, el test, el tema y la cuenta caben en UNA fila`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: ancho, height: 800 } });
    const page = await ctx.newPage();
    await page.goto("/index.html");
    const filas = await page.evaluate(() =>
      ["#tfCuenta", "#tfDescubrir", "#tema", ".marca"].map((s) =>
        Math.round(document.querySelector(s).getBoundingClientRect().top / 10)
      )
    );
    // Si uno se cae a la segunda fila su `top` se va 40 px o más por debajo.
    expect(Math.max(...filas) - Math.min(...filas)).toBeLessThanOrEqual(1);
    await ctx.close();
  });
}
