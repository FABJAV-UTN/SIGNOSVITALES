import { useEffect, useId, useRef, useState } from "react";
import api from "../api";

/**
 * Buscador con sugerencias: mientras se escribe muestra las personas que coinciden
 * por DNI, nombre o apellido. Al elegir una llama a onSelect(persona).
 */
export default function PersonaAutocomplete({ onSelect, placeholder = "DNI, nombre o apellido", autoFocus = false }) {
  const [texto, setTexto] = useState("");
  const [sugerencias, setSugerencias] = useState([]);
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(-1);
  const [buscando, setBuscando] = useState(false);
  const contenedorRef = useRef(null);
  const listId = useId();

  useEffect(() => {
    const termino = texto.trim();
    if (!termino) return undefined;
    let cancelado = false;
    const timeout = setTimeout(async () => {
      try {
        const res = await api.get("/personas", { params: { q: termino, limit: 8 } });
        if (!cancelado) {
          setSugerencias(res.data);
          setActivo(res.data.length ? 0 : -1);
        }
      } catch {
        if (!cancelado) setSugerencias([]);
      } finally {
        if (!cancelado) setBuscando(false);
      }
    }, 200);
    return () => {
      cancelado = true;
      clearTimeout(timeout);
    };
  }, [texto]);

  useEffect(() => {
    function cerrarSiClickAfuera(event) {
      if (contenedorRef.current && !contenedorRef.current.contains(event.target)) setAbierto(false);
    }
    document.addEventListener("mousedown", cerrarSiClickAfuera);
    return () => document.removeEventListener("mousedown", cerrarSiClickAfuera);
  }, []);

  function elegir(persona) {
    onSelect(persona);
    setTexto("");
    setSugerencias([]);
    setAbierto(false);
  }

  function handleKeyDown(event) {
    if (!abierto && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      setAbierto(true);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActivo((i) => Math.min(i + 1, sugerencias.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActivo((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (sugerencias[activo]) elegir(sugerencias[activo]);
    } else if (event.key === "Escape") {
      setAbierto(false);
    }
  }

  const mostrarLista = abierto && texto.trim() !== "";

  return (
    <div className="autocomplete" ref={contenedorRef}>
      <input
        type="search"
        value={texto}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => {
          const valor = e.target.value;
          setTexto(valor);
          setAbierto(true);
          setBuscando(Boolean(valor.trim()));
          if (!valor.trim()) setSugerencias([]);
        }}
        onFocus={() => setAbierto(true)}
        onKeyDown={handleKeyDown}
        role="combobox"
        aria-expanded={mostrarLista}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
      />
      {mostrarLista && (
        <ul className="autocomplete-list" id={listId} role="listbox">
          {buscando && sugerencias.length === 0 ? (
            <li className="autocomplete-empty">Buscando...</li>
          ) : sugerencias.length === 0 ? (
            <li className="autocomplete-empty">No hay personas que coincidan.</li>
          ) : (
            sugerencias.map((p, i) => (
              <li
                key={p.id}
                role="option"
                aria-selected={i === activo}
                className={i === activo ? "active" : ""}
                onMouseDown={(e) => {
                  e.preventDefault();
                  elegir(p);
                }}
                onMouseEnter={() => setActivo(i)}
              >
                <span className="ac-nombre">
                  {p.nombre} {p.apellido}
                </span>
                <span className="ac-meta">
                  DNI {p.dni} · {p.total_signos ?? 0} signos · {p.total_kits ?? 0} kits
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
