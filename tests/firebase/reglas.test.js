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
  writeBatch,
  arrayUnion,
  arrayRemove,
  deleteField,
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
    // Ana es de antes de los planes (sin `plan`): premium. Gus se registró con
    // la web abierta: aprobado y gratis.
    await setDoc(doc(db, "usuarios/ana"), { ...base, nombre: "Ana", correo: "ana@x.es", estado: "aprobado" });
    await setDoc(doc(db, "usuarios/gus"), { ...base, nombre: "Gus", correo: "gus@x.es", estado: "aprobado", plan: "gratis" });
    await setDoc(doc(db, "usuarios/bea"), { ...base, nombre: "Bea", correo: "bea@x.es", estado: "pendiente" });
    await setDoc(doc(db, "usuarios/cris"), { ...base, nombre: "Cris", correo: "cris@x.es", estado: "bloqueado" });
    // Eva ya verificó su correo; Bea (arriba) no.
    await setDoc(doc(db, "usuarios/eva"), { ...base, nombre: "Eva", correo: "eva@x.es", estado: "pendiente", verificado: true });
    // Las cuentas de antes de Firebase, copiadas con `tripfinder migrar-cuentas`.
    await setDoc(doc(db, "cuentas_antiguas/u-aaaaaaaa"), { usuario: "eva", nombre: "Eva", correo: "eva@x.es", activa: true });
    await setDoc(doc(db, "cuentas_antiguas/u-bbbbbbbb"), { usuario: "ana", nombre: "Ana", correo: "ana@x.es", activa: true });
    await setDoc(doc(db, "usuarios/jefe"), {
      ...base,
      nombre: "Jefe",
      correo: "jefe@x.es",
      estado: "aprobado",
      admin: true,
    });
  });
});

const como = (uid, correo, verificado = false) =>
  entorno.authenticatedContext(uid, { email: correo, email_verified: verificado }).firestore();
const anonimo = () => entorno.unauthenticatedContext().firestore();

const ficha = (correo, extra = {}) => ({
  nombre: "Dani",
  correo,
  estado: "aprobado",
  plan: "gratis",
  creado: serverTimestamp(),
  ...extra,
});

/* ----------------------------------------------------------------- registro */
test("registrarse: la web es abierta, nace aprobada y gratis, con tu correo y tu uid", async () => {
  await assertSucceeds(setDoc(doc(como("dani", "dani@x.es"), "usuarios/dani"), ficha("dani@x.es")));
});

test("registrarse: no puedes nacer premium, ni aprobada sin plan", async () => {
  const db = como("dani", "dani@x.es");
  await assertFails(setDoc(doc(db, "usuarios/dani"), ficha("dani@x.es", { plan: "premium" })));
  const sinPlan = ficha("dani@x.es");
  delete sinPlan.plan;
  await assertFails(setDoc(doc(db, "usuarios/dani"), sinPlan));
});

