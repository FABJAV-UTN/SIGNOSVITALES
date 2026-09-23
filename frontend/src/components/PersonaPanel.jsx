import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import { useAuth } from "./AuthContext";
import { generoTexto } from "../utils/genero";
import { proximoCumple } from "../utils/cumpleanos";

/**
 * Ficha de una persona: datos, totales de atenciones, acciones y kits recibidos.
 * Se usa en "Buscar persona" (panel lateral) y en "Historial" (columna izquierda).
 */
export default function PersonaPanel({ persona, onClose, mostrarVerHistorial = true, totalSignos }) {
  const { isAdmin } = useAuth();
  const [kits, setKits] = useState([]);
  // El componente se monta con key={dni}: al cambiar de persona arranca de cero.
  const [loadingKits, setLoadingKits] = useState(true);

  useEffect(() => {
    if (!persona?.dni) return undefined;
    let cancelado = false;
    api
      .get(`/kits/persona/${persona.dni}`)
      .then((res) => !cancelado && setKits(res.data))
      .catch(() => !cancelado && setKits([]))
      .finally(() => !cancelado && setLoadingKits(false));
    return () => {
      cancelado = true;
    };
  }, [persona?.dni]);

  if (!persona) return null;

  const signos = totalSignos ?? persona.total_signos;
  const cumple = proximoCumple(persona.fecha_nacimiento);
  const totalKits = loadingKits ? persona.total_kits : kits.length;

  return (
    <div className="persona-panel">
      <div className="persona-panel-header">
        <div>
          <h3>
            {persona.nombre} {persona.apellido}
          </h3>
          <span className="text-muted">DNI {persona.dni}</span>
        </div>
        {onClose && (
          <button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar ficha">
            ✕
          </button>
        )}
      </div>

      <div className="stat-row">
        <div className="stat">
          <span className="stat-value">{signos ?? "—"}</span>
          <span className="stat-label">Signos tomados</span>
        </div>
        <div className="stat">
          <span className="stat-value">{totalKits ?? "—"}</span>
          <span className="stat-label">Kits entregados</span>
        </div>
      </div>

      <dl className="persona-datos">
        <dt>Género</dt>
        <dd>{generoTexto(persona.genero)}</dd>
        <dt>Nacimiento</dt>
        <dd>
          {persona.fecha_nacimiento || "No informado"}
          {cumple && (
            <span className="text-muted small">
              {" "}
              ({cumple.dias === 0 ? cumple.edad : cumple.edad - 1} años{cumple.dias <= 7 ? ` · cumple ${cumple.edad} ${cumple.dias === 0 ? "hoy 🎂" : `en ${cumple.dias} día(s)`}` : ""})
            </span>
          )}
        </dd>
        <dt>Situación de calle</dt>
        <dd>{persona.situacion_de_calle ? "Sí" : "No"}</dd>
      </dl>

      <div className="button-row">
        <Link to="/signos/registrar" state={{ dni: persona.dni }} className="button button-primary">
          Registrar signos
        </Link>
        <Link to="/kits/entregar" state={{ dni: persona.dni, persona }} className="button button-primary">
          Entregar kit
        </Link>
        {isAdmin && mostrarVerHistorial && (
          <Link to={`/historial?dni=${encodeURIComponent(persona.dni)}`} className="button button-outline">
            Ver historial de signos
          </Link>
        )}
      </div>

      <div className="kits-block">
        <h4>📦 Kits recibidos</h4>
        {loadingKits ? (
          <p className="text-muted">Cargando kits...</p>
        ) : kits.length === 0 ? (
          <p className="text-muted">Esta persona no registra entregas de kits.</p>
        ) : (
          <ul className="kits-list">
            {kits.map((k) => (
              <li key={k.id}>
                <span>{k.fecha_entrega}</span>
                <span className={`kit-badge ${k.tipo === "ABRIGO" ? "kit-abrigo" : "kit-otro"}`}>Kit {k.tipo}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
