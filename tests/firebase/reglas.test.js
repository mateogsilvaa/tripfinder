/* Las reglas de Firestore, probadas contra el emulador.

   Son lo único que separa a unas cuentas de otras, así que se prueban por lo
   que NO dejan hacer, que es donde se rompe la privacidad. `npm run reglas`
   levanta el emulador y las pasa; el CI hace lo mismo. */
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require("@firebase/rules-unit-testing");
const {
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  collection,
  query,
  where,
  serverTimestamp,
  setLogLevel,
} = require("firebase/firestore");

// Las denegaciones son lo que se prueba: no hace falta que el cliente las cante.
setLogLevel("silent");

let entorno;

before(async () => {
  entorno = await initializeTestEnvironment({
    projectId: "demo-tripfinder",
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, "../../firestore.rules"), "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

after(async () => {
  await entorno.cleanup();
});

/* Tres cuentas ya hechas, saltándose las reglas: ana (aprobada), bea (pendiente)
   y admin (aprobada y con `admin`). Es el estado al que llegan en la vida real
   por otros caminos: el registro y el panel. */
beforeEach(async () => {
  await entorno.clearFirestore();
  await entorno.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const base = { creado: new Date() };
    await setDoc(doc(db, "usuarios/ana"), { ...base, nombre: "Ana", correo: "ana@x.es", estado: "aprobado" });
    await setDoc(doc(db, "usuarios/bea"), { ...base, nombre: "Bea", correo: "bea@x.es", estado: "pendiente" });
    await setDoc(doc(db, "usuarios/cris"), { ...base, nombre: "Cris", correo: "cris@x.es", estado: "bloqueado" });
    await setDoc(doc(db, "usuarios/jefe"), {
      ...base,
      nombre: "Jefe",
      correo: "jefe@x.es",
      estado: "aprobado",
      admin: true,
    });
  });
});

const como = (uid, correo) => entorno.authenticatedContext(uid, { email: correo }).firestore();
const anonimo = () => entorno.unauthenticatedContext().firestore();

const ficha = (correo, extra = {}) => ({
  nombre: "Dani",
  correo,
  estado: "pendiente",
  creado: serverTimestamp(),
  ...extra,
});

/* ----------------------------------------------------------------- registro */
test("registrarse: nace pendiente, con tu correo y tu uid", async () => {
  await assertSucceeds(setDoc(doc(como("dani", "dani@x.es"), "usuarios/dani"), ficha("dani@x.es")));
});

test("registrarse: no puedes nacer aprobado", async () => {
  const db = como("dani", "dani@x.es");
  await assertFails(setDoc(doc(db, "usuarios/dani"), ficha("dani@x.es", { estado: "aprobado" })));
});

test("registrarse: no puedes nacer administrador", async () => {
  const db = como("dani", "dani@x.es");
  await assertFails(setDoc(doc(db, "usuarios/dani"), ficha("dani@x.es", { admin: true })));
});

test("registrarse: no puedes crear la ficha de otro", async () => {
  await assertFails(setDoc(doc(como("dani", "dani@x.es"), "usuarios/otro"), ficha("dani@x.es")));
});

test("registrarse: el correo de la ficha es el de la cuenta", async () => {
  await assertFails(setDoc(doc(como("dani", "dani@x.es"), "usuarios/dani"), ficha("ana@x.es")));
});

test("registrarse: sin sesión no se crea nada", async () => {
  await assertFails(setDoc(doc(anonimo(), "usuarios/dani"), ficha("dani@x.es")));
});

test("registrarse: el nombre no puede estar vacío ni ser un libro", async () => {
  const db = como("dani", "dani@x.es");
  await assertFails(setDoc(doc(db, "usuarios/dani"), ficha("dani@x.es", { nombre: "" })));
  await assertFails(setDoc(doc(db, "usuarios/dani"), ficha("dani@x.es", { nombre: "x".repeat(41) })));
});

/* ------------------------------------------------------------------- fichas */
test("cada cual lee su ficha y no la de los demás", async () => {
  const ana = como("ana", "ana@x.es");
  await assertSucceeds(getDoc(doc(ana, "usuarios/ana")));
  await assertFails(getDoc(doc(ana, "usuarios/bea")));
});

test("nadie lista las fichas salvo el administrador", async () => {
  await assertFails(getDocs(collection(como("ana", "ana@x.es"), "usuarios")));
  await assertFails(getDocs(collection(anonimo(), "usuarios")));
  const lista = await assertSucceeds(getDocs(collection(como("jefe", "jefe@x.es"), "usuarios")));
  assert.equal(lista.size, 4);
});

test("una cuenta pendiente puede leer su ficha: así sabe cuándo la aprueban", async () => {
  await assertSucceeds(getDoc(doc(como("bea", "bea@x.es"), "usuarios/bea")));
});

test("el nombre y las preferencias, cada cual los suyos", async () => {
  const ana = como("ana", "ana@x.es");
  await assertSucceeds(updateDoc(doc(ana, "usuarios/ana"), { nombre: "Anita", prefs: { chollos: "diario" } }));
});

test("nadie se aprueba a sí mismo", async () => {
  await assertFails(updateDoc(doc(como("bea", "bea@x.es"), "usuarios/bea"), { estado: "aprobado" }));
  await assertFails(updateDoc(doc(como("cris", "cris@x.es"), "usuarios/cris"), { estado: "aprobado" }));
});

test("nadie se hace administrador", async () => {
  await assertFails(updateDoc(doc(como("ana", "ana@x.es"), "usuarios/ana"), { admin: true }));
});

test("el correo de la ficha no se cambia a mano", async () => {
  await assertFails(updateDoc(doc(como("ana", "ana@x.es"), "usuarios/ana"), { correo: "otro@x.es" }));
});

test("nadie borra fichas desde el navegador", async () => {
  await assertFails(deleteDoc(doc(como("ana", "ana@x.es"), "usuarios/ana")));
  await assertFails(deleteDoc(doc(como("jefe", "jefe@x.es"), "usuarios/ana")));
});

test("el administrador aprueba, bloquea y devuelve a pendiente", async () => {
  const jefe = como("jefe", "jefe@x.es");
  await assertSucceeds(updateDoc(doc(jefe, "usuarios/bea"), { estado: "aprobado" }));
  await assertSucceeds(updateDoc(doc(jefe, "usuarios/ana"), { estado: "bloqueado" }));
  await assertSucceeds(updateDoc(doc(jefe, "usuarios/ana"), { estado: "pendiente" }));
});

test("el administrador no se bloquea a sí mismo, ni inventa estados", async () => {
  const jefe = como("jefe", "jefe@x.es");
  await assertFails(updateDoc(doc(jefe, "usuarios/jefe"), { estado: "bloqueado" }));
  await assertFails(updateDoc(doc(jefe, "usuarios/bea"), { estado: "dios" }));
});

test("el administrador tampoco reparte administraciones desde el navegador", async () => {
  await assertFails(updateDoc(doc(como("jefe", "jefe@x.es"), "usuarios/ana"), { admin: true }));
});

test("un administrador bloqueado deja de serlo", async () => {
  await entorno.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), "usuarios/jefe"), { estado: "bloqueado" });
  });
  await assertFails(getDocs(collection(como("jefe", "jefe@x.es"), "usuarios")));
});

