import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Landing() {
  const { user, shop } = useAuth();
  return (
    <div className="landing">
      <header className="landing-hero">
        <div className="brand">🖨️ AutoPrint</div>
        <nav>
          {user ? (
            <Link className="btn btn-primary" to={shop ? "/dashboard" : "/"}>
              Go to Dashboard
            </Link>
          ) : (
            <>
              <Link className="btn btn-ghost" to="/login">
                Login
              </Link>
              <Link className="btn btn-primary" to="/register/shop">
                Start Free
              </Link>
            </>
          )}
        </nav>
      </header>

      <section className="hero-content">
        <h1>Silent, unattended printing for cyber cafés &amp; print shops</h1>
        <p>
          Customers scan your shop's QR, upload a file from their phone, pay online or at the
          counter, and it prints directly on your shop printer — no staff needed, no browser tab
          required.
        </p>
        <div className="hero-cta">
          <Link className="btn btn-primary btn-lg" to="/register/shop">
            Register your shop
          </Link>
          <Link className="btn btn-outline btn-lg" to="/register/student">
            I'm a customer
          </Link>
        </div>
      </section>

      <section className="features">
        <div className="feature-card">
          <h3>📱 Customer QR Upload</h3>
          <p>Customer scans your printed QR, uploads PDF/JPG/PNG, previews & crops before print.</p>
        </div>
        <div className="feature-card">
          <h3>💳 Pay Online or Cash</h3>
          <p>Charge per page with Color/Gray rates. Accept UPI/cards online or cash at counter.</p>
        </div>
        <div className="feature-card">
          <h3>🖥️ Shop Print Agent</h3>
          <p>Small background app on your Windows PC prints silently — no tab needs to stay open.</p>
        </div>
        <div className="feature-card">
          <h3>📋 Live Job Queue</h3>
          <p>See paid, pending, approved and printed jobs live with approval controls.</p>
        </div>
        <div className="feature-card">
          <h3>👛 Shop Wallet</h3>
          <p>Online payments settle to your shop wallet; withdraw anytime.</p>
        </div>
        <div className="feature-card">
          <h3>⚙️ Full Control</h3>
          <p>Set color/gray-only rules, default printer, approval-before-print and more.</p>
        </div>
      </section>

      <footer className="landing-footer">
        <p>Built for net cafés & print shop partners.</p>
      </footer>
    </div>
  );
}
