import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { useAuth } from "../../context/AuthContext";

export default function AgentSetup() {
  const { shop, setShop } = useAuth();
  const [agent, setAgent] = useState(null);
  const [activating, setActivating] = useState(false);
  const serverBase = window.location.origin;

  const load = async () => {
    const { data } = await api.get("/shop/me");
    setAgent(data.agent);
    setShop(data.shop);
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activateSubscription = async () => {
    setActivating(true);
    try {
      await api.post("/shop/subscription/activate");
      await load();
    } finally {
      setActivating(false);
    }
  };

  const [downloading, setDownloading] = useState(false);
  const downloadAgent = async () => {
    setDownloading(true);
    try {
      // Authenticated download — the server builds the zip on demand and
      // pre-fills this shop's server URL + runtime key inside it.
      const resp = await api.get("/agent/package", { responseType: "blob", timeout: 10 * 60 * 1000 });
      const url = URL.createObjectURL(resp.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = "AutoPrint-Agent-Setup.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (err) {
      let msg =
        "Download failed. The first download can take a few minutes (the server prepares the package) — wait a bit and try again.";
      const payload = err.response?.data;
      if (payload instanceof Blob) {
        try {
          msg = JSON.parse(await payload.text()).error || msg;
        } catch {}
      } else if (payload?.error) {
        msg = payload.error;
      }
      alert(msg);
    } finally {
      setDownloading(false);
    }
  };

  if (!shop) return <p>Loading...</p>;

  const printers = agent?.printers ? JSON.parse(agent.printers) : [];
  const isOnline =
    agent?.online && agent?.lastSeenAt && Date.now() - new Date(agent.lastSeenAt).getTime() < 60_000;

  const envSnippet = `AUTOPRINT_SERVER_URL=${serverBase}\nAUTOPRINT_RUNTIME_KEY=${shop.runtimeKey}`;

  return (
    <div>
      <h2>Auto Print Agent</h2>

      {!shop.subscriptionActive && (
        <div className="upgrade-card">
          <h3>Activate Auto Print — ₹499/mo</h3>
          <p>
            Unlocks the customer QR, silent shop-PC printing agent, payment collection and print
            approval queue.
          </p>
          <button className="btn btn-primary" onClick={activateSubscription} disabled={activating}>
            {activating ? "Activating..." : "Activate Auto Print"}
          </button>
        </div>
      )}

      {shop.subscriptionActive && (
        <>
          <div className={`agent-status ${isOnline ? "online" : "offline"}`}>
            <span className="dot" /> Agent is {isOnline ? "Online" : "Offline"}
            {agent?.lastSeenAt && <span className="muted"> · last seen {new Date(agent.lastSeenAt).toLocaleTimeString()}</span>}
          </div>

          <div className="step-card">
            <h3>Step 1 — Install the agent on your shop PC</h3>
            <ol>
              <li>Download the agent package below — it contains everything (no Node.js / npm needed on the shop PC).</li>
              <li>On the shop PC, unzip it somewhere you will keep (e.g. Desktop).</li>
              <li>
                Double-click <strong>Start AutoPrint Agent.bat</strong> and keep the window open.
                Your server URL and runtime key are already saved inside the package — nothing to type.
              </li>
            </ol>
            <button className="btn btn-outline" onClick={downloadAgent} disabled={downloading}>
              {downloading ? "Preparing package… (first time can take a few minutes)" : "Download Agent Package (.zip)"}
            </button>
            {downloading && (
              <p className="muted">The server is preparing the package (first download also fetches the portable Node.js runtime — be patient, don't close this tab).</p>
            )}
            <p className="muted">
              Need to change the server or key later? Use <strong>Change Server Settings.bat</strong> inside the
              package. Runtime key: <code>{shop.runtimeKey}</code>
            </p>
            <details>
              <summary className="muted">Advanced: manual setup (.env / environment variables)</summary>
              <pre className="code-block">{envSnippet}</pre>
            </details>
          </div>

          <div className="step-card">
            <h3>Step 2 — Printers detected by agent</h3>
            {printers.length === 0 && <p className="muted">No printers reported yet. Start the agent to detect them.</p>}
            <ul>
              {printers.map((p) => (
                <li key={p}>
                  🖨️ {p} {p === shop.defaultPrinterName && <strong> (default)</strong>}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
