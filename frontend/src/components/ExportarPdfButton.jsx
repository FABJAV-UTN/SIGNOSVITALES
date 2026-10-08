import { Link } from "react-router-dom";

// Lleva a la pantalla de exportación (rango de fechas y personas a incluir).
export default function ExportarPdfButton({ className = "button button-primary" }) {
  return (
    <Link to="/reportes/pdf" className={className}>
      Exportar PDF
    </Link>
  );
}
