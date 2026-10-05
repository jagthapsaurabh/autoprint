import axios from "axios";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { loadConfig } from "./config.js";
import { listPrinters, printFile, selectPrinter, osInfo } from "./printer.js";
import { startStatusServer } from "./statusPage.js";

const VERSION = "1.0.0";
const POLL_INTERVAL_MS = Number(process.env.AUTOPRINT_POLL_MS || 4000);
const HEARTBEAT_INTERVAL_MS = 30_000;
const TMP_DIR = path.join(os.tmpdir(), "autoprint-agent");

// ---------------------------------------------------------------------------
// Logging — also written to agent.log next to the agent so a shop owner can
// simply send us that file when something goes wrong.
// ---------------------------------------------------------------------------
const LOG_FILE = path.join(process.cwd(), "agent.log");
const MAX_LOG_BYTES = 1024 * 1024; // roll the log over at ~1MB

function formatArg(a) {
  if (a instanceof Error) return a.message;
  if (typeof a === "string") return a;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

function appendLog(line) {
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > MAX_LOG_BYTES) {
      fs.writeFileSync(LOG_FILE, "");
    }
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${line}\n`);
  } catch {
    // logging must never take the agent down
  }
}

function log(...args) {
  console.log(...args);
  appendLog(args.map(formatArg).join(" "));
}

function logError(...args) {
  console.error(...args);
  appendLog(args.map(formatArg).join(" "));
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const { serverUrl, runtimeKey } = loadConfig();

if (!runtimeKey) {
  console.error(
    "\n[AutoPrint Agent] No runtime key configured.\n" +
      "Set AUTOPRINT_SERVER_URL / AUTOPRINT_RUNTIME_KEY as environment variables,\n" +
      "or run 'Change Server Settings.bat' (in this folder) to enter them,\n" +
      "or create ~/.autoprint/agent-config.json with { \"serverUrl\": ..., \"runtimeKey\": ... }.\n" +
      "The runtime key is on your AutoPrint shop dashboard -> Auto Print Agent page.\n"
  );
  process.exit(1);
}

const http = axios.create({
  baseURL: serverUrl,
  headers: { "x-runtime-key": runtimeKey },
  timeout: 20000,
});

fs.mkdirSync(TMP_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Live state (shown on the local status page)
// ---------------------------------------------------------------------------
const state = {
  connected: false,
  serverUrl,
  printers: [],
  lastJob: null,
  lastError: null,
  startedAt: new Date().toISOString(),
  version: VERSION,
};

let statusUrl = null;
let browserOpened = false;

function openInBrowser(url) {
  try {
    let child;
    if (process.platform === "win32") child = spawn("cmd.exe", ["/c", "start", "", url]);
    else if (process.platform === "darwin") child = spawn("open", [url]);
    else child = spawn("xdg-open", [url]);
    child.on("error", () => {}); // no browser available (headless etc.) — not fatal
    child.unref();
  } catch {
    // never fatal
  }
}

function maybeOpenStatusPage() {
  if (statusUrl && !browserOpened) {
    browserOpened = true;
    openInBrowser(statusUrl);
  }
}

// ---------------------------------------------------------------------------
// Server interactions
// ---------------------------------------------------------------------------
async function handshake() {
  const printers = await listPrinters();
  try {
    await http.post("/api/agent/handshake", { printers, version: VERSION, osInfo: osInfo() });
    state.connected = true;
    state.printers = printers;
    state.lastError = null;
    log(`[AutoPrint Agent] Connected to ${serverUrl}. Printers detected:`, printers);
  } catch (err) {
    state.connected = false;
    state.lastError = String(err.response?.data?.error || err.message);
    logError("[AutoPrint Agent] Handshake failed:", state.lastError);
  } finally {
    maybeOpenStatusPage();
  }
}

async function heartbeat() {
  try {
    await http.post("/api/agent/heartbeat", {});
  } catch (err) {
    state.connected = false;
    state.lastError = String(err.response?.data?.error || err.message);
    logError("[AutoPrint Agent] Heartbeat failed:", state.lastError);
  }
}

let pollFailures = 0;
async function processQueue() {
  try {
    const { data } = await http.get("/api/agent/queue");
    pollFailures = 0;
    if (!state.connected) {
      state.connected = true;
      state.lastError = null;
    }
    for (const job of data.jobs) {
      await handleJob(job, data.settings);
    }
  } catch (err) {
    pollFailures += 1;
    const msg = String(err.response?.data?.error || err.message);
    logError("[AutoPrint Agent] Queue poll failed:", msg);
    if (pollFailures >= 3) {
      state.connected = false;
      state.lastError = msg;
    }
  }
}

const EXT_BY_MIME = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

function extensionFor(job) {
  // Jobs are merged server-side into a single PDF, so fileType is the
  // reliable source of truth for the extension — job.fileName is often a
  // human-readable label like "3 files (a.jpg, b.png, c.pdf)" for multi-file
  // jobs and must NOT be used with path.extname() (it would incorrectly
  // grab ".pdf)" from inside that label).
  return EXT_BY_MIME[job.fileType] || ".pdf";
}

async function handleJob(job, settings) {
  const localPath = path.join(TMP_DIR, `${job.id}${extensionFor(job)}`);
  try {
    log(`[AutoPrint Agent] Downloading job ${job.id} (${job.fileName})...`);
    const response = await http.get(job.downloadUrl, { responseType: "arraybuffer" });
    fs.writeFileSync(localPath, response.data);

    await http.post(`/api/agent/jobs/${job.id}/status`, { status: "PRINTING" });

    // Per-mode printer: color jobs -> color printer, B&W jobs -> gray
    // printer, each falling back to the shop default, then Windows default.
    const printer = selectPrinter(job, settings);
    log(
      `[AutoPrint Agent] Printing ${job.fileName} x${job.copies} (${job.colorMode}) -> ${printer || "Windows default printer"}...`
    );
    await printFile(localPath, {
      printer,
      copies: job.copies,
      colorMode: job.colorMode,
    });

    await http.post(`/api/agent/jobs/${job.id}/status`, { status: "PRINTED" });
    state.lastJob = { fileName: job.fileName, status: "Printed", at: new Date().toISOString() };
    log(`[AutoPrint Agent] ✅ Printed ${job.fileName}`);
  } catch (err) {
    state.lastJob = { fileName: job.fileName, status: "Failed", at: new Date().toISOString() };
    logError(`[AutoPrint Agent] ❌ Failed to print ${job.fileName}:`, err.message);
    try {
      await http.post(`/api/agent/jobs/${job.id}/status`, {
        status: "FAILED",
        failureReason: err.message?.slice(0, 200),
      });
    } catch {}
  } finally {
    fs.unlink(localPath, () => {});
  }
}

async function main() {
  log(`AutoPrint Agent v${VERSION} starting...`);
  log(`Server: ${serverUrl}`);

  // Local status page (127.0.0.1 only) — the friendly UI for non-technical
  // users; the launcher bat hides the console window.
  const status = await startStatusServer({
    port: Number(process.env.AUTOPRINT_STATUS_PORT || 4173),
    getState: () => state,
    onOpen: (url) => {
      statusUrl = url;
    },
  });
  if (status) {
    log(`[AutoPrint Agent] Status page ready: ${status.url}`);
  } else {
    log("[AutoPrint Agent] Status page unavailable (no free local port) — agent still works.");
  }

  await handshake();
  setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
  setInterval(processQueue, POLL_INTERVAL_MS);
  processQueue();
}

main();
