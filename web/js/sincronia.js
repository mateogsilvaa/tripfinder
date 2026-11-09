/* Lo mismo en el móvil y en el ordenador.
   Lo que guardas con tu cuenta (los vuelos que sigues, cuántos sois, el test de
   destinos, las camas, el viaje de Interrail…) vivía solo en el navegador donde
   lo hacías. Aquí se copia a tu ficha (`usuarios/{uid}.prefs.sync.<clave>`) y se
   trae de vuelta en el otro aparato.

   - Sin reglas nuevas: `prefs` ya se podía escribir, y se escribe con la máscara
     del campo exacto, sin tocar nada más (ver `nubeSubirSincronia`).
   - Nadie tiene que avisar al motor: se entera de que cambió algo porque
     `localStorage.setItem` de esas claves pasa por aquí (ver `vigilar`).
   - Los favoritos se funden uno a uno (gana el cambio más reciente de cada
     vuelo, y borrar también cuenta); el resto, clave a clave, gana el último.
   - Para no soltar a mitad de una pantalla lo que llega, se avisa con un botón
     «Ver» en vez de repintar solo. */
import { avisar } from "./avisos.js";

const POR_CUENTA = [
  "tf_grupo",
  "tf_quiz",
  "tf_camas",
  "tf_ir_ruta",
  "tf_ir_ciudades",
  "tf_ir_eleccion",
  "tf_ir_form",
  "tf_ir_ajustes",
];
const GLOBALES = ["tf_grupos_paises"];
const FAVORITOS = "tf_favoritos";
// Lo que no se sube: pendientes y «borrando» son del momento y de cada aparato.
const TOPE = 300_000; // caracteres por clave: la ficha entera no pasa de 1 MB
const OLVIDAR_BORRADOS_MS = 60 * 86_400_000;
const ESPERA_MS = 3000;
const REPASO_MS = 90_000;

const nombre = (base) => base.replace(/^tf_/, "");
const BASES = [...POR_CUENTA, ...GLOBALES];

let uid = "";
let meta = null;
let aplicando = false;
let ocupado = false;
let repetir = false;
let temporizador = 0;
let ultimo = 0;
const original = {
  set: Storage.prototype.setItem,
  quitar: Storage.prototype.removeItem,
};

const claveLocal = (base) => (GLOBALES.includes(base) ? base : `${base}:${uid}`);
const leer = (clave) => {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
};
const escribir = (clave, valor) => {
  aplicando = true;
  try {
    if (valor === null || valor === undefined) original.quitar.call(localStorage, clave);
    else original.set.call(localStorage, clave, valor);
  } catch {
    /* sin sitio o sin permiso: se queda como estaba */
  } finally {
    aplicando = false;
  }
};
const json = (texto, defecto) => {
  try {
    const v = JSON.parse(texto);
    return v && typeof v === "object" ? v : defecto;
  } catch {
    return defecto;
  }
};
const hash = (texto) => {
  let h = 5381;
  for (let i = 0; i < texto.length; i++) h = ((h << 5) + h + texto.charCodeAt(i)) | 0;
  return `${texto.length}:${h}`;
};

/* ------------------------------------------------------------------ la libreta
   Qué hora tiene cada cosa en ESTE aparato, para saber quién va más nuevo. */
const clavaMeta = () => `tf_sync_meta:${uid}`;
function cargarMeta() {
  const m = json(leer(clavaMeta()), null);
  if (m) return { claves: {}, favT: {}, favH: {}, favD: {}, ...m };
  // Primera vez aquí: lo que ya hay es «de antes» (hora 1), así que cualquier cosa
  // que otro aparato haya subido después le gana, y lo tuyo sube si no hay nada.
  const nuevo = { claves: {}, favT: {}, favH: {}, favD: {} };
  BASES.forEach((b) => (nuevo.claves[nombre(b)] = 1));
  const favs = json(leer(claveLocal(FAVORITOS)), {});
  Object.entries(favs).forEach(([id, f]) => {
    nuevo.favT[id] = 1;
    nuevo.favH[id] = hash(JSON.stringify(f));
  });
  return nuevo;
}
function guardarMeta() {
  escribir(clavaMeta(), JSON.stringify(meta));
}

/* Un cambio local: se apunta la hora y se programa una subida. */
function marcar(base) {
  const ahora = Date.now();
  if (base === FAVORITOS) {
    const favs = json(leer(claveLocal(FAVORITOS)), {});
    Object.entries(favs).forEach(([id, f]) => {
      const h = hash(JSON.stringify(f));
      if (meta.favH[id] !== h) {
        meta.favH[id] = h;
        meta.favT[id] = ahora;
        delete meta.favD[id];
      }
    });
    Object.keys(meta.favH).forEach((id) => {
      if (!(id in favs)) {
        delete meta.favH[id];
        delete meta.favT[id];
        meta.favD[id] = ahora;
      }
    });
  } else {
    meta.claves[nombre(base)] = ahora;
  }
  guardarMeta();
  programar();
}

function vigilar() {
  const nuestra = (clave) => {
    if (aplicando || !uid) return "";
    if (clave === claveLocal(FAVORITOS)) return FAVORITOS;
    return BASES.find((b) => clave === claveLocal(b)) || "";
  };
  Storage.prototype.setItem = function (clave, valor) {
    original.set.call(this, clave, valor);
    if (this === localStorage) {
      const base = nuestra(String(clave));
      if (base) marcar(base);
    }
  };
  Storage.prototype.removeItem = function (clave) {
    original.quitar.call(this, clave);
    if (this === localStorage) {
      const base = nuestra(String(clave));
      if (base) marcar(base);
    }
  };
}

