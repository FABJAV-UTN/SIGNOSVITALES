import { useState } from "react";
import api from "../api";
import ResultadoCarga from "./ResultadoCarga";
import RevisionCarga from "./RevisionCarga";
import { formatExcelDate, readExcelRows } from "../utils/excelDates";

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
  return Object.entries(HEADER_ALIASES).find(([, aliases]) => aliases.includes(normalizedHeader))?.[0];
};

const EJEMPLO_PAYLOAD = JSON.stringify(
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
);

function detalleError(err, porDefecto) {
  const detail = err.response?.data?.detail;
  if (Array.isArray(detail)) {
    return detail.map((e) => (e.loc ? `${e.loc[e.loc.length - 1]}: ${e.msg}` : e.msg)).join(" — ");
  }
  if (typeof detail === "string") return detail;
  return porDefecto;
}

/** Parsea el JSON y le pone a cada fila su número ("fila") si no lo trae. */
function parsearPayload(texto) {
  const data = JSON.parse(texto);
  if (!data.rows || !Array.isArray(data.rows) || data.rows.length === 0) {
    throw new Error("Debe incluir una lista de filas en el campo rows.");
  }
  return { ...data, rows: data.rows.map((row, i) => ({ ...row, fila: row?.fila ?? i + 1 })) };
}

export default function CargaMasivaSignos() {
  const [payload, setPayload] = useState(EJEMPLO_PAYLOAD);
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(null); // { data, preview }
  const [resultado, setResultado] = useState(null);

  const handleFileChange = async (event) => {
    setFileError("");
    setRevision(null);
    setResultado(null);
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        // Se leen los valores reales de las celdas (no el texto formateado) para que
        // el formato de fecha de la planilla (dd/mm, mm/dd, etc.) no afecte el resultado.
        const { rows: rawRows, date1904 } = readExcelRows(e.target.result);
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

        const requiredColumns = ["identificador", "fecha", "presion_arterial", "frecuencia_cardiaca", "oxigenacion_sangre"];
        const missing = requiredColumns.filter((column) => !keyMap[column]);
        if (missing.length > 0) {
          throw new Error(`Faltan columnas en el archivo: ${missing.join(", ")}`);
        }

        const rows = filteredRows.map((rawRow, i) => {
          const identificador = rawRow[keyMap.identificador]?.toString().trim();
          const fecha = formatExcelDate(rawRow[keyMap.fecha], { date1904 });
          const presion_arterial = rawRow[keyMap.presion_arterial]?.toString().trim();
          const frecuencia_cardiaca = rawRow[keyMap.frecuencia_cardiaca]?.toString().trim();
          const oxigenacion_sangre = rawRow[keyMap.oxigenacion_sangre]?.toString().trim();
          const operativo_id = keyMap.operativo_id ? rawRow[keyMap.operativo_id] : null;
          const lugar_custom = keyMap.lugar_custom ? rawRow[keyMap.lugar_custom]?.toString().trim() : null;
          return {
            // Número de fila del Excel (SheetJS guarda la fila real en __rowNum__, base 0).
            fila: typeof rawRow.__rowNum__ === "number" ? rawRow.__rowNum__ + 1 : i + 2,
            identificador,
            signos: `${presion_arterial}-${frecuencia_cardiaca}-${oxigenacion_sangre}`,
            fecha,
            operativo_id: operativo_id || null,
            lugar_custom: lugar_custom || null,
          };
        });

        const texto = JSON.stringify({ operativo_id: null, lugar_custom: null, rows }, null, 2);
        setPayload(texto);
        revisar(texto);
      } catch (err) {
        setFileError(err.message || "No se pudo leer el archivo Excel.");
      }
    };
    reader.onerror = () => {
      setFileError("No se pudo leer el archivo.");
    };
    reader.readAsArrayBuffer(file);
  };

  async function revisar(texto = payload) {
    setError("");
    setResultado(null);
    let data;
    try {
      data = parsearPayload(texto);
    } catch (err) {
      setError(err instanceof SyntaxError ? "El JSON no es válido. Verifique la estructura y la sintaxis." : err.message);
      return;
    }
    setLoading(true);
    try {
      const response = await api.post("/signos/bulk/preview", data);
      setRevision({ data, preview: response.data });
    } catch (err) {
      setError(detalleError(err, "No se pudo revisar la carga."));
    } finally {
      setLoading(false);
    }
  }

  function terminar(res) {
    setRevision(null);
    setResultado(res);
  }

  return (
    <main className="page-shell">
      <section className="card card-form">
        <div className="form-actions-row">
          <h1>Carga masiva de signos</h1>
        </div>
        <p>
          Sube un archivo Excel (.xls/.xlsx) con una fila por medición. La primera columna puede
          ser DNI o Nombre y Apellido. El archivo debe tener columnas: Identificador, Fecha,
          Presión arterial, Frecuencia cardíaca y Oxigenación.
        </p>
        <p className="text-muted">
          Antes de guardar se muestra una revisión: vas a confirmar los nombres parecidos y elegir
          a quién crear si no está en la base.
        </p>
        <label>
          Seleccionar archivo Excel
          <input type="file" accept=".xls,.xlsx" onChange={handleFileChange} />
        </label>
        {fileName && <p>Archivo seleccionado: {fileName}</p>}
        {fileError && <div className="alert alert-error">{fileError}</div>}

        <details className="json-details">
          <summary>Ver / editar JSON (avanzado)</summary>
          <label>
            JSON de carga masiva
            <textarea
              value={payload}
              onChange={(e) => {
                setPayload(e.target.value);
                setRevision(null);
              }}
              rows={14}
              spellCheck="false"
              className="textarea-monospace"
            />
          </label>
        </details>

        {error && <div className="alert alert-error">{error}</div>}
        {!revision && (
          <button type="button" className="button button-primary" disabled={loading} onClick={() => revisar()}>
            {loading ? "Revisando..." : "Revisar carga"}
          </button>
        )}
      </section>

      {revision && (
        <RevisionCarga
          key={JSON.stringify(revision.preview.identificadores.map((r) => r.identificador))}
          data={revision.data}
          endpoint="/signos/bulk"
          preview={revision.preview}
          onCancelar={() => setRevision(null)}
          onTerminado={terminar}
        />
      )}

      <ResultadoCarga resultado={resultado} unidad="fila(s) de signos guardada(s)" />
    </main>
  );
}
