import { useRef, useState } from "react";
import { combinarArchivos, leerArchivo } from "../utils/cargaMultiple";

/**
 * Hook para cargar varios Excel: se pueden agregar de a uno o muchos juntos, quitar
 * alguno o vaciar la lista. Cada cambio llama a `onCambio(combinado)` con todas las
 * filas juntas ({ rows, origenes, repetidas }), o con null si no queda ningún archivo útil.
 */
export default function useArchivosExcel(procesar, onCambio) {
  const [archivos, setArchivos] = useState([]);
  const [leyendo, setLeyendo] = useState(false);
  const archivosRef = useRef(archivos);

  function aplicar(lista, notificar = true) {
    archivosRef.current = lista;
    setArchivos(lista);
    if (!notificar) return;
    const combinado = combinarArchivos(lista);
    onCambio(combinado.rows.length ? combinado : null);
  }

  async function agregar(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setLeyendo(true);
    try {
      const leidos = await Promise.all(files.map((f) => leerArchivo(f, procesar)));
      const actuales = archivosRef.current;
      const ids = new Set(actuales.map((a) => a.id));
      // El mismo archivo elegido dos veces se ignora.
      aplicar([...actuales, ...leidos.filter((a) => !ids.has(a.id) && ids.add(a.id))]);
    } finally {
      setLeyendo(false);
    }
  }

  return {
    archivos,
    leyendo,
    agregar,
    quitar: (id) => aplicar(archivosRef.current.filter((a) => a.id !== id)),
    // limpiar(false): vacía la lista sin volver a revisar (ej. después de cargar).
    limpiar: (notificar = true) => aplicar([], notificar),
  };
}
