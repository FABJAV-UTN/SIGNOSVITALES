import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import PersonaAutocomplete from "./PersonaAutocomplete";

/**
 * Elegir a la persona para un formulario individual (entregar kit, registrar signos):
 * buscador con sugerencias por DNI, nombre o apellido. Una vez elegida muestra una ficha
 * corta con "Cambiar". Si se llega con un DNI (desde "Buscar persona"), la carga sola.
 */
export default function PersonaSelector({ persona, onChange, dniInicial = "", children }) {
  const [errorInicial, setErrorInicial] = useState("");

  useEffect(() => {
    if (!dniInicial || persona) return undefined;
    let cancelado = false;
    api
      .get("/personas", { params: { q: dniInicial, limit: 20 } })
      .then((res) => {
        if (cancelado) return;
        const encontrada = res.data.find((p) => p.dni === dniInicial);
        if (encontrada) onChange(encontrada);
        else setErrorInicial(`No se encontró una persona con DNI ${dniInicial}.`);
      })
      .catch(() => !cancelado && setErrorInicial("No se pudo cargar la persona."));
    return () => {
      cancelado = true;
    };
  }, [dniInicial]); // eslint-disable-line react-hooks/exhaustive-deps

  if (persona) {
    return (
      <div className="persona-elegida">
        <div>
          <strong>
            {persona.nombre} {persona.apellido}
          </strong>
          <div className="text-muted small">
            DNI {persona.dni}
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
