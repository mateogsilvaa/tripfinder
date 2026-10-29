/* filtro-destinos.js — Afinar el «donde sea».

   «Donde sea» era todo o nada: o un sitio concreto, o los cien destinos que
   salgan. Ahora, en medio:

   · ¿POR DÓNDE? Solo unos países, una región («Los Balcanes»), un continente
     o un GRUPO TUYO de países, que se guarda con nombre y se vuelve a elegir
     de un toque («Mis findes»: Italia, Portugal y Grecia).
   · ¿DÓNDE NO? Países o ciudades que no quieres (Londres no, Marruecos
     tampoco).

   EL CAMPO ESCONDIDO ES LA VERDAD, como en `horas.js`: lleva lo elegido en
   JSON y es lo que se lee al lanzar. Al backend no llegan nombres de países,
   que cada fuente escribe a su manera, sino los aeropuertos de cada cosa
   (`codigosDelFiltro`): `search.codigos_iata`. Las regiones y los continentes
   salen de los mismos ficheros que el filtro del feed; los países y las
   ciudades, de `airports_world.json`, que solo se baja al abrir esto. */
import { esc, fetchJSON } from "./base.js";
import { nombrePais } from "./mundo.js";
import { isoDe } from "./paises.js";

const CLAVE_GRUPOS = "tf_grupos_paises";
const MAX_RESULTADOS = 8;

let DATOS = null;
async function datos() {
  if (DATOS) return DATOS;
  const [aeropuertos, regiones, continentes] = await Promise.all([
    fetchJSON("data/airports_world.json").catch(() => []),
    fetchJSON("data/regiones.json").catch(() => ({})),
    fetchJSON("data/continentes.json").catch(() => ({})),
  ]);
  const paises = new Map();
  const ciudades = new Map();
  for (const a of aeropuertos || []) {
    const iso = isoDe(a.pais) || a.pais;
    const p = paises.get(iso) || { k: iso, n: nombrePais(iso) || a.pais, c: [] };
    p.c.push(a.code);
    paises.set(iso, p);
    const kc = `${a.ciudad}|${iso}`;
    const c = ciudades.get(kc) || { k: kc, n: a.ciudad, pais: p.n, c: [] };
    c.c.push(a.code);
    ciudades.set(kc, c);
  }
  const partir = (s) => String(s || "").match(/[A-Z]{3}/g) || [];
  DATOS = {
    paises,
    ciudades,
    regiones: Object.entries(regiones || {}).map(([k, v]) => ({ t: "region", k, n: v.n, c: partir(v.c) })),
    continentes: Object.entries(continentes || {}).map(([k, v]) => ({ t: "cont", k, n: k, c: partir(v) })),
  };
  return DATOS;
}

export function leerFiltro(valor) {
  try {
    const f = JSON.parse(valor || "{}");
    return { si: Array.isArray(f.si) ? f.si : [], no: Array.isArray(f.no) ? f.no : [] };
  } catch {
    return { si: [], no: [] };
  }
}

const lista = (items, max = 2) =>
  items.length <= max ? items.map((x) => x.n).join(", ") : `${items.slice(0, max).map((x) => x.n).join(", ")} +${items.length - max}`;

/* «Solo Italia, Grecia · sin Londres», o "" si no hay filtro. */
export function textoFiltro(valor) {
  const f = leerFiltro(valor);
  return [f.si.length ? `solo ${lista(f.si)}` : "", f.no.length ? `sin ${lista(f.no)}` : ""].filter(Boolean).join(" · ");
}

