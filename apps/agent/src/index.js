import axios from "axios";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadConfig } from "./config.js";
import { listPrinters, printFile, selectPrinter, osInfo } from "./printer.js";

const VERSION = "1.0.0";
const POLL_INTERVAL_MS = Number(process.env.AUTOPRINT_POLL_MS || 4000);
const HEARTBEAT_INTERVAL_MS = 30_000;
const TMP_DIR = path.join(os.tmpdir(), "autoprint-agent");

const { serverUrl, runtimeKey } = loadConfig();

if (!runtimeKey) {
  console.error(
    "\n[AutoPrint Agent] No runtime key configured.\n" +
      "Set AUTOPRINT_RUNTIME_KEY (and AUTOPRINT_SERVER_URL) as environment variables,\n" +
      "or create ~/.autoprint/agent-config.json with { \"serverUrl\": ..., \"runtimeKey\": ... }.\n" +
      "You can copy this from your AutoPrint shop dashboard -> Auto Print Agent page.\n"
  );
  process.exit(1);
}

const http = axios.create({
  baseURL: serverUrl,
  headers: { "x-runtime-key": runtimeKey },
  timeout: 20000,
});

fs.mkdirSync(TMP_DIR, { recursive: true });

async function handshake() {
  const printers = await listPrinters();
  try {
    await http.post("/api/agent/handshake", { printers, version: VERSION, osInfo: osInfo() });
    console.log(`[AutoPrint Agent] Connected to ${serverUrl}. Printers detected:`, printers);
  } catch (err) {
    console.error("[AutoPrint Agent] Handshake failed:", err.response?.data?.error || err.message);
  }
}

async function heartbeat() {
  try {
    await http.post("/api/agent/heartbeat", {});
  } catch (err) {
    console.error("[AutoPrint Agent] Heartbeat failed:", err.response?.data?.error || err.message);
  }
}

async function processQueue() {
  try {
    const { data } = await http.get("/api/agent/queue");
    for (const job of data.jobs) {
      await handleJob(job, data.settings);
    }
  } catch (err) {
    console.error("[AutoPrint Agent] Queue poll failed:", err.response?.data?.error || err.message);
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
    console.log(`[AutoPrint Agent] Downloading job ${job.id} (${job.fileName})...`);
    const response = await http.get(job.downloadUrl, { responseType: "arraybuffer" });
    fs.writeFileSync(localPath, response.data);

    await http.post(`/api/agent/jobs/${job.id}/status`, { status: "PRINTING" });

    // Per-mode printer: color jobs -> color printer, B&W jobs -> gray
    // printer, each falling back to the shop default, then Windows default.
    const printer = selectPrinter(job, settings);
    console.log(
      `[AutoPrint Agent] Printing ${job.fileName} x${job.copies} (${job.colorMode}) -> ${printer || "Windows default printer"}...`
    );
    await printFile(localPath, {
      printer,
      copies: job.copies,
      colorMode: job.colorMode,
    });

    await http.post(`/api/agent/jobs/${job.id}/status`, { status: "PRINTED" });
    console.log(`[AutoPrint Agent] ✅ Printed ${job.fileName}`);
  } catch (err) {
    console.error(`[AutoPrint Agent] ❌ Failed to print ${job.fileName}:`, err.message);
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
  console.log(`AutoPrint Agent v${VERSION} starting...`);
  console.log(`Server: ${serverUrl}`);
  await handshake();
  setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
  setInterval(processQueue, POLL_INTERVAL_MS);
  processQueue();
}

main();