test("registrarse con una web de antes en caché: pendiente y sin plan sigue valiendo", async () => {
  const vieja = ficha("dani@x.es", { estado: "pendiente" });
  delete vieja.plan;
  await assertSucceeds(setDoc(doc(como("dani", "dani@x.es"), "usuarios/dani"), vieja));
  await assertFails(
    setDoc(doc(como("dani", "dani@x.es"), "usuarios/dani"), ficha("dani@x.es", { estado: "pendiente" }))
  );
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
  assert.equal(lista.size, 6);
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

test("nadie se hace premium", async () => {
  await assertFails(updateDoc(doc(como("gus", "gus@x.es"), "usuarios/gus"), { plan: "premium" }));
});

test("el administrador da y quita premium, y no inventa planes", async () => {
  const jefe = como("jefe", "jefe@x.es");
  await assertSucceeds(updateDoc(doc(jefe, "usuarios/gus"), { plan: "premium" }));
  await assertSucceeds(updateDoc(doc(jefe, "usuarios/gus"), { plan: "gratis" }));
  await assertSucceeds(updateDoc(doc(jefe, "usuarios/bea"), { estado: "aprobado", plan: "gratis" }));
  await assertFails(updateDoc(doc(jefe, "usuarios/gus"), { plan: "oro" }));
  await assertFails(updateDoc(doc(jefe, "usuarios/jefe"), { plan: "gratis" }));
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

test("una cuenta premium pide un encargo a su nombre", async () => {
  await assertSucceeds(addDoc(collection(como("ana", "ana@x.es"), "encargos"), encargo("ana")));
});

test("de momento premium no se exige: una cuenta gratis también pide encargos", async () => {
  await assertSucceeds(addDoc(collection(como("gus", "gus@x.es"), "encargos"), encargo("gus")));
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

/* --------------------------------------------------------------- resultados */
test("los resultados se leen sin cuenta, de uno en uno, y nadie los escribe", async () => {
  await entorno.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "resultados/stay-x"), { json: "{}", creado: new Date() });
  });
  await assertSucceeds(getDoc(doc(anonimo(), "resultados/stay-x")));
  await assertFails(getDocs(collection(anonimo(), "resultados")));
  for (const db of [anonimo(), como("ana", "ana@x.es"), como("jefe", "jefe@x.es")]) {
    await assertFails(setDoc(doc(db, "resultados/stay-y"), { json: "{}" }));
    await assertFails(updateDoc(doc(db, "resultados/stay-x"), { json: "[]" }));
    await assertFails(deleteDoc(doc(db, "resultados/stay-x")));
  }
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

/* Las issues pasadas a Firestore llevan nombres y usuarios de quien pidió una
   cuenta: solo entran y salen con la cuenta de servicio. */
test("las issues copiadas no las lee ni las escribe nadie desde el navegador", async () => {
  await entorno.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "issues/125"), { tipo: "peticion_cuenta", titulo: "[cuenta] x" });
  });
  for (const db of [anonimo(), como("ana", "ana@x.es"), como("jefe", "jefe@x.es")]) {
    await assertFails(getDoc(doc(db, "issues/125")));
    await assertFails(getDocs(collection(db, "issues")));
    await assertFails(setDoc(doc(db, "issues/126"), { tipo: "tarea" }));
    await assertFails(deleteDoc(doc(db, "issues/125")));
  }
});

/* ------------------------------------------------- cuentas de antes de Firebase */
test("verificarse: solo vale lo que dice el token de Firebase", async () => {
  // Eva ha verificado su correo de verdad: su token lo dice.
  await assertSucceeds(updateDoc(doc(como("eva", "eva@x.es", true), "usuarios/eva"), { verificado: true }));
  // Bea no lo ha verificado: no puede escribir que sí.
  await assertFails(updateDoc(doc(como("bea", "bea@x.es", false), "usuarios/bea"), { verificado: true }));
  // Y sí puede escribir la verdad.
  await assertSucceeds(updateDoc(doc(como("bea", "bea@x.es", false), "usuarios/bea"), { verificado: false }));
});

test("nadie se vincula a sí mismo con una cuenta de antes", async () => {
  const eva = como("eva", "eva@x.es", true);
  await assertFails(updateDoc(doc(eva, "usuarios/eva"), { legado: "u-aaaaaaaa" }));
  await assertFails(updateDoc(doc(eva, "usuarios/eva"), { legado: "u-aaaaaaaa", estado: "aprobado" }));
});

// Vincular ya no existe: ni el administrador puede ponerle a alguien una cuenta
// de antes. Quien no migró a tiempo entra como cuenta nueva.
test("ya nadie vincula cuentas de antes, ni el administrador", async () => {
  const jefe = como("jefe", "jefe@x.es");
  await assertFails(updateDoc(doc(jefe, "usuarios/eva"), { legado: "u-aaaaaaaa", estado: "aprobado", plan: "premium" }));
  await assertFails(updateDoc(doc(jefe, "cuentas_antiguas/u-aaaaaaaa"), { vinculada: "eva" }));
  // Lo de siempre sí: darle premium.
  await assertSucceeds(updateDoc(doc(jefe, "usuarios/eva"), { estado: "aprobado", plan: "premium" }));
});

