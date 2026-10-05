// Builds and serves the "portable" AutoPrint Agent package for Windows.
//
// The zip a shop downloads contains everything needed to run the agent on a
// plain shop PC — no Node.js install, no npm, no compiler, no typing
// config into anything:
//
//   AutoPrint-Agent-Setup/
//   ├─ node/                          portable Node.js runtime (win-x64)
//   ├─ agent/                         agent code + pre-installed node_modules
//   ├─ agent-config.json              THIS shop's server URL + runtime key,
//   │                                  pre-filled server-side at download time
//   ├─ Start AutoPrint Agent.bat      double-click to run the agent
//   ├─ Change Server Settings.bat     re-enter server URL / runtime key
//   └─ README-START-HERE.txt          plain-English instructions
//
// Build strategy:
//   - The heavy, shop-independent part (portable Node + agent + deps) is
//     built ONCE into apps/agent/dist/portable-build (gitignored) and cached
//     while the agent source is unchanged (content hash marker).
//   - The only per-shop difference is agent-config.json, which is injected
//     into the zip stream at download time (never written into the shared
//     cache, so one shop's key can never leak into another shop's package).
//
// Config env vars:
//   AGENT_BUNDLE_NODE_VERSION   Node version to bundle (default: 22.22.3)
//   AGENT_NODE_DIST_BASE_URL    Node dist mirror base (default nodejs.org) —
//                               useful where nodejs.org is slow/blocked,
//                               e.g. https://cdn.npmmirror.com/binaries/node
//   AGENT_NODE_ZIP_PATH         offline mode: path to a local
//                               node-v<version>-win-x64.zip (no download)

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { ZipArchive } from "archiver";
import AdmZip from "adm-zip";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = path.resolve(__dirname, "../../../agent"); // apps/agent
const DIST_DIR = path.join(AGENT_DIR, "dist");
const STAGING_DIR = path.join(DIST_DIR, "portable-build");
const NODE_CACHE_DIR = path.join(DIST_DIR, "node-cache");
// Kept OUTSIDE STAGING_DIR so it is never part of the zipped bundle.
const BUNDLE_MARKER = path.join(DIST_DIR, ".portable-build-hash");

const NODE_VERSION = process.env.AGENT_BUNDLE_NODE_VERSION || "22.22.3";
const DIST_BASE = (process.env.AGENT_NODE_DIST_BASE_URL || "https://nodejs.org/dist").replace(/\/+$/, "");
const NODE_ZIP_NAME = `node-v${NODE_VERSION}-win-x64.zip`;
const ZIP_FILENAME = "AutoPrint-Agent-Setup.zip";

// ---------------------------------------------------------------------------
// Bundle file templates (plain ASCII, CRLF line endings for Windows)
// ---------------------------------------------------------------------------

const crlf = (s) => s.replace(/\n/g, "\r\n");

const START_BAT = crlf(`
@echo off
setlocal
set "ROOT=%~dp0"
cd /d "%ROOT%"

if not exist "agent-config.json" (
  echo No agent configuration found.
  echo Run "Change Server Settings.bat" first to enter the server URL and runtime key.
  pause
  exit /b 1
)

if not exist "node\\node.exe" (
  echo Error: node\\node.exe is missing from this folder.
  echo Re-download the agent package from your dashboard.
  pause
  exit /b 1
)

echo ============================================================
echo  AutoPrint Agent - prints jobs from your shop's server
echo  Keep this window open while the agent is running.
echo ============================================================
echo.

"node\\node.exe" "agent\\src\\index.js"

echo.
echo The agent has stopped. If it stopped with an error, read the
echo message above before starting it again.
pause
endlocal
`).trimStart();

const CHANGE_BAT = crlf(`
@echo off
setlocal
set "ROOT=%~dp0"
cd /d "%ROOT%"

echo ============================================================
echo  AutoPrint Agent - server configuration
echo ============================================================
echo.
set "URL="
set /p URL="Server URL (e.g. https://print.example.com or http://192.168.1.26:4000): "
if "%URL%"=="" (
  echo A server URL is required.
  pause
  exit /b 1
)
set "KEY="
set /p KEY="Runtime key (Dashboard - Auto Print Agent page): "
if "%KEY%"=="" (
  echo A runtime key is required.
  pause
  exit /b 1
)

> "agent-config.json" echo {"serverUrl": "%URL%", "runtimeKey": "%KEY%"}
echo.
echo Configuration saved to agent-config.json
echo Starting the agent now...
echo.

"node\\node.exe" "agent\\src\\index.js"
echo.
echo The agent has stopped.
pause
endlocal
`).trimStart();

