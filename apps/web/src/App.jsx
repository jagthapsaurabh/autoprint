import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import RegisterShop from "./pages/RegisterShop";
import RegisterStudent from "./pages/RegisterStudent";
import PrintPage from "./pages/PrintPage";
import DashboardLayout from "./pages/dashboard/DashboardLayout";
import Queue from "./pages/dashboard/Queue";
import Settings from "./pages/dashboard/Settings";
import AgentSetup from "./pages/dashboard/AgentSetup";
import Wallet from "./pages/dashboard/Wallet";
import ShopQr from "./pages/dashboard/ShopQr";

function RequireShop({ children }) {
  const { user, shop, loading } = useAuth();
  if (loading) return <div className="center-msg">Loading...</div>;
  if (!user || !shop) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register/shop" element={<RegisterShop />} />
          <Route path="/register/student" element={<RegisterStudent />} />
          <Route path="/print/:token" element={<PrintPage />} />
          <Route
            path="/dashboard"
            element={
              <RequireShop>
                <DashboardLayout />
              </RequireShop>
            }
          >
            <Route index element={<Queue />} />
            <Route path="settings" element={<Settings />} />
            <Route path="agent" element={<AgentSetup />} />
            <Route path="wallet" element={<Wallet />} />
            <Route path="qr" element={<ShopQr />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
