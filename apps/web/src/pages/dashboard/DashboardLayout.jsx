import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

export default function DashboardLayout() {
  const { user, shop, logout } = useAuth();
  const navigate = useNavigate();

  const doLogout = () => {
    logout();
    navigate("/");
  };

  return (
    <div className="dashboard">
      <aside className="dashboard-sidebar">
        <div className="brand">🖨️ AutoPrint</div>
        <div className="shop-name">{shop?.name}</div>
        <nav>
          <NavLink to="/dashboard" end>
            Queue
          </NavLink>
          <NavLink to="/dashboard/agent">Auto Print Agent</NavLink>
          <NavLink to="/dashboard/settings">Settings</NavLink>
          <NavLink to="/dashboard/wallet">Wallet</NavLink>
          <NavLink to="/dashboard/qr">Shop QR</NavLink>
        </nav>
        <div className="sidebar-footer">
          <div className="user-chip">{user?.fullName}</div>
          <button className="btn btn-ghost" onClick={doLogout}>
            Logout
          </button>
        </div>
      </aside>
      <main className="dashboard-main">
        <Outlet />
      </main>
    </div>
  );
}
