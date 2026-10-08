/** "DNI 30123456" o "Sin DNI" (el DNI es opcional). */
export const textoDni = (persona) => (persona?.dni ? `DNI ${persona.dni}` : "Sin DNI");

/** "02/01/1980" a partir de "1980-01-02" (o "" si no hay fecha). */
export function fechaCorta(iso) {
  if (!iso) return "";
  const [anio, mes, dia] = String(iso).slice(0, 10).split("-");
  return anio && mes && dia ? `${dia}/${mes}/${anio}` : String(iso);
}
