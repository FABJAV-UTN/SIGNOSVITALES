import { useEffect, useRef, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { useAuth } from "./AuthContext";

const navItems = [
  { path: "/dashboard", label: "Inicio" },
  { path: "/personas/buscar", label: "Buscar Persona" },
  { path: "/personas/nueva", label: "Nueva Persona" },
  { path: "/personas/carga-masiva", label: "Carga Masiva de Personas" },
  { path: "/signos/registrar", label: "Registrar Signos" },
  { path: "/signos/carga-masiva", label: "Carga Masiva" },
  { path: "/operativo/config", label: "Operativo" },
  { path: "/kits/entregar", label: "Entregar Kit" },
  { path: "/kits/historial", label: "Historial Kits" },
];

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const { token, logout, isAdmin } = useAuth();
  const headerRef = useRef(null);

  // Publica la altura real de la navbar (cambia según el ancho) para los paneles "sticky".
  useEffect(() => {
    const el = headerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const actualizar = () =>
      document.documentElement.style.setProperty("--navbar-height", `${el.getBoundingClientRect().height}px`);
    actualizar();
    const observer = new ResizeObserver(actualizar);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <header className="navbar" ref={headerRef}>
      <div className="navbar-brand">
        <Link to="/dashboard" className="brand-link">
          Cruz Roja / Signos Vitales
        </Link>
        <button className="menu-button" onClick={() => setOpen((prev) => !prev)}>
          ☰
        </button>
      </div>
      <nav className={`navbar-menu ${open ? "open" : ""}`}>
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
            onClick={() => setOpen(false)}
          >
            {item.label}
          </NavLink>
        ))}
        {isAdmin && (
          <NavLink
            to="/historial"
            className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
            onClick={() => setOpen(false)}
          >
            Historial
          </NavLink>
        )}
        {token ? (
          <button className="button button-secondary" onClick={logout}>
            Cerrar sesión
          </button>
        ) : (
          <Link to="/login" className="button button-secondary" onClick={() => setOpen(false)}>
            Ingresar
          </Link>
        )}
      </nav>
    </header>
  );
}
