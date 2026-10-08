import { formatExcelDate } from "./excelDates";

/**
 * Columnas de persona que comparten todas las planillas de carga masiva
 * (personas, signos y kits): Nombre, Apellido, DNI y Fecha de nacimiento.
 * Las columnas tienen que existir, pero cualquier celda puede quedar en blanco
 * (alcanza con Nombre y Apellido, o con el DNI).
 */
export const normalizeHeader = (value) =>
  value
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[_\s]+/g, " ");

export const ALIAS_PERSONA = {
  nombre: ["nombre", "nombres", "first name"],
  apellido: ["apellido", "apellidos", "last name", "surname"],
  dni: ["dni", "documento", "documento nro", "dni nro", "nro documento", "nro de documento"],
  fecha_nacimiento: ["fecha nacimiento", "nacimiento", "fecha de nacimiento", "f nacimiento", "cumpleanos"],
};

export const COLUMNAS_PERSONA = ["nombre", "apellido", "dni"];

/** Arma {campo: encabezado del Excel} con los alias de persona más los propios de la planilla. */
export function mapearColumnas(encabezados, aliasExtra = {}) {
  const alias = { ...ALIAS_PERSONA, ...aliasExtra };
  const keyMap = {};
  encabezados.forEach((header) => {
    const normalizado = normalizeHeader(header);
    const campo = Object.entries(alias).find(([, lista]) => lista.includes(normalizado))?.[0];
    if (campo && !keyMap[campo]) keyMap[campo] = header;
  });
  return keyMap;
}

/** Error claro si faltan columnas (incluye el caso de las planillas viejas con "identificador"). */
export function verificarColumnas(keyMap, encabezados, requeridasExtra = []) {
  const faltan = [...COLUMNAS_PERSONA, ...requeridasExtra].filter((c) => !keyMap[c]);
  if (faltan.length === 0) return;
  const viejo = encabezados.some((h) => normalizeHeader(h) === "identificador");
  const nombres = { nombre: "Nombre", apellido: "Apellido", dni: "DNI" };
  throw new Error(
    `Faltan columnas en el archivo: ${faltan.map((c) => nombres[c] || c).join(", ")}.` +
      (viejo
        ? " Esta planilla usa el formato viejo (una sola columna 'identificador'): ahora van Nombre, Apellido y DNI en columnas separadas."
        : "") +
      " Descargá la planilla modelo."
  );
}

const texto = (valor) => {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "number" && Number.isFinite(valor)) return String(valor);
  return String(valor).replace(/\s+/g, " ").trim();
};

/** Datos de persona de una fila (null en lo que esté en blanco). */
export function leerPersona(rawRow, keyMap, { date1904 } = {}) {
  const nacimiento = keyMap.fecha_nacimiento ? formatExcelDate(rawRow[keyMap.fecha_nacimiento], { date1904 }) : "";
  return {
    nombre: texto(rawRow[keyMap.nombre]) || null,
    apellido: texto(rawRow[keyMap.apellido]) || null,
    dni: texto(rawRow[keyMap.dni]).replace(/[\s.-]/g, "") || null,
    fecha_nacimiento: nacimiento || null,
  };
}

/** Número de fila del Excel (SheetJS guarda la fila real en __rowNum__, base 0). */
export const numeroFila = (rawRow, i) => (typeof rawRow.__rowNum__ === "number" ? rawRow.__rowNum__ + 1 : i + 2);

export const filasConDatos = (rawRows) =>
  rawRows.filter((row) =>
    Object.values(row || {}).some((value) => value !== null && value !== undefined && String(value).trim() !== "")
  );

/** Instrucciones comunes para la hoja "Instrucciones" de las planillas modelo. */
export const INSTRUCCIONES_PERSONA = [
  "Columnas de la persona: Nombre, Apellido, DNI y Fecha de nacimiento.",
  "Cualquiera puede quedar en blanco: alcanza con Nombre y Apellido, o solo con el DNI.",
  "DNI sin puntos (si se ponen, se sacan solos). Si no se sabe, dejarlo vacío.",
  "Fecha de nacimiento: opcional. Si viene, se completa o actualiza en la ficha de la persona.",
  "Al subir la planilla se muestra una revisión: si alguien ya existe sin DNI y la planilla lo trae, se ofrece completarlo.",
];
