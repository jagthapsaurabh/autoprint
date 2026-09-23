import "dotenv/config";
import express from "express";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import cron from "node-cron";
import { Server as SocketIOServer } from "socket.io";

import { authRouter } from "./routes/auth.js";
import { shopRouter } from "./routes/shop.js";
import { publicRouter } from "./routes/public.js";
import { agentRouter } from "./routes/agent.js";
import { paymentRouter } from "./routes/payment.js";
import { cleanupOldFilesAndJobs } from "./lib/cleanup.js";

if (process.env.NODE_ENV === "production") {
  const insecureDefaults = [
    ["JWT_SECRET", "change-this-super-secret-in-production"],
  ];
  for (const [key, badValue] of insecureDefaults) {
    if (!process.env[key] || process.env[key] === badValue) {
      console.error(
        `\n[FATAL] Refusing to start in production with an insecure/default ${key}.\n` +
          `Set a strong, unique ${key} in apps/server/.env before deploying.\n`
      );
      process.exit(1);
    }
  }
}

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: "*" },
});

app.set("io", io);
app.set("trust proxy", 1); // needed for correct client IPs / rate limiting behind a reverse proxy

app.use(
  helmet({
    // Uploaded files (PDF/images) are served with Content-Disposition and
    // don't need a strict CSP applied to them; the API only returns JSON so
    // this is mainly here for the standard security headers (HSTS, no-sniff,
    // frameguard, etc).
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(compression());
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "10mb" }));
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// Basic abuse protection. The customer upload/payment endpoints are public
// (no login), so they're the most important to throttle.
const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down and try again shortly." },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts, please try again later." },
});

app.get("/api/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use("/api/auth", authLimiter, authRouter);
app.use("/api/shop", shopRouter);
app.use("/api/public", publicLimiter, publicRouter);
app.use("/api/agent", agentRouter);
app.use("/api/payment", publicLimiter, paymentRouter);

// 404 fallback for unknown API routes
app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

// In production, optionally serve the built web app (apps/web/dist) from
// this same server so a client only has to run one process. Run
// `npm run build` at the repo root first. If the dist folder doesn't exist
// (e.g. web is hosted separately, or you're in dev with Vite on :5173),
// this is silently skipped.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = process.env.WEB_DIST_DIR || path.join(__dirname, "../../web/dist");
if (fs.existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(WEB_DIST, "index.html"));
  });
  console.log(`Serving built web app from ${WEB_DIST}`);
}

// Centralized error handler — catches anything thrown/rejected in routes
// that wasn't already handled, so the client always gets clean JSON instead
// of a raw stack trace or a hung connection.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("[unhandled error]", err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

// Socket.io: shop dashboards & agents join a room per shop for live job updates
io.on("connection", (socket) => {
  socket.on("join:shop", (shopId) => {
    if (shopId) socket.join(`shop:${shopId}`);
  });
});

// Purge old uploaded files / finished job records daily so disk usage on the
// shop PC doesn't grow forever.
cron.schedule("0 3 * * *", () => {
  cleanupOldFilesAndJobs().catch((err) => console.error("[cleanup] failed:", err));
});
// Also run once shortly after boot in case the server restarts often.
setTimeout(() => cleanupOldFilesAndJobs().catch(() => {}), 30_000);

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`AutoPrint server listening on http://0.0.0.0:${PORT}`);
});