test("las cuentas antiguas (con sus correos) solo las ve el administrador", async () => {
  for (const db of [anonimo(), como("ana", "ana@x.es"), como("eva", "eva@x.es", true)]) {
    await assertFails(getDoc(doc(db, "cuentas_antiguas/u-aaaaaaaa")));
    await assertFails(getDocs(collection(db, "cuentas_antiguas")));
    await assertFails(setDoc(doc(db, "cuentas_antiguas/u-cccccccc"), { correo: "x@x.es" }));
    await assertFails(deleteDoc(doc(db, "cuentas_antiguas/u-aaaaaaaa")));
  }
  const todas = await assertSucceeds(getDocs(collection(como("jefe", "jefe@x.es"), "cuentas_antiguas")));
  assert.equal(todas.size, 2);
});

test("nadie borra ni crea cuentas antiguas desde el navegador, ni el administrador", async () => {
  const jefe = como("jefe", "jefe@x.es");
  await assertFails(setDoc(doc(jefe, "cuentas_antiguas/u-cccccccc"), { correo: "x@x.es" }));
  await assertFails(deleteDoc(doc(jefe, "cuentas_antiguas/u-aaaaaaaa")));
});

/* --------------------------------------------------------------- actividad */
const caduca = () => new Date(Date.now() + 90 * 24 * 3600 * 1000);
const act = (extra = {}) => ({
  tipo: "pantalla",
  uid: null,
  pantalla: "buscar",
  segundos: 42,
  visitas: 1,
  creado: serverTimestamp(),
  caduca: caduca(),
  ...extra,
});

test("actividad: sin cuenta se apunta tiempo y errores, pero sin uid", async () => {
  await assertSucceeds(setDoc(doc(anonimo(), "actividad/a1"), act()));
  const error = { tipo: "error", uid: null, pantalla: "portada", mensaje: "js: x is undefined", creado: serverTimestamp(), caduca: caduca() };
  await assertSucceeds(setDoc(doc(anonimo(), "actividad/a2"), error));
  await assertFails(setDoc(doc(anonimo(), "actividad/a3"), act({ uid: "ana" })));
});

test("actividad: con cuenta, solo con tu uid; y entrar solo con cuenta", async () => {
  const ana = como("ana", "ana@x.es");
  await assertSucceeds(setDoc(doc(ana, "actividad/b1"), act({ uid: "ana" })));
  await assertFails(setDoc(doc(ana, "actividad/b2"), act({ uid: "gus" })));
  const entrada = { tipo: "entrada", uid: "ana", pantalla: "portada", metodo: "correo", creado: serverTimestamp(), caduca: caduca() };
  await assertSucceeds(setDoc(doc(ana, "actividad/b3"), entrada));
  await assertFails(setDoc(doc(anonimo(), "actividad/b4"), { ...entrada, uid: null }));
});

test("actividad: ni campos de más, ni segundos absurdos, ni que no caduque", async () => {
  const db = anonimo();
  await assertFails(setDoc(doc(db, "actividad/c1"), act({ admin: true })));
  await assertFails(setDoc(doc(db, "actividad/c2"), act({ segundos: -5 })));
  await assertFails(setDoc(doc(db, "actividad/c3"), act({ segundos: 10 ** 7 })));
  await assertFails(setDoc(doc(db, "actividad/c4"), act({ caduca: new Date(Date.now() + 400 * 24 * 3600 * 1000) })));
  await assertFails(setDoc(doc(db, "actividad/c5"), act({ tipo: "otra" })));
  await assertFails(setDoc(doc(db, "actividad/c6"), act({ creado: new Date(2020, 0, 1) })));
});

test("actividad: solo la lee el administrador, y nadie la cambia ni la borra", async () => {
  await entorno.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "actividad/d1"), { tipo: "pantalla", uid: "ana", pantalla: "buscar", creado: new Date(), caduca: caduca() });
  });
  for (const db of [anonimo(), como("ana", "ana@x.es")]) {
    await assertFails(getDoc(doc(db, "actividad/d1")));
    await assertFails(getDocs(collection(db, "actividad")));
  }
  const jefe = como("jefe", "jefe@x.es");
  await assertSucceeds(getDocs(collection(jefe, "actividad")));
  await assertFails(updateDoc(doc(jefe, "actividad/d1"), { segundos: 1 }));
  await assertFails(deleteDoc(doc(jefe, "actividad/d1")));
});

