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

/* La banda de cambio de precio: lo primero que ves al entrar cuando algo tuyo
   se ha movido. El titular dice cuánto dinero y en qué dirección. */
test.describe("la banda de cambio de precio", () => {
  const conCambios = (page, cambios) =>
    page.addInitScript(
      ([s, lista]) => {
        const favs = {};
        lista.forEach(([id, ciudad, antes, ahora], i) => {
          favs[id] = {
            id, origin: "MAD", destination: "XXX", destination_name: ciudad,
            depart_date: "2026-11-13", return_date: "2026-11-15", airline: "Ryanair",
            adults: 1, deep_link: "https://ryanair.com", desde: Date.now() - 9e7,
            precio_inicial: antes, precio_visto: ahora, visto_en: "2026-09-13",
            historia: [0, 1, 2, 3, 4, 5].map((j) => ({
              d: `2026-09-0${j + 4}`, p: Math.round(antes + (ahora - antes) * (j / 5)),
            })),
            cambio: { antes, ahora, visto: false },
          };
          void i;
        });
        try {
          localStorage.setItem("tf_sesion", JSON.stringify(s));
          localStorage.setItem(`tf_favoritos:${s.uid}`, JSON.stringify(favs));
        } catch (e) { /* nada */ }
      },
      [SESION, cambios]
    );

  const BAJA_Y_SUBE = [
    ["a", "Bérgamo", 53, 41],
    ["b", "Nápoles", 82, 73],
    ["c", "Sofía", 55, 64],
  ];

  test("el titular dice lo que baja, y lo que sube detrás", async ({ page }) => {
    await conCambios(page, BAJA_Y_SUBE);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    const banda = page.locator("#favAviso");
    await expect(banda).toBeVisible({ timeout: 10000 });
    /* Manda lo que baja: es lo que hace que te levantes a mirar. Ya no es un
       titular a cuerpo de portada sino un rótulo —la banda dejó de ser un
       cartel— pero dice exactamente lo mismo y en el mismo orden. */
    const rotulo = banda.locator(".aviso-rotulo");
    await expect(rotulo).toContainText("Baja 21 €");
    await expect(rotulo).toContainText("en 2 viajes apuntados");
    await expect(rotulo).toContainText("otro sube 9 €");
  });

  test("el filo de arriba se reparte como se reparten los cambios", async ({ page }) => {
    await conCambios(page, BAJA_Y_SUBE);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#favAviso")).toBeVisible({ timeout: 10000 });
    // Dos de tres bajan: 67 % verde. Se ve la proporción sin contar nada.
    const pct = await page.locator("#favAviso").evaluate((el) =>
      getComputedStyle(el).getPropertyValue("--pbaja").trim()
    );
    expect(pct).toBe("67%");
  });

  test("una línea por viaje, lo que baja primero", async ({ page }) => {
    await conCambios(page, BAJA_Y_SUBE);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    const filas = page.locator("#favAviso .cambio");
    await expect(filas).toHaveCount(3, { timeout: 10000 });
    // Lo que baja primero, y lo que sube al final.
    await expect(filas.first()).toHaveClass(/baja/);
    await expect(filas.last()).toHaveClass(/sube/);
    // Cada fila lleva su curva: es de lo que habla.
    await expect(filas.locator(".cambio-curva svg")).toHaveCount(3);

    /* El sello y el botón de compartir se cayeron a propósito: la banda avisa,
       y lo que se HACE con el viaje —compartirlo, seguirlo, buscarle cama— está
       en la lista de abajo, donde el viaje ya sale. */
    await expect(filas.locator(".insignia")).toHaveCount(0);
    await expect(filas.locator("[data-share]")).toHaveCount(0);
  });

  test("sin cambios no hay banda", async ({ page }) => {
    await conCambios(page, []);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    await expect(page.locator("#favAviso")).toBeHidden();
  });
});
