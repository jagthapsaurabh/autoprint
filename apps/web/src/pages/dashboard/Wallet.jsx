import { useEffect, useState } from "react";
import { api } from "../../api/client";

export default function Wallet() {
  const [data, setData] = useState(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await api.get("/shop/wallet");
    setData(data);
  };

  useEffect(() => {
    load();
  }, []);

  const withdraw = async () => {
    setBusy(true);
    try {
      await api.post("/shop/wallet/withdraw", amount ? { amount: Number(amount) } : {});
      setAmount("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <p>Loading...</p>;

  return (
    <div>
      <h2>Wallet</h2>
      <div className="wallet-balance">₹{data.balance.toFixed(2)}</div>
      <div className="withdraw-row">
        <input
          type="number"
          placeholder="Amount (blank = full balance)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <button className="btn btn-primary" onClick={withdraw} disabled={busy || data.balance <= 0}>
          {busy ? "Requesting..." : "Request withdrawal"}
        </button>
      </div>

      <h3>Recent transactions</h3>
      <div className="tx-table">
        {data.transactions.length === 0 && <p className="empty-state">No transactions yet.</p>}
        {data.transactions.map((tx) => (
          <div key={tx.id} className="tx-row">
            <span>{new Date(tx.createdAt).toLocaleString()}</span>
            <span>{tx.type}</span>
            <span className={tx.amount >= 0 ? "credit" : "debit"}>
              {tx.amount >= 0 ? "+" : ""}
              {tx.amount.toFixed(2)}
            </span>
            <span className="muted">{tx.note}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
