import { useState } from "react";
import { Link } from "react-router-dom";
import * as XLSX from "xlsx";
import api from "../api";
import { formatExcelDate, readExcelRows } from "../utils/excelDates";
import ResultadoCarga from "./ResultadoCarga";
import RevisionCarga from "./RevisionCarga";

const normalizeHeader = (value) =>
  value
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[_\s]+/g, " ");

const HEADER_ALIASES = {
  identificador: ["identificador", "dni", "persona", "nombre apellido", "nombre y apellido", "beneficiario"],
  fecha: ["fecha", "fecha entrega", "fecha de entrega", "date"],
  tipo: ["tipo", "tipo kit", "tipo de kit", "kit"],
};

const findHeaderKey = (normalizedHeader) =>
  Object.entries(HEADER_ALIASES).find(([, aliases]) => aliases.includes(normalizedHeader))?.[0];

function detalleError(err, porDefecto) {
  const detail = err.response?.data?.detail;
  if (Array.isArray(detail)) return detail.map((e) => (e.loc ? `${e.loc[e.loc.length - 1]}: ${e.msg}` : e.msg)).join(" — ");
  if (typeof detail === "string") return detail;
  return porDefecto;
}

function descargarPlanillaModelo() {
  const hoja = XLSX.utils.aoa_to_sheet([
    ["identificador", "fecha", "tipo"],
    ["12345678", "2026-06-04", "PPAAS"],
    ["Juan Pérez", "2026-06-04", "ABRIGO"],
  ]);
  hoja["!cols"] = [{ wch: 28 }, { wch: 14 }, { wch: 10 }];
  const instrucciones = XLSX.utils.aoa_to_sheet([
    ["Cómo completar esta planilla"],
    [""],
    ["1. identificador: DNI (sin puntos) o Nombre y Apellido."],
    ["2. fecha: el día en que se entregó el kit (AAAA-MM-DD o DD/MM/AAAA)."],
    ["3. tipo: PPAAS (higiene / primeros auxilios) o ABRIGO."],
    ["4. Una fila = un kit entregado. La misma persona puede aparecer en varias filas."],
    ["5. Al subirla, el sistema pide confirmar los nombres parecidos y permite crear a quien no esté registrado."],
  ]);
  instrucciones["!cols"] = [{ wch: 100 }];
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Kits");
  XLSX.utils.book_append_sheet(libro, instrucciones, "Instrucciones");
  XLSX.writeFile(libro, "Planilla_carga_masiva_kits.xlsx");
}

export default function CargaMasivaKits() {
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(null);
  const [resultado, setResultado] = useState(null);

  async function revisar(data) {
    setError("");
    setLoading(true);
    try {
      const response = await api.post("/kits/bulk/preview", data);
      setRevision({ data, preview: response.data });
    } catch (err) {
      setError(detalleError(err, "No se pudo revisar la carga."));
    } finally {
      setLoading(false);
    }
  }

  const handleFileChange = (event) => {
    setFileError("");
    setError("");
    setRevision(null);
    setResultado(null);
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const { rows: rawRows, date1904 } = readExcelRows(e.target.result);
        const filteredRows = rawRows.filter((row) =>
          Object.values(row || {}).some((value) => value !== null && value !== undefined && String(value).trim() !== "")
        );
        if (!filteredRows.length) {
          throw new Error("El archivo no contiene filas de datos útiles.");
        }

        const keyMap = {};
        Object.keys(rawRows[0]).forEach((header) => {
          const key = findHeaderKey(normalizeHeader(header));
          if (key) keyMap[key] = header;
        });
        const missing = ["identificador", "fecha", "tipo"].filter((column) => !keyMap[column]);
        if (missing.length > 0) {
          throw new Error(`Faltan columnas en el archivo: ${missing.join(", ")}. Descargá la planilla modelo.`);
        }

        const rows = filteredRows.map((rawRow, i) => ({
          fila: typeof rawRow.__rowNum__ === "number" ? rawRow.__rowNum__ + 1 : i + 2,
          identificador: rawRow[keyMap.identificador]?.toString().trim(),
          fecha: formatExcelDate(rawRow[keyMap.fecha], { date1904 }),
          tipo: rawRow[keyMap.tipo]?.toString().trim(),
        }));
        revisar({ rows });
      } catch (err) {
        setFileError(err.message || "No se pudo leer el archivo Excel.");
      }
    };
    reader.onerror = () => setFileError("No se pudo leer el archivo.");
    reader.readAsArrayBuffer(file);
    // Permite volver a elegir el mismo archivo después de cancelar.
    event.target.value = "";
  };

  return (
    <main className="page-shell">
      <section className="card card-form">
        <div className="form-actions-row">
          <h1>Carga masiva de kits</h1>
          <Link to="/kits/entregar" className="button button-outline button-small">
            Entrega individual
          </Link>
        </div>
        <p>
          Subí un Excel (.xls/.xlsx) con una fila por kit entregado y las columnas <strong>identificador</strong> (DNI o
          Nombre y Apellido), <strong>fecha</strong> y <strong>tipo</strong> (PPAAS o ABRIGO).
        </p>
        <p className="text-muted">
          Antes de guardar se muestra una revisión: vas a confirmar los nombres parecidos y elegir a quién crear si no
          está en la base.
        </p>
        <div className="button-row">
          <button type="button" className="button button-outline button-small" onClick={descargarPlanillaModelo}>
            Descargar planilla modelo
          </button>
        </div>
        <label style={{ marginTop: "1rem" }}>
          Seleccionar archivo Excel
          <input type="file" accept=".xls,.xlsx" onChange={handleFileChange} />
        </label>
        {fileName && <p>Archivo seleccionado: {fileName}</p>}
        {loading && <p className="text-muted">Revisando...</p>}
        {fileError && <div className="alert alert-error">{fileError}</div>}
        {error && <div className="alert alert-error">{error}</div>}
      </section>

      {revision && (
        <RevisionCarga
          key={fileName + revision.preview.total_filas}
          data={revision.data}
          endpoint="/kits/bulk"
          preview={revision.preview}
          onCancelar={() => setRevision(null)}
          onTerminado={(res) => {
            setRevision(null);
            setResultado(res);
          }}
        />
      )}

      <ResultadoCarga resultado={resultado} unidad="entrega(s) de kits guardada(s)" />
    </main>
  );
}
