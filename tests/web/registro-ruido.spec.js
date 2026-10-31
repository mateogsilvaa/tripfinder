/* El registro de errores apunta lo que falla de verdad, no el ruido: un 409
   de Firestore en un `:commit` es «eso ya existe» (lo trata quien escribe), y
   un fallo de red con la página oculta es el móvil dormido. */
const { test, expect } = require("@playwright/test");

const errores = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("tf_errores") || "[]"));

test("un 409 de Firestore al escribir no es un error", async ({ page }) => {
  await page.goto("/index.html");
  await page.route("https://firestore.googleapis.com/**", (r) => r.fulfill({ status: r.request().url().endsWith(":commit") ? 409 : 500, body: "{}" }));
  await page.evaluate(async () => {
    localStorage.removeItem("tf_errores");
    const base = "https://firestore.googleapis.com/v1/projects/x/databases/(default)/documents";
    await fetch(`${base}:commit`, { method: "POST", body: "{}" });
    await fetch(`${base}:runQuery`, { method: "POST", body: "{}" });
  });
  const lista = await errores(page);
  expect(lista.map((e) => e.mensaje || e.m || JSON.stringify(e)).join("\n")).not.toContain(":commit");
  // El 500 sí: ese es de verdad.
  expect(JSON.stringify(lista)).toContain("500");
});

test("sin conexión, un fallo de red no se apunta", async ({ page, context }) => {
  await page.goto("/index.html");
  await page.evaluate(() => localStorage.removeItem("tf_errores"));
  await context.setOffline(true);
  await page.evaluate(() => fetch("https://example.invalid/x").catch(() => {}));
  await context.setOffline(false);
  expect(JSON.stringify(await errores(page))).not.toContain("example.invalid");
});
