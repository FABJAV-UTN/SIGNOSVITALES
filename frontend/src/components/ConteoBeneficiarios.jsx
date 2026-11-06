import { useEffect, useState } from "react";
import api from "../api";

function Stat({ valor, label }) {
  return (
    <div className="stat">
      <span className="stat-value">{valor}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

/**
 * Conteo de personas beneficiarias del período, por género, y de kits por tipo.
 * Usa las mismas fechas que el historial. Opciones para comparar con conteos a mano:
 * qué cuenta como atención (signos / kits) y si se cuentan personas distintas o atenciones.
 */
export default function ConteoBeneficiarios({ desde, hasta }) {
  const [incluirSignos, setIncluirSignos] = useState(true);
  const [incluirKits, setIncluirKits] = useState(true);
  const [modo, setModo] = useState("personas");
  const key = JSON.stringify({ desde, hasta, incluirSignos, incluirKits, modo });
  const [estado, setEstado] = useState({ key: null, datos: null, error: "" });

  useEffect(() => {
    let cancelado = false;
    const params = { incluir_signos: incluirSignos, incluir_kits: incluirKits, modo };
    if (desde) params.desde = desde;
    if (hasta) params.hasta = hasta;
    api
      .get("/reportes/conteo", { params })
      .then((res) => !cancelado && setEstado({ key, datos: res.data, error: "" }))
      .catch((err) => {
        if (cancelado) return;
        const detalle = err.response?.data?.detail;
        setEstado({ key, datos: null, error: typeof detalle === "string" ? detalle : "No se pudo calcular el conteo." });
      });
    return () => {
      cancelado = true;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const cargando = estado.key !== key;
  const d = estado.datos;
  const periodo = desde || hasta ? `del ${desde || "inicio"} al ${hasta || "hoy"}` : "de todo el historial";
  const queCuenta =
    incluirSignos && incluirKits ? "con signos o con kit" : incluirSignos ? "solo con signos" : incluirKits ? "solo con kit" : "nada elegido";
  const titulo = modo === "personas" ? "Personas atendidas" : "Atenciones";

  return (
    <div className="conteo-block">
      <h3>Conteo de personas beneficiarias</h3>

      <div className="conteo-opciones">
        <span className="text-muted small">Contar:</span>
        <label className="checkbox-label">
          <input type="checkbox" checked={incluirSignos} onChange={(e) => setIncluirSignos(e.target.checked)} />
          Signos
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={incluirKits} onChange={(e) => setIncluirKits(e.target.checked)} />
          Kits
        </label>
        <span className="conteo-separador" />
        <label className="checkbox-label">
          <input type="radio" name="modo-conteo" checked={modo === "personas"} onChange={() => setModo("personas")} />
          Personas distintas (sin repetir)
        </label>
        <label className="checkbox-label">
          <input type="radio" name="modo-conteo" checked={modo === "atenciones"} onChange={() => setModo("atenciones")} />
          Atenciones (si vino 4 veces, cuenta 4)
        </label>
      </div>

      <p className="text-muted small">
        {modo === "personas"
          ? `Personas distintas atendidas ${periodo} (${queCuenta}), cada una contada una sola vez.`
          : `Atenciones ${periodo} (${queCuenta}): una por persona y por día.`}
      </p>
      {estado.error && <div className="alert alert-error">{estado.error}</div>}
      {cargando && !d ? (
        <p className="text-muted">Calculando...</p>
      ) : (
        d && (
          <>
            <div className="conteo-grid">
              <Stat valor={d.personas.total} label={titulo} />
              <Stat valor={d.personas.mujeres} label="Mujeres" />
              <Stat valor={d.personas.varones} label="Varones" />
              {d.personas.no_binario > 0 && <Stat valor={d.personas.no_binario} label="No binario" />}
              <Stat valor={d.personas.sin_dato} label="Sin género cargado" />
            </div>
            <div className="conteo-grid">
              <Stat valor={d.kits.total} label="Kits entregados" />
              <Stat valor={d.kits.higiene} label="Kits de higiene (PPAAS)" />
              <Stat valor={d.kits.abrigo} label="Kits de abrigo" />
              <Stat valor={d.personas_con_kit} label="Personas que recibieron kit" />
            </div>

            {d.por_dia.length > 0 && (
              <details className="conteo-dias">
                <summary>Ver por día ({d.por_dia.length} día/s) — para comparar con cada planilla</summary>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Lugar</th>
                        <th className="num">Personas</th>
                        <th className="num">Mujeres</th>
                        <th className="num">Varones</th>
                        <th className="num">Sin género</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.por_dia.map((dia) => (
                        <tr key={dia.fecha}>
                          <td>{dia.fecha}</td>
                          <td>{dia.lugares}</td>
                          <td className="num">{dia.total}</td>
                          <td className="num">{dia.mujeres}</td>
                          <td className="num">{dia.varones}</td>
                          <td className="num">{dia.sin_dato + dia.no_binario}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </>
        )
      )}
    </div>
  );
}
