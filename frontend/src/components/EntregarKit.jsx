import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../api";

export default function EntregarKit() {
  const navigate = useNavigate();
  const location = useLocation();
  const initialDni = location.state?.dni || "";
  const initialPersona = location.state?.persona || null;

  const [dni, setDni] = useState(initialDni);
  const [persona, setPersona] = useState(initialPersona);
  const [tipo, setTipo] = useState("PPAAS");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (initialDni && !persona) {
      buscarPersona(initialDni);
    }
  }, [initialDni]);

  async function buscarPersona(value) {
    if (!value) return;
    try {
      const response = await api.get(`/personas/${value}`);
      setPersona(response.data);
    } catch (err) {
      setPersona(null);
    }
  }

  async function handleDniBlur() {
    if (dni && (!persona || persona.dni !== dni)) {
      await buscarPersona(dni);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);
    try {
      await api.post("/kits", { dni: dni.trim(), tipo });
      const receptor = persona ? `${persona.nombre} ${persona.apellido}` : `DNI ${dni}`;
      setMessage(`Kit ${tipo} entregado correctamente a ${receptor}.`);
      if (!initialDni) {
        setDni("");
        setPersona(null);
        setTipo("PPAAS");
      } else {
        setTimeout(() => navigate("/personas/buscar"), 1500);
      }
    } catch (err) {
      const detail = err.response?.data?.detail;
      if (Array.isArray(detail)) {
        setError(detail.map((e) => (e.loc ? `${e.loc[e.loc.length - 1]}: ${e.msg}` : e.msg)).join(" — "));
      } else if (typeof detail === "string") {
        setError(detail);
      } else {
        setError("No se pudo entregar el kit.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="card card-form">
        <h1>Entregar kit</h1>
        <p className="text-muted">Acompañamiento y asistencia social</p>

        {persona && (
          <div className="info-card" style={{ marginBottom: "1.25rem" }}>
            <h3>{persona.nombre} {persona.apellido}</h3>
            <p><strong>DNI:</strong> {persona.dni}</p>
            <p><strong>Situación de calle:</strong> {persona.situacion_de_calle ? "Sí" : "No"}</p>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <label>
            DNI
            <input
              value={dni}
              onChange={(e) => setDni(e.target.value)}
              onBlur={handleDniBlur}
              required
              placeholder="12345678"
            />
          </label>
          <label>
            Tipo de kit
            <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="PPAAS">PPAAS (Higiene / Primeros auxilios)</option>
              <option value="ABRIGO">ABRIGO</option>
            </select>
          </label>
          {error && <div className="alert alert-error">{error}</div>}
          {message && <div className="alert alert-success">{message}</div>}
          <button type="submit" className="button button-primary" disabled={loading}>
            {loading ? "Enviando..." : "Registrar entrega"}
          </button>
        </form>
      </section>
    </main>
  );
}
