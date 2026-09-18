import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./components/AuthContext";
import Navbar from "./components/Navbar";
import Login from "./components/Login";
import Dashboard from "./components/Dashboard";
import RegistrarPersona from "./components/RegistrarPersona";
import BuscarPersona from "./components/BuscarPersona";
import RegistrarSignos from "./components/RegistrarSignos";
import ConfigurarOperativo from "./components/ConfigurarOperativo";
import EntregarKit from "./components/EntregarKit";
import HistorialKits from "./components/HistorialKits";
import Historial from "./components/Historial";
import CargaMasivaSignos from "./components/CargaMasivaSignos";
import CargaMasivaPersonas from "./components/CargaMasivaPersonas";
import "./App.css";

function ProtectedRoute({ children }) {
  const { token, loading } = useAuth();
  if (loading) return <div className="page-shell">Cargando sesión...</div>;
  return token ? children : <Navigate to="/login" replace />;
}

function AdminRoute({ children }) {
  const { isAdmin, loading } = useAuth();
  if (loading) return <div className="page-shell">Cargando sesión...</div>;
  return isAdmin ? children : <Navigate to="/dashboard" replace />;
}

function AppRoutes() {
  return (
    <BrowserRouter>
      <Navbar />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/personas/nueva"
          element={
            <ProtectedRoute>
              <RegistrarPersona />
            </ProtectedRoute>
          }
        />
        <Route
          path="/personas/buscar"
          element={
            <ProtectedRoute>
              <BuscarPersona />
            </ProtectedRoute>
          }
        />
        <Route
          path="/signos/registrar"
          element={
            <ProtectedRoute>
              <RegistrarSignos />
            </ProtectedRoute>
          }
        />
        <Route
          path="/personas/carga-masiva"
          element={
            <ProtectedRoute>
              <CargaMasivaPersonas />
            </ProtectedRoute>
          }
        />
        <Route
          path="/signos/carga-masiva"
          element={
            <ProtectedRoute>
              <CargaMasivaSignos />
            </ProtectedRoute>
          }
        />
        <Route
          path="/operativo/config"
          element={
            <ProtectedRoute>
              <ConfigurarOperativo />
            </ProtectedRoute>
          }
        />
        <Route
          path="/kits/entregar"
          element={
            <ProtectedRoute>
              <EntregarKit />
            </ProtectedRoute>
          }
        />
        <Route
          path="/kits/historial"
          element={
            <ProtectedRoute>
              <HistorialKits />
            </ProtectedRoute>
          }
        />
        <Route
          path="/historial"
          element={
            <ProtectedRoute>
              <AdminRoute>
                <Historial />
              </AdminRoute>
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}

export default App;
