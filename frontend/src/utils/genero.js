// Géneros válidos del sistema. OJO: "M" significa MUJER (y "V", varón).
export const GENEROS = [
  { value: "V", label: "V", descripcion: "Varón" },
  { value: "M", label: "M", descripcion: "Mujer" },
  { value: "No binario", label: "No binario", descripcion: "No binario" },
];

const ALIASES = {
  v: "V",
  varon: "V",
  masculino: "V",
  hombre: "V",
  h: "V",
  m: "M",
  mujer: "M",
  femenino: "M",
  f: "M",
  "no binario": "No binario",
  "no-binario": "No binario",
  nobinario: "No binario",
  nb: "No binario",
  x: "No binario",
};

const clave = (value) =>
  value
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ");

/**
 * Convierte cualquier texto de género a "V" | "M" | "No binario".
 * Con `legacyMF: true`, "M" se interpreta como MASCULINO (planillas viejas que usan M/F).
 * Devuelve null si está vacío y el texto original si no se reconoce.
 */
export function normalizarGenero(value, { legacyMF = false } = {}) {
  if (value === null || value === undefined) return null;
  const k = clave(value);
  if (!k) return null;
  if (legacyMF && k === "m") return "V";
  return ALIASES[k] ?? value.toString().trim();
}

/** true si la lista de valores usa la convención vieja M/F (hay alguna "F" o "Femenino"). */
export function usaConvencionMF(valores) {
  return valores.some((v) => {
    if (v === null || v === undefined) return false;
    const k = clave(v);
    return k === "f" || k === "femenino";
  });
}

export function generoTexto(value) {
  const g = GENEROS.find((item) => item.value === value);
  return g ? g.descripcion : value || "No informado";
}
