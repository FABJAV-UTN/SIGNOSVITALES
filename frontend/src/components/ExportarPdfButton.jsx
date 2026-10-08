import { useState } from "react";
import api from "../api";

// Descarga el PDF con los gráficos de signos vitales y los kits de todas las personas.
// El nombre del archivo es siempre el mismo, para reemplazarlo en Drive sin generar copias.
export default function ExportarPdfButton({ className = "button button-primary" }) {
  const [estado, setEstado] = useState({ cargando: false, error: "" });

  async function exportar() {
    setEstado({ cargando: true, error: "" });
    try {
      const res = await api.get("/reportes/signos-vitales.pdf", { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = "SISVAP_signos_vitales.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setEstado({ cargando: false, error: "" });
    } catch {
      setEstado({ cargando: false, error: "No se pudo generar el PDF." });
    }
  }

  return (
    <>
      <button type="button" className={className} onClick={exportar} disabled={estado.cargando}>
        {estado.cargando ? "Generando PDF..." : "Exportar PDF (todas las personas)"}
      </button>
      {estado.error && <div className="alert alert-error">{estado.error}</div>}
    </>
  );
}