/* Los aeropuertos de lo elegido: { solo: "OPOLIS…", sin: "STN…" }. */
export async function codigosDelFiltro(valor) {
  const f = leerFiltro(valor);
  if (!f.si.length && !f.no.length) return { solo: "", sin: "" };
  const d = await datos();
  const de = (x) => {
    if (x.t === "pais") return (d.paises.get(x.k) || {}).c || [];
    if (x.t === "ciudad") return (d.ciudades.get(x.k) || {}).c || [];
    if (x.t === "region") return (d.regiones.find((r) => r.k === x.k) || {}).c || [];
    if (x.t === "cont") return (d.continentes.find((r) => r.k === x.k) || {}).c || [];
    if (x.t === "iata") return [String(x.k).toUpperCase()];
    return [];
  };
  const juntar = (items) => [...new Set(items.flatMap(de))].filter((c) => /^[A-Z]{3}$/.test(c)).sort().join("");
  return { solo: juntar(f.si), sin: juntar(f.no) };
}

export function gruposGuardados() {
  try {
    const g = JSON.parse(localStorage.getItem(CLAVE_GRUPOS) || "[]");
    return Array.isArray(g) ? g.filter((x) => x && x.n && Array.isArray(x.items)) : [];
  } catch {
    return [];
  }
}
function guardarGrupos(g) {
  try {
    localStorage.setItem(CLAVE_GRUPOS, JSON.stringify(g.slice(0, 20)));
  } catch {
    /* navegación privada: el grupo dura lo que la pestaña */
  }
}

const pelado = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/* El filtro va DENTRO del desplegable de «a dónde»: una opción más («unos
   países o regiones…») que al elegirla abre el selector, y que después dice
   lo elegido («solo Italia, Grecia»). Sin botón aparte. Si se cierra sin
   elegir nada, el desplegable vuelve a «donde sea». */