/* -------------------------------------------------------------- el modo HOP */
const enDias = (n) => new Date(Date.now() + n * 864e5);
const datosHop = (uid, extra = {}) => ({
  nombre: "Roma en mayo",
  creador: uid,
  miembros: [uid],
  nombres: { [uid]: uid },
  fin: "2027-05-20",
  caduca: enDias(200),
  creado: serverTimestamp(),
  ...extra,
});
/* Crear como lo hace la web: el HOP y, para premium, su hueco, de una vez. */
const crearHop = (db, uid, id, { hueco = true, extra = {} } = {}) => {
  const b = writeBatch(db);
  b.set(doc(db, `hops/${id}`), datosHop(uid, extra));
  if (hueco) b.set(doc(db, `hop_slots/${uid}`), { hop: id });
  return b.commit();
};
const ponerMax = () =>
  entorno.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "usuarios/max"), {
      creado: new Date(), nombre: "Max", correo: "max@x.es", estado: "aprobado", plan: "max",
    });
  });

test("HOP: premium crea una; gratis no", async () => {
  await assertSucceeds(crearHop(como("ana", "ana@x.es"), "ana", "hop1"));
  await assertFails(crearHop(como("gus", "gus@x.es"), "gus", "hop2"));
});

test("HOP: premium solo tiene una activa a la vez", async () => {
  const ana = como("ana", "ana@x.es");
  await assertSucceeds(crearHop(ana, "ana", "hop1"));
  await assertFails(crearHop(ana, "ana", "hop2"));
  // Ni colándola sin hueco.
  await assertFails(crearHop(ana, "ana", "hop3", { hueco: false }));
  // El hueco no se suelta mientras el HOP exista...
  await assertFails(deleteDoc(doc(ana, "hop_slots/ana")));
  // ...y al borrarla, sí: entonces puede crear otra.
  const b = writeBatch(ana);
  b.delete(doc(ana, "hops/hop1"));
  b.delete(doc(ana, "hop_slots/ana"));
  await assertSucceeds(b.commit());
  await assertSucceeds(crearHop(ana, "ana", "hop4"));
});

test("HOP: Max crea las que quiera, sin hueco", async () => {
  await ponerMax();
  const db = como("max", "max@x.es");
  for (const id of ["m1", "m2", "m3"]) await assertSucceeds(crearHop(db, "max", id, { hueco: false }));
});

test("HOP: no se crea a nombre de otro, ni con más gente, ni sin fecha de caducidad razonable", async () => {
  const ana = como("ana", "ana@x.es");
  await assertFails(crearHop(ana, "ana", "j1", { extra: { creador: "gus" } }));
  await assertFails(crearHop(ana, "ana", "j1", { extra: { miembros: ["ana", "gus"] } }));
  await assertFails(crearHop(ana, "ana", "j1", { extra: { caduca: enDias(900) } }));
  await assertFails(crearHop(ana, "ana", "j1", { extra: { caduca: enDias(-1) } }));
  await assertFails(crearHop(ana, "ana", "j1", { extra: { fin: "mayo" } }));
});

test("HOP: cualquier cuenta se une con el enlace, solo a sí misma, y se sale", async () => {
  await crearHop(como("ana", "ana@x.es"), "ana", "hop1");
  const gus = como("gus", "gus@x.es");
  await assertSucceeds(getDoc(doc(gus, "hops/hop1")));
  await assertSucceeds(
    updateDoc(doc(gus, "hops/hop1"), { miembros: arrayUnion("gus"), "nombres.gus": "Gus" })
  );
  // Meter a otro, no.
  await assertFails(updateDoc(doc(gus, "hops/hop1"), { miembros: arrayUnion("bea"), "nombres.bea": "Bea" }));
  // Sin cuenta, tampoco.
  await assertFails(getDoc(doc(anonimo(), "hops/hop1")));
  // Una bloqueada no entra.
  await assertFails(
    updateDoc(doc(como("cris", "cris@x.es"), "hops/hop1"), { miembros: arrayUnion("cris"), "nombres.cris": "C" })
  );
  // Salirse: quitarse a uno mismo.
  await assertSucceeds(updateDoc(doc(gus, "hops/hop1"), { miembros: arrayRemove("gus"), "nombres.gus": deleteField() }));
  // Quien la creó no se sale, y a otro no se le echa así.
  await assertFails(updateDoc(doc(como("ana", "ana@x.es"), "hops/hop1"), { miembros: arrayRemove("ana") }));
});

