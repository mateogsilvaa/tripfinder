/* Las cifras de la cabecera son las de CADA página.

   Las cuatro páginas enseñaban las del tablón de chollos —ofertas vivas, mejor
   descuento, desde, escapadas de finde— porque el módulo del feed rellenaba
   `#stats` en todas. En el mapa del mundo eso era, literalmente, decirte
   cuántas ofertas hay mientras miras cuántos países has pisado. */
const { test, expect } = require("@playwright/test");

const SESION = { uid: "u-mateo", user: "mateo", name: "Mateo" };

const conCuenta = (page) =>
  page.addInitScript((s) => {
    try {
      localStorage.setItem("tf_sesion", JSON.stringify(s));
    } catch (e) { /* nada */ }
  }, SESION);

const conBusquedas = (page, searches) =>
  page.route("**/data/searches/index.json*", (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ searches }) })
  );

const conSeguimientos = (page, watches) =>
  page.route("**/data/watch.json*", (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ watches }) })
  );

const rotulos = (page) => page.locator("#stats dt");

test("el feed sigue enseñando las suyas", async ({ page }) => {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#stats")).toContainText("ofertas vivas");
  await expect(page.locator("#stats")).toContainText("escapadas de finde");
});

test("buscar cuenta búsquedas y viajes, no ofertas del feed", async ({ page }) => {
  await conCuenta(page);
  await conBusquedas(page, [
    { slug: "a", label: "Roma", count: 7, best_price: 96, generated_at: "2026-09-13", owner: "u-mateo" },
    { slug: "b", label: "Donde sea", count: 104, best_price: 29, generated_at: "2026-09-10", owner: "u-mateo" },
  ]);
  await page.goto("/buscar.html", { waitUntil: "domcontentloaded" });
  await expect(rotulos(page).first()).toHaveText("búsquedas guardadas");
  await expect(page.locator("#stats")).not.toContainText("ofertas vivas");
  await expect(page.locator("#stats div").first()).toContainText("2");
  // 7 + 104: lo que han sacado entre todas.
  await expect(page.locator("#stats div").nth(1)).toContainText("111");
  // Y lo que de verdad quiere saber quien va a darle a Buscar: cuánto tarda.
  await expect(page.locator("#stats")).toContainText("unos 8 minutos");
});

test("seguimientos separa lo que se revisa solo de lo que has apuntado", async ({ page }) => {
  await conCuenta(page);
  await conSeguimientos(page, [
    { id: "w1", label: "Donde sea", months: 6, active: true, owner: "u-mateo", last_checked: "2026-09-13", last_offers: [] },
    { id: "w2", label: "Nápoles", depart: "2027-01-15", active: true, owner: "u-mateo", last_checked: "2026-09-12", last_offers: [] },
  ]);
  await page.goto("/seguimientos.html", { waitUntil: "domcontentloaded" });
  await expect(rotulos(page).first()).toHaveText("siguiendo");
  await expect(rotulos(page).nth(1)).toHaveText("apuntados");
  await expect(page.locator("#stats div").first()).toContainText("2");
  await expect(page.locator("#stats")).not.toContainText("ofertas vivas");
  // Son dos cosas distintas: un encargo que se revisa solo y un viaje marcado.
  await expect(page.locator("#stats div").nth(1)).toContainText("0");
});

test("el mundo cuenta países, no chollos", async ({ page }) => {
  await conCuenta(page);
  await page.goto("/mapa.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#mundo svg path[data-iso]").first()).toBeVisible({ timeout: 15000 });
  await expect(rotulos(page).first()).toHaveText("países");
  await expect(rotulos(page).nth(1)).toHaveText("del mundo");
  await expect(page.locator("#stats")).not.toContainText("ofertas vivas");
});

test("sin cuenta, el mapa no inventa cifras de nadie", async ({ page }) => {
  await page.goto("/mapa.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#mundoPuerta")).toBeVisible();
  // Lo que no puede salir es el tablón de chollos donde va el mapa.
  await expect(page.locator("#stats")).not.toContainText("ofertas vivas");
});

/* Lo que se ve mientras una búsqueda corre fuera. Un barrido «donde sea» son
   ocho minutos: una rueda girando todo ese rato no dice nada. */
test.describe("los estados de una búsqueda", () => {
  const conPendientes = (page, lista) =>
    page.addInitScript(
      ([s, p]) => {
        try {
          localStorage.setItem("tf_sesion", JSON.stringify(s));
          localStorage.setItem(`tf_pendientes:${s.uid}`, JSON.stringify(p));
        } catch (e) { /* nada */ }
      },
      [SESION, lista]
    );

  test("una búsqueda en marcha dice por dónde va y que puedes irte", async ({ page }) => {
    await conPendientes(page, [{ label: "Donde sea · findes", desde: Date.now() - 3 * 60000 }]);
    await conBusquedas(page, []);
    await page.goto("/buscar.html", { waitUntil: "domcontentloaded" });
    const caja = page.locator(".lanzada").first();
    await expect(caja).toBeVisible({ timeout: 10000 });
    await expect(caja).toContainText("lleva 3 min");
    await expect(caja).toContainText("quedan unos 5 min");
    // Lo que más tranquiliza: que no hay que quedarse mirando.
    await expect(caja).toContainText("Puedes cerrar la pestaña");
    const barra = caja.locator(".lanzada-barra");
    await expect(barra).toHaveAttribute("role", "progressbar");
    const pct = Number(await barra.getAttribute("aria-valuenow"));
    expect(pct).toBeGreaterThan(30);
    expect(pct).toBeLessThan(45);
  });

  test("la barra no llega al 100 y se queda esperando", async ({ page }) => {
    // Llegar al 100 % y seguir esperando es peor que ir lento: se queda en 95.
    await conPendientes(page, [{ label: "Donde sea", desde: Date.now() - 14 * 60000 }]);
    await conBusquedas(page, []);
    await page.goto("/buscar.html", { waitUntil: "domcontentloaded" });
    const barra = page.locator(".lanzada-barra").first();
    await expect(barra).toBeVisible({ timeout: 10000 });
    expect(Number(await barra.getAttribute("aria-valuenow"))).toBe(95);
  });

  test("la que no llegó a terminar lo dice y se puede relanzar", async ({ page }) => {
    await conPendientes(page, [{ label: "Italia · un finde", desde: Date.now() - 20 * 60000 }]);
    await conBusquedas(page, []);
    await page.goto("/buscar.html", { waitUntil: "domcontentloaded" });
    const caja = page.locator(".lanzada").first();
    await expect(caja).toContainText("No llegó a terminar", { timeout: 10000 });
    await expect(caja).toContainText("20 minutos");
    await expect(caja.locator("[data-repetir]")).toBeVisible();
    await expect(caja.locator("[data-olvidar]")).toBeVisible();
  });
});
