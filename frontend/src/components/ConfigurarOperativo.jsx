import { useEffect, useState } from "react";
import api from "../api";

export default function ConfigurarOperativo() {
  const [lugar, setLugar] = useState("");
  const [diaSemana, setDiaSemana] = useState("");
  const [hora, setHora] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    async function cargar() {
      try {
        const response = await api.get("/operativo");
        setLugar(response.data.lugar);
        setDiaSemana(response.data.dia_semana);
        setHora(response.data.hora);
      } catch (err) {
        setError("No se pudo cargar la configuración del operativo.");
      } finally {
        setLoading(false);
      }
    }
    cargar();
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    setSaving(true);
    try {
      await api.put("/operativo", {
        lugar,
        dia_semana: diaSemana,
        hora,
      });
      setMessage("Operativo actualizado correctamente.");
    } catch (err) {
      setError(err.response?.data?.detail || "No se pudo actualizar operativo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="card card-form">
        <h1>Configurar operativo</h1>
        {loading ? (
          <p className="text-muted">Cargando datos...</p>
        ) : (
          <form onSubmit={handleSubmit}>
            <label>
              Lugar
              <input value={lugar} onChange={(e) => setLugar(e.target.value)} required />
            </label>
            <label>
              Día de la semana
              <input value={diaSemana} onChange={(e) => setDiaSemana(e.target.value)} required />
            </label>
            <label>
              Hora
              <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} required />
            </label>
            {error && <div className="alert alert-error">{error}</div>}
            {message && <div className="alert alert-success">{message}</div>}
            <button type="submit" className="button button-primary" disabled={saving}>
              {saving ? "Guardando..." : "Guardar operativo"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
