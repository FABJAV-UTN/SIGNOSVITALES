import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import { useAuth } from "./AuthContext";
import GeneroSelector from "./GeneroSelector";
import { generoTexto } from "../utils/genero";
import { proximoCumple } from "../utils/cumpleanos";
import { fechaCorta, textoDni } from "../utils/persona";

function detalleError(err, porDefecto) {
  const detail = err.response?.data?.detail;
  if (Array.isArray(detail)) return detail.map((e) => (e.loc ? `${e.loc[e.loc.length - 1]}: ${e.msg}` : e.msg)).join(" — ");
  if (typeof detail === "string") return detail;
  return porDefecto;
}

/** Formulario para corregir a mano los datos de la persona (DNI, nacimiento, etc.). */
function EditarPersona({ persona, onGuardada, onCancelar }) {
  const [form, setForm] = useState({
    nombre: persona.nombre || "",
    apellido: persona.apellido || "",
    dni: persona.dni || "",
    fecha_nacimiento: persona.fecha_nacimiento || "",
    genero: persona.genero || "",
    situacion_de_calle: Boolean(persona.situacion_de_calle),
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const cambiar = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));

  async function guardar(event) {
    event.preventDefault();
    setError("");
    setGuardando(true);
    try {
      const res = await api.patch(`/personas/${persona.id}`, {
        nombre: form.nombre.trim(),
        apellido: form.apellido.trim(),
        dni: form.dni.trim() || null,
        fecha_nacimiento: form.fecha_nacimiento || null,
        genero: form.genero || null,
        situacion_de_calle: form.situacion_de_calle,
      });
      onGuardada(res.data);
    } catch (err) {
      setError(detalleError(err, "No se pudieron guardar los cambios."));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form className="persona-editar" onSubmit={guardar}>
      <label>
        Nombre
        <input value={form.nombre} onChange={cambiar("nombre")} required />
      </label>
      <label>
        Apellido
        <input value={form.apellido} onChange={cambiar("apellido")} required />
      </label>
      <label>
        DNI
        <input value={form.dni} onChange={cambiar("dni")} placeholder="Sin DNI (dejar vacío)" inputMode="numeric" />
      </label>
      <label>
        Fecha de nacimiento
        <span className="input-con-boton">
          <input
            type="date"
            value={form.fecha_nacimiento}
            max={new Date().toISOString().slice(0, 10)}
            onChange={cambiar("fecha_nacimiento")}
          />
          {form.fecha_nacimiento && (
            <button
              type="button"
              className="button button-outline button-small"
              onClick={() => setForm((f) => ({ ...f, fecha_nacimiento: "" }))}
            >
              Borrar
            </button>
          )}
        </span>
      </label>
      <GeneroSelector value={form.genero} onChange={(g) => setForm((f) => ({ ...f, genero: g }))} name={`genero-${persona.id}`} />
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={form.situacion_de_calle}
          onChange={(e) => setForm((f) => ({ ...f, situacion_de_calle: e.target.checked }))}
        />
        En situación de calle
      </label>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="button-row">
        <button type="submit" className="button button-primary" disabled={guardando}>
          {guardando ? "Guardando..." : "Guardar cambios"}
        </button>
        <button type="button" className="button button-outline" onClick={onCancelar} disabled={guardando}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

/**
 * Ficha de una persona: datos, totales de atenciones, acciones y kits recibidos.
 * Se usa en "Buscar persona" (panel lateral) y en "Historial" (columna izquierda).
 * Los datos se pueden corregir a mano con "Editar datos" (onActualizada recibe la persona guardada).
 */
export default function PersonaPanel({ persona, onClose, onActualizada, mostrarVerHistorial = true, totalSignos }) {
  const { isAdmin } = useAuth();
  const [kits, setKits] = useState([]);
  // El componente se monta con key={id}: al cambiar de persona arranca de cero.
  const [loadingKits, setLoadingKits] = useState(true);
  const [editando, setEditando] = useState(false);
  const [guardada, setGuardada] = useState(null);
  const datos = guardada || persona;

  useEffect(() => {
    if (!persona?.id) return undefined;
    let cancelado = false;
    api
      .get(`/kits/persona/${persona.id}`)
      .then((res) => !cancelado && setKits(res.data))
      .catch(() => !cancelado && setKits([]))
      .finally(() => !cancelado && setLoadingKits(false));
    return () => {
      cancelado = true;
    };
  }, [persona?.id]);

  if (!persona) return null;

  const signos = totalSignos ?? datos.total_signos;
  const cumple = proximoCumple(datos.fecha_nacimiento);
  const totalKits = loadingKits ? datos.total_kits : kits.length;

  return (
    <div className="persona-panel">
      <div className="persona-panel-header">
        <div>
          <h3>
            {datos.nombre} {datos.apellido}
          </h3>
          <span className="text-muted">{textoDni(datos)}</span>
        </div>
        {onClose && (
          <button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar ficha">
            ✕
          </button>
        )}
      </div>

      {editando ? (
        <EditarPersona
          persona={datos}
          onCancelar={() => setEditando(false)}
          onGuardada={(p) => {
            setGuardada(p);
            setEditando(false);
            onActualizada?.(p);
          }}
        />
      ) : (
        <>
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
            <dt>DNI</dt>
            <dd>{datos.dni || <span className="text-muted">No informado</span>}</dd>
            <dt>Género</dt>
            <dd>{generoTexto(datos.genero)}</dd>
            <dt>Nacimiento</dt>
            <dd>
              {datos.fecha_nacimiento ? fechaCorta(datos.fecha_nacimiento) : <span className="text-muted">No informado</span>}
              {cumple && (
                <span className="text-muted small">
                  {" "}
                  ({cumple.dias === 0 ? cumple.edad : cumple.edad - 1} años
                  {cumple.dias <= 7 ? ` · cumple ${cumple.edad} ${cumple.dias === 0 ? "hoy 🎂" : `en ${cumple.dias} día(s)`}` : ""})
                </span>
              )}
            </dd>
            <dt>Situación de calle</dt>
            <dd>{datos.situacion_de_calle ? "Sí" : "No"}</dd>
          </dl>

          <div className="button-row">
            <Link to="/signos/registrar" state={{ personaId: datos.id }} className="button button-primary">
              Registrar signos
            </Link>
            <Link to="/kits/entregar" state={{ personaId: datos.id, persona: datos }} className="button button-primary">
              Entregar kit
            </Link>
            <button type="button" className="button button-outline" onClick={() => setEditando(true)}>
              Editar datos
            </button>
            {isAdmin && mostrarVerHistorial && (
              <Link to={`/historial?persona=${datos.id}`} className="button button-outline">
                Ver historial de signos
              </Link>
            )}
          </div>
        </>
      )}

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
                <span>{fechaCorta(k.fecha_entrega)}</span>
                <span className={`kit-badge ${k.tipo === "ABRIGO" ? "kit-abrigo" : "kit-otro"}`}>Kit {k.tipo}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
