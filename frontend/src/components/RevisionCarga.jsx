import { useMemo, useState } from "react";
import api from "../api";
import { GENEROS } from "../utils/genero";
import { fechaCorta, textoDni } from "../utils/persona";

const listaFilas = (filas) => (filas.length === 1 ? `fila ${filas[0]}` : `filas ${filas.join(", ")}`);
const cantFilas = (n) => `${n} ${n === 1 ? "fila" : "filas"}`;
const nombrePlanilla = (r) => [r.nombre_sugerido, r.apellido_sugerido].filter(Boolean).join(" ");

function detalleError(err, porDefecto) {
  const detail = err.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((e) => e.msg).join(" — ");
  return porDefecto;
}

/**
 * Datos de la planilla (DNI, fecha de nacimiento) que difieren de los de la persona elegida.
 * "completar": la persona no lo tiene. "cambiar": la persona tiene otro valor.
 * El DNI no se propone si ya lo tiene otra persona de la base.
 */
function cambiosPara(r, persona) {
  if (!persona) return [];
  const cambios = [];
  if (r.dni && r.dni !== persona.dni && (!r.dni_en_uso_por || r.dni_en_uso_por === persona.id)) {
    cambios.push({ campo: "dni", valor: r.dni, actual: persona.dni, tipo: persona.dni ? "cambiar" : "completar" });
  }
  if (r.fecha_nacimiento && r.fecha_nacimiento !== persona.fecha_nacimiento) {
    cambios.push({
      campo: "fecha_nacimiento",
      valor: r.fecha_nacimiento,
      actual: persona.fecha_nacimiento,
      tipo: persona.fecha_nacimiento ? "cambiar" : "completar",
    });
  }
  return cambios;
}

// Por defecto se completa lo que falta y se actualiza la fecha de nacimiento.
// Cambiar un DNI que ya estaba cargado queda destildado: hay que confirmarlo a mano.
const marcadoPorDefecto = (cambio) => !(cambio.campo === "dni" && cambio.tipo === "cambiar");

function textoCambio(c) {
  const etiqueta = c.campo === "dni" ? "DNI" : "fecha de nacimiento";
  const mostrar = (v) => (c.campo === "dni" ? v : fechaCorta(v));
  return c.tipo === "completar"
    ? `Completar ${etiqueta}: ${mostrar(c.valor)}`
    : `Cambiar ${etiqueta}: ${mostrar(c.actual)} → ${mostrar(c.valor)}`;
}

/**
 * Paso de revisión de una carga masiva (personas, signos o kits):
 * 1) confirma a quién corresponde cada persona dudosa (nombre parecido, homónimo o DNI de otro),
 * 2) ofrece completar/actualizar el DNI y la fecha de nacimiento de las personas que ya existen,
 * 3) lista a los que no están y deja tildar a quién crear,
 * 4) aplica los cambios, crea las personas y (si hay `endpoint`) manda las filas con la persona resuelta.
 */
