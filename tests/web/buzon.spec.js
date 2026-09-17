/* Pedir una cuenta eligiendo TU contraseña, y que aprobarla sea un clic.

   EL NUDO. Para que una cuenta nazca activa hacen falta dos cosas que nunca
   están en el mismo sitio: la contraseña, que solo sabe quien la pide, y la
   clave maestra, que solo tiene quien aprueba. Sin las dos no hay sobre, y sin
   sobre la cuenta entra en la web pero no puede lanzar ni una búsqueda. Por eso
   aprobar era: inventar una contraseña, escribirla a mano y salir a decírsela
   por otro lado.

   EL BUZÓN las junta sin que ninguna viaje en claro. Quien pide la cuenta cierra
   su correo y su contraseña con la clave pública del panel —publicada, para eso
   es pública— y el panel las abre con la privada, que vive cifrada con la
   maestra.

   Aquí se prueba de punta a punta y con criptografía de verdad: las claves se
   generan en el propio navegador de la prueba, y lo que se comprueba es que lo
   que sale del formulario se abre con la privada y con nada más. */
const { test, expect } = require("@playwright/test");

/* Un par de claves RSA-OAEP, hecho en la página como lo haría el panel.

   Hay que estar EN la web para generarlas: `crypto.subtle` solo existe en
   contexto seguro, y `about:blank` no lo es. Es la misma razón por la que la
   web no funciona abierta con `file://`, y está dicha en `auth.js`. */
async function nuevoBuzon(page) {
  if (!page.url().startsWith("http")) {
    await page.goto("/404.html", { waitUntil: "domcontentloaded" });
  }
  return page.evaluate(async () => {
    const par = await crypto.subtle.generateKey(
      { name: "RSA-OAEP", hash: "SHA-256", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
      true,
      ["encrypt", "decrypt"]
    );
    const b64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));
    return {
      pub: b64(await crypto.subtle.exportKey("spki", par.publicKey)),
      priv: b64(await crypto.subtle.exportKey("pkcs8", par.privateKey)),
    };
  });
}

const usuarios = (buzon) => ({
  updated: "2026-09-17",
  admin: buzon ? { buzon: { pub: buzon.pub, priv: { iv: "x", data: "y" } } } : {},
  users: [{ id: "u-2", user: "ana", name: "Ana", active: true }],
  site: {},
});

/* Abrir un sobre desde la prueba, con la privada en la mano. Es lo que hace el
   panel; hacerlo aquí es lo que prueba que ahí dentro está lo que tiene que
   estar y nada más. */
async function abrirSobre(page, privB64, sellado) {
  return page.evaluate(
    async ([priv, caja]) => {
      const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
      const RSA = { name: "RSA-OAEP", hash: "SHA-256" };
      const privada = await crypto.subtle.importKey("pkcs8", deB64(priv), RSA, false, ["decrypt"]);
      const cruda = await crypto.subtle.decrypt(RSA, privada, deB64(caja.k));
      const sesion = await crypto.subtle.importKey("raw", cruda, { name: "AES-GCM" }, false, ["decrypt"]);
      const claro = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: deB64(caja.iv) },
        sesion,
        deB64(caja.data)
      );
      return JSON.parse(new TextDecoder().decode(claro));
    },
    [privB64, sellado]
  );
}

const abrirForm = async (page, buzon) => {
  await page.route("**/data/users.json*", (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify(usuarios(buzon)) })
  );
  await page.goto("/buscar.html", { waitUntil: "domcontentloaded" });
  const puerta = page.locator("[data-pedir-cuenta]").first();
  await puerta.waitFor({ state: "attached" });
  await puerta.evaluate((b) => b.click());
  await expect(page.locator("#pedirCuenta")).toBeVisible();
};

const rellenar = async (page, { pass = "unaclavelarga", pass2 = null, email = "lucia@ejemplo.com" } = {}) => {
  await page.locator("#pcNombre").fill("Lucía Pérez");
  await page.locator("#pcUser").fill("lucia");
  await page.locator("#pcPorque").fill("Me gustaría tener acceso para poder viajar más.");
  if (await page.locator("#pcPass").count()) {
    await page.locator("#pcEmail").fill(email);
    await page.locator("#pcPass").fill(pass);
    await page.locator("#pcPass2").fill(pass2 === null ? pass : pass2);
  }
};

/* La petición sale abriendo GitHub: se sella la ventana para poder leer la
   dirección, que es donde viaja el cuerpo de la issue. */
async function mandar(page, context) {
  await context.route("https://github.com/**", (r) =>
    r.fulfill({ contentType: "text/html", body: "<p>ok</p>" })
  );
  const [nueva] = await Promise.all([
    context.waitForEvent("page"),
    page.locator("#pcMandar").click(),
  ]);
  return decodeURIComponent(nueva.url());
}

