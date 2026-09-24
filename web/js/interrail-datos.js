/* interrail-datos.js — Las ciudades, los trenes entre ellas y las rutas hechas.

   Antes cada ruta traía sus tramos escritos a mano, y la misma línea
   (Ámsterdam–Berlín) estaba copiada en tres rutas. Ahora hay UN mapa: ciudades
   y conexiones directas. Las rutas hechas son solo una lista de paradas, y los
   tramos salen del mapa; y cuando eliges tú las ciudades, la ruta también sale
   de él (el camino más corto entre cada dos, pasando por las que haga falta).

   LOS CENTROS son la plaza que cualquiera llamaría «el centro» —la catedral,
   la plaza mayor, la estación en las ciudades pequeñas—. Viajan con la
   petición de alojamiento: Airbnb busca en un recuadro alrededor de ese punto
   y lo que queda lejos se descarta. Buscar por el nombre de la ciudad traía
   pisos a 3 o 4 km y a 45 minutos andando.

   LOS AEROPUERTOS van con los de al lado que usa Ryanair, que es el único
   proveedor del proyecto que busca IDA SOLA: no vuela a Ámsterdam pero sí a
   Eindhoven, ni a París-CDG pero sí a Beauvais. El primero es el del enlace.

   LOS TIEMPOS Y PRECIOS DEL TREN son orientativos, del directo más rápido,
   redondeados, y no están contrastados contra los operadores (desde donde se
   escribió no había red hasta ellos). `reserva` es la horquilla en euros por
   persona que se paga aparte del pase, o `null` si el tren no la exige;
   `billete`, lo que suele costar ese tramo sin pase, en segunda y con unas
   semanas de antelación. */

const C = (ciudad, pais, lat, lon, aeropuertos, pequena = false) => ({
  ciudad,
  pais,
  lat,
  lon,
  aeropuertos,
  pequena,
});

export const CIUDADES = {
  AMS: C("Ámsterdam", "Países Bajos", 52.3731, 4.8926, ["AMS", "EIN", "RTM"]),
  BRU: C("Bruselas", "Bélgica", 50.8467, 4.3525, ["BRU", "CRL"]),
  BRG: C("Brujas", "Bélgica", 51.2093, 3.2247, ["BRU", "CRL", "OST"], true),
  PAR: C("París", "Francia", 48.8566, 2.3522, ["CDG", "ORY", "BVA"]),
  LYS: C("Lyon", "Francia", 45.764, 4.8357, ["LYS"]),
  MPL: C("Montpellier", "Francia", 43.6108, 3.8767, ["MPL"], true),
  MRS: C("Marsella", "Francia", 43.2965, 5.3698, ["MRS"]),
  NCE: C("Niza", "Francia", 43.6961, 7.2718, ["NCE"]),
  BCN: C("Barcelona", "España", 41.3851, 2.1734, ["BCN", "GRO", "REU"]),
  BER: C("Berlín", "Alemania", 52.52, 13.405, ["BER"]),
  HAM: C("Hamburgo", "Alemania", 53.5511, 9.9937, ["HAM", "LBC"]),
  CGN: C("Colonia", "Alemania", 50.9413, 6.9583, ["CGN", "DUS", "NRN"]),
  FRA: C("Fráncfort", "Alemania", 50.1109, 8.6821, ["FRA", "HHN"]),
  MUC: C("Múnich", "Alemania", 48.1374, 11.5755, ["MUC", "FMM"]),
  PRG: C("Praga", "Chequia", 50.0875, 14.4213, ["PRG"]),
  VIE: C("Viena", "Austria", 48.2085, 16.3721, ["VIE", "BTS"]),
  SZG: C("Salzburgo", "Austria", 47.8007, 13.0448, ["SZG"], true),
  BTS: C("Bratislava", "Eslovaquia", 48.1439, 17.1097, ["BTS", "VIE"], true),
  BUD: C("Budapest", "Hungría", 47.4979, 19.0402, ["BUD"]),
  ZAG: C("Zagreb", "Croacia", 45.8131, 15.9775, ["ZAG"]),
  LJU: C("Liubliana", "Eslovenia", 46.0511, 14.5051, ["LJU", "TRS"], true),
  ZRH: C("Zúrich", "Suiza", 47.3769, 8.5417, ["ZRH", "BSL"]),
  LUC: C("Lucerna", "Suiza", 47.0502, 8.3093, ["ZRH", "BSL"], true),
  INT: C("Interlaken", "Suiza", 46.6863, 7.8632, ["ZRH", "BSL"], true),
  GVA: C("Ginebra", "Suiza", 46.2044, 6.1432, ["GVA"]),
  MIL: C("Milán", "Italia", 45.4642, 9.19, ["MXP", "BGY", "LIN"]),
  VCE: C("Venecia", "Italia", 45.438, 12.3358, ["VCE", "TSF"]),
  FLR: C("Florencia", "Italia", 43.7731, 11.256, ["FLR", "PSA"]),
  PSA: C("Pisa", "Italia", 43.716, 10.3966, ["PSA", "FLR"], true),
  SPZ: C("La Spezia", "Italia", 44.1025, 9.8241, ["PSA", "GOA"], true),
  GOA: C("Génova", "Italia", 44.4072, 8.934, ["GOA"]),
  ROM: C("Roma", "Italia", 41.8986, 12.4768, ["FCO", "CIA"]),
  NAP: C("Nápoles", "Italia", 40.8518, 14.2681, ["NAP"]),
  CPH: C("Copenhague", "Dinamarca", 55.6761, 12.5683, ["CPH"]),
  STO: C("Estocolmo", "Suecia", 59.3293, 18.0686, ["ARN", "NYO", "BMA"]),
  OSL: C("Oslo", "Noruega", 59.9139, 10.7522, ["OSL", "TRF"]),
  BGO: C("Bergen", "Noruega", 60.3913, 5.3221, ["BGO"]),
  POZ: C("Poznań", "Polonia", 52.4064, 16.9252, ["POZ"], true),
  WAW: C("Varsovia", "Polonia", 52.2297, 21.0122, ["WAW", "WMI"]),
  KRK: C("Cracovia", "Polonia", 50.0614, 19.9366, ["KRK"]),
};

