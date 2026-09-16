import { useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import { useAuth } from "./AuthContext";

export default function BuscarPersona() {
  const { isAdmin } = useAuth();
  const [query, setQuery] = useState("");
  const [resultados, setResultados] = useState([]);
  const [seleccionada, setSeleccionada] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function buscar(event) {
    if (event) event.preventDefault();
    setError("");
    setSeleccionada(null);
    setLoading(true);
    try {
      const response = await api.get("/personas", {
        params: { q: query.trim() || undefined },
      });
      setResultados(response.data);
    } catch (err) {
      setError("No se pudo buscar la persona.");
      setResultados([]);
    } finally {
      setLoading(false);
    }
  }

  const [kitsPersona, setKitsPersona] = useState([]);
  const [loadingKits, setLoadingKits] = useState(false);

  async function seleccionarPersona(dni) {
    setError("");
    setLoading(true);
    setKitsPersona([]);
    setLoadingKits(true);
    try {
      const response = await api.get(`/personas/${dni}`);
      setSeleccionada(response.data);
      try {
        const kitsRes = await api.get(`/kits/persona/${dni}`);
        setKitsPersona(kitsRes.data);
      } catch (kErr) {
        setKitsPersona([]);
      }
    } catch (err) {
      setError("No se encontró la persona.");
    } finally {
      setLoading(false);
      setLoadingKits(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="card card-form">
        <h1>Buscar persona</h1>
        <form onSubmit={buscar}>
          <label>
            DNI o nombre/apellido
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ej. 12345678 o Juan"
            />
          </label>
          <button type="submit" className="button button-primary" disabled={loading}>
            {loading ? "Buscando..." : "Buscar"}
          </button>
        </form>
        {error && <div className="alert alert-error">{error}</div>}
      </section>

      <section className="card table-card">
        <h2>Resultados</h2>
        {resultados.length === 0 ? (
          <p className="text-muted">No se encontraron personas.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Apellido</th>
                  <th>DNI</th>
                  <th>Género</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {resultados.map((persona) => (
                  <tr key={persona.id}>
                    <td>{persona.nombre}</td>
                    <td>{persona.apellido}</td>
                    <td>{persona.dni}</td>
                    <td>{persona.genero || "-"}</td>
                    <td>
                      <button
                        type="button"
                        className="button button-primary"
                        onClick={() => seleccionarPersona(persona.dni)}
                      >
                        Ver
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {seleccionada && (
          <div className="info-card">
            <h3>
              {seleccionada.nombre} {seleccionada.apellido}
            </h3>
            <p>DNI: {seleccionada.dni}</p>
            <p>Género: {seleccionada.genero || "No informado"}</p>
            <p>Fecha nacimiento: {seleccionada.fecha_nacimiento || "No informado"}</p>
            <p>Situación de calle: {seleccionada.situacion_de_calle ? "Sí" : "No"}</p>
            <div className="button-row">
              <Link to="/signos/registrar" state={{ dni: seleccionada.dni }} className="button button-primary">
                Registrar signos
              </Link>
              <Link
                to="/kits/entregar"
                state={{ dni: seleccionada.dni, persona: seleccionada }}
                className="button button-primary"
              >
                Entregar kit
              </Link>
              {isAdmin && (
                <Link to={`/historial?q=${seleccionada.dni}`} className="button button-secondary">
                  Ver historial
                </Link>
              )}
            </div>

            <div style={{ marginTop: "1.25rem", borderTop: "1px solid #e0e0e0", paddingTop: "1rem" }}>
              <h4 style={{ margin: "0 0 0.5rem 0", color: "#222" }}>📦 Kits recibidos por esta persona</h4>
              {loadingKits ? (
                <p className="text-muted">Cargando historial de kits...</p>
              ) : kitsPersona.length === 0 ? (
                <p className="text-muted">Esta persona no registra entregas de kits previas.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {kitsPersona.map((k) => (
                    <div
                      key={k.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "0.6rem 0.9rem",
                        backgroundColor: "#ffffff",
                        border: "1px solid #e0e0e0",
                        borderRadius: "8px",
                      }}
                    >
                      <span>
                        <strong>Fecha:</strong> {k.fecha_entrega}
                      </span>
                      <span
                        style={{
                          padding: "0.25rem 0.6rem",
                          borderRadius: "6px",
                          fontSize: "0.85rem",
                          fontWeight: "bold",
                          backgroundColor: k.tipo === "ABRIGO" ? "#e0e7ff" : "#dcfce7",
                          color: k.tipo === "ABRIGO" ? "#3730a3" : "#166534",
                        }}
                      >
                        Kit {k.tipo}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