const sobreDe = (cuerpo) => {
  const m = /```tf-sobre\s*\n([\s\S]*?)\n```/i.exec(cuerpo);
  return m ? JSON.parse(m[1].trim()) : null;
};

test.describe("el formulario", () => {
  test("con buzón pide el correo y la contraseña", async ({ page }) => {
    const buzon = await nuevoBuzon(page);
    await abrirForm(page, buzon);
    await expect(page.locator("#pcEmail")).toBeVisible();
    await expect(page.locator("#pcPass")).toBeVisible();
    await expect(page.locator("#pcPass2")).toBeVisible();
    await expect(page.locator("#pedirBody")).toContainText(/elige aquí tu contraseña/i);
  });

  test("sin buzón no los pide, y no promete lo que no puede", async ({ page }) => {
    // Una web recién montada, sin token y por tanto sin maestra: pedir una
    // contraseña aquí sería mandarla a una issue pública en claro.
    await abrirForm(page, null);
    await expect(page.locator("#pcNombre")).toBeVisible();
    await expect(page.locator("#pcPass")).toHaveCount(0);
    await expect(page.locator("#pedirBody")).toContainText(/te pasa la contraseña/i);
  });

  test("la contraseña corta no se manda", async ({ page }) => {
    const buzon = await nuevoBuzon(page);
    await abrirForm(page, buzon);
    await rellenar(page, { pass: "corta" });
    await page.locator("#pcMandar").click();
    await expect(page.locator("#pcMsg")).toContainText(/8 caracteres/i);
  });

  test("dos contraseñas distintas tampoco", async ({ page }) => {
    // Aquí no hay «he olvidado mi contraseña»: si se cuela una errata, la
    // cuenta nace con una contraseña que no sabe nadie.
    const buzon = await nuevoBuzon(page);
    await abrirForm(page, buzon);
    await rellenar(page, { pass: "unaclavelarga", pass2: "otraclavelarga" });
    await page.locator("#pcMandar").click();
    await expect(page.locator("#pcMsg")).toContainText(/no son la misma/i);
  });

  test("un correo que no es un correo se dice antes de mandar", async ({ page }) => {
    const buzon = await nuevoBuzon(page);
    await abrirForm(page, buzon);
    await rellenar(page, { email: "esto no es un correo" });
    await page.locator("#pcMandar").click();
    await expect(page.locator("#pcMsg")).toContainText(/no parece un correo/i);
  });

  test("y el correo puede quedarse vacío", async ({ page, context }) => {
    const buzon = await nuevoBuzon(page);
    await abrirForm(page, buzon);
    await rellenar(page, { email: "" });
    const url = await mandar(page, context);
    expect(sobreDe(url)).toBeTruthy();
  });
});

test.describe("lo que viaja en la issue", () => {
  test("va el sobre, y ni el correo ni la contraseña en claro", async ({ page, context }) => {
    const buzon = await nuevoBuzon(page);
    await abrirForm(page, buzon);
    await rellenar(page);
    const url = await mandar(page, context);

    // Lo público sigue siendo público: es lo que quien aprueba tiene que leer.
    expect(url).toContain("[cuenta] lucia");
    expect(url).toContain("poder viajar más");
    // Y lo que no puede estar, no está. La issue es pública.
    expect(url).not.toContain("lucia@ejemplo.com");
    expect(url).not.toMatch(/[\w.]+@[\w.]+\.[\w]+/);
    expect(url).not.toContain("unaclavelarga");
    expect(sobreDe(url)).toBeTruthy();
  });

  test("y el sobre se abre con la privada, con lo que se escribió dentro", async ({ page, context }) => {
    const buzon = await nuevoBuzon(page);
    await abrirForm(page, buzon);
    await rellenar(page);
    const sellado = sobreDe(await mandar(page, context));
    expect(await abrirSobre(page, buzon.priv, sellado)).toEqual({
      email: "lucia@ejemplo.com",
      pass: "unaclavelarga",
    });
  });

  test("otra clave privada NO lo abre", async ({ page, context }) => {
    // Lo que hace que esto se pueda publicar: cualquiera puede cerrar un sobre
    // para el panel, y nadie más puede abrirlo.
    const buzon = await nuevoBuzon(page);
    const otro = await nuevoBuzon(page);
    await abrirForm(page, buzon);
    await rellenar(page);
    const sellado = sobreDe(await mandar(page, context));
    await expect(abrirSobre(page, otro.priv, sellado)).rejects.toThrow();
  });

  test("dos peticiones iguales no dan el mismo sobre", async ({ page, context }) => {
    // Sin esto, dos sobres idénticos delatarían que dos personas han puesto la
    // misma contraseña. El AES va con IV nuevo cada vez.
    const buzon = await nuevoBuzon(page);
    await abrirForm(page, buzon);
    await rellenar(page);
    const uno = sobreDe(await mandar(page, context));
    await abrirForm(page, buzon);
    await rellenar(page);
    const dos = sobreDe(await mandar(page, context));
    expect(uno.data).not.toBe(dos.data);
    expect(uno.iv).not.toBe(dos.iv);
  });
});

