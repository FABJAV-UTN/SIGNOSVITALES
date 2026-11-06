import { useRef, useState } from "react";
import api from "../api";
import ResultadoCarga from "./ResultadoCarga";
import RevisionCarga from "./RevisionCarga";
import SelectorArchivos from "./SelectorArchivos";
import useArchivosExcel from "./useArchivosExcel";
import * as XLSX from "xlsx";
import { formatExcelDate } from "../utils/excelDates";
import {
  INSTRUCCIONES_PERSONA,
  filasConDatos,
  leerPersona,
  mapearColumnas,
  numeroFila,
  verificarColumnas,
  verificarTipoPlanilla,
} from "../utils/planillaPersona";

const ALIAS_SIGNOS = {
  fecha: ["fecha", "fecha control", "fecha de control", "date"],
  presion_arterial: ["presion arterial", "presion", "presionarterial", "pa", "tension arterial"],
  frecuencia_cardiaca: ["frecuencia cardiaca", "frecuencia", "fc"],
  oxigenacion_sangre: [
    "oxigenacion",
    "oxigenacion sangre",
    "oxigenacion en sangre",
    "spo2",
    "saturacion",
    "saturacion de oxigeno",
  ],
  operativo_id: ["operativo id", "operativo"],
  lugar_custom: ["lugar custom", "lugar"],
};

function descargarPlanillaModelo() {
  const hoja = XLSX.utils.aoa_to_sheet([
    ["Nombre", "Apellido", "DNI", "Fecha de nacimiento", "Fecha", "Presión arterial", "Frecuencia cardíaca", "Oxigenación"],
    ["Juan", "Pérez", "30123456", "02/01/1980", "10/09/2026", "120/80", 75, 97],
    ["Ana", "Gómez", "", "", "10/09/2026", "110/70", 82, 98],
    ["", "", "28999888", "", "10/09/2026", "130/85", 90, 96],
  ]);
  hoja["!cols"] = [{ wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 20 }, { wch: 12 }, { wch: 16 }, { wch: 20 }, { wch: 12 }];
  const instrucciones = XLSX.utils.aoa_to_sheet([
    ["Cómo completar esta planilla"],
    [""],
    ...INSTRUCCIONES_PERSONA.map((t, i) => [`${i + 1}. ${t}`]),
    [`${INSTRUCCIONES_PERSONA.length + 1}. Fecha: el día del control (AAAA-MM-DD o DD/MM/AAAA).`],
    [`${INSTRUCCIONES_PERSONA.length + 2}. Presión arterial como 120/80; frecuencia cardíaca y oxigenación en números.`],
    [`${INSTRUCCIONES_PERSONA.length + 3}. Una fila = un control. La misma persona puede aparecer en varias filas.`],
  ]);
  instrucciones["!cols"] = [{ wch: 110 }];
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Signos");
  XLSX.utils.book_append_sheet(libro, instrucciones, "Instrucciones");
  XLSX.writeFile(libro, "Planilla_carga_masiva_signos.xlsx");
}

