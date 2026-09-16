import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import api from "../api";

export default function RegistrarSignos() {
  const navigate = useNavigate();
  const location = useLocation();
  const initialDni = location.state?.dni || "";

  const [dni, setDni] = useState(initialDni);
  const [persona, setPersona] = useState(null);
  const [presion, setPresion] = useState("");
  const [fc, setFc] = useState("");
  const [spo2, setSpo2] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (initialDni) {
      buscarPersona(initialDni);
    }
  }, [initialDni]);

  async function buscarPersona(value) {
    setError("");
    setPersona(null);
    setLoading(true);
    try {
      const response = await api.get(`/personas/${value}`);
      setPersona(response.data);
    } catch (err) {
      setError("Persona no encontrada. Registre primero la persona.");
    } finally {
      setLoading(false);
    }
  }

  async function handleBuscar(event) {
    event.preventDefault();
    if (!dni) return;
    await buscarPersona(dni);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);
    try {
      await api.post("/signos", {
        dni,
        presion_arterial: presion,
        frecuencia_cardiaca: Number(fc),
        oxigenacion_sangre: Number(spo2),
      });
      setMessage("Registro de signos guardado con éxito.");
      setPresion("");
      setFc("");
      setSpo2("");
      setTimeout(() => navigate("/dashboard"), 1200);
    } catch (err) {
      setError(err.response?.data?.detail || "No se pudo guardar el registro." );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="card card-form">
        <div className="form-actions-row">
          <h1>Registrar signos vitales</h1>
          <Link to="/signos/carga-masiva" className="button button-secondary">
            Carga masiva
          </Link>
        </div>
        <form onSubmit={handleBuscar}>
          <label>
            DNI
            <input value={dni} onChange={(e) => setDni(e.target.value)} required placeholder="12345678" />
          </label>
          <button type="submit" className="button button-primary" disabled={loading}>
            Buscar persona
          </button>
        </form>
        {error && <div className="alert alert-error">{error}</div>}
        {persona && (
          <div className="info-card">
            <h3>{persona.nombre} {persona.apellido}</h3>
            <p>DNI: {persona.dni}</p>
            <p>Situación de calle: {persona.situacion_de_calle ? "Sí" : "No"}</p>
            <form onSubmit={handleSubmit}>
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
              {message && <div className="alert alert-success">{message}</div>}
              <button type="submit" className="button button-primary" disabled={loading}>
                {loading ? "Guardando..." : "Confirmar registro"}
              </button>
            </form>
          </div>
        )}
      </section>
    </main>
  );
}