function programar() {
  clearTimeout(temporizador);
  temporizador = setTimeout(() => ciclo(), ESPERA_MS);
}

/* ------------------------------------------------------------------- el fundido */
function fundirFavoritos(remoto, subir) {
  const locales = json(leer(claveLocal(FAVORITOS)), {});
  const r = remoto && typeof remoto.v === "string" ? json(remoto.v, {}) : {};
  const ri = r.i || {};
  const rt = r.t || {};
  const rd = r.d || {};
  const corte = Date.now() - OLVIDAR_BORRADOS_MS;
  const ids = new Set([...Object.keys(locales), ...Object.keys(ri), ...Object.keys(rd), ...Object.keys(meta.favD)]);
  const final = {};
  const tiempos = {};
  const borrados = {};
  let cambioLocal = false;
  ids.forEach((id) => {
    const tl = id in locales ? meta.favT[id] || 1 : 0;
    const tdl = meta.favD[id] || 0;
    const tr = id in ri ? rt[id] || 1 : 0;
    const tdr = rd[id] || 0;
    const mejorVivo = Math.max(tl, tr);
    const mejorBorrado = Math.max(tdl, tdr);
    if (mejorVivo >= mejorBorrado && mejorVivo > 0) {
      const delRemoto = tr > tl;
      final[id] = delRemoto ? ri[id] : locales[id];
      tiempos[id] = mejorVivo;
      if (delRemoto && hash(JSON.stringify(ri[id])) !== hash(JSON.stringify(locales[id] ?? null))) cambioLocal = true;
    } else if (mejorBorrado > corte) {
      borrados[id] = mejorBorrado;
      if (id in locales) cambioLocal = true;
    }
  });
  if (cambioLocal) {
    escribir(claveLocal(FAVORITOS), JSON.stringify(final));
    meta.favH = {};
    Object.entries(final).forEach(([id, f]) => (meta.favH[id] = hash(JSON.stringify(f))));
  } else {
    Object.keys(final).forEach((id) => (meta.favH[id] = meta.favH[id] || hash(JSON.stringify(final[id]))));
  }
  meta.favT = tiempos;
  meta.favD = borrados;
  const nuevo = { i: final, t: tiempos, d: borrados };
  const texto = JSON.stringify(nuevo);
  const igual = remoto && remoto.v && hash(remoto.v) === hash(texto);
  if (!igual && texto.length <= TOPE && (Object.keys(final).length || Object.keys(borrados).length || remoto)) {
    subir[nombre(FAVORITOS)] = { t: Date.now(), v: texto };
  }
  return cambioLocal;
}

function fundirClave(base, remoto, subir) {
  const n = nombre(base);
  const clave = claveLocal(base);
  const local = leer(clave);
  const tl = meta.claves[n] || 1;
  const tr = remoto && typeof remoto.t === "number" ? remoto.t : 0;
  if (tr > tl) {
    const v = typeof remoto.v === "string" ? remoto.v : null;
    meta.claves[n] = tr;
    if (v !== local) {
      escribir(clave, v);
      return true;
    }
    return false;
  }
  if (tl > tr && (local !== null || tl > 1)) {
    if (local === null || local.length <= TOPE) subir[n] = { t: tl, v: local };
  }
  return false;
}

/* Un ciclo: ver lo que hay en la nube, fundirlo con lo de aquí, devolver lo que
   falte a un lado y a otro. `remoto` ya viene leído si la página acaba de bajar
   la ficha; si no (tras un cambio local) se lee fresca para no pisar a nadie. */
async function ciclo(remoto) {
  if (!uid) return;
  if (ocupado) {
    repetir = true;
    return;
  }
  ocupado = true;
  try {
    if (!remoto) {
      const token = await nubeToken();
      if (!token) return;
      const ficha = await nubeLeerDoc(token, `usuarios/${uid}`);
      remoto = ((ficha || {}).prefs || {}).sync || {};
    }
    const subir = {};
    let cambio = fundirFavoritos(remoto[nombre(FAVORITOS)], subir);
    BASES.forEach((b) => {
      if (fundirClave(b, remoto[nombre(b)], subir)) cambio = true;
    });
    guardarMeta();
    if (Object.keys(subir).length) await nubeSubirSincronia(subir);
    ultimo = Date.now();
    if (cambio) {
      avisar("Tus datos se han actualizado desde otro dispositivo", {
        boton: "Ver",
        alPulsar: () => location.reload(),
        ms: 12000,
      });
    }
  } catch {
    /* sin red o sin sesión: se reintenta en el próximo cambio o al volver */
  } finally {
    ocupado = false;
    if (repetir) {
      repetir = false;
      programar();
    }
  }
}

/* Al arrancar la página. No hace nada sin cuenta de la nube. */
export function iniciarSincronia() {
  const s = typeof tfSesion === "function" ? tfSesion() : null;
  if (!s || !s.nube || !s.uid || typeof nubeSubirSincronia !== "function") return;
  uid = s.uid;
  meta = cargarMeta();
  guardarMeta();
  vigilar();
  // `nubeSincronizar` baja la ficha al cargar y avisa con esto: de ahí sale lo
  // que dejó el otro aparato, sin una lectura más.
  document.addEventListener("tf:ficha", (e) => ciclo((e.detail && e.detail.sync) || {}));
  // Al volver a la pestaña tras un rato (el móvil se queda dormido horas).
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - ultimo > REPASO_MS) {
      ultimo = Date.now();
      nubeSincronizar();
    }
  });
}
