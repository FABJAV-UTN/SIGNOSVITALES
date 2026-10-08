import { useEffect, useMemo, useState } from "react";
import api from "../api";
import { textoDni } from "../utils/persona";

const normalizar = (t) =>
  (t || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

/** Pantalla para exportar el PDF: rango de fechas y personas a incluir (una hoja por persona). */
export default function ExportarPdf() {
  const [personas, setPersonas] = useState(null);
  const [elegidas, setElegidas] = useState(new Set());
  const [filtro, setFiltro] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get("/personas")
      .then((res) => {
        setPersonas(res.data);
        setElegidas(new Set(res.data.map((p) => p.id)));
      })
      .catch(() => setError("No se pudo cargar la lista de personas."));
  }, []);

  const visibles = useMemo(() => {
    const terminos = normalizar(filtro).split(/\s+/).filter(Boolean);
    return (personas || []).filter((p) => {
      const texto = normalizar(`${p.nombre} ${p.apellido} ${p.dni || ""}`);
      return terminos.every((t) => texto.includes(t));
    });
  }, [personas, filtro]);

  function alternar(id) {
    setElegidas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function marcarVisibles(valor) {
    setElegidas((prev) => {
      const next = new Set(prev);
      visibles.forEach((p) => (valor ? next.add(p.id) : next.delete(p.id)));
      return next;
    });
  }

  const rangoInvalido = desde && hasta && desde > hasta;
  const puedeExportar = desde && hasta && !rangoInvalido && elegidas.size > 0 && !generando;

  async function exportar(event) {
    event.preventDefault();
    setError("");
    setGenerando(true);
    try {
      const ids = (personas || []).filter((p) => elegidas.has(p.id)).map((p) => p.id);
      const res = await api.post("/reportes/signos-vitales.pdf", { persona_ids: ids, desde, hasta }, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = "SISVAP_signos_vitales.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError("No se pudo generar el PDF.");
    } finally {
      setGenerando(false);
    }
  }

  const todasVisiblesElegidas = visibles.length > 0 && visibles.every((p) => elegidas.has(p.id));

  return (
    <main className="page-shell page-wide">
      <form className="card card-form exportar-pdf" onSubmit={exportar}>
        <h1>Exportar PDF</h1>

        <div className="date-filters">
          <label>
            Desde
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} required />
          </label>
          <label>
            Hasta
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} required />
          </label>
        </div>
        {rangoInvalido && <div className="alert alert-warning">La fecha “Desde” es posterior a “Hasta”.</div>}

        <div className="section-header">
          <h2>Personas</h2>
          <span className="text-muted">
            {elegidas.size} de {personas?.length ?? 0} seleccionada(s)
          </span>
        </div>
        <div className="exportar-controles">
          <input type="search" value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Buscar por nombre, apellido o DNI" />
          <div className="button-row compact">
            <button type="button" className="button button-outline button-small" onClick={() => marcarVisibles(true)}>
              Tildar todas
            </button>
            <button type="button" className="button button-outline button-small" onClick={() => marcarVisibles(false)}>
              Destildar todas
            </button>
          </div>
        </div>

        {personas === null && !error ? (
          <p className="text-muted">Cargando personas...</p>
        ) : (
          <div className="table-scroll table-scroll-y exportar-lista">
            <table>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={todasVisiblesElegidas}
                      onChange={(e) => marcarVisibles(e.target.checked)}
                      aria-label="Tildar o destildar todas"
                    />
                  </th>
                  <th>Persona</th>
                  <th className="desktop-only">DNI</th>
                  <th className="num">Signos</th>
                  <th className="num">Kits</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((p) => (
                  <tr key={p.id} className="persona-row" onClick={() => alternar(p.id)}>
                    <td>
                      <input
                        type="checkbox"
                        checked={elegidas.has(p.id)}
                        onChange={() => alternar(p.id)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Incluir a ${p.nombre} ${p.apellido}`}
                      />
                    </td>
                    <td>
                      {p.apellido ? `${p.apellido}, ${p.nombre}` : p.nombre}
                      <span className="mobile-only text-muted small block">{textoDni(p)}</span>
                    </td>
                    <td className="desktop-only">{p.dni || <span className="text-muted">—</span>}</td>
                    <td className="num">{p.total_signos ?? 0}</td>
                    <td className="num">{p.total_kits ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {error && <div className="alert alert-error">{error}</div>}
        <div className="button-row">
          <button type="submit" className="button button-primary" disabled={!puedeExportar}>
            {generando ? "Generando PDF..." : `Exportar PDF (${elegidas.size})`}
          </button>
        </div>
      </form>
    </main>
  );
}
