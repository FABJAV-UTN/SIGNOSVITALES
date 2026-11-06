import { readExcelRows } from "./excelDates";
import { filasConDatos } from "./planillaPersona";

/*
 * Carga de varios Excel a la vez (personas, signos y kits).
 *
 * Cada archivo se lee por separado (sus columnas, su sistema de fechas y su convención de
 * género pueden ser distintos) y después se juntan todas las filas en UNA sola revisión.
 * Así el backend agrupa por persona sobre el total: si "Juan Pérez" aparece en tres
 * planillas se crea una sola vez, y si en una tiene DNI y en otra no, se unen.
 *
 * Como el backend identifica cada fila con un número ("fila"), a cada fila se le asigna un
 * número global único y se guarda de qué archivo y de qué fila del Excel viene (`origenes`)
 * para mostrar "Planilla_marzo.xlsx, fila 7" en la revisión y en los errores.
 */

const normalizar = (v) =>
  v === null || v === undefined
    ? ""
    : String(v)
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .replace(/\s+/g, " ")
        .trim();

/** Clave de contenido de una fila (sin el número de fila) para detectar filas repetidas entre archivos. */
const claveFila = (row) =>
  JSON.stringify(
    Object.keys(row)
      .filter((k) => k !== "fila")
      .sort()
      .map((k) => [k, normalizar(row[k])])
  );

const leerBuffer = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.readAsArrayBuffer(file);
  });

/**
 * Lee un archivo y lo convierte en filas con `procesar(rawRows, { date1904 })`.
 * Nunca lanza: si el archivo tiene un problema, se devuelve con `error` y los demás siguen.
 */
export async function leerArchivo(file, procesar) {
  const base = { id: `${file.name}|${file.size}|${file.lastModified}`, nombre: file.name, rows: [], error: "" };
  try {
    const { rows: rawRows, date1904 } = readExcelRows(await leerBuffer(file));
    if (!filasConDatos(rawRows).length) throw new Error("no tiene filas con datos.");
    const rows = procesar(rawRows, { date1904 });
    if (!rows.length) throw new Error("no tiene filas con datos.");
    return { ...base, rows };
  } catch (err) {
    return { ...base, error: err.message || "no se pudo leer." };
  }
}

/**
 * Junta las filas de todos los archivos leídos sin error.
 * - Renumera las filas (1, 2, 3...) y arma `origenes[fila] = { archivo, fila }`.
 * - Descarta las filas idénticas que aparecen en OTRO archivo (la misma planilla subida dos
 *   veces, o dos planillas que se pisan). Dentro de un mismo archivo no se toca nada.
 */
export function combinarArchivos(archivos) {
  const rows = [];
  const origenes = {};
  const repetidas = [];
  const vistas = new Map(); // clave -> { id, archivo, fila }
  let n = 0;

  archivos
    .filter((a) => !a.error)
    .forEach((archivo) => {
      const propias = new Set();
      archivo.rows.forEach((row) => {
        const clave = claveFila(row);
        const previa = vistas.get(clave);
        if (previa && previa.id !== archivo.id) {
          repetidas.push({ archivo: archivo.nombre, fila: row.fila, igualA: previa });
          return;
        }
        if (!propias.has(clave)) vistas.set(clave, { id: archivo.id, archivo: archivo.nombre, fila: row.fila });
        propias.add(clave);
        n += 1;
        origenes[n] = { archivo: archivo.nombre, fila: row.fila };
        rows.push({ ...row, fila: n });
      });
    });

  const variosArchivos = archivos.filter((a) => !a.error).length > 1;
  return { rows, origenes: variosArchivos ? origenes : null, repetidas };
}

/** "Fila 7" o "Planilla_marzo.xlsx, fila 7". */
export function describirFila(fila, origenes) {
  const o = origenes?.[fila];
  if (!o) return `fila ${fila}`;
  return `${o.archivo}, fila ${o.fila}`;
}

/** "filas 2, 5" o "marzo.xlsx: filas 2, 5 · abril.xlsx: fila 3". */
export function describirFilas(filas, origenes) {
  const lista = (nums) => (nums.length === 1 ? `fila ${nums[0]}` : `filas ${nums.join(", ")}`);
  if (!origenes) return lista(filas);
  const porArchivo = new Map();
  filas.forEach((f) => {
    const o = origenes[f] || { archivo: "?", fila: f };
    if (!porArchivo.has(o.archivo)) porArchivo.set(o.archivo, []);
    porArchivo.get(o.archivo).push(o.fila);
  });
  return [...porArchivo.entries()].map(([archivo, nums]) => `${archivo}: ${lista(nums)}`).join(" · ");
}

/** Pasa los "Fila N: ..." que devuelve el backend al archivo y fila reales. */
export function traducirErrores(errores, origenes) {
  if (!origenes) return errores;
  return errores.map((e) =>
    typeof e === "string" ? e.replace(/^Fila (\d+):/, (m, n) => (origenes[n] ? `${describirFila(Number(n), origenes)}:` : m)) : e
  );
}

/** Cantidad de archivos distintos entre las filas dadas (para avisar "aparece en 3 planillas"). */
export function cantidadArchivos(filas, origenes) {
  if (!origenes) return 1;
  return new Set(filas.map((f) => origenes[f]?.archivo)).size;
}
