/* El mapa de dónde has estado.

   Lo que se prueba aquí no es que el SVG se pinte —eso lo garantiza el
   generador— sino las tres cosas que pueden romperse solas: que sin cuenta no
   se entra, que lo marcado se queda con TU cuenta y no con la del siguiente, y
   que un país se marca tanto con el dedo en el mapa como por su nombre en la
   lista, que es la única forma de acertar con Malta. */
const { test, expect } = require("@playwright/test");

const SESION = { uid: "u-prueba", user: "p", name: "P" };

const conSesion = (page, sesion = SESION) =>
  page.addInitScript((s) => {
    try {
      localStorage.setItem("tf_sesion", JSON.stringify(s));
    } catch (e) { /* nada */ }
  }, sesion);

const abierto = async (page) => {
  await page.goto("/mapa.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#mundo svg path[data-iso]").first()).toBeVisible({ timeout: 15000 });
};

/* Pulsar un país de verdad, no en el centro de su recuadro: un `<path>` no es
   un rectángulo y el centro del de España cae en el Atlántico, porque las
   Canarias estiran el recuadro hacia el suroeste. Se busca a barridos un punto
   que el navegador conceda a ESE trazo y se pulsa ahí, que es lo que hace un
   dedo —y de paso se comprueba que el país se puede acertar—. */
async function pulsarPais(page, iso) {
  const punto = await page.locator(`path[data-iso="${iso}"]`).evaluate((nodo) => {
    // "instant" a proposito: la web scrollea suave y, si se anima, el recuadro
    // que se mide aqui ya no es donde estara el pais cuando llegue la pulsacion.
    nodo.scrollIntoView({ block: "center", behavior: "instant" });
    const r = nodo.getBoundingClientRect();
    const paso = Math.max(0.5, Math.min(r.width, r.height) / 24);
    for (let y = r.top + paso / 2; y < r.bottom; y += paso) {
      for (let x = r.left + paso / 2; x < r.right; x += paso) {
        if (document.elementFromPoint(x, y) === nodo) return { x, y };
      }
    }
    return null;
  });
  if (!punto) throw new Error(`no hay ningún punto donde pulsar ${iso}`);
  await page.mouse.click(punto.x, punto.y);
}

