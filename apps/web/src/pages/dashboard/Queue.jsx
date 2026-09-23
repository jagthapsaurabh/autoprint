import { useEffect, useState, useCallback } from "react";
import { io } from "socket.io-client";
import { api } from "../../api/client";
import { useAuth } from "../../context/AuthContext";

const STATUS_LABEL = {
  AWAITING_PAYMENT: "Awaiting payment",
  QUEUED: "Queued",
  PENDING_APPROVAL: "Needs approval",
  APPROVED: "Approved",
  PRINTING: "Printing",
  PRINTED: "Printed",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

export default function Queue() {
  const { shop } = useAuth();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data } = await api.get("/shop/jobs");
    setJobs(data.jobs);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!shop?.id) return;
    const socket = io("/", { path: "/socket.io" });
    socket.emit("join:shop", shop.id);
    socket.on("job:new", () => load());
    socket.on("job:updated", () => load());
    const interval = setInterval(load, 8000);
    return () => {
      socket.disconnect();
      clearInterval(interval);
    };
  }, [shop?.id, load]);

  const approve = async (id) => {
    await api.post(`/shop/jobs/${id}/approve`);
    load();
  };
  const reject = async (id) => {
    await api.post(`/shop/jobs/${id}/reject`);
    load();
  };
  const remove = async (id) => {
    await api.delete(`/shop/jobs/${id}`);
    load();
  };

  if (loading) return <p>Loading...</p>;

  return (
    <div>
      <h2>Print Queue</h2>
      <p className="muted">Jobs auto-refresh live. Delete old jobs anytime — files also purge automatically.</p>
      {jobs.length === 0 && <p className="empty-state">No print jobs yet. Share your shop QR to get started.</p>}
      <div className="job-table">
        {jobs.map((job) => (
          <div key={job.id} className={`job-row status-${job.status.toLowerCase()}`}>
            <div className="job-main">
              <strong>{job.fileName}</strong>
              <span className="muted">
                {job.pages} pg × {job.copies} • {job.colorMode} • ₹{job.amount}
                {job.paymentStatus === "PAY_AT_COUNTER" && " (collect cash)"} •{" "}
                {job.customerName || "Guest"}
              </span>
            </div>
            <div className={`badge badge-${job.status.toLowerCase()}`}>{STATUS_LABEL[job.status]}</div>
            <div className="job-actions">
              {job.status === "PENDING_APPROVAL" && (
                <>
                  <button className="btn btn-primary btn-sm" onClick={() => approve(job.id)}>
                    Approve
                  </button>
                  <button className="btn btn-outline btn-sm" onClick={() => reject(job.id)}>
                    Reject
                  </button>
                </>
              )}
              <button className="btn btn-ghost btn-sm" onClick={() => remove(job.id)}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
