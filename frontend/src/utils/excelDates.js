import * as XLSX from "xlsx";

/*
 * Lectura de Excel y normalización de fechas para las cargas masivas.
 *
 * Por qué existe: antes se leía con `raw: false`, que devuelve el TEXTO que muestra
 * la celda según su formato. Si el Excel tiene formato de fecha en inglés
 * (mm-dd-yy, el default de Excel/LibreOffice en muchas instalaciones), SheetJS
 * devuelve "8/27/26", y eso se interpretaba como día/mes -> "2026-27-08" (inválida)
 * o, peor, "6/4/26" -> 6 de abril en vez de 4 de junio.
 *
 * Ahora se lee el VALOR real de la celda (número de serie de Excel) y se convierte
 * a AAAA-MM-DD en UTC, así el formato visual de la planilla no importa.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Epoch del sistema de fechas 1900 (con el bug del 29/02/1900 ya compensado) y del sistema 1904 (Mac viejo).
const EXCEL_EPOCH_1900 = Date.UTC(1899, 11, 30);
const EXCEL_EPOCH_1904 = Date.UTC(1904, 0, 1);

const pad2 = (n) => String(n).padStart(2, "0");

const isValidYmd = (year, month, day) => {
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
};

const ymd = (year, month, day) => `${year}-${pad2(month)}-${pad2(day)}`;

const expandYear = (yearRaw) => {
  const y = Number(yearRaw);
  if (yearRaw.length !== 2) return y;
  return y < 50 ? 2000 + y : 1900 + y;
};

/** Convierte un número de serie de Excel a "AAAA-MM-DD" (siempre en UTC, sin corrimientos por zona horaria). */
export const excelSerialToIso = (serial, date1904 = false) => {
  const epoch = date1904 ? EXCEL_EPOCH_1904 : EXCEL_EPOCH_1900;
  // Math.floor: se descarta la hora si la celda tiene fecha+hora.
  const d = new Date(epoch + Math.floor(serial) * MS_PER_DAY);
  return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
};

/**
 * Normaliza lo que venga en la columna de fecha a "AAAA-MM-DD".
 * - número (valor real de una celda con formato fecha) -> se convierte desde el serial de Excel.
 * - Date -> se toman sus componentes locales (así lo arma SheetJS con cellDates).
 * - texto "AAAA-MM-DD" / "AAAA/MM/DD".
 * - texto "DD/MM/AAAA" (formato argentino, por defecto). Si el primer número no puede ser
 *   día-mes válido pero sí mes-día (ej. "8/27/26"), se interpreta como MM/DD.
 * Si no se puede interpretar, devuelve el texto original para que el backend informe el error de esa fila.
 */
export const formatExcelDate = (value, { date1904 = false } = {}) => {
  if (value === null || value === undefined || value === "") return "";

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return ymd(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return excelSerialToIso(value, date1904);
  }

  const text = value.toString().trim();
  if (!text) return "";

  const compact = text.replace(/T/g, " ").replace(/Z$/i, "").replace(/\s+/g, " ").trim();

  // Serial de Excel que vino como texto (ej. "46261").
  if (/^\d{5,7}(?:\.\d+)?$/.test(compact)) {
    return excelSerialToIso(Number(compact), date1904);
  }

  const isoMatch = compact.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch.map(Number);
    if (isValidYmd(y, m, d)) return ymd(y, m, d);
    return compact;
  }

  const localMatch = compact.match(/^(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{2,4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/);
  if (localMatch) {
    const [, a, b, yearRaw] = localMatch;
    const year = expandYear(yearRaw);
    const first = Number(a);
    const second = Number(b);
    // Por defecto DD/MM (Argentina).
    if (isValidYmd(year, second, first)) return ymd(year, second, first);
    // Si no es válida como DD/MM pero sí como MM/DD (ej. "8/27/26"), es formato EE.UU.
    if (isValidYmd(year, first, second)) return ymd(year, first, second);
    return compact;
  }

  return compact;
};

/**
 * Lee la primera hoja de un Excel y devuelve { rows, date1904 }.
 * Usa `raw: true` para obtener los valores reales de las celdas (las fechas vienen como
 * número de serie), no el texto formateado.
 */
export const readExcelRows = (arrayBuffer) => {
  const data = new Uint8Array(arrayBuffer);
  const workbook = XLSX.read(data, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true });
  const date1904 = Boolean(workbook.Workbook?.WBProps?.date1904);
  return { rows, date1904 };
};
