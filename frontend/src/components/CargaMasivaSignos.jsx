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
  identificador: [
    "identificador",
    "dni",
    "persona",
    "nombre apellido",
    "nombre_apellido",
    "nombre y apellido",
  ],
  fecha: ["fecha", "date"],
  presion_arterial: [
    "presion arterial",
    "presion_arterial",
    "presion",
    "presionarterial",
    "presionarterial",
  ],
  frecuencia_cardiaca: [
    "frecuencia cardiaca",
    "frecuencia_cardiaca",
    "frecuencia",
    "fc",
  ],
  oxigenacion_sangre: [
    "oxigenacion",
    "oxigenacion sangre",
    "oxigenacion_sangre",
    "oxigenacionen sangre",
    "spo2",
    "saturacion",
    "saturacion de oxigeno",
  ],
  operativo_id: ["operativo_id", "operativo id", "operativo"],
  lugar_custom: ["lugar_custom", "lugar custom", "lugar"],
};

const findHeaderKey = (normalizedHeader) => {
  return Object.entries(HEADER_ALIASES).find(([key, aliases]) => aliases.includes(normalizedHeader))?.[0];
};

const formatExcelDate = (value) => {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (value === null || value === undefined || value === "") {
    return "";
  }
  return value.toString().trim();
};

export default function CargaMasivaSignos() {
  const [payload, setPayload] = useState(
    JSON.stringify(
      {
        operativo_id: null,
        lugar_custom: null,
        rows: [
          {
            identificador: "12345678",
            signos: "120/80-75-98.5",
            fecha: "2026-06-04",
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

        if (!rawRows.length) {
          throw new Error("El archivo no contiene filas de datos.");
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

        const requiredColumns = ["identificador", "fecha", "presion_arterial", "frecuencia_cardiaca", "oxigenacion_sangre"];
        const missing = requiredColumns.filter((column) => !keyMap[column]);
        if (missing.length > 0) {
          throw new Error(`Faltan columnas en el archivo: ${missing.join(", ")}`);
        }

        const rows = rawRows.map((rawRow) => {
          const identificador = rawRow[keyMap.identificador]?.toString().trim();
          const fecha = formatExcelDate(rawRow[keyMap.fecha]);
          const presion_arterial = rawRow[keyMap.presion_arterial]?.toString().trim();
          const frecuencia_cardiaca = rawRow[keyMap.frecuencia_cardiaca]?.toString().trim();
          const oxigenacion_sangre = rawRow[keyMap.oxigenacion_sangre]?.toString().trim();
          const operativo_id = keyMap.operativo_id ? rawRow[keyMap.operativo_id] : null;
          const lugar_custom = keyMap.lugar_custom ? rawRow[keyMap.lugar_custom]?.toString().trim() : null;
          return {
            identificador,
            signos: `${presion_arterial}-${frecuencia_cardiaca}-${oxigenacion_sangre}`,
            fecha,
            operativo_id: operativo_id || null,
            lugar_custom: lugar_custom || null,
          };
        });

        setPayload(JSON.stringify({ operativo_id: null, lugar_custom: null, rows }, null, 2));
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
      const response = await api.post("/signos/bulk", data);
      setOkCount(response.data.ok);
      setErrores(response.data.errores || []);
      setMessage(`Carga finalizada: ${response.data.ok} fila(s) procesada(s).`);
    } catch (err) {
      setError(err.response?.data?.detail || "Error al cargar registros masivos.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="card card-form">
        <div className="form-actions-row">
          <h1>Carga masiva de signos</h1>
        </div>
        <p>
          Sube un archivo Excel (.xls/.xlsx) con una fila por persona. La primera columna puede
          ser DNI o Nombre y Apellido juntos. El archivo debe tener columnas: Identificador,
          Fecha, Presión arterial, Frecuencia cardíaca y Oxigenación.
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

        {okCount !== null && (
          <div className="card card-secondary">
            <h2>Resultado de la carga</h2>
            <p>Filas guardadas: {okCount}</p>
            {errores.length > 0 ? (
              <div>
                <p>Errores encontrados:</p>
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
