import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend } from "recharts";
import api from "../api";
import PersonaAutocomplete from "./PersonaAutocomplete";
import PersonaPanel from "./PersonaPanel";

function SignosChart({ registros }) {
  const datos = useMemo(
    () =>
      [...registros].reverse().map((item) => {
        let sistolica = null;
        let diastolica = null;
        if (item.presion_arterial) {
          const partes = item.presion_arterial.split("/");
          // "0/0" es lo que guarda la carga masiva cuando no se tomó la presión: no se grafica.
          sistolica = parseInt(partes[0], 10) || null;
          diastolica = parseInt(partes[1], 10) || null;
        }
        return {
          fecha: item.fecha,
          fc: item.frecuencia_cardiaca || null,
          spo2: item.oxigenacion_sangre || null,
          sistolica,
          diastolica,
        };
      }),
    [registros]
  );

  return (
    <div className="chart-wrapper">
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={datos} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#E0E0E0" strokeDasharray="3 3" />
          <XAxis dataKey="fecha" tick={{ fontSize: 11 }} />
          <YAxis yAxisId="fc" domain={[40, 220]} tickCount={6} tick={{ fontSize: 11 }} label={{ value: "FC / PA", angle: -90, position: "insideLeft", fontSize: 11 }} />
          <YAxis yAxisId="spo2" orientation="right" domain={[70, 100]} tickCount={6} tick={{ fontSize: 11 }} label={{ value: "SpO₂", angle: 90, position: "insideRight", fontSize: 11 }} />
          <YAxis yAxisId="pa" domain={[40, 220]} hide />
          <Tooltip formatter={(value, name) => [value ?? "—", name]} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line yAxisId="fc" type="monotone" dataKey="fc" name="FC (lpm)" stroke="#e3000f" strokeWidth={2} dot={{ r: 3 }} connectNulls />
          <Line yAxisId="spo2" type="monotone" dataKey="spo2" name="SpO₂ (%)" stroke="#17a2b8" strokeWidth={2} dot={{ r: 3 }} connectNulls />
          <Line yAxisId="pa" type="monotone" dataKey="sistolica" name="PA sistólica" stroke="#f5a623" strokeWidth={2} dot={{ r: 3 }} connectNulls />
          <Line yAxisId="pa" type="monotone" dataKey="diastolica" name="PA diastólica" stroke="#f0c040" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="4 2" connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function TablaRegistros({ registros, mostrarPersona }) {
  return (
    <div className="table-scroll table-scroll-y">
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            {mostrarPersona && <th>Persona</th>}
            <th>Lugar</th>
            <th>PA</th>
            <th className="num">FC</th>
            <th className="num">SpO₂</th>
          </tr>
        </thead>
        <tbody>
          {registros.map((r) => (
            <tr key={r.id}>
              <td>
                {r.fecha}
                <div className="text-muted small">{r.hora?.slice(0, 5)}</div>
              </td>
              {mostrarPersona && (
                <td>
                  {r.persona?.nombre} {r.persona?.apellido}
                </td>
              )}
              <td>{r.operativo?.lugar || "—"}</td>
              <td>{r.presion_arterial && r.presion_arterial !== "0/0" ? r.presion_arterial : "—"}</td>
              <td className="num">{r.frecuencia_cardiaca || "—"}</td>
              <td className="num">{r.oxigenacion_sangre || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Historial() {
  const [searchParams, setSearchParams] = useSearchParams();
  const dniParam = searchParams.get("dni") || searchParams.get("q") || "";

  const [personaCargada, setPersonaCargada] = useState(null);
  const [errorPersona, setErrorPersona] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [resultado, setResultado] = useState({ key: null, registros: [], error: "" });
  const [tab, setTab] = useState("signos");

  // La persona activa sale de la URL (?dni=...), así funciona el link desde "Buscar persona"
  // y el botón "atrás" del navegador.
  const persona = dniParam && personaCargada?.dni === dniParam ? personaCargada : null;
  const esperandoPersona = Boolean(dniParam) && !persona && !errorPersona;

  useEffect(() => {
    if (!dniParam || personaCargada?.dni === dniParam) return undefined;
    let cancelado = false;
    api
      .get("/personas", { params: { q: dniParam, limit: 20 } })
      .then((res) => {
        if (cancelado) return;
        const encontrada = res.data.find((p) => p.dni === dniParam) || null;
        setPersonaCargada(encontrada);
        setErrorPersona(encontrada ? "" : `No se encontró una persona con DNI ${dniParam}.`);
      })
      .catch(() => !cancelado && setErrorPersona("No se pudo cargar la persona."));
    return () => {
      cancelado = true;
    };
  }, [dniParam, personaCargada?.dni]);

  const requestKey = JSON.stringify({ dni: persona?.dni || null, desde, hasta });
  const loading = resultado.key !== requestKey;
  const registros = resultado.registros;
  const error = errorPersona || resultado.error;

  useEffect(() => {
    if (esperandoPersona) return undefined; // todavía cargando la persona del link
    let cancelado = false;
    const params = {};
    if (persona) params.q = persona.dni;
    if (desde) params.desde = desde;
    if (hasta) params.hasta = hasta;
    api
      .get("/signos/historial", { params })
      .then((response) => {
        if (cancelado) return;
        // El filtro q del backend también busca por nombre: nos quedamos solo con esta persona.
        const data = persona ? response.data.filter((r) => r.persona?.dni === persona.dni) : response.data;
        setResultado({ key: requestKey, registros: data, error: "" });
      })
      .catch(() => {
        if (!cancelado) setResultado({ key: requestKey, registros: [], error: "No se pudo cargar el historial." });
      });
    return () => {
      cancelado = true;
    };
  }, [requestKey, esperandoPersona]); // eslint-disable-line react-hooks/exhaustive-deps

  function seleccionar(p) {
    setPersonaCargada(p);
    setErrorPersona("");
    setTab("signos");
    setSearchParams({ dni: p.dni });
  }

  function limpiarPersona() {
    setErrorPersona("");
    setSearchParams({});
  }

  const hayFiltroFecha = Boolean(desde || hasta);

  const filtrosFecha = (
    <div className="date-filters">
      <label>
        Desde
        <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
      </label>
      <label>
        Hasta
        <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
      </label>
      {hayFiltroFecha && (
        <button
          type="button"
          className="button button-outline button-small"
          onClick={() => {
            setDesde("");
            setHasta("");
          }}
        >
          Limpiar fechas
        </button>
      )}
    </div>
  );

  return (
    <main className="page-shell page-wide">
      <section className="card card-form search-card">
        <h1>Historial de signos</h1>
        <label>
          Buscar persona
          <PersonaAutocomplete onSelect={seleccionar} placeholder="Escribí DNI, nombre o apellido..." />
        </label>
        {error && <div className="alert alert-error">{error}</div>}
      </section>

      {persona ? (
        <>
          <div className="tabs-mobile" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "persona"} className={tab === "persona" ? "active" : ""} onClick={() => setTab("persona")}>
              Persona
            </button>
            <button type="button" role="tab" aria-selected={tab === "signos"} className={tab === "signos" ? "active" : ""} onClick={() => setTab("signos")}>
              Signos ({registros.length})
            </button>
          </div>

          <div className="split-layout historial-layout has-selection">
            <aside className={`split-side tab-pane ${tab === "persona" ? "tab-active" : ""}`}>
              <div className="card sticky-card">
                <PersonaPanel
                  key={persona.dni}
                  persona={persona}
                  onClose={limpiarPersona}
                  mostrarVerHistorial={false}
                  totalSignos={hayFiltroFecha ? persona.total_signos : registros.length}
                />
              </div>
            </aside>

            <section className={`split-main tab-pane ${tab === "signos" ? "tab-active" : ""}`}>
              <div className="card">
                <div className="section-header">
                  <h2>Signos vitales</h2>
                  <span className="text-muted">{loading ? "Cargando..." : `${registros.length} registro(s)`}</span>
                </div>
                {filtrosFecha}
                {registros.length === 0 ? (
                  <p className="text-muted">{loading ? "Cargando..." : "No hay registros de signos para esta persona en el período."}</p>
                ) : (
                  <SignosChart registros={registros} />
                )}
              </div>
              {registros.length > 0 && (
                <div className="card table-card">
                  <h2>Registros</h2>
                  <TablaRegistros registros={registros} />
                </div>
              )}
            </section>
          </div>
        </>
      ) : (
        <section className="card table-card">
          <div className="section-header">
            <h2>Últimos registros (todas las personas)</h2>
            <span className="text-muted">{loading ? "Cargando..." : `${registros.length} registro(s)`}</span>
          </div>
          <p className="text-muted">Buscá una persona arriba para ver su ficha y el gráfico de sus signos.</p>
          {filtrosFecha}
          {registros.length === 0 ? (
            <p className="text-muted">No hay registros para mostrar.</p>
          ) : (
            <TablaRegistros registros={registros} mostrarPersona />
          )}
        </section>
      )}
    </main>
  );
}
