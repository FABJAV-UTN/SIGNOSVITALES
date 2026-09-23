import { useMemo, useState } from "react";
import api from "../api";
import { GENEROS } from "../utils/genero";

const listaFilas = (filas) => (filas.length === 1 ? `fila ${filas[0]}` : `filas ${filas.join(", ")}`);
const cantFilas = (n) => `${n} ${n === 1 ? "fila" : "filas"}`;

function detalleError(err, porDefecto) {
  const detail = err.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((e) => e.msg).join(" — ");
  return porDefecto;
}

/**
 * Paso de revisión de una carga masiva (signos o kits):
 * 1) confirma los nombres que se parecen a alguien de la base,
 * 2) lista a los que no están y deja tildar a quién crear,
 * 3) crea las personas tildadas y manda las filas a `endpoint` con la persona ya resuelta.
 */
export default function RevisionCarga({ data, preview, endpoint, onCancelar, onTerminado }) {
  const aConfirmar = preview.identificadores.filter((r) => r.estado === "sugerencia" || r.estado === "ambigua");
  const exactas = preview.identificadores.filter((r) => r.estado === "exacta");

  // Respuesta para cada coincidencia: id de persona (texto), "nueva", "omitir" o "" (sin responder).
  const [decisiones, setDecisiones] = useState(() => Object.fromEntries(aConfirmar.map((r) => [r.identificador, ""])));
  // Datos para dar de alta a quien no está en la base.
  const [altas, setAltas] = useState(() =>
    Object.fromEntries(
      preview.identificadores
        .filter((r) => r.estado !== "exacta")
        .map((r) => [
          r.identificador,
          {
            crear: true,
            unir: Boolean(r.parecido_a),
            nombre: r.nombre_sugerido || "",
            apellido: r.apellido_sugerido || "",
            dni: /^\d{6,9}$/.test(r.identificador.replace(/[\s.-]/g, "")) ? r.identificador.replace(/[\s.-]/g, "") : "",
            genero: "",
            fecha_nacimiento: "",
            situacion_de_calle: false,
          },
        ])
    )
  );
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  const noEncontradas = preview.identificadores.filter(
    (r) => r.estado === "no_encontrada" || decisiones[r.identificador] === "nueva"
  );
  const identificadoresNoEncontrados = new Set(noEncontradas.map((r) => r.identificador));

  // "Marelo Tercero" se une a "Marcelo Tercero" solo si esa otra también se va a crear.
  const destinoUnion = (r) => {
    const alta = altas[r.identificador];
    if (!r.parecido_a || !alta?.unir || !identificadoresNoEncontrados.has(r.parecido_a)) return null;
    return altas[r.parecido_a]?.crear ? r.parecido_a : null;
  };

  const pendientes = aConfirmar.filter((r) => !decisiones[r.identificador]);
  const aCrear = noEncontradas.filter((r) => altas[r.identificador]?.crear && !destinoUnion(r));
  const faltanDatos = aCrear.filter((r) => !altas[r.identificador].nombre.trim());

  const resumen = useMemo(() => {
    let filasACargar = 0;
    let filasOmitidas = 0;
    for (const r of preview.identificadores) {
      const n = r.filas.length;
      if (r.estado === "exacta") filasACargar += n;
      else if (identificadoresNoEncontrados.has(r.identificador)) {
        const alta = altas[r.identificador];
        if (alta?.crear) filasACargar += n;
        else filasOmitidas += n;
      } else if (decisiones[r.identificador] === "omitir") filasOmitidas += n;
      else if (decisiones[r.identificador]) filasACargar += n;
    }
    return { filasACargar, filasOmitidas };
  }, [preview, decisiones, altas]); // eslint-disable-line react-hooks/exhaustive-deps

  function actualizarAlta(identificador, cambios) {
    setAltas((prev) => ({ ...prev, [identificador]: { ...prev[identificador], ...cambios } }));
  }

  function tildarTodas(valor) {
    setAltas((prev) => {
      const next = { ...prev };
      noEncontradas.forEach((r) => {
        next[r.identificador] = { ...next[r.identificador], crear: valor };
      });
      return next;
    });
  }

  async function confirmar() {
    setError("");
    setEnviando(true);
    const errores = preview.invalidas.map((f) => `Fila ${f.fila}: ${f.error}`);
    try {
      // 1) Personas por identificador: las que ya existen y las confirmadas.
      const personaPor = {};
      exactas.forEach((r) => {
        personaPor[r.identificador] = r.persona.id;
      });
      aConfirmar.forEach((r) => {
        const d = decisiones[r.identificador];
        if (d && d !== "nueva" && d !== "omitir") personaPor[r.identificador] = Number(d);
      });

      // 2) Crear las personas tildadas.
      let creadas = [];
      if (aCrear.length > 0) {
        const filasAlta = aCrear.map((r) => {
          const a = altas[r.identificador];
          return {
            nombre: a.nombre.trim(),
            apellido: a.apellido.trim() || "Sin apellido",
            dni: a.dni.trim(),
            genero: a.genero || null,
            fecha_nacimiento: a.fecha_nacimiento || null,
            situacion_de_calle: a.situacion_de_calle,
          };
        });
        const res = await api.post("/personas/bulk", { rows: filasAlta });
        (res.data.errores || []).forEach((e) => errores.push(`Alta de persona — ${e}`));
        creadas = (res.data.creadas || []).map((c) => {
          const r = aCrear[c.fila - 1];
          personaPor[r.identificador] = c.id;
          return { ...c, provisorio: !altas[r.identificador].dni.trim() };
        });
      }
      noEncontradas.forEach((r) => {
        const destino = destinoUnion(r);
        if (destino && personaPor[destino]) personaPor[r.identificador] = personaPor[destino];
      });

      // 3) Armar las filas con la persona ya resuelta.
      const identPorFila = {};
      preview.identificadores.forEach((r) => r.filas.forEach((f) => (identPorFila[f] = r.identificador)));
      let omitidas = 0;
      const filas = [];
      data.rows.forEach((row) => {
        const ident = identPorFila[row.fila];
        if (!ident) return; // fila inválida: ya está en la lista de errores
        const personaId = personaPor[ident];
        if (!personaId) {
          omitidas += 1;
          return;
        }
        filas.push({ ...row, persona_id: personaId });
      });

      let ok = 0;
      if (filas.length > 0) {
        // Se reenvían los campos generales del payload (ej. operativo_id / lugar_custom en signos).
        const res = await api.post(endpoint, { ...data, rows: filas });
        ok = res.data.ok;
        errores.push(...(res.data.errores || []));
      }
      onTerminado({ ok, errores, creadas, omitidas });
    } catch (err) {
      setError(detalleError(err, "No se pudo completar la carga."));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="card revision">
      <h2>Revisión antes de cargar</h2>
      <div className="chip-row">
        <span className="chip">{cantFilas(preview.total_filas)}</span>
        <span className="chip chip-ok">{exactas.length} persona(s) encontradas</span>
        {aConfirmar.length > 0 && <span className="chip chip-warn">{aConfirmar.length} a confirmar</span>}
        {noEncontradas.length > 0 && <span className="chip chip-new">{noEncontradas.length} no están en la base</span>}
        {preview.invalidas.length > 0 && <span className="chip chip-error">{cantFilas(preview.invalidas.length)} con errores</span>}
      </div>

      {aConfirmar.length > 0 && (
        <div className="revision-block">
          <h3>Coincidencias a confirmar</h3>
          <p className="text-muted">
            Estos nombres no coinciden exacto con nadie de la base, pero se parecen. Elegí quién es cada uno.
          </p>
          {aConfirmar.map((r) => (
            <fieldset key={r.identificador} className={`match-card ${decisiones[r.identificador] ? "" : "match-pending"}`}>
              <legend>
                <strong>“{r.identificador}”</strong>{" "}
                <span className="text-muted">
                  · {cantFilas(r.filas.length)} ({listaFilas(r.filas)})
                </span>
              </legend>
              <p className="match-question">
                {r.estado === "ambigua" ? "Hay más de una persona con ese nombre. ¿Cuál es?" : "¿Es alguna de estas personas?"}
              </p>
              {r.candidatos.map((c) => (
                <label key={c.id} className="radio-line">
                  <input
                    type="radio"
                    name={`m-${r.identificador}`}
                    checked={decisiones[r.identificador] === String(c.id)}
                    onChange={() => setDecisiones((d) => ({ ...d, [r.identificador]: String(c.id) }))}
                  />
                  <span>
                    Sí, es <strong>{c.nombre} {c.apellido}</strong> <span className="text-muted">— DNI {c.dni}</span>
                    {r.estado === "sugerencia" && <span className="similitud">{Math.round(c.similitud * 100)}% parecido</span>}
                  </span>
                </label>
              ))}
              <label className="radio-line">
                <input
                  type="radio"
                  name={`m-${r.identificador}`}
                  checked={decisiones[r.identificador] === "nueva"}
                  onChange={() => setDecisiones((d) => ({ ...d, [r.identificador]: "nueva" }))}
                />
                <span>No, es otra persona (pasa a la lista de personas que no están en la base)</span>
              </label>
              <label className="radio-line">
                <input
                  type="radio"
                  name={`m-${r.identificador}`}
                  checked={decisiones[r.identificador] === "omitir"}
                  onChange={() => setDecisiones((d) => ({ ...d, [r.identificador]: "omitir" }))}
                />
                <span>No cargar estas filas</span>
              </label>
            </fieldset>
          ))}
        </div>
      )}

      {noEncontradas.length > 0 && (
        <div className="revision-block">
          <h3>Las siguientes personas no se encuentran en la base de datos:</h3>
          <ul className="no-encontradas-resumen">
            {noEncontradas.map((r) => (
              <li key={r.identificador}>
                {r.identificador} <span className="text-muted">({cantFilas(r.filas.length)})</span>
              </li>
            ))}
          </ul>
          <div className="section-header">
            <p className="match-question">¿Desea crear el registro de estas personas? Destildá a las que no quieras crear.</p>
            <div className="button-row compact">
              <button type="button" className="button button-outline button-small" onClick={() => tildarTodas(true)}>
                Tildar todas
              </button>
              <button type="button" className="button button-outline button-small" onClick={() => tildarTodas(false)}>
                Destildar todas
              </button>
            </div>
          </div>

          {noEncontradas.map((r) => {
            const alta = altas[r.identificador];
            const destino = destinoUnion(r);
            const puedeUnir = r.parecido_a && identificadoresNoEncontrados.has(r.parecido_a) && altas[r.parecido_a]?.crear;
            return (
              <div key={r.identificador} className={`alta-card ${alta.crear ? "" : "alta-off"}`}>
                <label className="alta-check">
                  <input
                    type="checkbox"
                    checked={alta.crear}
                    onChange={(e) => actualizarAlta(r.identificador, { crear: e.target.checked })}
                  />
                  <span>
                    <strong>{r.identificador}</strong>{" "}
                    <span className="text-muted">
                      · {cantFilas(r.filas.length)} ({listaFilas(r.filas)})
                    </span>
                  </span>
                </label>

                {!alta.crear && <p className="text-muted small">No se crea: sus filas no se van a cargar.</p>}

                {alta.crear && puedeUnir && (
                  <label className="alta-union">
                    <input
                      type="checkbox"
                      checked={alta.unir}
                      onChange={(e) => actualizarAlta(r.identificador, { unir: e.target.checked })}
                    />
                    <span>
                      Parece la misma persona que <strong>“{r.parecido_a}”</strong>: usar ese mismo registro
                    </span>
                  </label>
                )}

                {alta.crear && !destino && (
                  <div className="alta-campos">
                    <label>
                      Nombre
                      <input value={alta.nombre} onChange={(e) => actualizarAlta(r.identificador, { nombre: e.target.value })} />
                    </label>
                    <label>
                      Apellido
                      <input
                        value={alta.apellido}
                        placeholder="Sin apellido"
                        onChange={(e) => actualizarAlta(r.identificador, { apellido: e.target.value })}
                      />
                    </label>
                    <label>
                      DNI
                      <input
                        value={alta.dni}
                        placeholder="Opcional"
                        inputMode="numeric"
                        onChange={(e) => actualizarAlta(r.identificador, { dni: e.target.value })}
                      />
                    </label>
                    <label>
                      Género
                      <select value={alta.genero} onChange={(e) => actualizarAlta(r.identificador, { genero: e.target.value })}>
                        <option value="">—</option>
                        {GENEROS.map((g) => (
                          <option key={g.value} value={g.value}>
                            {g.label === g.descripcion ? g.label : `${g.label} (${g.descripcion})`}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Fecha de nacimiento
                      <input
                        type="date"
                        value={alta.fecha_nacimiento}
                        max={new Date().toISOString().slice(0, 10)}
                        onChange={(e) => actualizarAlta(r.identificador, { fecha_nacimiento: e.target.value })}
                      />
                    </label>
                    <label className="alta-calle">
                      <input
                        type="checkbox"
                        checked={alta.situacion_de_calle}
                        onChange={(e) => actualizarAlta(r.identificador, { situacion_de_calle: e.target.checked })}
                      />
                      En situación de calle
                    </label>
                  </div>
                )}
              </div>
            );
          })}
          <p className="text-muted small">Si no ponés DNI, se le asigna uno provisorio.</p>
        </div>
      )}

      {preview.invalidas.length > 0 && (
        <div className="revision-block">
          <h3>Filas con errores (no se van a cargar)</h3>
          <ul>
            {preview.invalidas.map((f) => (
              <li key={f.fila}>
                Fila {f.fila}: {f.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="revision-footer">
        <p>
          Se van a cargar <strong>{cantFilas(resumen.filasACargar)}</strong>
          {aCrear.length > 0 && (
            <>
              {" "}y crear <strong>{aCrear.length} persona(s)</strong>
            </>
          )}
          {resumen.filasOmitidas > 0 && <>; se omiten {cantFilas(resumen.filasOmitidas)}</>}.
        </p>
        {pendientes.length > 0 && (
          <div className="alert alert-warning">Faltan {pendientes.length} coincidencia(s) por confirmar.</div>
        )}
        {faltanDatos.length > 0 && (
          <div className="alert alert-warning">Completá el nombre de: {faltanDatos.map((r) => r.identificador).join(", ")}.</div>
        )}
        {error && <div className="alert alert-error">{error}</div>}
        <div className="button-row">
          <button
            type="button"
            className="button button-primary"
            disabled={enviando || pendientes.length > 0 || faltanDatos.length > 0 || (resumen.filasACargar === 0 && aCrear.length === 0)}
            onClick={confirmar}
          >
            {enviando ? "Cargando..." : "Confirmar y cargar"}
          </button>
          <button type="button" className="button button-outline" onClick={onCancelar} disabled={enviando}>
            Cancelar
          </button>
        </div>
      </div>
    </section>
  );
}
