import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import { io } from "socket.io-client";
import CropModal from "../components/CropModal";

const STEP = {
  LOADING: "LOADING",
  SHOP_ERROR: "SHOP_ERROR",
  UPLOAD: "UPLOAD",
  PREVIEW: "PREVIEW",
  PAYING: "PAYING",
  DONE: "DONE",
};

let nextLocalId = 1;

function loadRazorpayScript() {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export default function PrintPage() {
  const { token } = useParams();
  const [step, setStep] = useState(STEP.LOADING);
  const [shopError, setShopError] = useState("");
  const [shop, setShop] = useState(null);
  // items: [{ localId, file, previewUrl, isImage }] — supports multiple
  // images and/or PDFs uploaded together and merged into one print job.
  const [items, setItems] = useState([]);
  const [copies, setCopies] = useState(1);
  const [colorMode, setColorMode] = useState("GRAY");
  const [quote, setQuote] = useState(null);
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [cropTargetId, setCropTargetId] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    api
      .get(`/public/shop/${token}`)
      .then(({ data }) => {
        setShop(data.shop);
        setColorMode(data.shop.printRule === "ONLY_COLOR" ? "COLOR" : "GRAY");
        setStep(STEP.UPLOAD);
      })
      .catch((err) => {
        setShopError(err.response?.data?.error || "Unable to load shop");
        setStep(STEP.SHOP_ERROR);
      });
  }, [token]);

  // Poll job status once created, and also listen on socket for instant updates
  useEffect(() => {
    if (!job?.id) return;
    const socket = io("/", { path: "/socket.io" });
    let interval;
    const poll = async () => {
      try {
        const { data } = await api.get(`/public/jobs/${job.id}`);
        setJob(data.job);
        if (["PRINTED", "FAILED", "CANCELLED"].includes(data.job.status)) {
          clearInterval(interval);
        }
      } catch {}
    };
    interval = setInterval(poll, 3000);
    poll();
    return () => {
      clearInterval(interval);
      socket.disconnect();
    };
  }, [job?.id]);

  // Revoke object URLs on unmount to avoid leaking memory
  useEffect(() => {
    return () => {
      items.forEach((it) => it.previewUrl && URL.revokeObjectURL(it.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPickFiles = (e) => {
    const picked = Array.from(e.target.files || []);
    if (!picked.length) return;
    setErrorMsg("");
    const newItems = picked.map((f) => ({
      localId: nextLocalId++,
      file: f,
      previewUrl: f.type.startsWith("image/") ? URL.createObjectURL(f) : null,
      isImage: f.type.startsWith("image/"),
    }));
    setItems((prev) => [...prev, ...newItems]);
    e.target.value = ""; // allow picking the same file again later
  };

  const removeItem = (localId) => {
    setItems((prev) => {
      const target = prev.find((it) => it.localId === localId);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((it) => it.localId !== localId);
    });
  };

  const moveItem = (localId, direction) => {
    setItems((prev) => {
      const idx = prev.findIndex((it) => it.localId === localId);
      const swapWith = idx + direction;
      if (idx < 0 || swapWith < 0 || swapWith >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[swapWith]] = [copy[swapWith], copy[idx]];
      return copy;
    });
  };

  const getQuote = async () => {
    if (!items.length) return;
    setBusy(true);
    setErrorMsg("");
    try {
      const fd = new FormData();
      items.forEach((it) => fd.append("files", it.file));
      fd.append("copies", copies);
      fd.append("colorMode", colorMode);
      const { data } = await api.post(`/public/shop/${token}/quote`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setQuote(data);
      setStep(STEP.PREVIEW);
    } catch (err) {
      setErrorMsg(err.response?.data?.error || "Failed to process file(s)");
    } finally {
      setBusy(false);
    }
  };

  const createJob = async () => {
    const { data } = await api.post(`/public/shop/${token}/jobs`, {
      fileToken: quote.fileToken,
      fileName: quote.fileName,
      fileType: quote.fileType,
      pages: quote.pages,
      copies,
      colorMode,
      amount: quote.amount,
      customerName,
    });
    return data.job;
  };

  const handlePrintNow = async () => {
    setBusy(true);
    setErrorMsg("");
    try {
      const createdJob = await createJob();
      if (createdJob.status === "AWAITING_PAYMENT") {
        setJob(createdJob);
        setStep(STEP.PAYING);
        await startPayment(createdJob);
      } else {
        setJob(createdJob);
        setStep(STEP.DONE);
      }
    } catch (err) {
      setErrorMsg(err.response?.data?.error || "Failed to submit print job");
    } finally {
      setBusy(false);
    }
  };

  const startPayment = async (jobRecord) => {
    try {
      const { data: orderData } = await api.post("/payment/order", { jobId: jobRecord.id });
      if (orderData.mode === "manual") {
        // Demo mode: no gateway keys configured on the server.
        setErrorMsg(orderData.message);
        return;
      }
      const ok = await loadRazorpayScript();
      if (!ok) {
        setErrorMsg("Could not load payment gateway. Check your internet connection.");
        return;
      }
      const rzp = new window.Razorpay({
        key: orderData.keyId,
        amount: orderData.order.amount,
        currency: "INR",
        name: shop?.name || "AutoPrint",
        description: "Print job payment",
        order_id: orderData.order.id,
        handler: async (response) => {
          try {
            const { data } = await api.post("/payment/verify", {
              jobId: jobRecord.id,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            });
            setJob(data.job);
            setStep(STEP.DONE);
          } catch (err) {
            setErrorMsg("Payment verification failed. Contact the shop.");
          }
        },
        theme: { color: "#4f46e5" },
      });
      rzp.open();
    } catch (err) {
      setErrorMsg(err.response?.data?.error || "Could not start payment");
    }
  };

  const confirmManualPayment = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/payment/verify", { jobId: job.id, manualConfirm: true });
      setJob(data.job);
      setStep(STEP.DONE);
    } catch (err) {
      setErrorMsg(err.response?.data?.error || "Failed to confirm payment");
    } finally {
      setBusy(false);
    }
  };

  const startOver = () => {
    items.forEach((it) => it.previewUrl && URL.revokeObjectURL(it.previewUrl));
    setItems([]);
    setQuote(null);
    setJob(null);
    setErrorMsg("");
    setStep(STEP.UPLOAD);
  };

  if (step === STEP.LOADING) {
    return <div className="print-page center-msg">Loading shop...</div>;
  }
  if (step === STEP.SHOP_ERROR) {
    return (
      <div className="print-page center-msg error">
        <h2>⚠️ {shopError}</h2>
        <p>Please ask the shop to check their Auto Print subscription or QR code.</p>
      </div>
    );
  }

  const cropTarget = items.find((it) => it.localId === cropTargetId);

  return (
    <div className="print-page">
      <header className="print-header">
        <h1>🖨️ {shop.name}</h1>
        <p>Upload one or more files — photos and PDFs can be combined into a single print job.</p>
      </header>

      {errorMsg && <div className="error-banner">{errorMsg}</div>}

      {step === STEP.UPLOAD && (
        <div className="upload-card">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            onChange={onPickFiles}
          />
          <p className="hint">You can select multiple photos and/or PDFs — pick more anytime with the button above.</p>

          {items.length > 0 && (
            <div className="file-list">
              {items.map((it, idx) => (
                <div className="file-list-item" key={it.localId}>
                  <span className="file-list-index">{idx + 1}</span>
                  {it.previewUrl ? (
                    <img className="file-list-thumb" src={it.previewUrl} alt={it.file.name} />
                  ) : (
                    <div className="file-list-thumb file-list-thumb-pdf">📄</div>
                  )}
                  <div className="file-list-meta">
                    <strong>{it.file.name}</strong>
                    <span className="muted">{(it.file.size / 1024).toFixed(0)} KB</span>
                  </div>
                  <div className="file-list-actions">
                    {it.isImage && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCropTargetId(it.localId)}>
                        ✂️
                      </button>
                    )}
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => moveItem(it.localId, -1)} disabled={idx === 0}>
                      ↑
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => moveItem(it.localId, 1)} disabled={idx === items.length - 1}>
                      ↓
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeItem(it.localId)}>
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {cropTarget && (
            <CropModal
              imageSrc={cropTarget.previewUrl}
              fileType={cropTarget.file.type}
              fileName={cropTarget.file.name}
              onCancel={() => setCropTargetId(null)}
              onDone={(croppedFile) => {
                setCropTargetId(null);
                if (croppedFile) {
                  setItems((prev) =>
                    prev.map((it) =>
                      it.localId === cropTarget.localId
                        ? (() => {
                            URL.revokeObjectURL(it.previewUrl);
                            return { ...it, file: croppedFile, previewUrl: URL.createObjectURL(croppedFile) };
                          })()
                        : it
                    )
                  );
                }
              }}
            />
          )}

          <div className="field-row">
            <label>Copies (of the whole set)</label>
            <input
              type="number"
              min={1}
              max={200}
              value={copies}
              onChange={(e) => setCopies(Math.max(1, parseInt(e.target.value || "1", 10)))}
            />
          </div>

          {shop.printRule === "CUSTOMER_CHOICE" && (
            <div className="field-row">
              <label>Print mode</label>
              <div className="toggle-group">
                <button
                  className={colorMode === "GRAY" ? "active" : ""}
                  onClick={() => setColorMode("GRAY")}
                  type="button"
                >
                  Black &amp; White
                </button>
                <button
                  className={colorMode === "COLOR" ? "active" : ""}
                  onClick={() => setColorMode("COLOR")}
                  type="button"
                >
                  Color
                </button>
              </div>
            </div>
          )}
          {shop.printRule !== "CUSTOMER_CHOICE" && (
            <div className="hint">
              This shop only accepts {shop.printRule === "ONLY_COLOR" ? "Color" : "Black & White"} prints.
            </div>
          )}

          <div className="field-row">
            <label>Your name (optional)</label>
            <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="e.g. Rahul" />
          </div>

          <button className="btn btn-primary btn-lg" disabled={!items.length || busy} onClick={getQuote}>
            {busy ? "Processing..." : `Continue with ${items.length || 0} file${items.length === 1 ? "" : "s"}`}
          </button>
        </div>
      )}

      {step === STEP.PREVIEW && quote && (
        <div className="upload-card">
          <h3>Confirm your print</h3>
          <ul className="summary-list">
            <li>Files: {quote.fileCount} ({quote.sourceFileNames?.join(", ")})</li>
            <li>Total pages: {quote.pages}</li>
            <li>Copies: {copies}</li>
            <li>Mode: {colorMode === "COLOR" ? "Color" : "Black & White"}</li>
            <li className="amount">Amount: ₹{quote.amount}</li>
          </ul>
          {quote.amount > 0 ? (
            <p className="hint">You'll be asked to pay before the print job is sent.</p>
          ) : (
            <p className="hint">No payment needed — this will print immediately.</p>
          )}
          <div className="btn-row">
            <button className="btn btn-ghost" onClick={() => setStep(STEP.UPLOAD)}>
              Back
            </button>
            <button className="btn btn-primary btn-lg" disabled={busy} onClick={handlePrintNow}>
              {busy ? "Please wait..." : quote.amount > 0 ? "Pay & Print" : "Send to Printer"}
            </button>
          </div>
        </div>
      )}

      {step === STEP.PAYING && (
        <div className="upload-card center-msg">
          <p>Waiting for payment...</p>
          {errorMsg && job && (
            <button className="btn btn-primary" onClick={confirmManualPayment} disabled={busy}>
              {busy ? "Confirming..." : "I've paid — Confirm (demo mode)"}
            </button>
          )}
        </div>
      )}

      {step === STEP.DONE && job && (
        <div className="upload-card">
          <h3>Job status</h3>
          <JobStatusView job={job} />
          {["PRINTED", "FAILED", "CANCELLED"].includes(job.status) && (
            <button className="btn btn-outline" onClick={startOver}>
              Print another file
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function JobStatusView({ job }) {
  const labels = {
    AWAITING_PAYMENT: "Awaiting payment...",
    QUEUED: "Queued for printing...",
    PENDING_APPROVAL: "Waiting for shop approval...",
    APPROVED: "Approved, about to print...",
    PRINTING: "Printing now...",
    PRINTED: "✅ Printed! Please collect from the counter.",
    FAILED: `❌ Print failed${job.failureReason ? `: ${job.failureReason}` : ""}`,
    CANCELLED: "Cancelled by shop.",
  };
  return (
    <div className={`job-status status-${job.status.toLowerCase()}`}>
      <div className="spinner" style={{ display: ["PRINTED", "FAILED", "CANCELLED"].includes(job.status) ? "none" : "block" }} />
      <p>{labels[job.status] || job.status}</p>
    </div>
  );
}
