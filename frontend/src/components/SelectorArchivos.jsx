const cantFilas = (n) => `${n} ${n === 1 ? "fila" : "filas"}`;

/** Selector de varios Excel con la lista de archivos cargados y sus problemas. */
export default function SelectorArchivos({ carga, repetidas = [] }) {
  const { archivos, leyendo, agregar, quitar, limpiar } = carga;
  const conError = archivos.filter((a) => a.error);
  const totalFilas = archivos.reduce((s, a) => s + a.rows.length, 0);

  return (
    <div className="selector-archivos">
      <label style={{ marginTop: "1rem" }}>
        {archivos.length ? "Agregar más archivos Excel" : "Seleccionar uno o varios archivos Excel"}
        <input
          type="file"
          accept=".xls,.xlsx"
          multiple
          onChange={(e) => {
            agregar(e.target.files);
            // Permite volver a elegir el mismo archivo después de quitarlo.
            e.target.value = "";
          }}
        />
      </label>
      <p className="text-muted small">
        Podés elegir varios a la vez (Ctrl o Shift al seleccionar) o ir agregándolos de a uno. Se revisan todos juntos:
        una persona que aparece en varias planillas se reconoce y se crea una sola vez.
      </p>
      {leyendo && <p className="text-muted">Leyendo archivos...</p>}

      {archivos.length > 0 && (
        <div className="archivos-lista">
          <div className="section-header">
            <p>
              <strong>{archivos.length}</strong> archivo(s) · {cantFilas(totalFilas)}
            </p>
            <button type="button" className="button button-outline button-small" onClick={() => limpiar()}>
              Quitar todos
            </button>
          </div>
          <ul>
            {archivos.map((a) => (
              <li key={a.id} className={a.error ? "archivo-error" : ""}>
                <span>
                  <strong>{a.nombre}</strong>{" "}
                  <span className="text-muted">— {a.error ? `no se carga: ${a.error}` : cantFilas(a.rows.length)}</span>
                </span>
                <button type="button" className="button-link" onClick={() => quitar(a.id)} title="Quitar este archivo">
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {conError.length > 0 && (
        <div className="alert alert-error">
          {conError.length === 1 ? "Un archivo no se pudo usar" : `${conError.length} archivos no se pudieron usar`}; el
          resto se revisa igual.
        </div>
      )}

      {repetidas.length > 0 && (
        <details className="alert alert-warning">
          <summary>
            {cantFilas(repetidas.length)} repetida(s) entre archivos: se cargan una sola vez.
          </summary>
          <ul className="small">
            {repetidas.map((r) => (
              <li key={`${r.archivo}|${r.fila}`}>
                {r.archivo}, fila {r.fila} = {r.igualA.archivo}, fila {r.igualA.fila}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
