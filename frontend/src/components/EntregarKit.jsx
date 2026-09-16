import { useState } from "react";
import api from "../api";

export default function EntregarKit() {
  const [dni, setDni] = useState("");
  const [tipo, setTipo] = useState("PPAAS");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);
    try {
      await api.post("/kits", { dni, tipo });
      setMessage("Kit entregado correctamente.");
      setDni("");
      setTipo("PPAAS");
    } catch (err) {
      setError(err.response?.data?.detail || "No se pudo entregar el kit.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="card card-form">
        <h1>Entregar kit</h1>
        <form onSubmit={handleSubmit}>
          <label>
            DNI
            <input value={dni} onChange={(e) => setDni(e.target.value)} required placeholder="12345678" />
          </label>
          <label>
            Tipo de kit
            <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="PPAAS">PPAAS</option>
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
