import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../api";

export default function RegistrarPersona() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const defaultDni = params.get("dni") || "";

  const [nombre, setNombre] = useState("");
  const [apellido, setApellido] = useState("");
  const [dni, setDni] = useState(defaultDni);
  const [fecha_nacimiento, setFechaNacimiento] = useState("");
  const [genero, setGenero] = useState("");
  const [situacionDeCalle, setSituacionDeCalle] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);
    try {
      await api.post("/personas", {
        nombre,
        apellido,
        dni,
        fecha_nacimiento: fecha_nacimiento || null,
        genero: genero || null,
        situacion_de_calle: situacionDeCalle,
      });
      setMessage("Persona registrada con éxito.");
      setTimeout(() => navigate("/personas/buscar"), 1000);
    } catch (err) {
      setError(err.response?.data?.detail || "No se pudo registrar la persona.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="card card-form">
        <h1>Registrar nueva persona</h1>
        <form onSubmit={handleSubmit}>
          <label>
            Nombre
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} required />
          </label>
          <label>
            Apellido
            <input value={apellido} onChange={(e) => setApellido(e.target.value)} required />
          </label>
          <label>
            DNI
            <input value={dni} onChange={(e) => setDni(e.target.value)} required placeholder="12345678" />
          </label>
          <label>
            Fecha de nacimiento
            <input type="date" value={fecha_nacimiento} onChange={(e) => setFechaNacimiento(e.target.value)} />
          </label>
          <label>
            Género
            <input value={genero} onChange={(e) => setGenero(e.target.value)} placeholder="Masculino / Femenino" />
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={situacionDeCalle} onChange={(e) => setSituacionDeCalle(e.target.checked)} />
            Persona en situación de calle
          </label>
          {error && <div className="alert alert-error">{error}</div>}
          {message && <div className="alert alert-success">{message}</div>}
          <button type="submit" className="button button-primary" disabled={loading}>
            {loading ? "Guardando..." : "Registrar persona"}
          </button>
        </form>
      </section>
    </main>
  );
}
