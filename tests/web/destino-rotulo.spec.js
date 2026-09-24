/* El botón del destino dice lo que hay en el campo, venga de donde venga.

   El destino no siempre se elige en el diálogo: también llega en la URL, que es
   como viaja de la portada a la herramienta entera (`ampliar.js`) y como lo
   ponen los enlaces que traen un viaje ya pensado —la ruta de Interrail, con
   su vuelo de entrada y el de salida—. Ese camino rellenaba el campo escondido
   pero nadie tocaba el botón, así que la página se abría diciendo «Elegir
   destino» encima de un formulario que iba a buscar Budapest. Parecía vacío y
   no lo estaba: pulsar Buscar habría lanzado ocho minutos de barrido a un sitio
   que nadie veía elegido. */
const { test, expect } = require("@playwright/test");

const conSesion = async (page) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("tf_sesion", JSON.stringify({ uid: "u-d", user: "d", name: "D" }));
      localStorage.setItem("tf_token", "ghp_de_mentira");
    } catch (e) { /* nada */ }
  });
};

test.describe("el rótulo del destino", () => {
  test("llegando con el destino en la URL, el botón lo dice", async ({ page }) => {
    await page.goto("/buscar.html?donde=one&dest=BUD", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(700);
    await expect(page.locator("#fDest")).toHaveValue("BUD");
    await expect(page.locator("#destBtn")).toHaveText("BUD");
  });

  test("y sin `ir=1` no lanza nada: rellena y espera a que pulses", async ({ page }) => {
    // Un enlace que trae un viaje pensado no puede lanzar ocho minutos de
    // búsqueda por su cuenta: la búsqueda la decide quien pulsa.
    let despachos = 0;
    await page.route("**/api.github.com/**", (r) => {
      despachos += 1;
      r.fulfill({ status: 204, body: "" });
    });
    await page.goto("/buscar.html?donde=one&dest=BUD", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);
    expect(despachos).toBe(0);
  });

  test("elegido en el diálogo, igual que siempre", async ({ page }) => {
    await conSesion(page);
    await page.goto("/buscar.html", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#finderForm:not(.candado)", { timeout: 10000 });
    await page.selectOption("#fWhere", "one");
    await page.click("#destBtn");
    await expect(page.locator("#destModal")).toBeVisible();
    const opcion = page.locator("#destList [data-valor]").first();
    const valor = await opcion.getAttribute("data-valor");
    await opcion.click();
    await expect(page.locator("#fDest")).toHaveValue(valor);
    await expect(page.locator("#destBtn")).toHaveText(valor);
  });

  test("y en la página de seguir, con su propio par de campo y botón", async ({ page }) => {
    await page.goto("/seguimientos.html", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      const el = document.querySelector("#wDest");
      el.value = "PRG";
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(page.locator("#wDestBtn")).toHaveText("PRG");
  });

  test("vaciar el campo devuelve el rótulo de siempre", async ({ page }) => {
    // No se queda colgado el último destino: si el campo se vacía, el botón
    // vuelve a pedir que elijas.
    await page.goto("/buscar.html?donde=one&dest=BUD", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(700);
    await page.evaluate(() => {
      const el = document.querySelector("#fDest");
      el.value = "";
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(page.locator("#destBtn")).toHaveText("Elegir destino");
  });
});