test("HOP: solo quien la creó cambia el nombre y la fecha, o la borra", async () => {
  await crearHop(como("ana", "ana@x.es"), "ana", "hop1");
  const gus = como("gus", "gus@x.es");
  await updateDoc(doc(gus, "hops/hop1"), { miembros: arrayUnion("gus"), "nombres.gus": "Gus" });
  await assertFails(updateDoc(doc(gus, "hops/hop1"), { nombre: "Mía" }));
  await assertFails(deleteDoc(doc(gus, "hops/hop1")));
  await assertSucceeds(
    updateDoc(doc(como("ana", "ana@x.es"), "hops/hop1"), { nombre: "Roma, al final", fin: "2027-06-01", caduca: enDias(220) })
  );
});

test("HOP: lo de dentro solo lo ven y lo escriben sus miembros", async () => {
  await crearHop(como("ana", "ana@x.es"), "ana", "hop1");
  const ana = como("ana", "ana@x.es");
  const gus = como("gus", "gus@x.es");
  const prop = { tipo: "viaje", titulo: "Roma", destino: "Roma", ida: "2027-05-10", vuelta: "2027-05-13",
    precio: 120, url: "https://www.ryanair.com/x", autor: "ana", nombre: "Ana", votos: {}, creado: serverTimestamp() };
  await assertSucceeds(setDoc(doc(ana, "hops/hop1/propuestas/p1"), prop));
  await assertSucceeds(setDoc(doc(ana, "hops/hop1/mensajes/m1"), { autor: "ana", nombre: "Ana", texto: "¿Roma?", creado: serverTimestamp() }));
  // Gus aún no está dentro.
  await assertFails(getDoc(doc(gus, "hops/hop1/propuestas/p1")));
  await assertFails(getDocs(collection(gus, "hops/hop1/mensajes")));
  await assertFails(setDoc(doc(gus, "hops/hop1/mensajes/m2"), { autor: "gus", nombre: "Gus", texto: "hola", creado: serverTimestamp() }));
  await updateDoc(doc(gus, "hops/hop1"), { miembros: arrayUnion("gus"), "nombres.gus": "Gus" });
  await assertSucceeds(getDocs(collection(gus, "hops/hop1/mensajes")));
  await assertSucceeds(setDoc(doc(gus, "hops/hop1/mensajes/m2"), { autor: "gus", nombre: "Gus", texto: "¡Vamos!", creado: serverTimestamp() }));
  // Ni a nombre de otro, ni un enlace que no sea https, ni un mensaje vacío.
  await assertFails(setDoc(doc(gus, "hops/hop1/mensajes/m3"), { autor: "ana", nombre: "Ana", texto: "x", creado: serverTimestamp() }));
  await assertFails(setDoc(doc(gus, "hops/hop1/propuestas/p2"), { ...prop, autor: "gus", url: "javascript:alert(1)" }));
  await assertFails(setDoc(doc(gus, "hops/hop1/mensajes/m4"), { autor: "gus", nombre: "Gus", texto: "", creado: serverTimestamp() }));
});

