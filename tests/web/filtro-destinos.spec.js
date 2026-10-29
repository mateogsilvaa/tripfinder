/* Afinar el «donde sea»: solo unos países o una región, todos menos unos
   países o unas ciudades, y tus grupos de países guardados.

   Lo que se pidió: «lo de quitar ciudades y países también, o poder
   seleccionar tu bundle de países». A la búsqueda llegan los aeropuertos de
   cada cosa (`viaje.solo` y `viaje.sin`), no los nombres. */
const { test, expect } = require("@playwright/test");

const conSesion = (page) =>
  page.addInitScript(() => {
    try {
      localStorage.setItem("tf_sesion", JSON.stringify({ uid: "u-f", user: "f", name: "F" }));
      localStorage.setItem("tf_token", "ghp_de_mentira");
    } catch (e) {
      /* nada */
    }
  });

const capturar = async (page) => {
  const enviados = [];
  await page.route("**/api.github.com/**", (r) => {
    enviados.push(JSON.parse(r.request().postData() || "{}"));
    return r.fulfill({ status: 204, body: "" });
  });
  return enviados;
};

const abrir = async (page) => {
  await page.goto("/buscar.html", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#finderForm:not(.candado)", { timeout: 10000 });
  // Afinar es una opción más de «¿A dónde?».
  await page.selectOption("#fWhere", "afinar");
  await expect(page.locator(".filtro-dest h3").first()).toHaveText("¿Por dónde?");
};

test("sin tocarlo, cualquier sitio y no se manda nada", async ({ page }) => {
  await conSesion(page);
  const enviados = await capturar(page);
  await page.goto("/buscar.html", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#finderForm:not(.candado)", { timeout: 10000 });
  await expect(page.locator('#fWhere option[value="afinar"]')).toHaveText("Unos países o regiones…");
  await page.click('[form="finderForm"]');
  await expect.poll(() => enviados.length).toBe(1);
  expect(enviados[0].client_payload.viaje).toMatchObject({ solo: "", sin: "" });
});

test("solo Italia y Portugal, pero sin Roma", async ({ page }) => {
  await conSesion(page);
  const enviados = await capturar(page);
  await abrir(page);
  await page.locator('[data-buscar="si"]').fill("ital");
  await page.locator('.filtro-res[data-k="IT"]').click();
  await page.locator('[data-buscar="si"]').fill("portu");
  await page.locator('.filtro-res[data-k="PT"]').click();
  await page.locator('[data-buscar="no"]').fill("roma");
  await page.locator('.filtro-res[data-t="ciudad"]').first().click();
  await expect(page.locator(".filtro-resumen")).toHaveText("solo Italia, Portugal · sin Roma");
  await page.locator("[data-listo]").click();
  // La opción dice lo elegido.
  await expect(page.locator("#fWhere")).toHaveValue("afinar");
  await expect(page.locator('#fWhere option[value="afinar"]')).toHaveText("Solo Italia, Portugal · sin Roma");
  await page.click('[form="finderForm"]');
  await expect.poll(() => enviados.length).toBe(1);
  const p = enviados[0].client_payload;
  expect(p.viaje.solo).toBe("BGYFCOLIS");
  expect(p.viaje.sin).toBe("FCO");
  expect(p.label).toContain("solo Italia, Portugal");
});

test("una región entera, y se guarda como grupo para otra vez", async ({ page }) => {
  await conSesion(page);
  await capturar(page);
  await abrir(page);
  await page.locator('.filtro-atajo[data-t="region"]', { hasText: "Las Islas Británicas" }).click();
  await expect(page.locator('[data-elegidos="si"]')).toContainText("Las Islas Británicas");
  page.once("dialog", (d) => d.accept("Mis islas"));
  await page.locator("[data-guardar-grupo]").click();
  await expect(page.locator("[data-grupos]")).toContainText("Mis islas");
  await page.locator("[data-limpiar]").click();
  await expect(page.locator('[data-elegidos="si"]')).toContainText("Cualquier sitio");
  // El grupo vuelve con un toque, también otro día.
  await page.locator("[data-grupo]", { hasText: "Mis islas" }).click();
  await expect(page.locator('[data-elegidos="si"]')).toContainText("Las Islas Británicas");
});

test("si se cierra sin elegir nada, vuelve a «donde sea», y con un sitio concreto no se afina", async ({ page }) => {
  await conSesion(page);
  const enviados = await capturar(page);
  await abrir(page);
  await page.locator("[data-listo]").click();
  await expect(page.locator("#fWhere")).toHaveValue("any");
  // Con un filtro puesto, elegir un sitio concreto no lo manda.
  await page.selectOption("#fWhere", "afinar");
  await page.locator('.filtro-atajo[data-t="cont"]').first().click();
  await page.locator("[data-listo]").click();
  await expect(page.locator("#fWhere")).toHaveValue("afinar");
  await page.selectOption("#fWhere", "one");
  await expect(page.locator("#destWrap")).toBeVisible();
  await page.evaluate(() => {
    const d = document.querySelector("#fDest");
    d.value = "Roma";
  });
  await page.click('[form="finderForm"]');
  await expect.poll(() => enviados.length).toBe(1);
  expect(enviados[0].client_payload.viaje).toMatchObject({ solo: "", sin: "" });
});
