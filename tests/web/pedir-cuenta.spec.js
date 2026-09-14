/* Pedir una cuenta (2d del diseño).

   Hasta ahora, quien no tenía cuenta se encontraba los formularios apagados con
   el motivo puesto y ahí se acababa el camino: para conseguir una había que
   conocer a alguien y pedírsela por fuera.

   CÓMO SALE DE AQUÍ LA PETICIÓN. Quien pide una cuenta no tiene cuenta, luego
   no tiene token, luego no puede escribir en el repositorio como escribe todo
   lo demás en esta web. Lo único que puede hacer alguien de fuera es abrir una
   issue con su propio GitHub, así que eso es lo que se hace. */
const { test, expect } = require("@playwright/test");

const USUARIOS = {
  updated: "2026-09-14",
  admin: {},
  users: [
    { id: "u-1", user: "mateogsilvaa", name: "mateo", active: true },
    { id: "u-2", user: "ana", name: "Ana Garcia", active: true },
  ],
  site: {},
};

const conUsuarios = (page) =>
  page.route("**/data/users.json*", (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify(USUARIOS) })
  );

const abrir = async (page) => {
  await conUsuarios(page);
  await page.goto("/buscar.html", { waitUntil: "domcontentloaded" });
  const puerta = page.locator("[data-pedir-cuenta]").first();
  await puerta.waitFor({ state: "attached" });
  await puerta.evaluate((b) => b.click());
  await expect(page.locator("#pedirCuenta")).toBeVisible();
};

test("sin cuenta hay por dónde pedirla", async ({ page }) => {
  await conUsuarios(page);
  await page.goto("/buscar.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-pedir-cuenta]").first()).toBeAttached();
});

test("el formulario pide lo que pide el diseño", async ({ page }) => {
  await abrir(page);
  await expect(page.locator("#pcNombre")).toBeVisible();
  await expect(page.locator("#pcUser")).toBeVisible();
  await expect(page.locator("#pcPorque")).toBeVisible();
  // Y el contador de los 240.
  await page.locator("#pcPorque").fill("Hola");
  await expect(page.locator("#pcCuenta")).toHaveText("4/240");
});

/* El email NO se pide, y es apartarse del diseño a propósito: la petición acaba
   en una issue pública, y este proyecto ya publica `users.json` sin emails con
   un grep en el despliegue que falla si se cuela una arroba. */
test("el email no se pide aquí, y se dice por qué", async ({ page }) => {
  await abrir(page);
  await expect(page.locator("#pedirBody")).not.toContainText("Email");
  await expect(page.locator(".pedir-nota").first()).toContainText("queda publicado");
});

test("un usuario cogido se avisa, con alternativas que se pueden pulsar", async ({ page }) => {
  await abrir(page);
  await page.locator("#pcNombre").fill("Ana Garcia");
  await page.locator("#pcUser").fill("ana");
  await expect(page.locator("#pcUserPie")).toContainText("Ya hay una cuenta con ese usuario");
  const sug = page.locator("#pcSug button");
  await expect(sug.first()).toBeVisible();
  // Salen del nombre que ha escrito, no de un contador.
  await expect(page.locator("#pcSug")).toContainText("anagarcia");
  await sug.first().click();
  await expect(page.locator("#pcUser")).not.toHaveValue("ana");
  await expect(page.locator("#pcUserPie")).toHaveText("Libre.");
});

test("uno libre se dice libre", async ({ page }) => {
  await abrir(page);
  await page.locator("#pcUser").fill("lucia");
  await expect(page.locator("#pcUserPie")).toHaveText("Libre.");
});

test("no deja mandar media petición", async ({ page }) => {
  await abrir(page);
  await page.locator("#pcMandar").click();
  await expect(page.locator("#pcMsg")).toContainText("Falta el nombre");

  await page.locator("#pcNombre").fill("Lucía");
  await page.locator("#pcUser").fill("lucia");
  await page.locator("#pcMandar").click();
  await expect(page.locator("#pcMsg")).toContainText("quién eres");
});

/* Lo que de verdad manda la petición: una issue con el cuerpo ya escrito. */
test("mandarla abre GitHub con la petición escrita", async ({ page, context }) => {
  await abrir(page);
  await page.locator("#pcNombre").fill("Lucía Pérez");
  await page.locator("#pcUser").fill("lucia");
  await page
    .locator("#pcPorque")
    .fill("Me gustaría tener acceso para poder viajar más.");

  // GitHub no se visita desde aquí: se contesta con un sello para poder leer
  // la dirección a la que se iba, que es lo que comprueba esta prueba.
  await context.route("https://github.com/**", (r) =>
    r.fulfill({ contentType: "text/html", body: "<p>ok</p>" })
  );

  const [nueva] = await Promise.all([
    context.waitForEvent("page"),
    page.locator("#pcMandar").click(),
  ]);
  const url = nueva.url();
  expect(url).toContain("github.com/mateogsilvaa/tripfinder/issues/new");
  expect(decodeURIComponent(url)).toContain("labels=peticion-cuenta");
  expect(decodeURIComponent(url)).toContain("[cuenta] lucia");
  expect(decodeURIComponent(url)).toContain("Usuario: lucia");
  expect(decodeURIComponent(url)).toContain("poder viajar más");
  // Y en el cuerpo no viaja ninguna dirección.
  expect(decodeURIComponent(url)).not.toMatch(/[\w.]+@[\w.]+/);

  // Y la pantalla dice lo que falta, sin dar por hecho que ya está pedida.
  await expect(page.locator("#pedirBody")).toContainText("Submit new issue");
  await expect(page.locator("#pedirBody")).toContainText("lucia");
});

