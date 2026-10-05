// Local status page for the agent — the "no black window" UI for
// non-technical shop users.
//
// Binds to 127.0.0.1 only (never exposed to the network), serves:
//   GET  /            a simple, big-font status page (auto-refreshes)
//   GET  /api/status  JSON state (connection, printers, last job, auto-start)
//   POST /api/autostart  { enabled: true|false } — adds/removes the agent
//                         from Windows Startup (built-in VBS, no installers)
//
// The .bat launcher opens this page in the default browser after start.

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const STATUS_SHORTCUT_NAME = "AutoPrint Agent.lnk";

export function startupShortcutPath() {
  return path.join(
    os.homedir(),
    "AppData",
    "Roaming",
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Startup",
    STATUS_SHORTCUT_NAME
  );
}

/**
 * VBS that creates the Startup-folder shortcut pointing at the launcher bat.
 * Exported separately so the generated script is unit-testable.
 */
export function buildAutostartVbs(targetBat, workingDir) {
  return [
    'Set ws = CreateObject("WScript.Shell")',
    'Set sc = ws.CreateShortcut(ws.SpecialFolders("Startup") & "\\AutoPrint Agent.lnk")',
    `sc.TargetPath = "${targetBat}"`,
    `sc.WorkingDirectory = "${workingDir}"`,
    'sc.Description = "AutoPrint Agent"',
    "sc.Save",
  ].join("\r\n");
}

async function setAutostart(enabled) {
  if (process.platform !== "win32") {
    return { supported: false, enabled: false };
  }
  const lnk = startupShortcutPath();
  if (!enabled) {
    try {
      await fs.promises.unlink(lnk);
    } catch {}
    return { supported: true, enabled: false };
  }
  const bat = path.join(process.cwd(), "Start AutoPrint Agent.bat");
  if (!fs.existsSync(bat)) {
    return { supported: true, enabled: false, error: "Start AutoPrint Agent.bat not found next to the agent." };
  }
  const vbsFile = path.join(os.tmpdir(), `autoprint-autostart-${process.pid}.vbs`);
  fs.writeFileSync(vbsFile, buildAutostartVbs(bat, process.cwd()));
  try {
    await execFileAsync("cscript", ["//nologo", vbsFile]);
    return { supported: true, enabled: fs.existsSync(lnk) };
  } catch (err) {
    return { supported: true, enabled: false, error: err.message };
  } finally {
    fs.unlink(vbsFile, () => {});
  }
}

