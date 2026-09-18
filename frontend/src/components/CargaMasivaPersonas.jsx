import { useState } from "react";
import * as XLSX from "xlsx";
import api from "../api";

const normalizeHeader = (value) =>
  value
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[_\s]+/g, " ");

const HEADER_ALIASES = {
  nombre: ["nombre", "nombres", "first name", "first_name"],
  apellido: ["apellido", "apellidos", "last name", "last_name", "surname"],
  dni: ["dni", "documento", "documento nro", "documento_nro", "dni nro"],
  fecha_nacimiento: ["fecha nacimiento", "fecha_nacimiento", "nacimiento", "fecha de nacimiento"],
  genero: ["genero", "sexo", "sex"],
  situacion_de_calle: ["situacion de calle", "situacion_de_calle", "situacion calle", "calle"],
};

const findHeaderKey = (normalizedHeader) => {
  return Object.entries(HEADER_ALIASES).find(([_, aliases]) => aliases.includes(normalizedHeader))?.[0];
};

const parseBooleanValue = (value) => {
  if (value === null || value === undefined || value === "") return false;
  const text = value.toString().trim().toLowerCase();
  return ["true", "1", "si", "sí", "yes", "s", "y"].includes(text);
};

const formatExcelDate = (value) => {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  const toIsoDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  if (value instanceof Date) {
    return toIsoDate(value);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const parsed = new Date(excelEpoch.getTime() + value * 24 * 60 * 60 * 1000);
    return toIsoDate(parsed);
  }

  const text = value.toString().trim();
  if (!text) return "";

  const compact = text.replace(/T/g, " ").replace(/Z$/i, "").replace(/\s+/g, " ").trim();

  if (/^\d{5,7}(?:\.\d+)?$/.test(compact)) {
    const numeric = Number(compact);
    if (Number.isFinite(numeric)) {
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      const parsed = new Date(excelEpoch.getTime() + numeric * 24 * 60 * 60 * 1000);
      return toIsoDate(parsed);
    }
  }

  const isoMatch = compact.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${year}-${String(Number(month)).padStart(2, "0")}-${String(Number(day)).padStart(2, "0")}`;
  }

  const localMatch = compact.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/);
  if (localMatch) {
    const [, day, month, yearRaw] = localMatch;
    const year = yearRaw.length === 2 ? (Number(yearRaw) < 50 ? 2000 + Number(yearRaw) : 1900 + Number(yearRaw)) : Number(yearRaw);
    return `${year}-${String(Number(month)).padStart(2, "0")}-${String(Number(day)).padStart(2, "0")}`;
  }

  const out = compact.match(/^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2,4})$/);
  if (out) {
    const [, day, month, yearRaw] = out;
    const year = yearRaw.length === 2 ? (Number(yearRaw) < 50 ? 2000 + Number(yearRaw) : 1900 + Number(yearRaw)) : Number(yearRaw);
    return `${year}-${String(Number(month)).padStart(2, "0")}-${String(Number(day)).padStart(2, "0")}`;
  }

  const parsed = new Date(compact);
  if (!Number.isNaN(parsed.getTime())) {
    return toIsoDate(parsed);
  }

  return compact;
};

const formatExcelValue = (value) => {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toString();
  }

  return value.toString().trim();
};

export default function CargaMasivaPersonas() {
  const [payload, setPayload] = useState(
    JSON.stringify(
      {
        rows: [
          {
            nombre: "Juan",
            apellido: "Pérez",
            dni: "12345678",
            fecha_nacimiento: "1990-05-10",
            genero: "Masculino",
            situacion_de_calle: false,
          },
        ],
      },
      null,
      2
    )
  );
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [errores, setErrores] = useState([]);
  const [okCount, setOkCount] = useState(null);
  const [totalRows, setTotalRows] = useState(null);

  const handleFileChange = async (event) => {
    setFileError("");
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: "array", cellDates: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
        const filteredRows = rawRows.filter((row) =>
          Object.values(row || {}).some((value) => value !== null && value !== undefined && String(value).trim() !== "")
        );

        if (!filteredRows.length) {
          throw new Error("El archivo no contiene filas de datos útiles. Hay filas vacías o sin información.");
        }

        const headerKeys = Object.keys(rawRows[0]);
        const keyMap = {};
        headerKeys.forEach((header) => {
          const normalizedHeader = normalizeHeader(header);
          const key = findHeaderKey(normalizedHeader);
          if (key) {
            keyMap[key] = header;
          }
        });

        const requiredColumns = ["nombre", "apellido", "dni"];
        const missing = requiredColumns.filter((column) => !keyMap[column]);
        if (missing.length > 0) {
          throw new Error(`Faltan columnas en el archivo: ${missing.join(", ")}`);
        }

        const rows = filteredRows.map((rawRow) => {
          const nombre = formatExcelValue(rawRow[keyMap.nombre])
            ?.replace(/\s+/g, " ")
            .trim();
          const apellido = formatExcelValue(rawRow[keyMap.apellido])
            ?.replace(/\s+/g, " ")
            .trim();
          const dni = formatExcelValue(rawRow[keyMap.dni]);
          const fecha_nacimiento = keyMap.fecha_nacimiento ? formatExcelDate(rawRow[keyMap.fecha_nacimiento]) : "";
          const genero = keyMap.genero ? formatExcelValue(rawRow[keyMap.genero]) : "";
          const situacion_de_calle = keyMap.situacion_de_calle
            ? parseBooleanValue(rawRow[keyMap.situacion_de_calle])
            : false;

          return {
            nombre,
            apellido,
            dni,
            fecha_nacimiento: fecha_nacimiento || null,
            genero: genero || null,
            situacion_de_calle,
          };
        });

        setPayload(JSON.stringify({ rows }, null, 2));
      } catch (err) {
        setFileError(err.message || "No se pudo leer el archivo Excel.");
      }
    };
    reader.onerror = () => {
      setFileError("No se pudo leer el archivo.");
    };
    reader.readAsArrayBuffer(file);
  };

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    setErrores([]);
    setOkCount(null);
    setTotalRows(null);

    let data;
    try {
      data = JSON.parse(payload);
    } catch (err) {
      setError("El JSON no es válido. Verifique la estructura y la sintaxis.");
      return;
    }

    if (!data.rows || !Array.isArray(data.rows) || data.rows.length === 0) {
      setError("Debe incluir una lista de filas en el campo rows.");
      return;
    }

    setLoading(true);
    try {
      const response = await api.post("/personas/bulk", data);
      setOkCount(response.data.ok);
      setTotalRows(response.data.total);
      setErrores(response.data.errores || []);
      if ((response.data.errores || []).length > 0 && response.data.ok === 0) {
        setError("La carga no pudo completarse. Revisá los errores detallados abajo.");
      } else {
        setError("");
      }
      setMessage(
        response.data.ok > 0
          ? `Carga finalizada: ${response.data.ok} persona(s) cargada(s) de ${response.data.total}.`
          : "No se pudo guardar ninguna persona. Revisá los errores."
      );
    } catch (err) {
      const detail = err.response?.data?.detail;
      if (Array.isArray(detail)) {
        setError(detail.map((e) => (e.loc ? `${e.loc[e.loc.length - 1]}: ${e.msg}` : e.msg)).join(" — "));
      } else if (typeof detail === "string") {
        setError(detail);
      } else {
        setError("Error al cargar personas masivas.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="card card-form">
        <div className="form-actions-row">
          <h1>Carga masiva de personas</h1>
        </div>
        <p>
          Sube un archivo Excel (.xls/.xlsx) con una fila por persona. Los campos mínimos son
          Nombre, Apellido y DNI. También acepta Fecha de nacimiento, Género y Situación de calle.
        </p>
        <label>
          Seleccionar archivo Excel
          <input type="file" accept=".xls,.xlsx" onChange={handleFileChange} />
        </label>
        {fileName && <p>Archivo seleccionado: {fileName}</p>}
        {fileError && <div className="alert alert-error">{fileError}</div>}
        <form onSubmit={handleSubmit}>
          <label>
            JSON de carga masiva
            <textarea
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              rows={18}
              spellCheck="false"
              className="textarea-monospace"
              required
            />
          </label>
          {error && <div className="alert alert-error">{error}</div>}
          {message && <div className="alert alert-success">{message}</div>}
          <button type="submit" className="button button-primary" disabled={loading}>
            {loading ? "Cargando..." : "Ejecutar carga masiva"}
          </button>
        </form>

        {(okCount !== null || totalRows !== null) && (
          <div className="card card-secondary">
            <h2>Resultado de la carga</h2>
            <p>
              Personas procesadas: {okCount ?? 0}/{totalRows ?? 0}
            </p>
            {errores.length > 0 ? (
              <div>
                <p>Errores y omisiones encontrados:</p>
                <ul>
                  {errores.map((item, index) => (
                    <li key={`${item}-${index}`}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p>No se encontraron errores.</p>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
