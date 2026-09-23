import { Link } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { AvisoCumpleanos } from "./Cumpleanos";

export default function Dashboard() {
  const { isAdmin } = useAuth();
  return (
    <main className="page-shell">
      <section className="card">
        <h1>Panel de Control</h1>
        <p className="text-muted">Seleccione una acción rápida para registrar y revisar el operativo.</p>
        <AvisoCumpleanos />
        <div className="grid cards-grid">
          <Link to="/personas/nueva" className="card-action">
            Nueva persona
          </Link>
          <Link to="/personas/buscar" className="card-action">
            Buscar persona
          </Link>
          <Link to="/signos/registrar" className="card-action">
            Registrar signos
          </Link>
          <Link to="/operativo/config" className="card-action">
            Configurar operativo
          </Link>
          <Link to="/kits/entregar" className="card-action">
            Entregar kit
          </Link>
          <Link to="/kits/carga-masiva" className="card-action">
            Carga masiva de kits
          </Link>
          <Link to="/cumpleanos" className="card-action">
            Cumpleaños
          </Link>
          <Link to="/kits/historial" className="card-action">
            Historial de kits
          </Link>
          {isAdmin && (
            <Link to="/historial" className="card-action">
              Historial administrativo
            </Link>
          )}
        </div>
      </section>
    </main>
  );
}