test("HOP: cada cual vota lo suyo, y solo lo suyo", async () => {
  await crearHop(como("ana", "ana@x.es"), "ana", "hop1");
  const ana = como("ana", "ana@x.es");
  const gus = como("gus", "gus@x.es");
  await updateDoc(doc(gus, "hops/hop1"), { miembros: arrayUnion("gus"), "nombres.gus": "Gus" });
  await setDoc(doc(ana, "hops/hop1/propuestas/p1"), { tipo: "fechas", titulo: "Puente de mayo", ida: "2027-05-01",
    vuelta: "2027-05-04", autor: "ana", votos: {}, creado: serverTimestamp() });
  await assertSucceeds(updateDoc(doc(gus, "hops/hop1/propuestas/p1"), { "votos.gus": "si" }));
  await assertSucceeds(updateDoc(doc(ana, "hops/hop1/propuestas/p1"), { "votos.ana": "quiza" }));
  await assertFails(updateDoc(doc(gus, "hops/hop1/propuestas/p1"), { "votos.ana": "no" }));
  await assertFails(updateDoc(doc(gus, "hops/hop1/propuestas/p1"), { "votos.gus": "muchisimo" }));
  await assertFails(updateDoc(doc(gus, "hops/hop1/propuestas/p1"), { titulo: "Otra cosa" }));
  await assertSucceeds(updateDoc(doc(gus, "hops/hop1/propuestas/p1"), { "votos.gus": deleteField() }));
  // Borrar: quien la propuso o quien creó el HOP.
  await assertFails(deleteDoc(doc(gus, "hops/hop1/propuestas/p1")));
  await assertSucceeds(deleteDoc(doc(ana, "hops/hop1/propuestas/p1")));
});

test("plan max: solo lo da el administrador", async () => {
  const jefe = como("jefe", "jefe@x.es");
  await assertSucceeds(updateDoc(doc(jefe, "usuarios/gus"), { plan: "max" }));
  await assertFails(updateDoc(doc(como("ana", "ana@x.es"), "usuarios/ana"), { plan: "max" }));
});

test("HOP: cualquier miembro apunta la búsqueda del grupo, y nada más", async () => {
  await crearHop(como("ana", "ana@x.es"), "ana", "hop1");
  const gus = como("gus", "gus@x.es");
  await updateDoc(doc(gus, "hops/hop1"), { miembros: arrayUnion("gus"), "nombres.gus": "Gus" });
  const busqueda = { clave: "hop1-abc", texto: "Donde sea · findes", por: "gus", nombre: "Gus", lanzada: new Date(), estado: "buscando" };
  await assertSucceeds(updateDoc(doc(gus, "hops/hop1"), { busqueda }));
  await assertSucceeds(updateDoc(doc(gus, "hops/hop1"), { cama: { oferta: "ryanair-MAD-FCO-20270501", estado: "buscando", por: "gus" } }));
  // Ni con una clave rara ni colando otra cosa.
  await assertFails(updateDoc(doc(gus, "hops/hop1"), { busqueda: { ...busqueda, clave: "../otra" } }));
  await assertFails(updateDoc(doc(gus, "hops/hop1"), { busqueda, nombre: "Mía" }));
  // Quien no está dentro, tampoco.
  await assertFails(updateDoc(doc(como("eva", "eva@x.es"), "hops/hop1"), { busqueda }));
});

test("HOP: los resultados de la búsqueda entran como vuelos y camas votables", async () => {
  await crearHop(como("ana", "ana@x.es"), "ana", "hop1");
  const ana = como("ana", "ana@x.es");
  const vuelo = { tipo: "vuelo", titulo: "Roma", destino: "Italia", ida: "2027-05-01", vuelta: "2027-05-04",
    precio: 89, url: "https://www.ryanair.com/x", compania: "Ryanair", horario: "07:10–09:30 · vuelta 18:40–21:00",
    oferta: "ryanair-MAD-FCO-20270501", iata: "FCO", origen: "MAD", pais: "Italia", autor: "ana", votos: {}, creado: serverTimestamp() };
  await assertSucceeds(setDoc(doc(ana, "hops/hop1/propuestas/v-ryanair-MAD-FCO-20270501"), vuelo));
  await assertSucceeds(setDoc(doc(ana, "hops/hop1/propuestas/c-1"), { tipo: "cama", titulo: "Piso en Trastevere",
    precio: 60, url: "https://www.airbnb.es/rooms/1", foto: "https://a0.muscache.com/x.jpg", autor: "ana", votos: {}, creado: serverTimestamp() }));
  await assertFails(setDoc(doc(ana, "hops/hop1/propuestas/c-2"), { tipo: "cama", titulo: "X", foto: "javascript:1",
    autor: "ana", votos: {}, creado: serverTimestamp() }));
  await assertFails(setDoc(doc(ana, "hops/hop1/propuestas/c-3"), { tipo: "hotelazo", titulo: "X", autor: "ana", votos: {}, creado: serverTimestamp() }));
});