/* ------------------------------------------------------ y cómo se aprueba */

test.describe("el panel", () => {
  // 32 bytes exactos: es lo que mide una clave AES-256, y `importKey` lo exige.
  const MAESTRA = "bWFlc3RyYS1kZS1tZW50aXJhLWRlLTMyLWJ5dGVzISE=";
  const PASS = "unaclavelarga";

  /* Un panel con la maestra abierta y un buzón suyo, que es el estado normal
     de alguien que acaba de entrar. Las dos mitades en la misma pantalla: eso
     es lo que hace que aprobar pueda ser un clic. */
  async function conPanel(page, { sellar = true, pass = PASS, email = "lucia@ejemplo.com" } = {}) {
    await page.goto("/404.html", { waitUntil: "domcontentloaded" });
    const buzon = await nuevoBuzon(page);

    // La privada, cerrada con la maestra: es como se publica de verdad.
    const priv = await page.evaluate(
      async ([maestra, pkcs8]) => {
        const b64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));
        const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
        const clave = await crypto.subtle.importKey(
          "raw", deB64(maestra), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]
        );
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const datos = await crypto.subtle.encrypt(
          { name: "AES-GCM", iv }, clave, new TextEncoder().encode(pkcs8)
        );
        return { iv: b64(iv), data: b64(datos) };
      },
      [MAESTRA, buzon.priv]
    );

    // Y el sobre de la petición, cerrado con la pública como lo cerraría quien
    // pide la cuenta desde el formulario.
    const sellado = sellar
      ? await page.evaluate(
          async ([pub, dentro]) => {
            const b64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));
            const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
            const RSA = { name: "RSA-OAEP", hash: "SHA-256" };
            const publica = await crypto.subtle.importKey("spki", deB64(pub), RSA, false, ["encrypt"]);
            const sesion = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const datos = await crypto.subtle.encrypt(
              { name: "AES-GCM", iv }, sesion, new TextEncoder().encode(JSON.stringify(dentro))
            );
            const cruda = await crypto.subtle.exportKey("raw", sesion);
            return {
              k: b64(await crypto.subtle.encrypt(RSA, publica, cruda)),
              iv: b64(iv),
              data: b64(datos),
            };
          },
          [buzon.pub, { email, pass }]
        )
      : null;

    const cuerpo = [
      "Nombre: Lucía Pérez", "Usuario: lucia", "", "Por qué:",
      "Soy la hermana de Mateo y volamos juntos casi todos los findes.", "", "---",
      ...(sellado ? ["```tf-sobre", JSON.stringify(sellado), "```"] : []),
    ].join("\n");

    const issues = [
      {
        number: 12,
        html_url: "https://github.com/mateogsilvaa/tripfinder/issues/12",
        title: "[cuenta] lucia",
        created_at: "2026-09-17T10:02:00Z",
        user: { login: "luciaperez" },
        body: cuerpo,
      },
    ];

    const enviados = [];
    const parches = [];
    await page.route("https://api.github.com/**", (r) => {
      const req = r.request();
      const cuerpoReq = req.postData() || "";
      if (req.method() === "POST" && req.url().includes("/dispatches")) {
        enviados.push(JSON.parse(cuerpoReq));
        return r.fulfill({ status: 204, body: "" });
      }
      if (req.method() === "PATCH") {
        parches.push(JSON.parse(cuerpoReq));
        return r.fulfill({ contentType: "application/json", body: "{}" });
      }
      return r.fulfill({ contentType: "application/json", body: JSON.stringify(issues) });
    });
    await page.route("**/data/users.json*", (r) =>
      r.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          updated: "2026-09-17",
          admin: { buzon: { pub: buzon.pub, priv } },
          users: [],
          site: {},
        }),
      })
    );

    // El panel solo recupera la maestra de `sessionStorage` cuando se da por
    // abierto: sin la marca, entra pero sin clave, que es justo el caso que
    // prueba la última de aquí abajo.
    await page.addInitScript((m) => {
      try {
        sessionStorage.setItem("tf_token_abierto", "token-de-mentira");
        // `tfDispatch` mira el de localStorage: sin él no llega a la red y el
        // panel contesta que falta el token, que es verdad pero no es el caso.
        localStorage.setItem("tf_token", "token-de-mentira");
        sessionStorage.setItem("tf_maestra", m);
        sessionStorage.setItem("tf_admin_abierto", String(Date.now()));
      } catch (e) { /* nada */ }
    }, MAESTRA);
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      document.querySelector("#panelAdmin").hidden = false;
    });
    await page.evaluate(() => window.pintarPeticiones());
    return { enviados, parches, buzon };
  }

  test("la petición con sobre se aprueba, no se rellena a mano", async ({ page }) => {
    await conPanel(page);
    await expect(page.locator("[data-aprobar]")).toBeVisible();
    await expect(page.locator("[data-crear]")).toHaveCount(0);
  });

  test("y sin sobre sigue siendo «Crear la cuenta»", async ({ page }) => {
    // Las peticiones de antes del buzón tienen que seguir pudiéndose atender.
    await conPanel(page, { sellar: false });
    await expect(page.locator("[data-crear]")).toBeVisible();
    await expect(page.locator("[data-aprobar]")).toHaveCount(0);
  });

  test("aprobar crea la cuenta con lo que venía dentro del sobre", async ({ page }) => {
    const { enviados } = await conPanel(page);
    await page.locator("[data-aprobar]").click();
    await expect.poll(() => enviados.length, { timeout: 15000 }).toBe(1);

    const p = enviados[0].client_payload;
    expect(enviados[0].event_type).toBe("user_add");
    expect(p.user).toBe("lucia");
    expect(p.name).toBe("Lucía Pérez");
    // El correo llega sin que nadie lo haya tecleado ni haya pasado por la issue.
    expect(p.email).toBe("lucia@ejemplo.com");
    expect(p.salt && p.hash && p.iterations).toBeTruthy();
    // Y el sobre: sin él la cuenta entraría en la web sin poder lanzar nada.
    expect(p.sobre && p.sobre.data).toBeTruthy();
  });

  test("la contraseña que se guarda es la que eligió, y su sobre abre el token",
    async ({ page }) => {
      // Esto es la prueba de verdad: que las dos mitades han cuadrado. El hash
      // valida su contraseña y su sobre devuelve la clave maestra, que es lo
      // que le deja lanzar búsquedas desde el primer minuto.
      const { enviados } = await conPanel(page);
      await page.locator("[data-aprobar]").click();
      await expect.poll(() => enviados.length, { timeout: 15000 }).toBe(1);
      const p = enviados[0].client_payload;

      const comprobado = await page.evaluate(
        async ([pass, cred, sobre]) => ({
          entra: await tfComprobar(pass, cred),
          maestra: await tfAbrirSobre(pass, sobre),
          conOtra: await tfComprobar("otracosadistinta", cred),
        }),
        [PASS, { salt: p.salt, hash: p.hash, iterations: p.iterations }, p.sobre]
      );
      expect(comprobado.entra).toBe(true);
      expect(comprobado.conOtra).toBe(false);
      expect(comprobado.maestra).toBe(MAESTRA);
    });

  test("al aprobar se cierra la issue y se le retira el sobre", async ({ page }) => {
    // Cerrarla sola dejaría el texto cifrado publicado para siempre. No es
    // legible sin la privada, pero lo que no hace falta que siga ahí, no sigue.
    const { parches } = await conPanel(page);
    await page.locator("[data-aprobar]").click();
    await expect.poll(() => parches.length, { timeout: 15000 }).toBe(1);
    expect(parches[0].state).toBe("closed");
    expect(parches[0].body).not.toContain("tf-sobre");
    expect(parches[0].body).toContain("Lucía Pérez");
  });

  test("y se dice que no hay que darle ninguna contraseña", async ({ page }) => {
    const { enviados } = await conPanel(page);
    await page.locator("[data-aprobar]").click();
    await expect.poll(() => enviados.length, { timeout: 15000 }).toBe(1);
    await expect(page.locator("#avisoCuentas")).toContainText(/no tienes que darle ninguna/i);
  });

  test("sin la maestra no se intenta: se dice qué hacer", async ({ page }) => {
    const { enviados } = await conPanel(page);
    // Se le quita la clave y se vuelve a entrar: el panel sigue abierto —la
    // marca de tiempo está— pero sin maestra no hay con qué abrir el sobre.
    await page.addInitScript(() => {
      try {
        sessionStorage.removeItem("tf_maestra");
      } catch (e) { /* nada */ }
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      document.querySelector("#panelAdmin").hidden = false;
    });
    await page.evaluate(() => window.pintarPeticiones());
    await page.locator("[data-aprobar]").click();
    await expect(page.locator("#avisoCuentas")).toContainText(/contraseña del panel/i);
    expect(enviados).toEqual([]);
  });
});