/* ------------------------------------------------ y cómo le llega al panel */

const ISSUES = [
  {
    number: 12, html_url: "https://github.com/mateogsilvaa/tripfinder/issues/12",
    title: "[cuenta] lucia", created_at: "2026-09-14T10:02:00Z",
    user: { login: "luciaperez" },
    body: [
      "Nombre: Lucía Pérez", "Usuario: lucia", "", "Por qué:",
      "Soy la hermana de Mateo y volamos juntos casi todos los findes.", "",
      "---", "Pedida desde la web.",
    ].join("\n"),
  },
  // Una issue del bot, de las que se publican cuando el correo no sale: no es
  // una petición y no puede colarse en la cola.
  {
    number: 11, html_url: "https://github.com/x/y/issues/11",
    title: "Chollo: Roma 41 €", created_at: "2026-09-13T06:00:00Z",
    user: { login: "github-actions[bot]" }, body: "…",
  },
  // Y un pull request, que la API mete también en /issues.
  {
    number: 10, html_url: "https://github.com/x/y/pull/10", title: "[cuenta] no",
    created_at: "2026-09-13T06:00:00Z", user: { login: "x" }, body: "",
    pull_request: { url: "…" },
  },
];

const conPanel = async (page) => {
  await page.route("https://api.github.com/**", (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify(ISSUES) })
  );
  // `tfToken` es un `const`, así que no se puede sustituir desde fuera: se le
  // pone el token donde de verdad lo lee.
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem("tf_token_abierto", "token-de-mentira");
    } catch (e) { /* nada */ }
  });
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    document.querySelector("#panelAdmin").hidden = false;
  });
};

test("la cola del panel lee las peticiones y deja las demás issues fuera", async ({ page }) => {
  await conPanel(page);
  await page.evaluate(() => window.pintarPeticiones());
  const caja = page.locator("#peticiones");
  await expect(caja).toContainText("peticiones de cuenta · 1");
  await expect(caja).toContainText("Lucía Pérez");
  await expect(caja).toContainText("hermana de Mateo");
  await expect(caja).toContainText("pedida por luciaperez");
  await expect(caja).not.toContainText("Chollo");
  await expect(page.locator(".peticion")).toHaveCount(1);
});

/* «Crear la cuenta» sale con los campos ya puestos: copiarlos a mano de una
   issue a un formulario es justo donde se cuela una errata en el usuario. */
test("«Crear la cuenta» abre el formulario relleno", async ({ page }) => {
  await conPanel(page);
  await page.evaluate(() => window.pintarPeticiones());
  await page.locator("[data-crear]").click();
  await expect(page.locator("#cNombre")).toHaveValue("Lucía Pérez");
  await expect(page.locator("#cUser")).toHaveValue("lucia");
  // Y la contraseña sigue poniéndola quien aprueba, no la petición.
  await expect(page.locator("#cPass")).toHaveValue("");
});

/* ------------------------------------------------- y desde dónde se llega */

/* La portada lleva sus dos avisos de «hace falta una cuenta» ESCRITOS A MANO en
   el HTML, y como ya existen, `candarFormularios` no añade los suyos: en la
   página a la que llega todo el mundo no había ninguna puerta para pedirla. */
test("desde la portada, sin sesión, se puede pedir una cuenta", async ({ page }) => {
  await conUsuarios(page);
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  const puertas = page.locator(".candado-nota [data-pedir-cuenta]");
  await expect(puertas).toHaveCount(2);
  await expect(puertas.first()).toBeVisible();

  await puertas.first().click();
  await expect(page.locator("#pedirCuenta")).toBeVisible();
});

/* Y con sesión no sale por ningún lado, que es lo suyo: ya la tienes. Los
   avisos de la portada están en el HTML pase lo que pase, así que hay que
   apagarlos a mano —antes se quedaban puestos y quien ya había entrado seguía
   leyendo «hace falta una cuenta para buscar» encima de un formulario que le
   funcionaba, con un «Entrar» al lado. */
test("con sesión, ni la puerta ni el aviso de que falta cuenta", async ({ page }) => {
  await conUsuarios(page);
  await page.addInitScript(() => {
    try {
      localStorage.setItem(
        "tf_sesion",
        JSON.stringify({ uid: "u-1", user: "mateogsilvaa", name: "mateo" })
      );
    } catch (e) { /* nada */ }
  });
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);

  await expect(page.locator("[data-pedir-cuenta]:visible")).toHaveCount(0);
  await expect(page.locator(".candado-nota:visible")).toHaveCount(0);
  // Y el formulario, vivo: es lo que hace que el aviso fuera una contradicción.
  await expect(page.locator("#finderForm select").first()).toBeEnabled();
});
