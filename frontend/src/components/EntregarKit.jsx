import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import api from "../api";
import PersonaSelector from "./PersonaSelector";

const hoy = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Últimas entregas de la persona y aviso si ya recibió ese tipo de kit hoy. */
function KitsPrevios({ dni, tipo }) {
  const [kits, setKits] = useState(null);

  useEffect(() => {
    let cancelado = false;
    api
      .get(`/kits/persona/${dni}`)
      .then((res) => !cancelado && setKits(res.data))
      .catch(() => !cancelado && setKits([]));
    return () => {
      cancelado = true;
    };
  }, [dni]);

  if (kits === null) return <p className="text-muted small">Cargando entregas anteriores...</p>;
  const yaHoy = kits.some((k) => k.tipo === tipo && k.fecha_entrega === hoy());
  return (
    <div className="kits-previos">
      {yaHoy && <div className="alert alert-warning">Ojo: esta persona ya recibió un kit {tipo} hoy.</div>}
      {kits.length === 0 ? (
        <p className="text-muted small">No registra entregas anteriores.</p>
      ) : (
        <p className="text-muted small">
          Últimas entregas:{" "}
          {kits
            .slice(0, 3)
            .map((k) => `${k.tipo} (${k.fecha_entrega})`)
            .join(" · ")}
          {kits.length > 3 && ` · y ${kits.length - 3} más`}
        </p>
      )}
    </div>
  );
}

export default function EntregarKit() {
  const navigate = useNavigate();
  const location = useLocation();
  const initialDni = location.state?.dni || "";

  const [persona, setPersona] = useState(location.state?.persona || null);
  const [tipo, setTipo] = useState("PPAAS");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
      await api.post("/kits", { dni: persona.dni, tipo });
      setMessage(`Kit ${tipo} entregado correctamente a ${persona.nombre} ${persona.apellido}.`);
      if (initialDni) {
        setTimeout(() => navigate("/personas/buscar"), 1500);
      } else {
        // Listo para la siguiente persona.
        setPersona(null);
        setTipo("PPAAS");
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
        <div className="form-actions-row">
          <div>
            <h1>Entregar kit</h1>
            <p className="text-muted">Acompañamiento y asistencia social</p>
          </div>
          <Link to="/kits/carga-masiva" className="button button-outline button-small">
            Carga masiva
          </Link>
        </div>

        {message && <div className="alert alert-success">{message}</div>}

        <PersonaSelector persona={persona} onChange={elegirPersona} dniInicial={initialDni}>
          {persona && <KitsPrevios key={persona.dni} dni={persona.dni} tipo={tipo} />}
        </PersonaSelector>

        {persona && (
          <form onSubmit={handleSubmit} className="form-after-persona">
            <label>
              Tipo de kit
              <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
                <option value="PPAAS">PPAAS (Higiene / Primeros auxilios)</option>
                <option value="ABRIGO">ABRIGO</option>
              </select>
            </label>
            {error && <div className="alert alert-error">{error}</div>}
            <button type="submit" className="button button-primary" disabled={loading}>
              {loading ? "Enviando..." : "Registrar entrega"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
