import { useEffect, useState } from "react";
import api from "../api";
import { useAuth } from "./AuthContext";
import { ordenarPorCumple } from "../utils/cumpleanos";

const REFRESCO_MS = 30 * 60 * 1000; // cada 30 minutos, mientras la app está abierta

/**
 * Lista de personas con fecha de nacimiento, ordenada por cumpleaños más próximo.
 * Se vuelve a consultar cada 30 minutos y al volver a la pestaña del navegador.
 */
export default function useCumpleanos() {
  const { token } = useAuth();
  const [estado, setEstado] = useState({ lista: [], sinFecha: 0, cargado: false, error: "" });

  useEffect(() => {
    if (!token) return undefined;
    let cancelado = false;
    const cargar = () =>
      api
        .get("/personas")
        .then((res) => {
          if (cancelado) return;
          const lista = ordenarPorCumple(res.data);
          setEstado({ lista, sinFecha: res.data.length - lista.length, cargado: true, error: "" });
        })
        .catch(() => !cancelado && setEstado((e) => ({ ...e, cargado: true, error: "No se pudieron cargar los cumpleaños." })));
    cargar();
    const intervalo = setInterval(cargar, REFRESCO_MS);
    const alVolver = () => document.visibilityState === "visible" && cargar();
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      cancelado = true;
      clearInterval(intervalo);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [token]);

  const proximos = estado.lista.filter((x) => x.cumple.dias <= 7);
  return { ...estado, proximos, hoy: proximos.filter((x) => x.cumple.dias === 0) };
}
