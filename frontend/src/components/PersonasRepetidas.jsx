import { useCallback, useEffect, useState } from "react";
import api from "../api";
import { fechaCorta } from "../utils/persona";

function detalleError(err, porDefecto) {
  const detail = err.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((e) => e.msg).join(" — ");
  return porDefecto;
}

const nombreDe = (p) => [p.nombre, p.apellido].filter(Boolean).join(" ");

/**
 * Un grupo de registros que parecen la misma persona. Se destilda a quien no corresponde
 * (ej. en "Manu / Manuel / Emanuel", Emanuel es otra persona), se elige qué registro
 * conservar y se unifica el resto en ese.
 */
function GrupoRepetidos({ grupo, onResuelto }) {
  const [incluidas, setIncluidas] = useState(() => new Set(grupo.personas.map((p) => p.id)));
  const [conservar, setConservar] = useState(grupo.sugerida_id);
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  const elegidas = grupo.personas.filter((p) => incluidas.has(p.id));
  const fuera = grupo.personas.filter((p) => !incluidas.has(p.id));
  const principal = grupo.personas.find((p) => p.id === conservar);
  const dnis = [...new Set(elegidas.map((p) => p.dni).filter(Boolean))];
  const conflictoDni = dnis.length > 1;
  const puedeUnificar = elegidas.length >= 2 && incluidas.has(conservar) && !conflictoDni;

  const resultado = {
    dni: principal?.dni || dnis[0] || null,
    nacimiento: principal?.fecha_nacimiento || elegidas.map((p) => p.fecha_nacimiento).find(Boolean) || null,
    signos: elegidas.reduce((n, p) => n + (p.total_signos || 0), 0),
    kits: elegidas.reduce((n, p) => n + (p.total_kits || 0), 0),
  };

  function alternar(id) {
    setConfirmando(false);
    setIncluidas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function unificar() {
    setError("");
    setEnviando(true);
    try {
      const res = await api.post("/personas/unificar", {
        conservar_id: conservar,
        unir_ids: elegidas.filter((p) => p.id !== conservar).map((p) => p.id),
      });
      // Los destildados no son esta persona: que no se vuelvan a proponer juntos.
      if (fuera.length > 0) {
        await api.post("/personas/distintas", { pares: fuera.map((p) => [conservar, p.id]) });
      }
      onResuelto(
        `Unificado en ${nombreDe(res.data.persona)}: ${res.data.persona.total_signos} signos y ${res.data.persona.total_kits} kits` +
          (res.data.duplicados_descartados ? ` (se descartaron ${res.data.duplicados_descartados} registros repetidos idénticos)` : "") +
          "."
      );
    } catch (err) {
      setError(detalleError(err, "No se pudo unificar."));
      setEnviando(false);
    }
  }

  async function sonDistintas() {
    setError("");
    setEnviando(true);
    const pares = [];
    grupo.personas.forEach((a, i) => grupo.personas.slice(i + 1).forEach((b) => pares.push([a.id, b.id])));
    try {
      await api.post("/personas/distintas", { pares });
      onResuelto(`Marcadas como personas distintas: ${grupo.personas.map(nombreDe).join(", ")}.`);
    } catch (err) {
      setError(detalleError(err, "No se pudo guardar."));
      setEnviando(false);
    }
  }

  return (
    <section className="card repetidos-grupo">
      <h2>{grupo.personas.map(nombreDe).join(" · ")}</h2>
      <p className="text-muted small">
        Tildá los registros que son la misma persona y elegí cuál conservar. Los signos y kits de los demás pasan a ese registro.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Es la misma</th>
              <th>Conservar</th>
              <th>Nombre</th>
              <th>DNI</th>
              <th className="desktop-only">Nacimiento</th>
              <th className="num">Signos</th>
              <th className="num">Kits</th>
            </tr>
          </thead>
          <tbody>
            {grupo.personas.map((p) => {
              const incluida = incluidas.has(p.id);
              return (
                <tr key={p.id} className={incluida ? "" : "fila-excluida"}>
                  <td>
                    <input type="checkbox" checked={incluida} onChange={() => alternar(p.id)} aria-label={`Incluir a ${nombreDe(p)}`} />
                  </td>
                  <td>
                    <input
                      type="radio"
                      name={`conservar-${grupo.sugerida_id}`}
                      checked={conservar === p.id}
                      disabled={!incluida}
                      onChange={() => {
                        setConservar(p.id);
                        setConfirmando(false);
                      }}
                      aria-label={`Conservar el registro de ${nombreDe(p)}`}
                    />
                  </td>
                  <td>
                    <strong>{nombreDe(p)}</strong>
                  </td>
                  <td>{p.dni || <span className="text-muted">—</span>}</td>
                  <td className="desktop-only">{p.fecha_nacimiento ? fechaCorta(p.fecha_nacimiento) : <span className="text-muted">—</span>}</td>
                  <td className="num">{p.total_signos}</td>
                  <td className="num">{p.total_kits}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {conflictoDni && (
        <div className="alert alert-warning">
          Los registros tildados tienen DNI distintos ({dnis.join(", ")}): no pueden ser la misma persona. Destildá alguno.
        </div>
      )}
      {!incluidas.has(conservar) && elegidas.length > 0 && (
        <div className="alert alert-warning">Elegí cuál de los registros tildados conservar.</div>
      )}
      {puedeUnificar && (
        <p className="repetidos-resultado">
          Queda <strong>{nombreDe(principal)}</strong>
          {resultado.dni ? ` · DNI ${resultado.dni}` : " · sin DNI"}
          {resultado.nacimiento ? ` · nació el ${fechaCorta(resultado.nacimiento)}` : ""} · {resultado.signos} signos · {resultado.kits} kits.
          {fuera.length > 0 && (
            <span className="text-muted"> {fuera.map(nombreDe).join(", ")} queda(n) como persona(s) aparte.</span>
          )}
        </p>
      )}
      {error && <div className="alert alert-error">{error}</div>}

      {confirmando ? (
        <div className="alert alert-warning">
          <p>
            Se van a borrar {elegidas.length - 1} registro(s) ({elegidas.filter((p) => p.id !== conservar).map(nombreDe).join(", ")}) y todo
            pasa a <strong>{nombreDe(principal)}</strong>. No se puede deshacer.
          </p>
          <div className="button-row">
            <button type="button" className="button button-primary" onClick={unificar} disabled={enviando}>
              {enviando ? "Unificando..." : "Sí, unificar"}
            </button>
            <button type="button" className="button button-outline" onClick={() => setConfirmando(false)} disabled={enviando}>
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <div className="button-row">
          <button type="button" className="button button-primary" disabled={!puedeUnificar || enviando} onClick={() => setConfirmando(true)}>
            Unificar {elegidas.length >= 2 ? `${elegidas.length} registros` : ""}
          </button>
          <button type="button" className="button button-outline" disabled={enviando} onClick={sonDistintas}>
            No son la misma persona
          </button>
        </div>
      )}
    </section>
  );
}

export default function PersonasRepetidas() {
  const [grupos, setGrupos] = useState(null);
  const [error, setError] = useState("");
  const [mensajes, setMensajes] = useState([]);

  const cargar = useCallback(() => {
    api
      .get("/personas/repetidos")
      .then((res) => setGrupos(res.data))
      .catch(() => setError("No se pudieron buscar las personas repetidas."));
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  function resuelto(mensaje) {
    setMensajes((prev) => [mensaje, ...prev].slice(0, 5));
    cargar();
  }

  return (
    <main className="page-shell page-wide">
      <section className="card">
        <h1>Personas repetidas</h1>
        <p className="text-muted">
          Registros que, por el nombre, podrían ser la misma persona escrita distinto (por ejemplo “Ema” y “Emanuel”, o “Marelo” y
          “Marcelo Tercero”). Revisá cada grupo: destildá a quien sea otra persona y unificá el resto. Si un grupo no corresponde,
          marcalo como “No son la misma persona” y no vuelve a aparecer.
        </p>
        {mensajes.map((m, i) => (
          <div key={`${m}-${i}`} className="alert alert-success">
            {m}
          </div>
        ))}
        {error && <div className="alert alert-error">{error}</div>}
        {grupos === null && !error && <p className="text-muted">Buscando...</p>}
        {grupos?.length === 0 && <p>No se encontraron posibles repetidos. 🎉</p>}
        {grupos?.length > 0 && <p>{grupos.length} grupo(s) para revisar.</p>}
      </section>
      {grupos?.map((g) => (
        <GrupoRepetidos key={g.personas.map((p) => p.id).join("-")} grupo={g} onResuelto={resuelto} />
      ))}
    </main>
  );
}
