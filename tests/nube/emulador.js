/* Lo que las pruebas hacen DESDE FUERA de la web, con la llave maestra del
   emulador (`Authorization: Bearer owner` se salta las reglas): mirar lo que
   hay guardado y hacer de administrador, que es algo que el navegador no puede
   hacer solo. */
const AUTH = "http://127.0.0.1:9099";
const FS = "http://127.0.0.1:8080/v1/projects/demo-tripfinder/databases/(default)/documents";
const DUENO = { Authorization: "Bearer owner", "Content-Type": "application/json" };

const CONFIG = {
  apiKey: "clave-de-mentira",
  projectId: "demo-tripfinder",
  emulador: { auth: AUTH, firestore: "http://127.0.0.1:8080" },
};

const valor = (v) => {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if ("mapValue" in v) return objeto(v.mapValue.fields);
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(valor);
  return null;
};
const objeto = (campos = {}) => Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, valor(v)]));

async function ficha(uid) {
  const r = await fetch(`${FS}/usuarios/${uid}`, { headers: DUENO });
  return r.ok ? objeto((await r.json()).fields) : null;
}

/* Cambiar campos de una ficha sin pasar por las reglas: lo que haría el panel. */
async function poner(uid, campos) {
  const fields = Object.fromEntries(
    Object.entries(campos).map(([k, v]) => [k, typeof v === "boolean" ? { booleanValue: v } : { stringValue: v }])
  );
  const mascara = Object.keys(campos).map((k) => `updateMask.fieldPaths=${k}`).join("&");
  const r = await fetch(`${FS}/usuarios/${uid}?${mascara}`, {
    method: "PATCH",
    headers: DUENO,
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) throw new Error(`no se pudo cambiar la ficha: ${r.status}`);
}

const aprobar = (uid) => poner(uid, { estado: "aprobado" });
const hacerAdmin = (uid) => poner(uid, { estado: "aprobado", admin: true });

async function encargosDe(uid) {
  const r = await fetch(`${FS}:runQuery`, {
    method: "POST",
    headers: DUENO,
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "encargos" }],
        where: { fieldFilter: { field: { fieldPath: "owner" }, op: "EQUAL", value: { stringValue: uid } } },
      },
    }),
  });
  return (await r.json()).filter((f) => f.document).map((f) => objeto(f.document.fields));
}

/* Borrar la cuenta de Authentication, como haría alguien desde la consola. */
const borrarCuenta = (uid) =>
  fetch(`${AUTH}/emulator/v1/projects/demo-tripfinder/accounts/${uid}`, { method: "DELETE" });

/* Una cuenta de antes de Firebase, como la deja `tripfinder migrar-cuentas`. */
async function sembrarAntigua(id, campos) {
  const fields = {};
  for (const [k, v] of Object.entries(campos)) {
    fields[k] =
      typeof v === "boolean"
        ? { booleanValue: v }
        : v && typeof v === "object"
          ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([a, b]) => [a, typeof b === "number" ? { doubleValue: b } : b === null ? { nullValue: null } : { stringValue: String(b) }])) } }
          : { stringValue: String(v) };
  }
  const r = await fetch(`${FS}/cuentas_antiguas/${id}`, { method: "PATCH", headers: DUENO, body: JSON.stringify({ fields }) });
  if (!r.ok) throw new Error(`no se pudo sembrar: ${r.status}`);
}

async function antigua(id) {
  const r = await fetch(`${FS}/cuentas_antiguas/${id}`, { headers: DUENO });
  return r.ok ? objeto((await r.json()).fields) : null;
}

/* Lo que pasa cuando alguien pincha el enlace del correo de verificación. */
async function verificarCorreo(uid) {
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/demo-tripfinder/accounts:update`, {
    method: "POST",
    headers: DUENO,
    body: JSON.stringify({ localId: uid, emailVerified: true }),
  });
  if (!r.ok) throw new Error(`no se pudo verificar: ${r.status}`);
}

let n = 0;
const correoNuevo = () => `prueba${Date.now()}${n++}@ejemplo.es`;

module.exports = {
  CONFIG, ficha, poner, aprobar, hacerAdmin, encargosDe, borrarCuenta, correoNuevo,
  sembrarAntigua, antigua, verificarCorreo,
};
