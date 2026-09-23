import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import api from "../api";
import PersonaSelector from "./PersonaSelector";

export default function RegistrarSignos() {
  const navigate = useNavigate();
  const location = useLocation();
  const initialDni = location.state?.dni || "";

  const [persona, setPersona] = useState(null);
  const [presion, setPresion] = useState("");
  const [fc, setFc] = useState("");
  const [spo2, setSpo2] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function elegirPersona(p) {
    setPersona(p);
    setError("");
    if (p) setMessage("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!persona) return;
    setError("");
    setMessage("");
    setLoading(true);
    try {
      await api.post("/signos", {
        dni: persona.dni,
        presion_arterial: presion.trim() || null,
        frecuencia_cardiaca: fc !== "" ? Number(fc) : null,
        oxigenacion_sangre: spo2 !== "" ? Number(spo2) : null,
      });
      setMessage(`Signos de ${persona.nombre} ${persona.apellido} guardados con éxito.`);
      setPresion("");
      setFc("");
      setSpo2("");
      if (initialDni) {
        setTimeout(() => navigate("/personas/buscar"), 1200);
      } else {
        // Listo para la siguiente persona.
        setPersona(null);
      }
    } catch (err) {
      const detail = err.response?.data?.detail;
      if (Array.isArray(detail)) {
        setError(detail.map((e) => (e.loc ? `${e.loc[e.loc.length - 1]}: ${e.msg}` : e.msg)).join(" — "));
      } else if (typeof detail === "string") {
        setError(detail);
      } else {
        setError("No se pudo guardar el registro.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="card card-form">
        <div className="form-actions-row">
          <h1>Registrar signos vitales</h1>
          <Link to="/signos/carga-masiva" className="button button-outline button-small">
            Carga masiva
          </Link>
        </div>

        {message && <div className="alert alert-success">{message}</div>}

        <PersonaSelector persona={persona} onChange={elegirPersona} dniInicial={initialDni} />

        {persona && (
          <form onSubmit={handleSubmit} className="form-after-persona">
            <label>
              Presión arterial
              <input value={presion} onChange={(e) => setPresion(e.target.value)} placeholder="120/80" required />
            </label>
            <label>
              Frecuencia cardíaca
              <input type="number" value={fc} onChange={(e) => setFc(e.target.value)} placeholder="80" required />
            </label>
            <label>
              Oxigenación en sangre
              <input type="number" step="0.1" value={spo2} onChange={(e) => setSpo2(e.target.value)} placeholder="97.5" required />
            </label>
            {error && <div className="alert alert-error">{error}</div>}
            <button type="submit" className="button button-primary" disabled={loading}>
              {loading ? "Guardando..." : "Confirmar registro"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
