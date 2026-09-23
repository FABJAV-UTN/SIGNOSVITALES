import { useCallback, useEffect, useRef, useState } from "react";
import api from "../api";
import PersonaPanel from "./PersonaPanel";

function Contador({ valor }) {
  return <span className={`count-badge ${valor > 0 ? "" : "count-zero"}`}>{valor}</span>;
}

export default function BuscarPersona() {
  const [query, setQuery] = useState("");
  const [resultados, setResultados] = useState([]);
  const [seleccionada, setSeleccionada] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const panelRef = useRef(null);

  const buscarPersonas = useCallback(async (valor = "") => {
    setError("");
    setLoading(true);
    try {
      const response = await api.get("/personas", {
        params: { q: valor.trim() || undefined },
      });
      setResultados(response.data);
    } catch {
      setError("No se pudo buscar la persona.");
      setResultados([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      buscarPersonas(query);
    }, 150);
    return () => clearTimeout(timeout);
  }, [query, buscarPersonas]);

  function seleccionarPersona(persona) {
    setSeleccionada(persona);
    // En el celular la ficha queda arriba de la tabla: la llevamos a la vista.
    if (window.matchMedia("(max-width: 900px)").matches) {
      requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }

  function handleBuscar(event) {
    event.preventDefault();
    buscarPersonas(query);
  }

  return (
    <main className="page-shell page-wide">
      <section className="card card-form search-card">
        <h1>Buscar persona</h1>
        <form onSubmit={handleBuscar} className="search-form">
          <label>
            DNI, nombre o apellido
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ej. 12345678, Juan o Pérez"
              type="search"
            />
          </label>
          <button type="submit" className="button button-primary" disabled={loading}>
            {loading ? "Buscando..." : "Buscar"}
          </button>
        </form>
        {error && <div className="alert alert-error">{error}</div>}
      </section>

      <div className={`split-layout ${seleccionada ? "has-selection" : ""}`}>
        <section className="card table-card split-main">
          <div className="section-header">
            <h2>Resultados</h2>
            <span className="text-muted">{resultados.length} persona(s)</span>
          </div>
          {loading && resultados.length === 0 ? (
            <p className="text-muted">Cargando personas...</p>
          ) : resultados.length === 0 ? (
            <p className="text-muted">No se encontraron personas.</p>
          ) : (
            <div className="table-scroll table-scroll-y">
              <table>
                <thead>
                  <tr>
                    <th>
                      Nombre<span className="mobile-only"> y apellido</span>
                    </th>
                    <th className="desktop-only">Apellido</th>
                    <th className="desktop-only">DNI</th>
                    <th className="desktop-only">Género</th>
                    <th className="num" title="Registros de signos vitales tomados">
                      Signos
                    </th>
                    <th className="num" title="Kits entregados">
                      Kits
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {resultados.map((persona) => (
                    <tr
                      key={persona.id}
                      className={`persona-row ${seleccionada?.id === persona.id ? "selected" : ""}`}
                      onClick={() => seleccionarPersona(persona)}
                      onKeyDown={(e) => e.key === "Enter" && seleccionarPersona(persona)}
                      tabIndex={0}
                    >
                      <td>
                        {persona.nombre}
                        <span className="mobile-only">
                          {" "}
                          {persona.apellido}
                          <span className="text-muted small block">DNI {persona.dni}</span>
                        </span>
                      </td>
                      <td className="desktop-only">{persona.apellido}</td>
                      <td className="desktop-only">{persona.dni}</td>
                      <td className="desktop-only">{persona.genero || "-"}</td>
                      <td className="num">
                        <Contador valor={persona.total_signos ?? 0} />
                      </td>
                      <td className="num">
                        <Contador valor={persona.total_kits ?? 0} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="split-side" ref={panelRef}>
          {seleccionada ? (
            <div className="card sticky-card">
              <PersonaPanel key={seleccionada.id} persona={seleccionada} onClose={() => setSeleccionada(null)} />
            </div>
          ) : (
            <div className="card sticky-card empty-panel">
              <p className="text-muted">Seleccioná una persona de la tabla para ver su ficha.</p>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
