import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import api from "../api";
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
import SelectorArchivos from "./SelectorArchivos";
import useArchivosExcel from "./useArchivosExcel";

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

/** Filas de un Excel de personas (cada archivo con sus propias columnas y convención de género). */
function procesarPlanilla(rawRows, { date1904 }) {
  const filteredRows = filasConDatos(rawRows);
  const encabezados = Object.keys(rawRows[0]);
  const keyMap = mapearColumnas(encabezados, ALIAS_PERSONAS);
  verificarColumnas(keyMap, encabezados);

  // Género: el sistema usa V (varón) / M (mujer) / No binario. Si la planilla usa la
  // convención vieja M/F (aparece alguna "F"), ahí "M" significa masculino -> "V".
  const legacyMF = keyMap.genero ? usaConvencionMF(filteredRows.map((r) => r[keyMap.genero])) : false;

  return filteredRows.map((rawRow, i) => ({
    fila: numeroFila(rawRow, i),
    ...leerPersona(rawRow, keyMap, { date1904 }),
    genero: keyMap.genero ? normalizarGenero(String(rawRow[keyMap.genero] ?? "").trim(), { legacyMF }) || null : null,
    situacion_de_calle: keyMap.situacion_de_calle ? parseBooleanValue(rawRow[keyMap.situacion_de_calle]) : false,
  }));
}

export default function CargaMasivaPersonas() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(null);
  const [resultado, setResultado] = useState(null);
  const pedido = useRef(0);

  async function revisar(combinado) {
    setError("");
    setResultado(null);
    setRevision(null);
    if (!combinado) return;
    const id = ++pedido.current;
    const data = { rows: combinado.rows };
    setLoading(true);
    try {
      const response = await api.post("/personas/bulk/preview", data);
      if (id !== pedido.current) return; // llegó otra revisión más nueva
      setRevision({ id, data, preview: response.data, origenes: combinado.origenes, repetidas: combinado.repetidas });
    } catch (err) {
      if (id === pedido.current) setError(detalleError(err, "No se pudo revisar la carga."));
    } finally {
      if (id === pedido.current) setLoading(false);
    }
  }

  const carga = useArchivosExcel(procesarPlanilla, revisar);

  return (
    <main className="page-shell">
      <section className="card card-form">
        <div className="form-actions-row">
          <h1>Carga masiva de personas</h1>
        </div>
        <p>
          Subí uno o varios Excel (.xls/.xlsx) con una fila por persona y las columnas <strong>Nombre</strong>,{" "}
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
        <SelectorArchivos carga={carga} repetidas={revision?.repetidas} />
        {loading && <p className="text-muted">Revisando...</p>}
        {error && <div className="alert alert-error">{error}</div>}
      </section>

      {revision && (
        <RevisionCarga
          key={revision.id}
          data={revision.data}
          endpoint={null}
          preview={revision.preview}
          origenes={revision.origenes}
          onCancelar={() => setRevision(null)}
          onTerminado={(res) => {
            setRevision(null);
            setResultado(res);
            carga.limpiar(false);
          }}
        />
      )}

      <ResultadoCarga resultado={resultado} unidad="persona(s) creada(s) o actualizada(s)" />
    </main>
  );
}