export default function RevisionCarga({ data, preview, endpoint, onCancelar, onTerminado }) {
  const aConfirmar = preview.identificadores.filter((r) => ["sugerencia", "ambigua", "conflicto_dni"].includes(r.estado));
  const exactas = preview.identificadores.filter((r) => r.estado === "exacta");

  // Respuesta para cada coincidencia: id de persona (texto), "nueva", "omitir" o "" (sin responder).
  const [decisiones, setDecisiones] = useState(() => Object.fromEntries(aConfirmar.map((r) => [r.identificador, ""])));
  // Tildes de "completar / actualizar datos": clave identificador|persona|campo.
  const [marcas, setMarcas] = useState({});
  // Datos para dar de alta a quien no está en la base.
  const [altas, setAltas] = useState(() => {
    const filaPorNumero = Object.fromEntries(data.rows.map((row) => [row.fila, row]));
    return Object.fromEntries(
      preview.identificadores
        .filter((r) => r.estado !== "exacta")
        .map((r) => {
          const filas = r.filas.map((f) => filaPorNumero[f]).filter(Boolean);
          const primero = (campo) => filas.map((f) => f[campo]).find((v) => v !== null && v !== undefined && v !== "");
          return [
            r.identificador,
            {
              crear: true,
              unir: Boolean(r.parecido_a),
              nombre: r.nombre_sugerido || "",
              apellido: r.apellido_sugerido || "",
              // Si el DNI de la planilla ya lo tiene otra persona, no se puede repetir.
              dni: r.dni_en_uso_por ? "" : r.dni || "",
              genero: primero("genero") || "",
              fecha_nacimiento: r.fecha_nacimiento || "",
              situacion_de_calle: Boolean(primero("situacion_de_calle")),
            },
          ];
        })
    );
  });
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

  // Persona elegida para cada grupo (las exactas y las confirmadas).
  const elegidas = [];
  exactas.forEach((r) => elegidas.push({ r, persona: r.persona }));
  aConfirmar.forEach((r) => {
    const d = decisiones[r.identificador];
    const persona = r.candidatos.find((c) => String(c.id) === d);
    if (persona) elegidas.push({ r, persona });
  });
  const conCambios = elegidas
    .map(({ r, persona }) => ({ r, persona, cambios: cambiosPara(r, persona) }))
    .filter((x) => x.cambios.length > 0);
  const claveMarca = (r, persona, c) => `${r.identificador}|${persona.id}|${c.campo}`;
  const estaMarcado = (r, persona, c) => marcas[claveMarca(r, persona, c)] ?? marcadoPorDefecto(c);
  const cambiosMarcados = conCambios.flatMap(({ r, persona, cambios }) =>
    cambios.filter((c) => estaMarcado(r, persona, c)).map((c) => ({ persona, ...c }))
  );

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

  const personasAActualizar = new Set(cambiosMarcados.map((c) => c.persona.id)).size;
  const hayAlgoParaHacer = endpoint
    ? resumen.filasACargar > 0 || aCrear.length > 0 || cambiosMarcados.length > 0
    : aCrear.length > 0 || cambiosMarcados.length > 0;

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
      // 1) Completar / actualizar DNI y fecha de nacimiento de personas existentes.
      let actualizadas = 0;
      if (cambiosMarcados.length > 0) {
        const porPersona = {};
        cambiosMarcados.forEach((c) => {
          porPersona[c.persona.id] = { ...(porPersona[c.persona.id] || { persona_id: c.persona.id }), [c.campo]: c.valor };
        });
        const res = await api.post("/personas/actualizar", { cambios: Object.values(porPersona) });
        actualizadas = res.data.ok;
        errores.push(...(res.data.errores || []));
      }

      // 2) Personas por identificador: las que ya existen y las confirmadas.
      const personaPor = {};
      elegidas.forEach(({ r, persona }) => {
        personaPor[r.identificador] = persona.id;
      });

      // 3) Crear las personas tildadas.
      let creadas = [];
      if (aCrear.length > 0) {
        const filasAlta = aCrear.map((r) => {
          const a = altas[r.identificador];
          return {
            nombre: a.nombre.trim(),
            apellido: a.apellido.trim(),
            dni: a.dni.trim() || null,
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
          return c;
        });
      }
      noEncontradas.forEach((r) => {
        const destino = destinoUnion(r);
        if (destino && personaPor[destino]) personaPor[r.identificador] = personaPor[destino];
      });

      // 4) Armar las filas con la persona ya resuelta (solo signos y kits).
      let ok = creadas.length + actualizadas;
      let omitidas = 0;
      if (endpoint) {
        const identPorFila = {};
        preview.identificadores.forEach((r) => r.filas.forEach((f) => (identPorFila[f] = r.identificador)));
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

        ok = 0;
        if (filas.length > 0) {
          // Se reenvían los campos generales del payload (ej. operativo_id / lugar_custom en signos).
          const res = await api.post(endpoint, { ...data, rows: filas });
          ok = res.data.ok;
          errores.push(...(res.data.errores || []));
        }
      }
      onTerminado({ ok, errores, creadas, omitidas, actualizadas });
    } catch (err) {
      setError(detalleError(err, "No se pudo completar la carga."));
    } finally {
      setEnviando(false);
    }
  }

  function preguntaConfirmacion(r) {
    if (r.estado === "conflicto_dni" && r.dni_en_uso_por) {
      const duenio = r.candidatos.find((c) => c.id === r.dni_en_uso_por);
      return (
        <>
          El DNI {r.dni} ya es de <strong>{duenio ? `${duenio.nombre} ${duenio.apellido}` : "otra persona"}</strong>, pero
          la planilla dice “{nombrePlanilla(r) || "sin nombre"}”. ¿Quién es?
        </>
      );
    }
    if (r.estado === "conflicto_dni") {
      return <>Hay una persona con ese nombre pero con otro DNI (la planilla dice {r.dni}). ¿Es la misma persona?</>;
    }
    if (r.estado === "ambigua") return "Hay más de una persona con ese nombre. ¿Cuál es?";
    return "¿Es alguna de estas personas?";
  }

  return (
    <section className="card revision">
      <h2>Revisión antes de cargar</h2>
      <div className="chip-row">
        <span className="chip">{cantFilas(preview.total_filas)}</span>
        <span className="chip chip-ok">{exactas.length} persona(s) encontradas</span>
        {aConfirmar.length > 0 && <span className="chip chip-warn">{aConfirmar.length} a confirmar</span>}
        {conCambios.length > 0 && <span className="chip chip-warn">{conCambios.length} con datos para completar</span>}
        {noEncontradas.length > 0 && <span className="chip chip-new">{noEncontradas.length} no están en la base</span>}
        {preview.invalidas.length > 0 && <span className="chip chip-error">{cantFilas(preview.invalidas.length)} con errores</span>}
      </div>

      {aConfirmar.length > 0 && (
        <div className="revision-block">
          <h3>Coincidencias a confirmar</h3>
          <p className="text-muted">
            Estas personas no coinciden exacto con nadie de la base, o el DNI no cuadra con el nombre. Elegí quién es cada una.
          </p>
          {aConfirmar.map((r) => (
            <fieldset key={r.identificador} className={`match-card ${decisiones[r.identificador] ? "" : "match-pending"}`}>
              <legend>
                <strong>“{r.identificador}”</strong>{" "}
                <span className="text-muted">
                  · {cantFilas(r.filas.length)} ({listaFilas(r.filas)})
                </span>
              </legend>
              <p className="match-question">{preguntaConfirmacion(r)}</p>
              {r.candidatos.map((c) => (
                <label key={c.id} className="radio-line">
                  <input
                    type="radio"
                    name={`m-${r.identificador}`}
                    checked={decisiones[r.identificador] === String(c.id)}
                    onChange={() => setDecisiones((d) => ({ ...d, [r.identificador]: String(c.id) }))}
                  />
                  <span>
                    Sí, es <strong>{c.nombre} {c.apellido}</strong> <span className="text-muted">— {textoDni(c)}</span>
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
                <span>
                  No, es otra persona (pasa a la lista de personas que no están en la base
                  {r.dni_en_uso_por ? "; se crea sin ese DNI" : ""})
                </span>
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

      {conCambios.length > 0 && (
        <div className="revision-block">
          <h3>Datos para completar o actualizar</h3>
          <p className="text-muted">
            La planilla trae datos que estas personas no tienen (o tienen distinto). Destildá lo que no quieras cambiar.
          </p>
          {conCambios.map(({ r, persona, cambios }) => (
            <div key={`${r.identificador}|${persona.id}`} className="match-card">
              <p>
                <strong>
                  {persona.nombre} {persona.apellido}
                </strong>{" "}
                <span className="text-muted">
                  · {textoDni(persona)} · {listaFilas(r.filas)}
                </span>
              </p>
              {cambios.map((c) => (
                <label key={c.campo} className="radio-line">
                  <input
                    type="checkbox"
                    checked={estaMarcado(r, persona, c)}
                    onChange={(e) => setMarcas((m) => ({ ...m, [claveMarca(r, persona, c)]: e.target.checked }))}
                  />
                  <span>
                    {textoCambio(c)}
                    {c.campo === "dni" && c.tipo === "cambiar" && (
                      <span className="text-muted small"> (ya tenía DNI cargado: confirmá que el de la planilla es el correcto)</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
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
                      <input
                        value={alta.nombre}
                        placeholder={r.nombre_sugerido ? "" : "Completar"}
                        onChange={(e) => actualizarAlta(r.identificador, { nombre: e.target.value })}
                      />
                    </label>
                    <label>
                      Apellido
                      <input value={alta.apellido} onChange={(e) => actualizarAlta(r.identificador, { apellido: e.target.value })} />
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
          <p className="text-muted small">
            DNI y fecha de nacimiento son opcionales: si no los ponés, quedan en blanco y se pueden completar después desde
            la ficha de la persona o con otra planilla.
          </p>
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
          {endpoint ? (
            <>
              Se van a cargar <strong>{cantFilas(resumen.filasACargar)}</strong>
            </>
          ) : (
            <>Personas que ya estaban: {exactas.length}</>
          )}
          {aCrear.length > 0 && (
            <>
              {endpoint ? " y crear " : "; se van a crear "}
              <strong>{aCrear.length} persona(s)</strong>
            </>
          )}
          {personasAActualizar > 0 && (
            <>
              ; se actualizan datos de <strong>{personasAActualizar} persona(s)</strong>
            </>
          )}
          {endpoint && resumen.filasOmitidas > 0 && <>; se omiten {cantFilas(resumen.filasOmitidas)}</>}.
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
            disabled={enviando || pendientes.length > 0 || faltanDatos.length > 0 || !hayAlgoParaHacer}
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
