import { useEffect, useState } from "react";
import api from "../api";

export default function HistorialKits() {
  const [dias, setDias] = useState([]);
  const [entregas, setEntregas] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Filtros
  const [filtroFecha, setFiltroFecha] = useState("");
  const [filtroQuery, setFiltroQuery] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");

  useEffect(() => {
    cargarDias();
    cargarEntregas();
  }, []);

  async function cargarDias() {
    try {
      const response = await api.get("/kits/dias");
      setDias(response.data);
    } catch (err) {
      console.error("Error al cargar días:", err);
    }
  }

  async function cargarEntregas(fechaSeleccionada = filtroFecha, q = filtroQuery, tipo = filtroTipo) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (fechaSeleccionada) params.set("fecha", fechaSeleccionada);
      if (q.trim()) params.set("q", q.trim());
      if (tipo) params.set("tipo", tipo);

      const response = await api.get(`/kits/entregas?${params.toString()}`);
      setEntregas(response.data);
    } catch (err) {
      setError("No se pudieron cargar las entregas de kits.");
    } finally {
      setLoading(false);
    }
  }

  function handleFiltrarPorDia(fecha) {
    const nuevaFecha = filtroFecha === fecha ? "" : fecha;
    setFiltroFecha(nuevaFecha);
    cargarEntregas(nuevaFecha, filtroQuery, filtroTipo);
  }

  function handleBuscar(e) {
    e.preventDefault();
    cargarEntregas(filtroFecha, filtroQuery, filtroTipo);
  }

  function handleReset() {
    setFiltroFecha("");
    setFiltroQuery("");
    setFiltroTipo("");
    cargarEntregas("", "", "");
  }

  // Métricas totales
  const totalKits = dias.reduce((acc, d) => acc + d.total, 0);
  const totalPpaas = dias.reduce((acc, d) => acc + d.ppaas, 0);
  const totalAbrigo = dias.reduce((acc, d) => acc + d.abrigo, 0);

  return (
    <main className="page-shell">
      <section className="card">
        <h1>Historial de Entrega de Kits</h1>
        <p className="text-muted">
          Consulta de días con operativos de entrega y personas beneficiarias.
        </p>

        {/* Resumen general */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: "1rem",
            margin: "1.25rem 0",
          }}
        >
          <div
            style={{
              padding: "1rem",
              background: "#ffffff",
              border: "1px solid #e0e0e0",
              borderRadius: "10px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: "1.8rem", fontWeight: "bold", color: "#e3000f" }}>
              {totalKits}
            </div>
            <div style={{ fontSize: "0.9rem", color: "#6b6b6b" }}>Total kits entregados</div>
          </div>
          <div
            style={{
              padding: "1rem",
              background: "#ffffff",
              border: "1px solid #e0e0e0",
              borderRadius: "10px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: "1.8rem", fontWeight: "bold", color: "#166534" }}>
              {totalPpaas}
            </div>
            <div style={{ fontSize: "0.9rem", color: "#6b6b6b" }}>Kits PPAAS (Higiene)</div>
          </div>
          <div
            style={{
              padding: "1rem",
              background: "#ffffff",
              border: "1px solid #e0e0e0",
              borderRadius: "10px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: "1.8rem", fontWeight: "bold", color: "#3730a3" }}>
              {totalAbrigo}
            </div>
            <div style={{ fontSize: "0.9rem", color: "#6b6b6b" }}>Kits ABRIGO</div>
          </div>
          <div
            style={{
              padding: "1rem",
              background: "#ffffff",
              border: "1px solid #e0e0e0",
              borderRadius: "10px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: "1.8rem", fontWeight: "bold", color: "#333333" }}>
              {dias.length}
            </div>
            <div style={{ fontSize: "0.9rem", color: "#6b6b6b" }}>Días con entregas</div>
          </div>
        </div>
      </section>

      {/* Días en que se han entregado kits */}
      <section className="card">
        <h2>📅 Días con entregas de kits</h2>
        <p className="text-muted" style={{ marginTop: "0.25rem" }}>
          Hacé clic en cualquier fecha para filtrar las personas que recibieron kits ese día.
        </p>
        {dias.length === 0 ? (
          <p className="text-muted">Aún no se registran entregas en ninguna fecha.</p>
        ) : (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.75rem",
              marginTop: "1rem",
            }}
          >
            <button
              onClick={() => handleFiltrarPorDia("")}
              className="button"
              style={{
                backgroundColor: !filtroFecha ? "#e3000f" : "#ffffff",
                color: !filtroFecha ? "#ffffff" : "#333333",
                border: "1px solid #e0e0e0",
                fontWeight: "600",
                padding: "0.6rem 1rem",
              }}
            >
              Todos los días ({totalKits})
            </button>
            {dias.map((d) => (
              <button
                key={d.fecha}
                onClick={() => handleFiltrarPorDia(d.fecha)}
                className="button"
                style={{
                  backgroundColor: filtroFecha === d.fecha ? "#e3000f" : "#ffffff",
                  color: filtroFecha === d.fecha ? "#ffffff" : "#333333",
                  border: "1px solid #e0e0e0",
                  padding: "0.6rem 1rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                }}
              >
                <span>{d.fecha}</span>
                <span
                  style={{
                    backgroundColor: filtroFecha === d.fecha ? "rgba(255,255,255,0.25)" : "#f1f5f9",
                    padding: "0.15rem 0.5rem",
                    borderRadius: "12px",
                    fontSize: "0.8rem",
                    fontWeight: "bold",
                  }}
                >
                  {d.total} kit{d.total > 1 ? "s" : ""}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Filtros de búsqueda */}
      <section className="card card-form">
        <h2>Filtrar personas y kits</h2>
        <form onSubmit={handleBuscar} style={{ marginTop: "1rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
            <label>
              Buscar por DNI o Nombre
              <input
                type="text"
                placeholder="Ej. 12345678 o Juan"
                value={filtroQuery}
                onChange={(e) => setFiltroQuery(e.target.value)}
              />
            </label>
            <label>
              Fecha específica
              <input
                type="date"
                value={filtroFecha}
                onChange={(e) => setFiltroFecha(e.target.value)}
              />
            </label>
            <label>
              Tipo de kit
              <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
                <option value="">Todos los tipos</option>
                <option value="PPAAS">PPAAS (Higiene)</option>
                <option value="ABRIGO">ABRIGO</option>
              </select>
            </label>
          </div>
          <div className="button-row">
            <button type="submit" className="button button-primary" disabled={loading}>
              {loading ? "Filtrando..." : "Aplicar filtros"}
            </button>
            <button type="button" onClick={handleReset} className="button" style={{ background: "#e2e8f0", color: "#333" }}>
              Limpiar filtros
            </button>
          </div>
        </form>
        {error && <div className="alert alert-error">{error}</div>}
      </section>

      {/* Listado de entregas */}
      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h2>
            Registros de entregas{" "}
            <span style={{ fontSize: "1rem", color: "#6b6b6b", fontWeight: "normal" }}>
              ({entregas.length} {entregas.length === 1 ? "resultado" : "resultados"})
            </span>
          </h2>
          {filtroFecha && (
            <span
              style={{
                backgroundColor: "#fef2f2",
                color: "#e3000f",
                padding: "0.3rem 0.75rem",
                borderRadius: "6px",
                fontSize: "0.85rem",
                fontWeight: "600",
              }}
            >
              Filtrado por fecha: {filtroFecha}
            </span>
          )}
        </div>

        {entregas.length === 0 ? (
          <p className="text-muted">No se encontraron entregas para el filtro seleccionado.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #e0e0e0", background: "#f8f8f8" }}>
                  <th style={{ padding: "0.75rem" }}>Fecha</th>
                  <th style={{ padding: "0.75rem" }}>Beneficiario</th>
                  <th style={{ padding: "0.75rem" }}>DNI</th>
                  <th style={{ padding: "0.75rem" }}>Situación de calle</th>
                  <th style={{ padding: "0.75rem" }}>Tipo de kit</th>
                </tr>
              </thead>
              <tbody>
                {entregas.map((item) => (
                  <tr key={item.id} style={{ borderBottom: "1px solid #e0e0e0" }}>
                    <td style={{ padding: "0.75rem", fontWeight: "500" }}>{item.fecha_entrega}</td>
                    <td style={{ padding: "0.75rem" }}>
                      {item.persona.nombre} {item.persona.apellido}
                    </td>
                    <td style={{ padding: "0.75rem" }}>{item.persona.dni}</td>
                    <td style={{ padding: "0.75rem" }}>
                      {item.persona.situacion_de_calle ? (
                        <span style={{ color: "#b91c1c", fontWeight: "bold" }}>Sí</span>
                      ) : (
                        <span style={{ color: "#6b6b6b" }}>No</span>
                      )}
                    </td>
                    <td style={{ padding: "0.75rem" }}>
                      <span
                        style={{
                          padding: "0.25rem 0.6rem",
                          borderRadius: "6px",
                          fontSize: "0.85rem",
                          fontWeight: "bold",
                          backgroundColor: item.tipo === "ABRIGO" ? "#e0e7ff" : "#dcfce7",
                          color: item.tipo === "ABRIGO" ? "#3730a3" : "#166534",
                        }}
                      >
                        Kit {item.tipo}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