const EJEMPLO_PAYLOAD = JSON.stringify(
  {
    operativo_id: null,
    lugar_custom: null,
    rows: [
      {
        nombre: "Juan",
        apellido: "Pérez",
        dni: "30123456",
        fecha_nacimiento: null,
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

/** Filas de un Excel de signos (cada archivo con sus propias columnas y sistema de fechas). */
function procesarPlanilla(rawRows, { date1904 }) {
  // Se leen los valores reales de las celdas (no el texto formateado) para que
  // el formato de fecha de la planilla (dd/mm, mm/dd, etc.) no afecte el resultado.
  const filteredRows = filasConDatos(rawRows);
  const encabezados = Object.keys(rawRows[0]);
  verificarTipoPlanilla(encabezados, "signos");
  const keyMap = mapearColumnas(encabezados, ALIAS_SIGNOS);
  verificarColumnas(keyMap, encabezados, ["fecha", "presion_arterial", "frecuencia_cardiaca", "oxigenacion_sangre"]);

  const celda = (rawRow, campo) => (rawRow[keyMap[campo]] ?? "").toString().trim();
  return filteredRows.map((rawRow, i) => ({
    fila: numeroFila(rawRow, i),
    ...leerPersona(rawRow, keyMap, { date1904 }),
    signos: `${celda(rawRow, "presion_arterial")}-${celda(rawRow, "frecuencia_cardiaca")}-${celda(rawRow, "oxigenacion_sangre")}`,
    fecha: formatExcelDate(rawRow[keyMap.fecha], { date1904 }),
    operativo_id: (keyMap.operativo_id && rawRow[keyMap.operativo_id]) || null,
    lugar_custom: (keyMap.lugar_custom && celda(rawRow, "lugar_custom")) || null,
  }));
}

export default function CargaMasivaSignos() {
  const [payload, setPayload] = useState(EJEMPLO_PAYLOAD);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(null); // { id, data, preview, origenes, repetidas }
  const [resultado, setResultado] = useState(null);
  const [archivosInfo, setArchivosInfo] = useState({ origenes: null, repetidas: [] });
  const pedido = useRef(0);

  function alCambiarArchivos(combinado) {
    setResultado(null);
    setRevision(null);
    setError("");
    if (!combinado) {
      pedido.current += 1;
      setArchivosInfo({ origenes: null, repetidas: [] });
      setLoading(false);
      return;
    }
    const info = { origenes: combinado.origenes, repetidas: combinado.repetidas };
    setArchivosInfo(info);
    const texto = JSON.stringify({ operativo_id: null, lugar_custom: null, rows: combinado.rows }, null, 2);
    setPayload(texto);
    revisar(texto, info);
  }

  const carga = useArchivosExcel(procesarPlanilla, alCambiarArchivos);

  async function revisar(texto = payload, info = archivosInfo) {
    setError("");
    setResultado(null);
    let data;
    try {
      data = parsearPayload(texto);
    } catch (err) {
      setError(err instanceof SyntaxError ? "El JSON no es válido. Verifique la estructura y la sintaxis." : err.message);
      return;
    }
    const id = ++pedido.current;
    setLoading(true);
    try {
      const response = await api.post("/signos/bulk/preview", data);
      if (id !== pedido.current) return; // llegó otra revisión más nueva
      setRevision({ id, data, preview: response.data, ...info });
    } catch (err) {
      if (id === pedido.current) setError(detalleError(err, "No se pudo revisar la carga."));
    } finally {
      if (id === pedido.current) setLoading(false);
    }
  }

  function terminar(res) {
    setRevision(null);
    setResultado(res);
    carga.limpiar(false);
    setArchivosInfo({ origenes: null, repetidas: [] });
  }

  return (
    <main className="page-shell">
      <section className="card card-form">
        <div className="form-actions-row">
          <h1>Carga masiva de signos</h1>
        </div>
        <p>
          Subí uno o varios Excel (.xls/.xlsx) con una fila por control y las columnas <strong>Nombre</strong>,{" "}
          <strong>Apellido</strong>, <strong>DNI</strong>, <strong>Fecha</strong>, <strong>Presión arterial</strong>,{" "}
          <strong>Frecuencia cardíaca</strong> y <strong>Oxigenación</strong>. Opcional: <strong>Fecha de nacimiento</strong>.
        </p>
        <p className="text-muted">
          Nombre, Apellido y DNI pueden quedar en blanco: alcanza con el nombre y apellido, o solo con el DNI. Antes de
          guardar se muestra una revisión: confirmás los nombres parecidos, completás DNI o fecha de nacimiento a quien
          ya existe y elegís a quién crear.
        </p>
        <div className="button-row">
          <button type="button" className="button button-outline button-small" onClick={descargarPlanillaModelo}>
            Descargar planilla modelo
          </button>
        </div>
        <SelectorArchivos carga={carga} repetidas={archivosInfo.repetidas} />

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
          key={revision.id}
          data={revision.data}
          endpoint="/signos/bulk"
          preview={revision.preview}
          origenes={revision.origenes}
          onCancelar={() => setRevision(null)}
          onTerminado={terminar}
        />
      )}

      <ResultadoCarga resultado={resultado} unidad="fila(s) de signos guardada(s)" />
    </main>
  );
}
