import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function RegisterStudent() {
  const { registerStudent } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ fullName: "", email: "", whatsapp: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await registerStudent(form);
      navigate("/");
    } catch (err) {
      setError(err.response?.data?.error || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <h2>Customer registration</h2>
        {error && <div className="error-banner">{error}</div>}
        <label>Full name</label>
        <input value={form.fullName} onChange={update("fullName")} required />
        <label>Email</label>
        <input type="email" value={form.email} onChange={update("email")} required />
        <label>WhatsApp number</label>
        <input value={form.whatsapp} onChange={update("whatsapp")} />
        <label>Password</label>
        <input type="password" value={form.password} onChange={update("password")} required minLength={6} />
        <button className="btn btn-primary" disabled={loading} type="submit">
          {loading ? "Creating..." : "Register"}
        </button>
        <p className="auth-alt">
          Own a shop? <Link to="/register/shop">Register as shop</Link>
        </p>
        <p className="auth-alt">
          Already have an account? <Link to="/login">Login</Link>
        </p>
        <p className="auth-alt small">
          Tip: you don't need an account to print — just scan the shop's QR code directly.
        </p>
      </form>
    </div>
  );
}
