/* El diálogo de tu cuenta, y lo que pinta el navegador.

   Los dos desplegables de las preferencias —cada cuánto quieres los chollos y
   el parte de lo que sigues— salían con fondo casi blanco y el texto casi
   blanco encima: se veía la caja y no se leía nada de lo que ponía dentro.

   La causa no estaba solo en que `.modal-form` se olvidara del `select`. Es que
   la web no declaraba `color-scheme` en ninguna parte, y sin decírselo el
   navegador pinta CLARO todo lo suyo: el fondo de un `select` sin estilar, la
   barra de scroll, las flechitas de los campos numéricos y el amarillo del
   autorrelleno. Sobre una página oscura, eso no encaja nunca. */
const { test, expect } = require("@playwright/test");

const USUARIOS = {
  updated: "2026-09-14",
  admin: {},
  site: {},
  users: [
    {
      id: "u-1", user: "mateogsilvaa", name: "mateo", active: true,
      tiene_email: true, sobre: { data: "x", iv: "y" },
      prefs: {
        chollos: "cada_vez", chollos_max_precio: null,
        seguimientos: "diario", seguimientos_solo_novedades: false,
      },
    },
  ],
};

const abrirCuenta = async (page, tema = "oscuro") => {
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("tf_tema", t);
      localStorage.setItem("tf_sesion", JSON.stringify({
        uid: "u-1", user: "mateogsilvaa", name: "mateo", exp: Date.now() + 9e8,
      }));
      sessionStorage.setItem("tf_token_abierto", "x");
    } catch (e) { /* nada */ }
  }, tema);
  await page.route("**/data/users.json*", (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify(USUARIOS) })
  );
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.locator("#tfCuenta").click();
  await expect(page.locator("#tfModal .modal-caja")).toBeVisible();
};

/* Luminancia relativa y contraste, como los mide WCAG. Se calcula aquí y no en
   `contraste.py` porque lo que falla no es un token nuestro: es el color que
   pone el navegador cuando no le decimos nada. */
const CONTRASTE = `(fondo, tinta) => {
  const rgb = (c) => c.match(/\\d+(\\.\\d+)?/g).slice(0, 3).map(Number);
  const lum = (c) => {
    const [r, g, b] = rgb(c).map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const a = lum(fondo), b = lum(tinta);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}`;

for (const tema of ["oscuro", "claro"]) {
  test(`los desplegables de tu cuenta se leen (tema ${tema})`, async ({ page }) => {
    await abrirCuenta(page, tema);
    const selects = page.locator("#tfModal select");
    await expect(selects).toHaveCount(2);

    const contraste = await page.evaluate((fn) => {
      const medir = eval(fn);
      return [...document.querySelectorAll("#tfModal select")].map((s) => {
        const cs = getComputedStyle(s);
        return medir(cs.backgroundColor, cs.color);
      });
    }, CONTRASTE);

    // Antes de arreglarlo esto daba ~1.02: blanco sobre blanco.
    contraste.forEach((c) => expect(c).toBeGreaterThan(4.5));
  });

  test(`lo que pinta el navegador va con el tema (${tema})`, async ({ page }) => {
    await abrirCuenta(page, tema);
    const esquema = await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
    expect(esquema).toBe(tema === "oscuro" ? "dark" : "light");
  });
}

/* Dentro de un formulario esto es una casilla con su frase al lado, no uno de
   los chips de la barra de filtros: salía como una pastilla de mono en
   mayúsculas, con la casilla en `opacity: 0` y nada que dijera que se marca. */
test("la casilla de los seguimientos es una casilla, y se ve", async ({ page }) => {
  await abrirCuenta(page);
  const fila = page.locator("#tfModal .switch");
  await expect(fila).toContainText("Solo cuando haya algo nuevo que contar");

  const como = await page.evaluate(() => {
    const f = document.querySelector("#tfModal .switch");
    const c = f.querySelector("input[type=checkbox]");
    const cs = getComputedStyle(f);
    const ci = getComputedStyle(c);
    return {
      mayusculas: cs.textTransform,
      mono: /Mono/i.test(cs.fontFamily),
      ancho: c.getBoundingClientRect().width,
      opacidad: Number(ci.opacity),
    };
  });
  expect(como.mayusculas).toBe("none");
  expect(como.mono).toBe(false);
  expect(como.ancho).toBeGreaterThan(10);
  expect(como.opacidad).toBe(1);

  // Y se marca de verdad.
  const casilla = page.locator("#tfModal .switch input[type=checkbox]");
  await expect(casilla).not.toBeChecked();
  await casilla.check();
  await expect(casilla).toBeChecked();
});