/* Cómo se agrupan en el formulario. Por países eran catorce filas —en el
   móvil, una pantalla y media de botones—; por zonas son cinco. */
export const ZONAS = [
  ["Benelux, Francia y España", ["Países Bajos", "Bélgica", "Francia", "España"]],
  ["Alemania, Austria y Suiza", ["Alemania", "Austria", "Suiza"]],
  ["Italia", ["Italia"]],
  ["Centro y este", ["Chequia", "Polonia", "Eslovaquia", "Hungría", "Eslovenia", "Croacia"]],
  ["Nórdicos", ["Dinamarca", "Suecia", "Noruega"]],
];

/* [a, b, minutos, reserva, billete]. Van en los dos sentidos. */
const R = (a, b) => [a, b];
export const CONEXIONES = [
  ["AMS", "BER", 380, null, [40, 110]],
  ["AMS", "CGN", 160, null, [30, 80]],
  ["AMS", "BRG", 180, null, [30, 60]],
  ["AMS", "BRU", 170, null, [25, 50]],
  ["AMS", "HAM", 315, null, [40, 100]],
  ["BRU", "BRG", 60, null, [15, 20]],
  ["BRU", "CGN", 110, null, [25, 60]],
  ["PAR", "BRU", 85, R(15, 30), [30, 110]],
  ["PAR", "AMS", 200, R(15, 30), [40, 150]],
  ["PAR", "LYS", 120, R(10, 20), [30, 90]],
  ["PAR", "FRA", 230, R(15, 30), [40, 110]],
  ["PAR", "ZRH", 245, R(25, 35), [50, 130]],
  ["PAR", "BCN", 400, R(30, 40), [60, 150]],
  ["LYS", "MPL", 100, R(10, 20), [25, 70]],
  ["LYS", "GVA", 115, null, [15, 35]],
  ["LYS", "MRS", 100, R(10, 20), [25, 70]],
  ["MPL", "BCN", 180, R(20, 35), [30, 80]],
  ["MPL", "MRS", 100, null, [20, 40]],
  ["MRS", "NCE", 160, null, [20, 40]],
  ["NCE", "GOA", 200, null, [20, 45]],
  ["GOA", "SPZ", 90, null, [10, 20]],
  ["GOA", "MIL", 95, R(10, 15), [15, 35]],
  ["SPZ", "PSA", 55, null, [8, 12]],
  ["PSA", "FLR", 60, null, [8, 12]],
  ["MIL", "VCE", 145, R(10, 15), [20, 50]],
  ["MIL", "FLR", 115, R(10, 15), [20, 55]],
  ["MIL", "ZRH", 200, R(10, 20), [30, 80]],
  ["MIL", "GVA", 240, R(10, 15), [40, 90]],
  ["VCE", "FLR", 125, R(10, 15), [20, 50]],
  ["VCE", "MUC", 400, null, [40, 100]],
  ["VCE", "VIE", 450, null, [30, 90]],
  ["FLR", "ROM", 95, R(10, 15), [20, 55]],
  ["ROM", "NAP", 70, R(10, 15), [15, 45]],
  ["ZRH", "LUC", 45, null, [15, 30]],
  ["ZRH", "MUC", 235, null, [40, 90]],
  ["LUC", "INT", 110, null, [20, 35]],
  ["INT", "GVA", 170, null, [40, 75]],
  ["CGN", "FRA", 65, null, [20, 50]],
  ["CGN", "BER", 260, null, [30, 100]],
  ["FRA", "MUC", 195, null, [30, 90]],
  ["FRA", "BER", 240, null, [40, 110]],
  ["BER", "HAM", 110, null, [20, 60]],
  ["BER", "PRG", 255, null, [30, 70]],
  ["BER", "POZ", 160, R(2, 5), [20, 40]],
  ["HAM", "CPH", 290, R(5, 15), [40, 100]],
  ["MUC", "SZG", 90, null, [20, 40]],
  ["MUC", "PRG", 345, null, [25, 60]],
  ["SZG", "VIE", 150, null, [20, 50]],
  ["PRG", "VIE", 240, null, [20, 50]],
  ["PRG", "KRK", 440, null, [25, 55]],
  ["VIE", "BTS", 60, null, [10, 15]],
  ["VIE", "BUD", 160, null, [15, 40]],
  ["VIE", "LJU", 360, null, [30, 60]],
  ["BTS", "BUD", 150, null, [15, 25]],
  ["BUD", "ZAG", 390, null, [25, 45]],
  ["ZAG", "LJU", 140, null, [10, 20]],
  ["POZ", "WAW", 170, R(2, 5), [15, 30]],
  ["WAW", "KRK", 150, R(2, 5), [15, 35]],
  ["CPH", "STO", 310, R(5, 10), [40, 120]],
  ["STO", "OSL", 360, R(5, 10), [30, 90]],
  ["OSL", "BGO", 410, R(5, 10), [30, 100]],
];

