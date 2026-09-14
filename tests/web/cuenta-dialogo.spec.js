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

/* ------------------------------------- la puerta que faltaba, y el rediseño */

/* La puerta de pedir una cuenta estaba SOLO donde la web sale sin sesión —los
   formularios candados, los avisos de «entra para ver lo tuyo»—, así que quien
   llegaba al diálogo de entrar a probar una contraseña que no tiene se
   encontraba un «pídesela a quien lleve la web» y ningún sitio donde hacerlo. */
test("desde «Entrar» se puede pedir una cuenta", async ({ page }) => {
  await page.route("**/data/users.json*", (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify(USUARIOS) })
  );
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.locator("#tfCuenta").click(); // sin sesión abre «Entrar»
  await expect(page.locator("#tfModal")).toBeVisible();
  await expect(page.locator("#tfPedirCuenta")).toBeVisible();

  await page.locator("#tfPedirCuenta").click();
  await expect(page.locator("#pedirCuenta")).toBeVisible();
  // Y el de entrar se cierra: son dos capas distintas y si no se superponen.
  await expect(page.locator("#tfModal")).toBeHidden();

  // La vuelta también: «Ya tengo una: entrar».
  await page.locator("#pcEntrar").click();
  await expect(page.locator("#tfModal")).toBeVisible();
});

test.describe("el diálogo de cuenta, rehecho", () => {
  /* Lo que de verdad puede romper un rediseño: el cableado busca estos ids y
     ninguno falla en voz alta si desaparece —simplemente deja de guardarse. */
  test("no se ha perdido ningún campo por el camino", async ({ page }) => {
    await abrirCuenta(page);
    for (const id of [
      "#tfEmail", "#tfChollos", "#tfTope", "#tfSeg", "#tfSoloNov",
      "#tfPrefsMsg", "#tfSalir", "#tfClaveForm", "#tfPrefsForm",
      "#tfClaveVieja", "#tfClaveNueva", "#tfClaveRepe", "#tfClaveMsg",
    ]) {
      await expect(page.locator(id), `falta ${id}`).toHaveCount(1);
    }
  });

  /* El hueco decía «el que ya tienes guardado», que finge ser un valor: parecía
     que la dirección estaba escrita ahí. Y no puede estarlo — el fichero que
     publica la web va sin direcciones. */
  test("dice si tienes dirección guardada, sin fingir enseñarla", async ({ page }) => {
    await abrirCuenta(page);
    await expect(page.locator("#tfEmail")).toHaveValue("");
    await expect(page.locator("#tfPrefsForm")).toContainText("Tienes una dirección guardada");
    const hueco = await page.locator("#tfEmail").getAttribute("placeholder");
    expect(hueco).not.toContain("ya tienes guardado");
  });

  /* Salir era un botón del mismo ancho que «Guardar», justo debajo: el mismo
     peso para la acción principal y para la que te echa fuera. */
  test("«Salir» ya no compite con «Guardar»", async ({ page }) => {
    await abrirCuenta(page);
    const salir = page.locator("#tfSalir");
    await expect(salir).toHaveClass(/quitar/);
    await expect(page.locator(".cuenta-salir")).toContainText("En este navegador");

    const anchos = await page.evaluate(() => ({
      guardar: document.querySelector("#tfPrefsForm button[type=submit]").getBoundingClientRect().width,
      salir: document.querySelector("#tfSalir").getBoundingClientRect().width,
    }));
    expect(anchos.salir).toBeLessThan(anchos.guardar * 0.75);
  });

  test("cada bloque dice de qué va", async ({ page }) => {
    await abrirCuenta(page);
    const cabeceras = page.locator("#tfModal .bloque-head");
    await expect(cabeceras).toHaveCount(2);
    await expect(cabeceras.first()).toHaveText(/tus avisos/i);
    await expect(cabeceras.nth(1)).toHaveText(/tu contraseña/i);
  });
});
