import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { useAuth } from "../../context/AuthContext";

export default function Settings() {
  const { shop, setShop } = useAuth();
  const [form, setForm] = useState(null);
  const [agent, setAgent] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get("/shop/me").then(({ data }) => {
      setForm(data.shop);
      setAgent(data.agent);
    });
  }, []);

  if (!form) return <p>Loading...</p>;

  const update = (k) => (e) => {
    const val = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [k]: val }));
  };

  const save = async (e) => {
    e.preventDefault();
    const { data } = await api.patch("/shop/settings", {
      printRule: form.printRule,
      paymentMode: form.paymentMode,
      approvalRequired: form.approvalRequired,
      colorRate: form.colorRate,
      grayRate: form.grayRate,
      upiId: form.upiId,
      defaultPrinterName: form.defaultPrinterName,
      colorPrinterName: form.colorPrinterName || "",
      grayPrinterName: form.grayPrinterName || "",
      name: form.name,
      address: form.address,
      whatsapp: form.whatsapp,
    });
    setForm(data.shop);
    setShop(data.shop);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const printers = agent?.printers ? JSON.parse(agent.printers) : [];

  return (
    <div>
      <h2>Shop Settings</h2>
      <form className="settings-form" onSubmit={save}>
        <fieldset>
          <legend>Shop profile</legend>
          <label>Shop name</label>
          <input value={form.name} onChange={update("name")} />
          <label>Address</label>
          <input value={form.address || ""} onChange={update("address")} />
          <label>WhatsApp (shown to customers)</label>
          <input value={form.whatsapp || ""} onChange={update("whatsapp")} />
        </fieldset>

        <fieldset>
          <legend>Print rule</legend>
          <select value={form.printRule} onChange={update("printRule")}>
            <option value="CUSTOMER_CHOICE">Customer Choice (Color or B&W)</option>
            <option value="ONLY_COLOR">Only Color Print</option>
            <option value="ONLY_GRAY">Only Gray / B&W Print</option>
          </select>

          <label>Default Printer (fallback for both modes)</label>
          <select value={form.defaultPrinterName || ""} onChange={update("defaultPrinterName")}>
            <option value="">Windows Default Printer</option>
            {printers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          <div className="field-row-2">
            <div>
              <label>Color printer (color jobs)</label>
              <select value={form.colorPrinterName || ""} onChange={update("colorPrinterName")}>
                <option value="">Use default printer</option>
                {printers.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Black &amp; white printer (B&amp;W jobs)</label>
              <select value={form.grayPrinterName || ""} onChange={update("grayPrinterName")}>
                <option value="">Use default printer</option>
                {printers.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="muted">
            Jobs are sent to the printer matching their mode — color jobs to the color printer,
            black &amp; white jobs to the B&amp;W printer. Leave one on "Use default printer" to
            fall back to the default printer above.
          </p>
        </fieldset>

        <fieldset>
          <legend>Payment</legend>
          <select value={form.paymentMode} onChange={update("paymentMode")}>
            <option value="NO_PAYMENT">No Payment — Direct Auto Print</option>
            <option value="CASH">Cash at Counter — Direct Auto Print</option>
            <option value="ONLINE">Online Pay — Direct Auto Print</option>
          </select>

          <label className="checkbox-row">
            <input type="checkbox" checked={form.approvalRequired} onChange={update("approvalRequired")} />
            Approval Before Print (job waits in queue until you approve)
          </label>

          <div className="field-row-2">
            <div>
              <label>Color rate (₹/page)</label>
              <input type="number" min={0} step="0.5" value={form.colorRate} onChange={update("colorRate")} />
            </div>
            <div>
              <label>Gray rate (₹/page)</label>
              <input type="number" min={0} step="0.5" value={form.grayRate} onChange={update("grayRate")} />
            </div>
          </div>

          <label>UPI ID (for payout / display QR)</label>
          <input value={form.upiId || ""} onChange={update("upiId")} placeholder="shopname@upi" />
        </fieldset>

        <button className="btn btn-primary" type="submit">
          Save settings
        </button>
        {saved && <span className="saved-tick">Saved ✓</span>}
      </form>
    </div>
  );
}