/* LAS RUTAS HECHAS. Paradas y noches; los tramos salen del mapa. Son las que
   se proponen cuando no eliges ciudades, y las que se enseñan como «otras
   rutas que pasan por…» cuando sí. */
export const RUTAS = [
  {
    id: "centro",
    nombre: "Europa central",
    idea: "Cuatro capitales en línea, sin una sola reserva: el pase sin letra pequeña.",
    paradas: [["AMS", 2], ["BER", 3], ["PRG", 2], ["VIE", 2], ["BUD", 2]],
  },
  {
    id: "italia",
    nombre: "Italia de punta a punta",
    idea: "Tramos cortos y rápidos: más ciudad que tren. Todos llevan reserva.",
    paradas: [["MIL", 2], ["VCE", 2], ["FLR", 2], ["ROM", 3], ["NAP", 2]],
  },
  {
    id: "francia",
    nombre: "Del Mediterráneo a París",
    idea: "Barcelona, la costa y subir hasta París.",
    paradas: [["BCN", 1], ["MPL", 2], ["LYS", 2], ["PAR", 3]],
  },
  {
    id: "suiza",
    nombre: "Suiza y los lagos",
    idea: "Trayectos de una o dos horas entre montañas. Sin reservas; Suiza no es barata, el tren con pase sí sale a cuenta.",
    paradas: [["ZRH", 2], ["LUC", 2], ["INT", 2], ["GVA", 2]],
  },
  {
    id: "norte",
    nombre: "Los nórdicos",
    idea: "Tres capitales y el tren de Bergen, que es el viaje en sí.",
    paradas: [["CPH", 2], ["STO", 3], ["OSL", 2], ["BGO", 2]],
  },
  {
    id: "benelux",
    nombre: "Del Benelux a Berlín",
    idea: "Canales y catedrales, sin una reserva: de Bruselas a Berlín por Brujas, Ámsterdam y Colonia.",
    paradas: [["BRU", 2], ["BRG", 1], ["AMS", 2], ["CGN", 1], ["BER", 3]],
  },
  {
    id: "alpes",
    nombre: "Del Rin a Viena",
    idea: "Alemania de norte a sur y los Alpes austriacos. Trenes rápidos y ninguna reserva obligatoria.",
    paradas: [["CGN", 1], ["FRA", 1], ["MUC", 2], ["SZG", 2], ["VIE", 2]],
  },
  {
    id: "danubio",
    nombre: "Del Danubio al Adriático",
    idea: "La más barata de todas: regionales sin reserva y ciudades que cuestan la mitad.",
    paradas: [["VIE", 2], ["BTS", 1], ["BUD", 2], ["ZAG", 2], ["LJU", 2]],
  },
  {
    id: "riviera",
    nombre: "La Riviera y la Toscana",
    idea: "Costa hasta Cinque Terre y luego tierra adentro. Todo regional salvo el último tramo.",
    paradas: [["NCE", 2], ["GOA", 1], ["SPZ", 2], ["PSA", 1], ["FLR", 2], ["ROM", 2]],
  },
  {
    id: "polonia",
    nombre: "Polonia",
    idea: "Barata y con buen tren. Los Intercity polacos piden reserva, pero cuesta poco.",
    paradas: [["BER", 2], ["POZ", 1], ["WAW", 2], ["KRK", 3]],
  },
  {
    id: "hamburgo",
    nombre: "De Hamburgo a Oslo",
    idea: "El norte de Alemania y tres capitales nórdicas, subiendo por la costa.",
    paradas: [["HAM", 2], ["CPH", 2], ["STO", 3], ["OSL", 2]],
  },
  {
    id: "vuelta",
    nombre: "La vuelta grande",
    idea: "De París a Roma dando la vuelta por el centro. Para un pase de siete días.",
    paradas: [["PAR", 2], ["AMS", 2], ["BER", 2], ["PRG", 2], ["VIE", 2], ["VCE", 2], ["ROM", 2]],
  },
];