test("HOP: las fases las mueve cualquier miembro, con fechas y plan bien hechos", async () => {
  await crearHop(como("ana", "ana@x.es"), "ana", "hop1");
  const gus = como("gus", "gus@x.es");
  await updateDoc(doc(gus, "hops/hop1"), { miembros: arrayUnion("gus"), "nombres.gus": "Gus" });
  await assertSucceeds(updateDoc(doc(gus, "hops/hop1"), { fase: 2, fechas: { ida: "2027-05-01", vuelta: "2027-05-04" } }));
  const plan = { de: "v-1", titulo: "Roma", ida: "2027-05-01", vuelta: "2027-05-04", precio: 89.5, url: "https://x.es/a",
    cama: "Piso", cama_url: "", cama_precio: 40, nota: "T1 a las 6", por: "gus", nombre: "Gus" };
  await assertSucceeds(updateDoc(doc(gus, "hops/hop1"), { fase: 5, plan }));
  await assertFails(updateDoc(doc(gus, "hops/hop1"), { fase: 9 }));
  await assertFails(updateDoc(doc(gus, "hops/hop1"), { fase: 2.5 }));
  await assertFails(updateDoc(doc(gus, "hops/hop1"), { fechas: { ida: "mañana" } }));
  await assertFails(updateDoc(doc(gus, "hops/hop1"), { plan: { ...plan, url: "javascript:1" } }));
  await assertFails(updateDoc(doc(gus, "hops/hop1"), { plan: { ...plan, colado: 1 } }));
  await assertFails(updateDoc(doc(gus, "hops/hop1"), { fase: 3, nombre: "Mío" }));
  await assertFails(updateDoc(doc(como("eva", "eva@x.es"), "hops/hop1"), { fase: 3 }));
});

test("HOP: cada cual tacha hasta tres ciudades, y solo las suyas", async () => {
  await crearHop(como("ana", "ana@x.es"), "ana", "hop1");
  const ana = como("ana", "ana@x.es");
  const gus = como("gus", "gus@x.es");
  await updateDoc(doc(gus, "hops/hop1"), { miembros: arrayUnion("gus"), "nombres.gus": "Gus" });
  await assertSucceeds(updateDoc(doc(ana, "hops/hop1"), { "vetos.ana": ["Londres|GB", "Roma|IT"] }));
  await assertSucceeds(updateDoc(doc(gus, "hops/hop1"), { "vetos.gus": ["Londres|GB"] }));
  await assertSucceeds(updateDoc(doc(gus, "hops/hop1"), { "vetos.gus": [] }));
  await assertFails(updateDoc(doc(gus, "hops/hop1"), { "vetos.gus": ["a", "b", "c", "d"] }));
  await assertFails(updateDoc(doc(gus, "hops/hop1"), { "vetos.ana": [] }));
  await assertFails(updateDoc(doc(gus, "hops/hop1"), { "vetos.gus": [42] }));
});

test("HOP: lo guardado puede llevar su alojamiento", async () => {
  await crearHop(como("ana", "ana@x.es"), "ana", "hop1");
  const ana = como("ana", "ana@x.es");
  const base = { tipo: "vuelo", titulo: "Roma", autor: "ana", votos: {}, creado: serverTimestamp() };
  await assertSucceeds(setDoc(doc(ana, "hops/hop1/propuestas/v-1-c-a"), { ...base, cama: "Piso en Trastevere",
    cama_url: "https://www.booking.com/x", cama_precio: 45.5 }));
  await assertFails(setDoc(doc(ana, "hops/hop1/propuestas/v-1-c-b"), { ...base, cama_url: "http://x" }));
  await assertFails(setDoc(doc(ana, "hops/hop1/propuestas/v-1-c-c"), { ...base, cama_precio: "mucho" }));
});
