import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import PersonaAutocomplete from "./PersonaAutocomplete";
import { textoDni } from "../utils/persona";

/**
 * Elegir a la persona para un formulario individual (entregar kit, registrar signos):
 * buscador con sugerencias por DNI, nombre o apellido. Una vez elegida muestra una ficha
 * corta con "Cambiar". Si se llega con una persona (desde "Buscar persona"), la carga sola.
 */
export default function PersonaSelector({ persona, onChange, personaIdInicial = null, children }) {
  const [errorInicial, setErrorInicial] = useState("");

  useEffect(() => {
    if (!personaIdInicial || persona) return undefined;
    let cancelado = false;
    api
      .get(`/personas/${personaIdInicial}`)
      .then((res) => !cancelado && onChange(res.data))
      .catch(() => !cancelado && setErrorInicial("No se pudo cargar la persona."));
    return () => {
      cancelado = true;
    };
  }, [personaIdInicial]); // eslint-disable-line react-hooks/exhaustive-deps

  if (persona) {
    return (
      <div className="persona-elegida">
        <div>
          <strong>
            {persona.nombre} {persona.apellido}
          </strong>
          <div className="text-muted small">
            {textoDni(persona)}
            {persona.total_signos !== undefined && ` · ${persona.total_signos} signos · ${persona.total_kits} kits`}
            {persona.situacion_de_calle ? " · En situación de calle" : ""}
          </div>
          {children}
        </div>
        <button type="button" className="button button-outline button-small" onClick={() => onChange(null)}>
          Cambiar
        </button>
      </div>
    );
  }

  return (
    <div className="persona-selector">
      <label>
        Persona
        <PersonaAutocomplete onSelect={onChange} placeholder="Escribí DNI, nombre o apellido..." autoFocus />
      </label>
      {errorInicial && <div className="alert alert-error">{errorInicial}</div>}
      <p className="text-muted small">
        ¿No aparece? <Link to="/personas/nueva">Registrar una persona nueva</Link>
      </p>
    </div>
  );
}
