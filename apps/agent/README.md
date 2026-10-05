# AutoPrint Agent

Small background service that runs on the **shop's Windows PC**, connects to
your AutoPrint server, polls for paid/approved print jobs, and sends them
straight to a real printer — silently, with no browser tab required.

## How it works

1. Shop owner activates "Auto Print" in the dashboard and gets a **runtime
   key** (`apps/web` → Dashboard → Auto Print Agent).
2. This agent authenticates to the server with that key
   (`x-runtime-key` header) and reports the printers installed on the PC.
3. Every few seconds it polls `GET /api/agent/queue` for jobs that are ready
   (`QUEUED`, or `APPROVED` if the shop requires manual approval).
4. For each job it downloads the file, prints it with the configured
   copies/color settings, then reports back `PRINTING` → `PRINTED` / `FAILED`.

## Running in development

```bash
cd apps/agent
npm install
AUTOPRINT_SERVER_URL=http://localhost:4000 \
AUTOPRINT_RUNTIME_KEY=<shop-runtime-key> \
npm run dev
```

On Linux/macOS (this sandbox) there's no real Windows printer, so the agent
falls back to a **virtual printer** — it copies the "printed" file into
`apps/agent/prints/` and logs it, so you can test the whole pipeline without
real hardware. On Windows it uses [`pdf-to-printer`](https://www.npmjs.com/package/pdf-to-printer)
(SumatraPDF under the hood) to print to any installed printer.

## Configuration

The agent looks for config in this order:

1. `AUTOPRINT_SERVER_URL` / `AUTOPRINT_RUNTIME_KEY` environment variables
2. `.env` file next to the executable (see `.env.example`)
3. `agent-config.json` in the current working directory — this is what the
   portable bundle uses (the `.bat` launchers start the agent from the
   bundle folder, where the download pre-fills this file)
4. `~/.autoprint/agent-config.json` — `{ "serverUrl": "...", "runtimeKey": "..." }`

The local (bundle) config wins over the home-dir one. The shop dashboard
shows the exact `.env` snippet to use for a given shop.

## Distributing to shop PCs (portable bundle — no install)

The primary way shops get the agent is the **Download Agent Package** button
on the dashboard (Dashboard → Auto Print Agent). The server
(`apps/server/src/lib/agentBundle.js`) builds a self-contained Windows zip:

```
AutoPrint-Agent-Setup/
├─ node/                          portable Node.js (win-x64)
├─ agent/                         this code + pre-installed node_modules
├─ agent-config.json              THIS shop's server URL + runtime key
├─ Start AutoPrint Agent.bat      double-click to run
├─ Change Server Settings.bat     re-enter URL/key (rewrites the config)
└─ README-START-HERE.txt          plain-English instructions
```

Shop experience: **download → unzip → double-click "Start AutoPrint Agent.bat"**
→ a status page opens in their **browser** (green "Connected", printers,
last job). No Node.js, no npm, no installer, no typing config, and no black
console window to babysit — the `.bat` starts the agent in a *minimized*
window using Windows' built-in VBS, and everything the shop needs to see is
on the page:

- **Status page** (`http://127.0.0.1:4173`, bound to localhost only, tries
  4173–4182 if busy): connection state, detected printers, last job result,
  and a **"Start with Windows"** button that adds/removes the agent from the
  Startup folder (built-in `cscript` + WScript.Shell — nothing to install).
  Override the port with `AUTOPRINT_STATUS_PORT`.
- **`agent.log`** in the agent's folder: full timestamped log (rolls at ~1MB)
  so a shop owner can email one file for support instead of describing errors.
- `Change Server Settings.bat` re-enters URL/key and restarts the agent.

The bundle is built once and cached in `dist/portable-build` (gitignored);
it rebuilds when the agent source changes, and only `agent-config.json`
differs per shop (injected into the zip stream at download time — never
written into the shared cache).

The portable Node runtime is fetched on first build from `nodejs.org`
(override with `AGENT_NODE_DIST_BASE_URL` for a mirror, or
`AGENT_NODE_ZIP_PATH` for a fully offline build; version via
`AGENT_BUNDLE_NODE_VERSION`, default 22.22.3).

### Legacy: single .exe via pkg

An older approach bundles the agent with
[`pkg`](https://www.npmjs.com/package/pkg) (`npm run package:win`) — pkg is
unmaintained and the portable bundle is strongly preferred. An Inno Setup
script at `installer/autoprint-agent.iss` remains for that path.

### Auto-start with Windows

Recommended: register the agent as a Windows service using
[`node-windows`](https://www.npmjs.com/package/node-windows), or simply
place a shortcut to `AutoPrint-Agent.exe` in:

```
C:\Users\<user>\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup
```

so it launches automatically when the shop PC boots — this is what keeps
printing working even if nobody is logged into the browser.
