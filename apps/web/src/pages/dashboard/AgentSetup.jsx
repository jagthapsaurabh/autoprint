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
              <li>Copy your shop's runtime key below.</li>
              <li>Download &amp; install the AutoPrint Agent on the Windows PC connected to your printer.</li>
              <li>Paste the runtime key (or a <code>.env</code> file) when the agent asks, then start it.</li>
            </ol>
            <pre className="code-block">{envSnippet}</pre>
            <p className="muted">
              Runtime key: <code>{shop.runtimeKey}</code>
            </p>
            <a className="btn btn-outline" href="/downloads/AutoPrint-Agent-Setup.zip" download>
              Download Agent Setup
            </a>
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
