import { createContext, useContext, useEffect, useState } from "react";
import api from "../api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [role, setRole] = useState(localStorage.getItem("role") || "");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (token) {
      localStorage.setItem("token", token);
      localStorage.setItem("role", role);
      api.defaults.headers.common.Authorization = `Bearer ${token}`;
    } else {
      localStorage.removeItem("token");
      localStorage.removeItem("role");
      delete api.defaults.headers.common.Authorization;
    }
    setLoading(false);
  }, [token, role]);

  async function login(username, password) {
    const response = await api.post("/auth/login", { username, password });
    setToken(response.data.access_token);
    setRole(response.data.role);
    return response.data;
  }

  function logout() {
    setToken("");
    setRole("");
  }

  const value = {
    token,
    role,
    isAdmin: role === "admin",
    login,
    logout,
    loading,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