export function engancharFiltro(select, campo, { rotulo = "unos países o regiones…", todos = "any", mayus = false } = {}) {
  const may = (t) => (mayus ? t.charAt(0).toUpperCase() + t.slice(1) : t);
  if (!select || !campo || select.dataset.conFiltro) return;
  select.dataset.conFiltro = "1";
  let op = select.querySelector('option[value="afinar"]');
  if (!op) {
    op = document.createElement("option");
    op.value = "afinar";
    select.appendChild(op);
  }
  // Con algo elegido, una opción más para cambiarlo (la de arriba ya está
  // elegida y volver a tocarla no avisa de nada).
  const cambiar = document.createElement("option");
  cambiar.value = "afinar-cambiar";
  cambiar.textContent = may("cambiar países…");
  const pintar = () => {
    const t = textoFiltro(campo.value);
    op.textContent = may(t || rotulo);
    if (t && !cambiar.isConnected) select.appendChild(cambiar);
    if (!t && cambiar.isConnected) cambiar.remove();
    if (t && select.value === todos) select.value = "afinar";
    if (!t && select.value === "afinar" && !abierto) select.value = todos;
  };
  let abierto = false;
  const abrir = async () => {
    abierto = true;
    await abrirFiltro(campo);
    const modal = document.getElementById("tfModal");
    if (!modal) return;
    // Al cerrarse el diálogo, se mira si quedó algo elegido.
    const obs = new MutationObserver(() => {
      if (!modal.hidden) return;
      obs.disconnect();
      abierto = false;
      pintar();
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    obs.observe(modal, { attributes: true, attributeFilter: ["hidden"] });
  };
  select.addEventListener("change", () => {
    if (select.value === "afinar-cambiar") select.value = "afinar";
    else if (select.value !== "afinar" || abierto || campo.value) return;
    if (!abierto) abrir();
  });
  campo.addEventListener("change", pintar);
  pintar();
}

export async function abrirFiltro(campo) {
  let f = leerFiltro(campo.value);
  const caja = tfModal(`
    <header class="modal-head">
      <div>
        <p class="kicker-tag">donde sea, pero…</p>
        <h2>Afinar el destino</h2>
      </div>
      <button type="button" data-cerrar aria-label="Cerrar">cerrar</button>
    </header>
    <div class="filtro-dest"><p class="meta"><span class="spin"></span>Cargando países…</p></div>`);
  const d = await datos();
  const cuerpo = caja.querySelector(".filtro-dest");
  if (!cuerpo) return;
  const poner = () => {
    campo.value = f.si.length || f.no.length ? JSON.stringify(f) : "";
    campo.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const igual = (a, b) => a.t === b.t && a.k === b.k;
  const tiene = (l, x) => l.some((y) => igual(x, y));
  const chip = (x, donde) =>
    `<button type="button" class="chip filtro-chip ${donde}" data-quitar="${donde}" data-t="${esc(x.t)}" data-k="${esc(
      x.k
    )}" aria-label="Quitar ${esc(x.n)}">${esc(x.n)}<span aria-hidden="true">×</span></button>`;
  const atajo = (x) =>
    `<button type="button" class="chip filtro-atajo" data-poner="si" data-t="${esc(x.t)}" data-k="${esc(x.k)}" data-n="${esc(
      x.n
    )}" aria-pressed="${tiene(f.si, x)}">${esc(x.n)}</button>`;

  cuerpo.innerHTML = `
    <section class="filtro-parte" aria-labelledby="filtroSiTit">
      <h3 id="filtroSiTit">¿Por dónde?</h3>
      <div class="filtro-elegidos" data-elegidos="si"></div>
      <label class="filtro-buscar"><span class="solo-lector">Buscar un país</span>
        <input type="search" data-buscar="si" placeholder="Añadir un país: Italia, Grecia…" autocomplete="off"></label>
      <div class="filtro-resultados" data-resultados="si"></div>
      <div class="filtro-grupos" data-grupos></div>
      <p class="filtro-sub">Regiones</p>
      <div class="filtro-atajos">${d.regiones.map(atajo).join("")}</div>
      <p class="filtro-sub">Continentes</p>
      <div class="filtro-atajos">${d.continentes.map(atajo).join("")}</div>
    </section>
    <section class="filtro-parte" aria-labelledby="filtroNoTit">
      <h3 id="filtroNoTit">¿Dónde no?</h3>
      <div class="filtro-elegidos" data-elegidos="no"></div>
      <label class="filtro-buscar"><span class="solo-lector">Quitar un país o una ciudad</span>
        <input type="search" data-buscar="no" placeholder="Quitar un país o una ciudad: Londres, Marruecos…" autocomplete="off"></label>
      <div class="filtro-resultados" data-resultados="no"></div>
    </section>
    <div class="filtro-pie">
      <span class="filtro-resumen" role="status"></span>
      <button type="button" class="btn ghost small" data-guardar-grupo>Guardar como grupo</button>
      <button type="button" class="btn ghost small" data-limpiar>Quitar todo</button>
      <button type="button" class="btn primary small" data-listo>Listo</button>
    </div>`;

  const repintar = () => {
    ["si", "no"].forEach((donde) => {
      cuerpo.querySelector(`[data-elegidos="${donde}"]`).innerHTML = f[donde].length
        ? f[donde].map((x) => chip(x, donde)).join("")
        : `<span class="filtro-nada">${donde === "si" ? "Cualquier sitio" : "Nada quitado"}</span>`;
    });
    cuerpo.querySelectorAll("[data-poner]").forEach((b) =>
      b.setAttribute("aria-pressed", String(tiene(f.si, { t: b.dataset.t, k: b.dataset.k })))
    );
    const grupos = gruposGuardados();
    cuerpo.querySelector("[data-grupos]").innerHTML = grupos.length
      ? `<p class="filtro-sub">Tus grupos</p><div class="filtro-atajos">${grupos
          .map(
            (g, i) => `<span class="filtro-grupo"><button type="button" class="chip filtro-atajo" data-grupo="${i}">${esc(
              g.n
            )}</button><button type="button" class="filtro-grupo-borrar" data-borrar-grupo="${i}" aria-label="Borrar el grupo ${esc(
              g.n
            )}">×</button></span>`
          )
          .join("")}</div>`
      : "";
    cuerpo.querySelector("[data-guardar-grupo]").hidden = !f.si.length;
    cuerpo.querySelector(".filtro-resumen").textContent = textoFiltro(JSON.stringify(f)) || "Cualquier sitio";
    poner();
  };

  const buscar = (donde, q) => {
    const caja = cuerpo.querySelector(`[data-resultados="${donde}"]`);
    const t = pelado(q);
    if (t.length < 2) {
      caja.innerHTML = "";
      return;
    }
    const encaja = (n) => pelado(n).startsWith(t) || pelado(n).includes(` ${t}`);
    const paises = [...d.paises.values()].filter((p) => encaja(p.n)).map((p) => ({ t: "pais", k: p.k, n: p.n, sub: "país" }));
    const ciudades =
      donde === "no"
        ? [...d.ciudades.values()].filter((c) => encaja(c.n)).map((c) => ({ t: "ciudad", k: c.k, n: c.n, sub: c.pais }))
        : [];
    const todo = [...paises, ...ciudades].slice(0, MAX_RESULTADOS);
    caja.innerHTML = todo.length
      ? todo
          .map(
            (x) => `<button type="button" class="filtro-res" data-poner="${donde}" data-t="${x.t}" data-k="${esc(x.k)}"
              data-n="${esc(x.n)}">${esc(x.n)} <small>${esc(x.sub)}</small></button>`
          )
          .join("")
      : `<p class="filtro-nada">No sale nada con «${esc(q)}».</p>`;
  };
  cuerpo.querySelectorAll("[data-buscar]").forEach((input) =>
    input.addEventListener("input", () => buscar(input.dataset.buscar, input.value))
  );

  cuerpo.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.poner) {
      const donde = b.dataset.poner;
      const x = { t: b.dataset.t, k: b.dataset.k, n: b.dataset.n };
      if (tiene(f[donde], x)) f[donde] = f[donde].filter((y) => !igual(x, y));
      else f[donde] = [...f[donde], x].slice(0, 40);
      if (b.classList.contains("filtro-res")) {
        const input = cuerpo.querySelector(`[data-buscar="${donde}"]`);
        input.value = "";
        buscar(donde, "");
        input.focus();
      }
      repintar();
    } else if (b.dataset.quitar) {
      const donde = b.dataset.quitar;
      f[donde] = f[donde].filter((y) => !igual(y, { t: b.dataset.t, k: b.dataset.k }));
      repintar();
    } else if (b.dataset.grupo !== undefined) {
      const g = gruposGuardados()[Number(b.dataset.grupo)];
      if (g) f.si = [...g.items];
      repintar();
    } else if (b.dataset.borrarGrupo !== undefined) {
      const g = gruposGuardados();
      g.splice(Number(b.dataset.borrarGrupo), 1);
      guardarGrupos(g);
      repintar();
    } else if (b.hasAttribute("data-guardar-grupo")) {
      const n = (prompt("¿Cómo se llama este grupo? (p. ej. «Mis findes»)", lista(f.si, 3)) || "").trim().slice(0, 40);
      if (!n) return;
      guardarGrupos([{ n, items: f.si }, ...gruposGuardados().filter((g) => g.n !== n)]);
      repintar();
    } else if (b.hasAttribute("data-limpiar")) {
      f = { si: [], no: [] };
      repintar();
    } else if (b.hasAttribute("data-listo")) {
      tfCerrarModal();
    }
  });
  repintar();
}

/* Para los vetos del HOP: ciudades que encajan con lo escrito, y los
   aeropuertos de unas cuantas ciudades («Londres|GB» → LGW, LHR, LTN…). */
export async function buscarCiudades(q, max = MAX_RESULTADOS) {
  const t = pelado(q);
  if (t.length < 2) return [];
  const d = await datos();
  return [...d.ciudades.values()]
    .filter((c) => pelado(c.n).startsWith(t) || pelado(c.n).includes(` ${t}`))
    .sort((a, b) => b.c.length - a.c.length || a.n.localeCompare(b.n, "es"))
    .slice(0, max)
    .map((c) => ({ k: c.k, n: c.n, pais: c.pais }));
}

export async function codigosDeCiudades(claves) {
  if (!claves.length) return [];
  const d = await datos();
  return [...new Set(claves.flatMap((k) => (d.ciudades.get(k) || {}).c || []))];
}
