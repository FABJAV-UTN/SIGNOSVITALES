import { Link } from "react-router-dom";
import useCumpleanos from "./useCumpleanos";
import { textoDias } from "../utils/cumpleanos";

const formatoFecha = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long" });

function grupo(dias) {
  if (dias === 0) return "Hoy";
  if (dias <= 7) return "Próximos 7 días";
  if (dias <= 31) return "Este mes";
  return "Más adelante";
}

export default function Cumpleanos() {
  const { lista, sinFecha, cargado, error } = useCumpleanos();

  const grupos = [];
  lista.forEach((item) => {
    const nombre = grupo(item.cumple.dias);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.nombre === nombre) ultimo.items.push(item);
    else grupos.push({ nombre, items: [item] });
  });

  return (
    <main className="page-shell">
      <section className="card">
        <h1>🎂 Cumpleaños</h1>
        <p className="text-muted">
          Ordenados del más próximo al más lejano, según la fecha de nacimiento cargada.
          {sinFecha > 0 && ` Hay ${sinFecha} persona(s) sin fecha de nacimiento que no aparecen en la lista.`}
        </p>
        {error && <div className="alert alert-error">{error}</div>}
        {!cargado ? (
          <p className="text-muted">Cargando...</p>
        ) : lista.length === 0 ? (
          <p className="text-muted">Todavía no hay personas con fecha de nacimiento cargada.</p>
        ) : (
          grupos.map((g) => (
            <div key={g.nombre} className="cumple-grupo">
              <h2>{g.nombre}</h2>
              <ul className="cumple-lista">
                {g.items.map(({ persona, cumple }) => (
                  <li key={persona.id} className={cumple.dias === 0 ? "cumple-hoy" : cumple.dias <= 7 ? "cumple-pronto" : ""}>
                    <div className="cumple-persona">
                      <strong>
                        {persona.nombre} {persona.apellido}
                      </strong>
                      <span className="text-muted small">DNI {persona.dni}</span>
                    </div>
                    <div className="cumple-fecha">
                      <span className="cumple-dias">{textoDias(cumple.dias)}</span>
                      <span className="text-muted small">{formatoFecha.format(cumple.fecha)}</span>
                    </div>
                    <div className="cumple-edad">
                      Cumple <strong>{cumple.edad}</strong> años
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </main>
  );
}

/** Aviso para el panel de inicio: cumpleaños de hoy y de los próximos 7 días. */
export function AvisoCumpleanos() {
  const { proximos } = useCumpleanos();
  if (proximos.length === 0) return null;
  return (
    <Link to="/cumpleanos" className="aviso-cumple">
      <span className="aviso-cumple-icono">🎂</span>
      <span>
        {proximos.slice(0, 3).map(({ persona, cumple }, i) => (
          <span key={persona.id}>
            {i > 0 && " · "}
            <strong>
              {persona.nombre} {persona.apellido}
            </strong>{" "}
            cumple {cumple.edad} {cumple.dias === 0 ? "hoy" : cumple.dias === 1 ? "mañana" : `en ${cumple.dias} días`}
          </span>
        ))}
        {proximos.length > 3 && ` · y ${proximos.length - 3} más`}
      </span>
    </Link>
  );
}
