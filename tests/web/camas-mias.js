/* Lo que busca otra persona no se enseña (`alojamiento.js`, `esMiCama`): las
   pruebas que abren una cama ya buscada la tienen que dar por TUYA, apuntada
   en `tf_camas` como si la hubieras pedido desde este navegador. */
const fs = require("node:fs");
const path = require("node:path");

const IDS = JSON.parse(fs.readFileSync(path.join(__dirname, "datos", "offers.json"), "utf8")).offers.map((o) => o.id);

const camasMias = (page, uid = "", extra = []) =>
  page.addInitScript(
    ([ids, u]) => {
      try {
        localStorage.setItem(u ? `tf_camas:${u}` : "tf_camas", JSON.stringify(ids.map((id) => ({ id, ida: "2099-01-01" }))));
      } catch (e) {
        /* nada */
      }
    },
    [[...IDS, ...extra], uid]
  );

module.exports = { camasMias };
