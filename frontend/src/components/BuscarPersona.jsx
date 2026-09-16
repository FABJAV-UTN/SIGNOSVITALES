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
    event.preventDefault();
    setError("");
    setSeleccionada(null);
    setResultados([]);
    setLoading(true);
    try {
      const response = await api.get(`/personas?q=${encodeURIComponent(query)}`);
      setResultados(response.data);
    } catch (err) {
      setError("No se pudo buscar la persona.");
    } finally {
      setLoading(false);
    }
  }

  async function seleccionarPersona(dni) {
    setError("");
    setLoading(true);
    try {
      const response = await api.get(`/personas/${dni}`);
      setSeleccionada(response.data);
    } catch (err) {
      setError("No se encontró la persona.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="card card-form">
        <h1>Buscar persona</h1>
        <form onSubmit={buscar}>
          <label>
            DNI o nombre/apellido
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ej. 12345678 o Juan" required />
          </label>
          <button type="submit" className="button button-primary" disabled={loading}>
            {loading ? "Buscando..." : "Buscar"}
          </button>
        </form>
        {error && <div className="alert alert-error">{error}</div>}
      </section>
      <section className="card">
        <h2>Resultados</h2>
        {resultados.length === 0 ? (
          <p className="text-muted">Ingrese un término y presione Buscar.</p>
        ) : (
          <div className="list-card">
            {resultados.map((persona) => (
              <button key={persona.id} className="item-button" onClick={() => seleccionarPersona(persona.dni)}>
                {persona.nombre} {persona.apellido} • {persona.dni}
              </button>
            ))}
          </div>
        )}
        {seleccionada && (
          <div className="info-card">
            <h3>{seleccionada.nombre} {seleccionada.apellido}</h3>
            <p>DNI: {seleccionada.dni}</p>
            <p>Género: {seleccionada.genero || "No informado"}</p>
            <p>Fecha nacimiento: {seleccionada.fecha_nacimiento || "No informado"}</p>
            <p>Situación de calle: {seleccionada.situacion_de_calle ? "Sí" : "No"}</p>
            <div className="button-row">
              <Link to="/signos/registrar" state={{ dni: seleccionada.dni }} className="button button-primary">
                Registrar signos
              </Link>
              {isAdmin && (
                <Link to={`/historial?q=${seleccionada.dni}`} className="button button-secondary">
                  Ver historial
                </Link>
              )}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
