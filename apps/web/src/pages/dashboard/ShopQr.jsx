import { useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { api } from "../../api/client";
import { useAuth } from "../../context/AuthContext";

export default function ShopQr() {
  const { shop, setShop } = useAuth();
  const [busy, setBusy] = useState(false);
  const printUrl = `${window.location.origin}/print/${shop?.shopToken}`;

  const regenerate = async () => {
    if (!confirm("This will invalidate your old QR code. Continue?")) return;
    setBusy(true);
    try {
      const { data } = await api.post("/shop/qr/regenerate");
      setShop(data.shop);
    } finally {
      setBusy(false);
    }
  };

  const downloadQr = () => {
    const canvas = document.getElementById("shop-qr-canvas");
    const link = document.createElement("a");
    link.download = `${shop.name}-autoprint-qr.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  if (!shop) return <p>Loading...</p>;

  return (
    <div>
      <h2>Shop QR Code</h2>
      <p className="muted">Print this QR and stick it at your counter. Customers scan it to upload files.</p>
      <div className="qr-card">
        <QRCodeCanvas id="shop-qr-canvas" value={printUrl} size={240} includeMargin />
        <p className="print-url">{printUrl}</p>
        <div className="btn-row">
          <button className="btn btn-primary" onClick={downloadQr}>
            Download PNG
          </button>
          <button className="btn btn-outline" onClick={regenerate} disabled={busy}>
            {busy ? "Regenerating..." : "Regenerate QR"}
          </button>
        </div>
      </div>
    </div>
  );
}
