import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import * as XLSX from "xlsx";
import api from "../api";
import { formatExcelDate } from "../utils/excelDates";
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

const ALIAS_KITS = {
  fecha: ["fecha", "fecha entrega", "fecha de entrega", "date"],
  tipo: ["tipo", "tipo kit", "tipo de kit", "kit"],
};

function detalleError(err, porDefecto) {
  const detail = err.response?.data?.detail;
  if (Array.isArray(detail)) return detail.map((e) => (e.loc ? `${e.loc[e.loc.length - 1]}: ${e.msg}` : e.msg)).join(" — ");
  if (typeof detail === "string") return detail;
  return porDefecto;
}

function descargarPlanillaModelo() {
  const hoja = XLSX.utils.aoa_to_sheet([
    ["Nombre", "Apellido", "DNI", "Fecha de nacimiento", "Fecha", "Tipo"],
    ["Juan", "Pérez", "30123456", "02/01/1980", "04/06/2026", "PPAAS"],
    ["Ana", "Gómez", "", "", "04/06/2026", "ABRIGO"],
    ["", "", "28999888", "", "04/06/2026", "PPAAS"],
  ]);
  hoja["!cols"] = [{ wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 20 }, { wch: 12 }, { wch: 10 }];
  const instrucciones = XLSX.utils.aoa_to_sheet([
    ["Cómo completar esta planilla"],
    [""],
    ...INSTRUCCIONES_PERSONA.map((t, i) => [`${i + 1}. ${t}`]),
    [`${INSTRUCCIONES_PERSONA.length + 1}. Fecha: el día en que se entregó el kit (AAAA-MM-DD o DD/MM/AAAA).`],
    [`${INSTRUCCIONES_PERSONA.length + 2}. Tipo: PPAAS (higiene / primeros auxilios) o ABRIGO.`],
    [`${INSTRUCCIONES_PERSONA.length + 3}. Una fila = un kit entregado. La misma persona puede aparecer en varias filas.`],
  ]);
  instrucciones["!cols"] = [{ wch: 110 }];
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Kits");
  XLSX.utils.book_append_sheet(libro, instrucciones, "Instrucciones");
  XLSX.writeFile(libro, "Planilla_carga_masiva_kits.xlsx");
}

/** Filas de un Excel de kits (cada archivo con sus propias columnas). */
function procesarPlanilla(rawRows, { date1904 }) {
  const filteredRows = filasConDatos(rawRows);
  const encabezados = Object.keys(rawRows[0]);
  const keyMap = mapearColumnas(encabezados, ALIAS_KITS);
  verificarColumnas(keyMap, encabezados, ["fecha", "tipo"]);
  return filteredRows.map((rawRow, i) => ({
    fila: numeroFila(rawRow, i),
    ...leerPersona(rawRow, keyMap, { date1904 }),
    fecha: formatExcelDate(rawRow[keyMap.fecha], { date1904 }),
    tipo: rawRow[keyMap.tipo]?.toString().trim(),
  }));
}

export default function CargaMasivaKits() {
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
      const response = await api.post("/kits/bulk/preview", data);
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
          <h1>Carga masiva de kits</h1>
          <Link to="/kits/entregar" className="button button-outline button-small">
            Entrega individual
          </Link>
        </div>
        <p>
          Subí uno o varios Excel (.xls/.xlsx) con una fila por kit entregado y las columnas <strong>Nombre</strong>,{" "}
          <strong>Apellido</strong>, <strong>DNI</strong>, <strong>Fecha</strong> y <strong>Tipo</strong> (PPAAS o
          ABRIGO). Opcional: <strong>Fecha de nacimiento</strong>.
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
        <SelectorArchivos carga={carga} repetidas={revision?.repetidas} />
        {loading && <p className="text-muted">Revisando...</p>}
        {error && <div className="alert alert-error">{error}</div>}
      </section>

      {revision && (
        <RevisionCarga
          key={revision.id}
          data={revision.data}
          endpoint="/kits/bulk"
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

      <ResultadoCarga resultado={resultado} unidad="entrega(s) de kits guardada(s)" />
    </main>
  );
}