const README_TXT = crlf(`
AUTO PRINT AGENT - START HERE
============================

What is this?
  This folder is the AutoPrint print agent. It runs on the shop's Windows
  PC, watches your shop's print queue on the server, and prints jobs
  automatically - no staff needed.

Setup (one time, about 1 minute)
  1. Unzip this file somewhere you will keep - for example your Desktop.
     (Right-click the zip -> "Extract All".)
  2. Double-click "Start AutoPrint Agent.bat" in the unzipped folder.
     Your server URL and runtime key are already saved inside the package,
     so it should connect immediately.
  3. Keep the black window open. When it says "Connected" and lists your
     printers, the agent is working.

Changing the server or runtime key later
  Double-click "Change Server Settings.bat" and type the new values
  (shown on your dashboard, Auto Print Agent page). It saves them and
  starts the agent automatically.

Windows / antivirus warnings
  Windows or your antivirus may warn about downloaded programs - that is
  normal for this kind of tool. Choose "More info" -> "Run", or allow it
  in your antivirus. If the antivirus quarantines node\\node.exe, add an
  exception for this folder.

Day to day
  - Start:   double-click "Start AutoPrint Agent.bat"
  - Stop:    close the agent window
  - Do NOT move or delete this folder while the agent is running.
  - After a PC restart, start the agent again. To make it start
    automatically with Windows: press Win+R, type "shell:startup" and
    press Enter, then put a shortcut of "Start AutoPrint Agent.bat" in
    that folder.

Troubleshooting
  - "Connected ... Printers detected: []" (no printers): make sure the
    printer is installed in Windows - Settings -> Bluetooth & devices ->
    Printers & scanners. Try restarting the agent after plugging in the
    printer cable.
  - "Handshake failed": the PC cannot reach the server. Check its
    internet/WiFi, and that the Server URL is correct. A LAN address
    (http://192.168.x.x:4000) works when the PC is on the same network
    as the server; a public https URL works from anywhere.
  - Printing failed for a job: the agent window shows the reason. Most
    often it is a printer problem (paper, offline) - fix it in Windows
    and the next job will print.
`).trimStart();

// ---------------------------------------------------------------------------
// Build plumbing
// ---------------------------------------------------------------------------

function friendlyError(userMessage) {
  return Object.assign(new Error(userMessage), { userMessage });
}

function computeFingerprint() {
  const hash = crypto.createHash("sha256");
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else {
        hash.update(p);
        hash.update(fs.readFileSync(p));
      }
    }
  };
  walk(path.join(AGENT_DIR, "src"));
  hash.update(fs.readFileSync(path.join(AGENT_DIR, "package.json")));
  hash.update(NODE_VERSION);
  return hash.digest("hex");
}

async function ensureNodeZip() {
  const localOverride = process.env.AGENT_NODE_ZIP_PATH;
  if (localOverride) {
    if (!fs.existsSync(localOverride)) {
      throw friendlyError(`AGENT_NODE_ZIP_PATH is set but ${localOverride} does not exist.`);
    }
    return localOverride;
  }
  fs.mkdirSync(NODE_CACHE_DIR, { recursive: true });
  const dest = path.join(NODE_CACHE_DIR, NODE_ZIP_NAME);
  if (fs.existsSync(dest)) return dest;

  const url = `${DIST_BASE}/v${NODE_VERSION}/${NODE_ZIP_NAME}`;
  console.log(`[agent-package] downloading portable Node ${NODE_VERSION} (win-x64) from ${url} ...`);
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw friendlyError(
      `Could not reach the Node.js download (${err.message}). Check the server's internet ` +
        `connection and try again, or set AGENT_NODE_ZIP_PATH to a local copy of ${NODE_ZIP_NAME} ` +
        `for offline builds.`
    );
  }
  if (!res.ok) {
    throw friendlyError(`Downloading portable Node failed (HTTP ${res.status} from ${url}). Try again, or set AGENT_NODE_ZIP_PATH to a local copy of ${NODE_ZIP_NAME}.`);
  }
  const part = `${dest}.part`;
  fs.writeFileSync(part, Buffer.from(await res.arrayBuffer()));
  fs.renameSync(part, dest);
  return dest;
}

