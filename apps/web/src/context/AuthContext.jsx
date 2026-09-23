import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, getAuthToken, setAuthToken } from "../api/client";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [shop, setShop] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const token = getAuthToken();
    if (!token) {
      setUser(null);
      setShop(null);
      setLoading(false);
      return;
    }
    try {
      const { data } = await api.get("/auth/me");
      setUser(data.user);
      setShop(data.shop);
    } catch (err) {
      setAuthToken(null);
      setUser(null);
      setShop(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    setAuthToken(data.token);
    setUser(data.user);
    setShop(data.shop);
    return data;
  };

  const registerShop = async (payload) => {
    const { data } = await api.post("/auth/register/shop", payload);
    setAuthToken(data.token);
    setUser(data.user);
    setShop(data.shop);
    return data;
  };

  const registerStudent = async (payload) => {
    const { data } = await api.post("/auth/register/student", payload);
    setAuthToken(data.token);
    setUser(data.user);
    setShop(null);
    return data;
  };

  const logout = () => {
    setAuthToken(null);
    setUser(null);
    setShop(null);
  };

  return (
    <AuthContext.Provider
      value={{ user, shop, loading, login, registerShop, registerStudent, logout, refresh, setShop }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
