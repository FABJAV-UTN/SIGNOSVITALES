/** Resultado de una carga masiva (signos o kits) después de la revisión. */
export default function ResultadoCarga({ resultado, unidad = "fila(s) guardada(s)" }) {
  if (!resultado) return null;
  return (
    <section className="card card-secondary">
      <h2>Resultado de la carga</h2>
      <p>
        <strong>
          {resultado.ok} {unidad}
        </strong>
        {resultado.omitidas > 0 && <> · Filas no cargadas por decisión tuya: {resultado.omitidas}</>}
      </p>
      {resultado.creadas.length > 0 && (
        <div>
          <p>Personas creadas ({resultado.creadas.length}):</p>
          <ul>
            {resultado.creadas.map((p) => (
              <li key={p.id}>
                {p.nombre} {p.apellido} — DNI {p.dni}
                {p.provisorio ? " (sin DNI en la planilla: se asignó uno provisorio)" : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      {resultado.errores.length > 0 ? (
        <div>
          <p>Errores encontrados:</p>
          <ul>
            {resultado.errores.map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p>No se encontraron errores.</p>
      )}
    </section>
  );
}
