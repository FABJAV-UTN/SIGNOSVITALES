import { GENEROS } from "../utils/genero";

/** Opción única de género: V / M / No binario. Un segundo click en la opción marcada la limpia. */
export default function GeneroSelector({ value, onChange, name = "genero" }) {
  return (
    <fieldset className="choice-group">
      <legend>Género</legend>
      <div className="choice-options" role="radiogroup">
        {GENEROS.map((g) => (
          <label key={g.value} className={`choice-pill ${value === g.value ? "selected" : ""}`} title={g.descripcion}>
            <input
              type="radio"
              name={name}
              value={g.value}
              checked={value === g.value}
              onChange={() => onChange(g.value)}
              onClick={() => value === g.value && onChange("")}
            />
            <span className="choice-label">{g.label}</span>
            {g.label !== g.descripcion && <span className="choice-hint">{g.descripcion}</span>}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