/* ----------------------------------------------------------------- encargos */
const encargo = (owner, extra = {}) => ({
  tipo: "search",
  owner,
  payload: { origin: "MAD", destination: "ROM" },
  estado: "pendiente",
  creado: serverTimestamp(),
  ...extra,
});

test("una cuenta aprobada pide un encargo a su nombre", async () => {
  await assertSucceeds(addDoc(collection(como("ana", "ana@x.es"), "encargos"), encargo("ana")));
});

test("pendiente y bloqueada no piden nada", async () => {
  await assertFails(addDoc(collection(como("bea", "bea@x.es"), "encargos"), encargo("bea")));
  await assertFails(addDoc(collection(como("cris", "cris@x.es"), "encargos"), encargo("cris")));
  await assertFails(addDoc(collection(anonimo(), "encargos"), encargo("nadie")));
});

test("no se piden encargos a nombre de otra cuenta", async () => {
  await assertFails(addDoc(collection(como("ana", "ana@x.es"), "encargos"), encargo("jefe")));
});

test("el encargo nace pendiente y solo con los tipos conocidos", async () => {
  const ana = como("ana", "ana@x.es");
  await assertFails(addDoc(collection(ana, "encargos"), encargo("ana", { estado: "enviado" })));
  await assertFails(addDoc(collection(ana, "encargos"), encargo("ana", { tipo: "user_add" })));
  await assertFails(addDoc(collection(ana, "encargos"), encargo("ana", { tipo: "admin_password" })));
});

test("el encargo no lleva campos de más ni más de diez propiedades", async () => {
  const ana = como("ana", "ana@x.es");
  await assertFails(addDoc(collection(ana, "encargos"), encargo("ana", { extra: 1 })));
  const once = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`p${i}`, i]));
  await assertFails(addDoc(collection(ana, "encargos"), encargo("ana", { payload: once })));
  const diez = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`p${i}`, i]));
  await assertSucceeds(addDoc(collection(ana, "encargos"), encargo("ana", { payload: diez })));
});

test("cada cual ve sus encargos y no los de los demás", async () => {
  await entorno.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "encargos/e1"), { ...encargo("ana"), creado: new Date() });
    await setDoc(doc(db, "encargos/e2"), { ...encargo("jefe"), creado: new Date() });
  });
  const ana = como("ana", "ana@x.es");
  await assertSucceeds(getDoc(doc(ana, "encargos/e1")));
  await assertFails(getDoc(doc(ana, "encargos/e2")));
  const mios = await assertSucceeds(getDocs(query(collection(ana, "encargos"), where("owner", "==", "ana"))));
  assert.equal(mios.size, 1);
  // Sin filtrar por dueño, la consulta entera se rechaza: no se cuela nada.
  await assertFails(getDocs(collection(ana, "encargos")));
});

test("los encargos no se cambian ni se borran desde el navegador", async () => {
  await entorno.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "encargos/e1"), { ...encargo("ana"), creado: new Date() });
  });
  const ana = como("ana", "ana@x.es");
  await assertFails(updateDoc(doc(ana, "encargos/e1"), { estado: "enviado" }));
  await assertFails(deleteDoc(doc(ana, "encargos/e1")));
});

/* --------------------------------------------------- lo que no está escrito */
test("lo que no tiene regla está cerrado, también para el administrador", async () => {
  await entorno.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "historial/MAD-ROM"), { precios: [1, 2, 3] });
  });
  for (const db of [anonimo(), como("ana", "ana@x.es"), como("jefe", "jefe@x.es")]) {
    await assertFails(getDoc(doc(db, "historial/MAD-ROM")));
    await assertFails(setDoc(doc(db, "historial/MAD-ROM"), { precios: [] }));
  }
});
