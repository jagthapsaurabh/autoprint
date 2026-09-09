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
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [copies, setCopies] = useState(1);
  const [colorMode, setColorMode] = useState("GRAY");
  const [quote, setQuote] = useState(null);
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [showCrop, setShowCrop] = useState(false);
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

  const onPickFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setErrorMsg("");
    if (f.type.startsWith("image/")) setPreviewUrl(URL.createObjectURL(f));
    else setPreviewUrl(null);
  };

  const getQuote = async () => {
    if (!file) return;
    setBusy(true);
    setErrorMsg("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("copies", copies);
      fd.append("colorMode", colorMode);
      const { data } = await api.post(`/public/shop/${token}/quote`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setQuote(data);
      setStep(STEP.PREVIEW);
    } catch (err) {
      setErrorMsg(err.response?.data?.error || "Failed to process file");
    } finally {
      setBusy(false);
    }
  };

  const createJob = async (overridePaid) => {
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

  return (
    <div className="print-page">
      <header className="print-header">
        <h1>🖨️ {shop.name}</h1>
        <p>Upload your file, preview, and send it straight to the shop printer.</p>
      </header>

      {errorMsg && <div className="error-banner">{errorMsg}</div>}

      {step === STEP.UPLOAD && (
        <div className="upload-card">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"
            onChange={onPickFile}
          />
          {previewUrl && (
            <div className="preview-block">
              <img className="file-preview" src={previewUrl} alt="preview" />
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowCrop(true)}>
                ✂️ Crop image
              </button>
            </div>
          )}
          {file && !previewUrl && <div className="file-chip">📄 {file.name}</div>}
          {showCrop && (
            <CropModal
              imageSrc={previewUrl}
              fileType={file?.type}
              fileName={file?.name || "cropped.jpg"}
              onCancel={() => setShowCrop(false)}
              onDone={(croppedFile) => {
                setShowCrop(false);
                if (croppedFile) {
                  setFile(croppedFile);
                  setPreviewUrl(URL.createObjectURL(croppedFile));
                }
              }}
            />
          )}

          <div className="field-row">
            <label>Copies</label>
            <input
              type="number"
              min={1}
              max={50}
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

          <button className="btn btn-primary btn-lg" disabled={!file || busy} onClick={getQuote}>
            {busy ? "Processing..." : "Continue"}
          </button>
        </div>
      )}

      {step === STEP.PREVIEW && quote && (
        <div className="upload-card">
          <h3>Confirm your print</h3>
          <ul className="summary-list">
            <li>File: {quote.fileName}</li>
            <li>Pages: {quote.pages}</li>
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
