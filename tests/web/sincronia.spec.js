// @ts-check
/* Lo mismo en el móvil y en el ordenador: lo que se guarda con la cuenta viaja a
   la ficha (`prefs.sync`) y vuelve en el otro aparato. La nube se simula: lo que
   se comprueba es el motor, no Firestore. */
const { test, expect } = require("@playwright/test");

const UID = "u-prueba";

async function abrir(page, local = {}) {
  await page.addInitScript(
    ([uid, datos]) => {
      if (localStorage.getItem("tf_sesion")) return;
      localStorage.setItem(
        "tf_sesion",
        JSON.stringify({ uid, user: "Ana", name: "Ana", prefs: {}, estado: "aprobado", plan: "max", nube: true })
      );
      Object.entries(datos).forEach(([k, v]) => localStorage.setItem(k, v));
    },
    [UID, local]
  );
  await page.goto("/index.html", { waitUntil: "load" });
  // Una nube de mentira: lo que hay en la ficha y lo que se sube.
  await page.evaluate(() => {
    window.__ficha = {};
    window.__subidas = [];
    window.nubeActiva = () => true;
    window.nubeToken = async () => "t";
    window.nubeLeerDoc = async () => ({ prefs: { sync: window.__ficha } });
    window.nubeSubirSincronia = async (entradas) => {
      window.__subidas.push(entradas);
      Object.assign(window.__ficha, entradas);
      return true;
    };
  });
}

test.describe("la cuenta en varios aparatos", () => {
  test("lo que cambias aquí se sube a la ficha", async ({ page }) => {
    await abrir(page);
    await page.evaluate((uid) => localStorage.setItem(`tf_grupo:${uid}`, JSON.stringify({ adultos: 3 })), UID);
    await expect.poll(() => page.evaluate(() => window.__subidas.length), { timeout: 10000 }).toBeGreaterThan(0);
    const subido = await page.evaluate(() => window.__ficha.grupo);
    expect(JSON.parse(subido.v)).toEqual({ adultos: 3 });
    expect(subido.t).toBeGreaterThan(1);
  });

  test("lo que dejó el otro aparato llega aquí y avisa", async ({ page }) => {
    await abrir(page);
    await page.evaluate(() => {
      window.__ficha.quiz = { t: Date.now() + 1000, v: JSON.stringify({ gustos: ["playa"] }) };
      document.dispatchEvent(new CustomEvent("tf:ficha", { detail: { sync: window.__ficha } }));
    });
    await expect.poll(() => page.evaluate((u) => localStorage.getItem(`tf_quiz:${u}`), UID)).toContain("playa");
    await expect(page.locator(".deshacer")).toContainText("otro dispositivo");
  });

  test("los favoritos se juntan: lo de cada aparato se queda", async ({ page }) => {
    const mio = { "a-1": { id: "a-1", origen: "MAD", destino: "LIS" } };
    await abrir(page, { [`tf_favoritos:${UID}`]: JSON.stringify(mio) });
    await page.evaluate(() => {
      const otro = { "b-2": { id: "b-2", origen: "MAD", destino: "ROM" } };
      window.__ficha.favoritos = { t: Date.now() + 1000, v: JSON.stringify({ i: otro, t: { "b-2": Date.now() + 1000 }, d: {} }) };
      document.dispatchEvent(new CustomEvent("tf:ficha", { detail: { sync: window.__ficha } }));
    });
    await expect
      .poll(() => page.evaluate((u) => Object.keys(JSON.parse(localStorage.getItem(`tf_favoritos:${u}`))).sort(), UID))
      .toEqual(["a-1", "b-2"]);
    // y lo de aquí también sube, para que el otro aparato lo vea
    const subido = await page.evaluate(() => JSON.parse(window.__ficha.favoritos.v));
    expect(Object.keys(subido.i).sort()).toEqual(["a-1", "b-2"]);
  });

  test("lo que borras aquí se borra allí, aunque el otro aparato lo tuviera", async ({ page }) => {
    const mio = { "a-1": { id: "a-1" }, "c-3": { id: "c-3" } };
    await abrir(page, { [`tf_favoritos:${UID}`]: JSON.stringify(mio) });
    await page.evaluate((uid) => {
      const k = `tf_favoritos:${uid}`;
      const f = JSON.parse(localStorage.getItem(k));
      delete f["c-3"];
      localStorage.setItem(k, JSON.stringify(f));
    }, UID);
    await expect.poll(() => page.evaluate(() => window.__subidas.length), { timeout: 10000 }).toBeGreaterThan(0);
    const subido = await page.evaluate(() => JSON.parse(window.__ficha.favoritos.v));
    expect(Object.keys(subido.i)).toEqual(["a-1"]);
    expect(Object.keys(subido.d)).toEqual(["c-3"]);
  });

  test("sin cuenta de la nube no se toca nada", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "load" });
    await page.evaluate(() => localStorage.setItem("tf_grupo", "{}"));
    expect(await page.evaluate(() => localStorage.getItem("tf_sync_meta:undefined"))).toBeNull();
  });
});
