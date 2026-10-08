import { useState } from "react";
import * as XLSX from "xlsx";
import api from "../api";
import { readExcelRows } from "../utils/excelDates";
import { normalizarGenero, usaConvencionMF } from "../utils/genero";
import {
  INSTRUCCIONES_PERSONA,
  filasConDatos,
  leerPersona,
  mapearColumnas,
  numeroFila,
  verificarColumnas,
} from "../utils/planillaPersona";
import ResultadoCarga from "./ResultadoCarga";
import RevisionCarga from "./RevisionCarga";

const ALIAS_PERSONAS = {
  genero: ["genero", "sexo", "sex"],
  situacion_de_calle: ["situacion de calle", "situacion calle", "calle"],
};

const parseBooleanValue = (value) => {
  if (value === null || value === undefined || value === "") return false;
  const text = value.toString().trim().toLowerCase();
  return ["true", "1", "si", "sí", "yes", "s", "y", "x"].includes(text);
};

function detalleError(err, porDefecto) {
  const detail = err.response?.data?.detail;
  if (Array.isArray(detail)) return detail.map((e) => (e.loc ? `${e.loc[e.loc.length - 1]}: ${e.msg}` : e.msg)).join(" — ");
  if (typeof detail === "string") return detail;
  return porDefecto;
}

function descargarPlanillaModelo() {
  const hoja = XLSX.utils.aoa_to_sheet([
    ["Nombre", "Apellido", "DNI", "Fecha de nacimiento", "Género", "Situación de calle"],
    ["Juan", "Pérez", "30123456", "02/01/1980", "V", "Sí"],
    ["Ana", "Gómez", "", "", "M", ""],
  ]);
  hoja["!cols"] = [{ wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 20 }, { wch: 10 }, { wch: 18 }];
  const instrucciones = XLSX.utils.aoa_to_sheet([
    ["Cómo completar esta planilla"],
    [""],
    ...INSTRUCCIONES_PERSONA.map((t, i) => [`${i + 1}. ${t}`]),
    [`${INSTRUCCIONES_PERSONA.length + 1}. Género: V (varón), M (mujer) o No binario. Si la planilla usa M/F, la M se toma como masculino.`],
    [`${INSTRUCCIONES_PERSONA.length + 2}. Situación de calle: Sí / No (vacío = No).`],
  ]);
  instrucciones["!cols"] = [{ wch: 110 }];
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Personas");
  XLSX.utils.book_append_sheet(libro, instrucciones, "Instrucciones");
  XLSX.writeFile(libro, "Planilla_carga_masiva_personas.xlsx");
}

export default function CargaMasivaPersonas() {
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
      const response = await api.post("/personas/bulk/preview", data);
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
        const filteredRows = filasConDatos(rawRows);
        if (!filteredRows.length) {
          throw new Error("El archivo no contiene filas de datos útiles.");
        }

        const encabezados = Object.keys(rawRows[0]);
        const keyMap = mapearColumnas(encabezados, ALIAS_PERSONAS);
        verificarColumnas(keyMap, encabezados);

        // Género: el sistema usa V (varón) / M (mujer) / No binario. Si la planilla usa la
        // convención vieja M/F (aparece alguna "F"), ahí "M" significa masculino -> "V".
        const legacyMF = keyMap.genero ? usaConvencionMF(filteredRows.map((r) => r[keyMap.genero])) : false;

        const rows = filteredRows.map((rawRow, i) => ({
          fila: numeroFila(rawRow, i),
          ...leerPersona(rawRow, keyMap, { date1904 }),
          genero: keyMap.genero ? normalizarGenero(String(rawRow[keyMap.genero] ?? "").trim(), { legacyMF }) || null : null,
          situacion_de_calle: keyMap.situacion_de_calle ? parseBooleanValue(rawRow[keyMap.situacion_de_calle]) : false,
        }));
        revisar({ rows });
      } catch (err) {
        setFileError(err.message || "No se pudo leer el archivo Excel.");
      }
    };
    reader.onerror = () => setFileError("No se pudo leer el archivo.");
    reader.readAsArrayBuffer(file);
    event.target.value = "";
  };

  return (
    <main className="page-shell">
      <section className="card card-form">
        <div className="form-actions-row">
          <h1>Carga masiva de personas</h1>
        </div>
        <p>
          Subí un Excel (.xls/.xlsx) con una fila por persona y las columnas <strong>Nombre</strong>,{" "}
          <strong>Apellido</strong> y <strong>DNI</strong>. Opcionales: <strong>Fecha de nacimiento</strong>,{" "}
          <strong>Género</strong> y <strong>Situación de calle</strong>.
        </p>
        <p className="text-muted">
          El DNI y la fecha de nacimiento pueden quedar en blanco. Antes de guardar se muestra una revisión: a quien ya
          existe se le completa el DNI o la fecha de nacimiento si la planilla los trae, y elegís a quién crear.
        </p>
        <p className="text-muted small">Género: V (varón), M (mujer) o No binario. Si la planilla usa M/F, la M se toma como masculino.</p>
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
          endpoint={null}
          preview={revision.preview}
          onCancelar={() => setRevision(null)}
          onTerminado={(res) => {
            setRevision(null);
            setResultado(res);
          }}
        />
      )}

      <ResultadoCarga resultado={resultado} unidad="persona(s) creada(s) o actualizada(s)" />
    </main>
  );
}
