import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend } from "recharts";
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
      [...registros].reverse().map((item) => {
        let sistolica = null;
        let diastolica = null;
        if (item.presion_arterial) {
          const partes = item.presion_arterial.split("/");
          sistolica = partes[0] ? parseInt(partes[0]) : null;
          diastolica = partes[1] ? parseInt(partes[1]) : null;
        }
        return {
          fecha: item.fecha,
          fc: item.frecuencia_cardiaca ?? null,
          spo2: item.oxigenacion_sangre ?? null,
          sistolica,
          diastolica,
        };
      }),
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
        <h2>Gráfico de signos vitales</h2>
        {registros.length === 0 ? (
          <p className="text-muted">No hay registros para mostrar.</p>
        ) : (
          <div className="chart-wrapper">
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={datosGrafico}>
                <CartesianGrid stroke="#E0E0E0" strokeDasharray="3 3" />
                <XAxis dataKey="fecha" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="fc" domain={[40, 220]} tickCount={6} tick={{ fontSize: 11 }} label={{ value: "FC / PA", angle: -90, position: "insideLeft", fontSize: 11 }} />
                <YAxis yAxisId="spo2" orientation="right" domain={[70, 100]} tickCount={6} tick={{ fontSize: 11 }} label={{ value: "SpO₂", angle: 90, position: "insideRight", fontSize: 11 }} />
                <YAxis yAxisId="pa" domain={[40, 220]} hide />
                <Tooltip formatter={(value, name) => [value ?? "—", name]} />
                <Legend />
                <Line yAxisId="fc" type="monotone" dataKey="fc" name="FC (lpm)" stroke="#e3000f" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                <Line yAxisId="spo2" type="monotone" dataKey="spo2" name="SpO₂ (%)" stroke="#17a2b8" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                <Line yAxisId="pa" type="monotone" dataKey="sistolica" name="PA sistólica" stroke="#f5a623" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                <Line yAxisId="pa" type="monotone" dataKey="diastolica" name="PA diastólica" stroke="#f0c040" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="4 2" connectNulls />
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
                    <td>{registro.operativo?.lugar || "—"}</td>
                    <td>{registro.presion_arterial ?? "—"}</td>
                    <td>{registro.frecuencia_cardiaca ?? "—"}</td>
                    <td>{registro.oxigenacion_sangre ?? "—"}</td>
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
