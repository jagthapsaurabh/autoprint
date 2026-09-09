import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function RegisterShop() {
  const { registerShop } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    whatsapp: "",
    password: "",
    shopName: "",
    address: "",
    shopWhatsapp: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await registerShop(form);
      navigate("/dashboard");
    } catch (err) {
      setError(err.response?.data?.error || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <h2>Partner / Shop registration</h2>
        {error && <div className="error-banner">{error}</div>}
        <label>Full name</label>
        <input value={form.fullName} onChange={update("fullName")} required />
        <label>Email</label>
        <input type="email" value={form.email} onChange={update("email")} required />
        <label>Your WhatsApp</label>
        <input value={form.whatsapp} onChange={update("whatsapp")} />
        <label>Password</label>
        <input type="password" value={form.password} onChange={update("password")} required minLength={6} />
        <hr />
        <label>Shop name</label>
        <input value={form.shopName} onChange={update("shopName")} required />
        <label>Shop address</label>
        <input value={form.address} onChange={update("address")} />
        <label>Shop WhatsApp (shown to customers)</label>
        <input value={form.shopWhatsapp} onChange={update("shopWhatsapp")} />
        <button className="btn btn-primary" disabled={loading} type="submit">
          {loading ? "Creating..." : "Create shop account"}
        </button>
        <p className="auth-alt">
          Already have an account? <Link to="/login">Login</Link>
        </p>
      </form>
    </div>
  );
}