function autostartState() {
  if (process.platform !== "win32") return { supported: false, enabled: false };
  return { supported: true, enabled: fs.existsSync(startupShortcutPath()) };
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AutoPrint Agent</title>
<style>
  body { font-family: "Segoe UI", Arial, sans-serif; background: #f5f6fb; color: #1e2233; margin: 0; padding: 28px 16px; }
  .card { max-width: 620px; margin: 0 auto; background: #fff; border-radius: 16px; padding: 28px; box-shadow: 0 4px 24px rgba(20, 20, 60, 0.08); }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: #6b7085; margin: 0 0 20px; font-size: 14px; }
  .status { display: flex; align-items: center; gap: 12px; font-size: 19px; font-weight: 700; padding: 16px 18px; border-radius: 12px; margin-bottom: 18px; }
  .ok { background: #e8f8ee; color: #0a7a3d; }
  .bad { background: #fdecec; color: #b3261e; }
  .dot { width: 14px; height: 14px; border-radius: 50%; background: currentColor; flex-shrink: 0; }
  .row { display: flex; justify-content: space-between; gap: 16px; padding: 11px 0; border-bottom: 1px solid #eef0f6; font-size: 15px; }
  .row .k { color: #6b7085; }
  .row .v { font-weight: 600; text-align: right; word-break: break-word; }
  .btn { display: block; width: 100%; margin: 22px 0 6px; padding: 13px; font-size: 15px; font-weight: 700; color: #fff; background: #4f46e5; border: none; border-radius: 10px; cursor: pointer; }
  .btn:disabled { opacity: 0.6; cursor: default; }
  .btn.secondary { background: #eef0f6; color: #1e2233; }
  .note { font-size: 13px; color: #6b7085; line-height: 1.6; margin-top: 18px; }
  .note b { color: #1e2233; }
</style>
</head>
<body>
  <div class="card">
    <h1>🖨️ AutoPrint Agent</h1>
    <p class="sub">This page shows the print agent running on this computer.</p>

    <div id="status" class="status bad"><span class="dot"></span><span id="statusText">Checking…</span></div>

    <div class="row"><span class="k">Server</span><span class="v" id="server">–</span></div>
    <div class="row"><span class="k">Printers</span><span class="v" id="printers">–</span></div>
    <div class="row"><span class="k">Last job</span><span class="v" id="lastjob">–</span></div>
    <div class="row"><span class="k">Running since</span><span class="v" id="since">–</span></div>

    <button id="autostart" class="btn" onclick="toggleAutostart()">…</button>

    <p class="note">
      To <b>stop</b> the agent: find the small "AutoPrint Agent" window in the
      Windows taskbar (bottom of the screen) and close it.<br>
      To change the server or key later: double-click <b>Change Server Settings.bat</b>
      in the agent's folder.
    </p>
  </div>
<script>
  let autostartEnabled = false;
  async function refresh() {
    try {
      const s = await (await fetch("/api/status")).json();
      const el = document.getElementById("status");
      el.className = "status " + (s.connected ? "ok" : "bad");
      document.getElementById("statusText").textContent = s.connected
        ? "Connected — printing automatically"
        : "Not connected to the server";
      document.getElementById("server").textContent = s.serverUrl || "–";
      document.getElementById("printers").textContent =
        s.printers && s.printers.length ? s.printers.join(", ") : "none detected";
      document.getElementById("lastjob").textContent = s.lastJob
        ? s.lastJob.fileName + " — " + s.lastJob.status + " (" + new Date(s.lastJob.at).toLocaleString() + ")"
        : "none yet";
      document.getElementById("since").textContent = new Date(s.startedAt).toLocaleString();
      const b = document.getElementById("autostart");
      if (s.autostart && s.autostart.supported) {
        b.style.display = "";
        autostartEnabled = !!s.autostart.enabled;
        b.textContent = autostartEnabled
          ? "Remove “Start with Windows”"
          : "Start with Windows (recommended)";
        b.className = "btn" + (autostartEnabled ? " secondary" : "");
      } else {
        b.style.display = "none";
      }
    } catch (e) { /* agent restarted? retry on next tick */ }
  }
  async function toggleAutostart() {
    const b = document.getElementById("autostart");
    b.disabled = true;
    try {
      const r = await fetch("/api/autostart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !autostartEnabled }),
      });
      const j = await r.json();
      if (!r.ok) alert(j.error || "Could not change the setting.");
      refresh();
    } finally { b.disabled = false; }
  }
  refresh();
  setInterval(refresh, 3000);
</script>
</body>
</html>
`;

/**
 * Starts the status server on 127.0.0.1. Tries `port`, then the next 9
 * ports (a different app may hold 4173). Returns { url } on success or
 * null when no port was available (the agent keeps working without the page).
 */
export async function startStatusServer({ port = 4173, getState, onOpen } = {}) {
  const server = http.createServer((req, res) => {
    try {
      if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(PAGE);
      } else if (req.method === "GET" && req.url === "/api/status") {
        const s = getState ? getState() : {};
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ...s, autostart: autostartState() }));
      } else if (req.method === "POST" && req.url === "/api/autostart") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", async () => {
          let enabled;
          try {
            enabled = JSON.parse(body || "{}").enabled;
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid request" }));
            return;
          }
          const result = await setAutostart(Boolean(enabled));
          res.writeHead(result.error ? 500 : 200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        });
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
      }
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  for (let p = port; p < port + 10; p += 1) {
    try {
      await new Promise((resolve, reject) => {
        const onError = (err) => {
          server.removeListener("listening", resolve);
          reject(err);
        };
        server.once("error", onError);
        server.listen(p, "127.0.0.1", () => {
          server.removeListener("error", onError);
          resolve();
        });
      });
      const url = `http://127.0.0.1:${p}/`;
      if (typeof onOpen === "function") onOpen(url);
      return { url, close: () => server.close() };
    } catch (err) {
      if (err.code !== "EADDRINUSE") {
        console.warn("[status-page] could not start:", err.message);
        return null;
      }
    }
  }
  console.warn("[status-page] no free port found (4173-4182) — continuing without the status page");
  return null;
}