test.describe("el mapa del mundo", () => {
  test("sin cuenta no hay mapa: hay puerta", async ({ page }) => {
    await page.goto("/mapa.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#mundoPuerta")).toBeVisible();
    await expect(page.locator("#mundo")).toBeHidden();
    // Y la puerta lleva a entrar, no a un callejón.
    await expect(page.locator("#mundoPuerta [data-entrar]")).toBeVisible();
  });

  test("con cuenta sale el mundo entero, con su código y su nombre", async ({ page }) => {
    await conSesion(page);
    await abierto(page);
    await expect(page.locator("#mundoPuerta")).toBeHidden();
    const paises = page.locator("#mundo svg path[data-iso]");
    expect(await paises.count()).toBeGreaterThan(180);
    // España es de donde salen todos los vuelos: si falta, el mapa no vale.
    const es = page.locator('path[data-iso="ES"]');
    await expect(es).toHaveAttribute("data-n", "España");
    // El nombre también para quien no ve el mapa.
    await expect(es.locator("title")).toHaveText("España");
  });

  test("pulsar un país lo marca, y volver a pulsarlo lo desmarca", async ({ page }) => {
    await conSesion(page);
    await abierto(page);
    const es = page.locator('path[data-iso="ES"]');
    await expect(page.locator("#mundoCifra")).toHaveText("0");

    await pulsarPais(page, "ES");
    await expect(es).toHaveClass(/visitado/);
    await expect(page.locator("#mundoCifra")).toHaveText("1");

    await pulsarPais(page, "ES");
    await expect(es).not.toHaveClass(/visitado/);
    await expect(page.locator("#mundoCifra")).toHaveText("0");
  });

  test("lo marcado sigue ahí al volver", async ({ page }) => {
    await conSesion(page);
    await abierto(page);
    await pulsarPais(page, "ES");
    await expect(page.locator("#mundoCifra")).toHaveText("1");

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator('path[data-iso="ES"]')).toHaveClass(/visitado/, { timeout: 15000 });
    await expect(page.locator("#mundoCifra")).toHaveText("1");
  });

  /* El mapa es de ALGUIEN. Antes de las cuentas, lo guardado sin sesión se lo
     encontraba el siguiente que entraba, y ese fue el fallo que las cuentas
     vinieron a arreglar: no se puede repetir aquí. */
  test("el mapa de una cuenta no es el de otra", async ({ page }) => {
    await conSesion(page);
    await abierto(page);
    await pulsarPais(page, "ES");
    await expect(page.locator("#mundoCifra")).toHaveText("1");

    // Otra cuenta de verdad: se pone antes de cargar, porque al navegar la web
    // vuelve a leer la sesion de cero.
    await conSesion(page, { uid: "u-otra", user: "o", name: "O" });
    await abierto(page);
    await expect(page.locator("#mundoCifra")).toHaveText("0");
    await expect(page.locator('path[data-iso="ES"]')).not.toHaveClass(/visitado/);
  });

  /* Malta son tres píxeles: con el dedo no se acierta y sin la lista el mapa
     sería mentira para media Europa. */
  test("un país pequeño se marca por su nombre", async ({ page }) => {
    await conSesion(page);
    await abierto(page);
    await page.fill("#mundoBusca", "malta");
    const chips = page.locator("#mundoLista .pais-chip");
    await expect(chips).toHaveCount(1);
    await expect(chips.first()).toHaveText("Malta");

    await chips.first().click();
    await expect(page.locator('path[data-iso="MT"]')).toHaveClass(/visitado/);
    // Y la busqueda sigue puesta: marcar no puede devolverte a los 225 de golpe.
    await expect(chips).toHaveCount(1);
    await expect(chips.first()).toHaveAttribute("aria-pressed", "true");
  });

  test("la búsqueda no distingue tildes ni mayúsculas", async ({ page }) => {
    await conSesion(page);
    await abierto(page);
    await page.fill("#mundoBusca", "JAPON");
    await expect(page.locator("#mundoLista .pais-chip", { hasText: "Japón" })).toHaveCount(1);
  });

  /* El dato que solo puede dar esta web: cruzar el mapa con lo que vuela hoy.
     Si `offers.json` no cuadrara con los nombres del mapa, esto saldría a cero
     y nadie se enteraría. */
  test("cruza el mapa con los países a los que hay vuelo", async ({ page }) => {
    await conSesion(page);
    await abierto(page);
    const caja = page.locator("#mundoVuelos");
    await expect(caja).toBeVisible();
    // El JSON de ejemplo vuela a España, Italia y Reino Unido: tres países.
    await expect(caja).toContainText("De los 3 países a los que hay vuelo ahora mismo, has estado en 0. Quedan 3.");
    await pulsarPais(page, "IT");
    await expect(caja).toContainText("has estado en 1. Quedan 2.");
  });

  test("«a dónde hay vuelo hoy» se pinta sobre el mapa", async ({ page }) => {
    await conSesion(page);
    await abierto(page);
    expect(await page.locator("#mundo svg path.con-vuelo").count()).toBe(0);
    // La casilla va dentro del chip y no se ve: se pulsa el chip, como se pulsa.
    await page.locator(".switch", { hasText: "hay vuelo hoy" }).click();
    await expect(page.locator("#mundo svg path.con-vuelo")).toHaveCount(3);
  });

  test("los territorios sin código no se pueden marcar", async ({ page }) => {
    await conSesion(page);
    await abierto(page);
    const sin = page.locator("#mundo svg path.sin-codigo").first();
    if (!(await sin.count())) return; // no los hay: nada que comprobar
    await expect(sin).not.toHaveAttribute("data-iso", /./);
    expect(await sin.evaluate((e) => getComputedStyle(e).pointerEvents)).toBe("none");
  });

  test("en navegación privada funciona igual, solo que no recuerda", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      try {
        localStorage.setItem("tf_sesion", JSON.stringify({ uid: "u-p", user: "p", name: "P" }));
      } catch (e) { /* nada */ }
      // A partir de aquí, guardar revienta: es lo que hace Safari en privado.
      const real = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (String(k).startsWith("tf_mundo")) throw new Error("sin sitio");
        return real.call(this, k, v);
      };
    });
    await page.goto("/mapa.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator('path[data-iso="ES"]')).toBeVisible({ timeout: 15000 });
    await pulsarPais(page, "ES");
    // Se marca en pantalla aunque no se pueda guardar: no se rompe nada.
    await expect(page.locator('path[data-iso="ES"]')).toHaveClass(/visitado/);
    await expect(page.locator("#mundoCifra")).toHaveText("1");
    await ctx.close();
  });
});
