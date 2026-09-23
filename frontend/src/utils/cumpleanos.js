// Cálculo de próximos cumpleaños a partir de la fecha de nacimiento ("AAAA-MM-DD").

const MS_DIA = 24 * 60 * 60 * 1000;

const esBisiesto = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Fecha del cumpleaños en un año dado. Quien nació un 29/02 lo festeja el 28/02 en años no bisiestos. */
function cumpleEnAnio(mes, dia, anio) {
  if (mes === 2 && dia === 29 && !esBisiesto(anio)) return new Date(anio, 1, 28);
  return new Date(anio, mes - 1, dia);
}

/**
 * Devuelve { fecha, dias, edad } del próximo cumpleaños (hoy cuenta como 0 días),
 * o null si la fecha de nacimiento no es válida.
 */
export function proximoCumple(fechaNacimiento, hoy = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fechaNacimiento || "");
  if (!m) return null;
  const [anioNac, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const base = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  let anio = base.getFullYear();
  let fecha = cumpleEnAnio(mes, dia, anio);
  if (fecha < base) {
    anio += 1;
    fecha = cumpleEnAnio(mes, dia, anio);
  }
  const dias = Math.round((fecha - base) / MS_DIA);
  return { fecha, dias, edad: anio - anioNac };
}

/** Personas con fecha de nacimiento, ordenadas del cumpleaños más cercano al más lejano. */
export function ordenarPorCumple(personas, hoy = new Date()) {
  return personas
    .map((p) => ({ persona: p, cumple: proximoCumple(p.fecha_nacimiento, hoy) }))
    .filter((x) => x.cumple)
    .sort(
      (a, b) =>
        a.cumple.dias - b.cumple.dias ||
        a.persona.apellido.localeCompare(b.persona.apellido, "es") ||
        a.persona.nombre.localeCompare(b.persona.nombre, "es")
    );
}

export function textoDias(dias) {
  if (dias === 0) return "¡Hoy!";
  if (dias === 1) return "Mañana";
  return `En ${dias} días`;
}
