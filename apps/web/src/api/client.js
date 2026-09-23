import axios from "axios";

export const api = axios.create({ baseURL: "/api" });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("autoprint_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export function setAuthToken(token) {
  if (token) localStorage.setItem("autoprint_token", token);
  else localStorage.removeItem("autoprint_token");
}

export function getAuthToken() {
  return localStorage.getItem("autoprint_token");
}
