import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";
import api from "../api";

export default function Historial() {
  const [searchParams] = useSearchParams();
  const [q, setQ] = useState(searchParams.get("q") || "");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [registros, setRegistros] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const datosGrafico = useMemo(
    () =>
      registros.map((item) => ({
        fecha: item.fecha,
        oxigenacion: item.oxigenacion_sangre,
      })),
    [registros]
  );

  useEffect(() => {
    cargarHistorial();
  }, []);

  async function cargarHistorial() {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (desde) params.set("desde", desde);
      if (hasta) params.set("hasta", hasta);
      const response = await api.get(`/signos/historial?${params.toString()}`);
      setRegistros(response.data);
    } catch (err) {
      setError("No se pudo cargar el historial.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="card card-form">
        <h1>Historial de signos</h1>
        <form onSubmit={(event) => { event.preventDefault(); cargarHistorial(); }}>
          <label>
            DNI o nombre/apellido
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="12345678 o Juan" />
          </label>
          <label>
            Desde
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </label>
          <label>
            Hasta
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </label>
          <button type="submit" className="button button-primary" disabled={loading}>
            {loading ? "Cargando..." : "Filtrar historial"}
          </button>
        </form>
        {error && <div className="alert alert-error">{error}</div>}
      </section>
      <section className="card">
        <h2>Gráfico de oxigenación</h2>
        {registros.length === 0 ? (
          <p className="text-muted">No hay registros para mostrar.</p>
        ) : (
          <div className="chart-wrapper">
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={datosGrafico}> 
                <CartesianGrid stroke="#E0E0E0" strokeDasharray="3 3" />
                <XAxis dataKey="fecha" />
                <YAxis domain={[70, 100]} />
                <Tooltip />
                <Line type="monotone" dataKey="oxigenacion" stroke="#E3000F" strokeWidth={3} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
      <section className="card table-card">
        <h2>Registros recientes</h2>
        {registros.length === 0 ? (
          <p className="text-muted">Utilice el filtro para ver registros.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Hora</th>
                  <th>Lugar</th>
                  <th>PA</th>
                  <th>FC</th>
                  <th>SpO₂</th>
                </tr>
              </thead>
              <tbody>
                {registros.map((registro) => (
                  <tr key={registro.id}>
                    <td>{registro.fecha}</td>
                    <td>{registro.hora}</td>
                    <td>{registro.operativo?.lugar || "-"}</td>
                    <td>{registro.presion_arterial}</td>
                    <td>{registro.frecuencia_cardiaca}</td>
                    <td>{registro.oxigenacion_sangre}</td>
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