async function buildBundle() {
  const hash = computeFingerprint();
  const cacheValid =
    fs.existsSync(BUNDLE_MARKER) &&
    fs.readFileSync(BUNDLE_MARKER, "utf-8") === hash &&
    fs.existsSync(path.join(STAGING_DIR, "node", "node.exe")) &&
    fs.existsSync(path.join(STAGING_DIR, "agent", "node_modules"));
  if (cacheValid) {
    console.log("[agent-package] using cached portable bundle");
    return;
  }

  console.log("[agent-package] building portable agent bundle (first build takes a few minutes)...");
  fs.rmSync(STAGING_DIR, { recursive: true, force: true });
  fs.mkdirSync(STAGING_DIR, { recursive: true });

  // 1. Portable Node.js runtime (win-x64), extracted into node/
  const nodeZip = await ensureNodeZip();
  const tmpExtract = path.join(STAGING_DIR, ".node-extract");
  fs.mkdirSync(tmpExtract);
  try {
    new AdmZip(nodeZip).extractAllTo(tmpExtract, true);
  } catch (err) {
    fs.rmSync(STAGING_DIR, { recursive: true, force: true });
    throw friendlyError(
      `The Node.js runtime zip is not a valid zip file (${err.message}). ` +
        (process.env.AGENT_NODE_ZIP_PATH
          ? `Check AGENT_NODE_ZIP_PATH (${process.env.AGENT_NODE_ZIP_PATH}).`
          : "The download may be corrupted — try again, or set AGENT_NODE_ZIP_PATH to a known-good node-v…-win-x64.zip.")
    );
  }
  const extractedDir = path.join(tmpExtract, `node-v${NODE_VERSION}-win-x64`);
  if (!fs.existsSync(extractedDir)) {
    fs.rmSync(STAGING_DIR, { recursive: true, force: true });
    throw friendlyError(
      `The downloaded Node zip does not look like ${NODE_ZIP_NAME}. ` +
        `Check AGENT_BUNDLE_NODE_VERSION / AGENT_NODE_ZIP_PATH.`
    );
  }
  fs.renameSync(extractedDir, path.join(STAGING_DIR, "node"));
  fs.rmSync(tmpExtract, { recursive: true, force: true });

  // 2. Agent code + pre-installed dependencies (all pure JS, so the tree
  //    installed here is identical to what runs on Windows).
  fs.mkdirSync(path.join(STAGING_DIR, "agent"));
  fs.cpSync(path.join(AGENT_DIR, "src"), path.join(STAGING_DIR, "agent", "src"), { recursive: true });
  fs.copyFileSync(path.join(AGENT_DIR, "package.json"), path.join(STAGING_DIR, "agent", "package.json"));
  // `shell` on Windows is needed because npm is a .cmd there; args are fixed
  // literals, so no injection surface.
  await execFileAsync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--loglevel", "error"], {
    cwd: path.join(STAGING_DIR, "agent"),
    shell: process.platform === "win32",
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });

  // 3. Launcher scripts + instructions
  fs.writeFileSync(path.join(STAGING_DIR, "Start AutoPrint Agent.bat"), START_BAT);
  fs.writeFileSync(path.join(STAGING_DIR, "Change Server Settings.bat"), CHANGE_BAT);
  fs.writeFileSync(path.join(STAGING_DIR, "README-START-HERE.txt"), README_TXT);

  // 4. Cache marker (excluded from the zip)
  fs.writeFileSync(BUNDLE_MARKER, hash);
  console.log("[agent-package] portable bundle ready");
}

// Single-flight: concurrent first-time downloads share one build.
let buildPromise = null;
function ensureBundle() {
  if (!buildPromise) {
    buildPromise = buildBundle().catch((err) => {
      buildPromise = null;
      throw err;
    });
  }
  return buildPromise;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Streams the portable agent zip for one shop to `response`.
 * @param {import("express").Response} response
 * @param {{serverUrl: string, runtimeKey: string}} shop
 */
export async function streamAgentPackageZip(response, { serverUrl, runtimeKey }) {
  await ensureBundle();

  // The ONLY shop-specific entry. Injected into the stream so the shared
  // bundle cache never contains a runtime key.
  const config = Buffer.from(
    JSON.stringify({ serverUrl: String(serverUrl).replace(/\/+$/, ""), runtimeKey }, null, 2) + "\r\n",
    "utf-8"
  );

  const archive = new ZipArchive({ zlib: { level: 6 } });
  archive.on("warning", (w) => {
    if (w.code !== "ENOENT") console.warn("[agent-package] zip warning:", w);
  });
  archive.on("error", (err) => {
    console.error("[agent-package] zip error:", err);
    if (!response.headersSent) {
      response.status(500).json({ error: "Could not package the agent. Try again." });
    } else {
      response.destroy(err);
    }
  });

  archive.append(config, { name: "agent-config.json" });
  archive.directory(STAGING_DIR, false);
  archive.pipe(response);

  await new Promise((resolve, reject) => {
    archive.once("error", reject);
    archive.once("end", resolve);
    archive.finalize();
  });
  console.log(`[agent-package] served ${ZIP_FILENAME} (${(archive.pointer() / 1024 / 1024).toFixed(1)} MB)`);
}

export { ZIP_FILENAME, AGENT_DIR };
