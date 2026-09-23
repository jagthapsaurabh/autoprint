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
3. `~/.autoprint/agent-config.json` — `{ "serverUrl": "...", "runtimeKey": "..." }`

The shop dashboard shows the exact `.env` snippet to use for a given shop.

## Packaging as a Windows installer/.exe

This project uses [`pkg`](https://www.npmjs.com/package/pkg) to bundle the
agent + Node runtime into a single Windows executable (matching the
"AkPrintHub-Smart-AutoPrint-Setup.exe" style installer from the reference
product):

```bash
cd apps/agent
npm install
npm run package:win
# -> dist/AutoPrint-Agent.exe
```

For a proper installer experience (Start Menu shortcut, "Run at startup",
Windows Firewall prompt handling, etc.) wrap the resulting `.exe` with
[Inno Setup](https://jrsoftware.org/isinfo.php) or
[electron-builder](https://www.electron.build/) NSIS target. A minimal Inno
Setup script is included at `installer/autoprint-agent.iss` as a starting
point — it just needs the packaged `.exe` and the app icon.

### Auto-start with Windows

Recommended: register the agent as a Windows service using
[`node-windows`](https://www.npmjs.com/package/node-windows), or simply
place a shortcut to `AutoPrint-Agent.exe` in:

```
C:\Users\<user>\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup
```

so it launches automatically when the shop PC boots — this is what keeps
printing working even if nobody is logged into the browser.
