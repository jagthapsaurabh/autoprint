# AutoPrint

Silent, unattended print automation for cyber cafés / print shops — a
from-scratch build inspired by the AK Print Hub "Auto Print" flow
(https://akprinthub.com, [demo video](https://www.youtube.com/watch?v=hZNa7VCJUaQ)).

A customer scans the shop's QR, uploads one or more files (photos and/or
PDFs — including multi-page PDFs) from their phone, previews and
(optionally) crops each image, pays online or at the counter, and the job
lands directly on the shop's printer via a small background agent — no
staff involvement, no browser tab needing to stay open.

See [DEPLOYMENT.md](./DEPLOYMENT.md) for handing this off to a real client
(server hosting, agent installer distribution, Docker, backups, billing).

## Architecture

```
apps/
  server/   Node.js/Express API — auth, shop settings, file upload, pricing,
            Razorpay payments, print-job queue, Socket.io live updates.
            Data is stored in an embedded SQLite DB using Node's built-in
            `node:sqlite` module (no native build step required).
  web/      React (Vite) app with two experiences:
              • Customer page  (/print/:shopToken) — upload, crop, pay, track
              • Shop dashboard (/dashboard)         — settings, queue, wallet, QR
  agent/    Node.js background service for the shop's Windows PC — polls the
            queue and prints silently to a real printer (or a virtual
            fallback for local testing). Packaged into a Windows .exe with pkg.
```

## Requirements

- **Node.js 22.13+** (the server uses Node's built-in `node:sqlite` module —
  no native compiler / Visual Studio Build Tools needed, `npm install` just
  works on Windows/macOS/Linux). Check with `node -v`; upgrade from
  https://nodejs.org if needed.

## Getting started (development)

```bash
npm install                      # installs all workspaces

cp apps/server/.env.example apps/server/.env
# edit apps/server/.env and add RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET
# (leave blank to use the built-in "manual confirm" demo payment mode)

npm run dev:server               # http://localhost:4000
npm run dev:web                  # http://localhost:5173
# or: npm run dev                # runs both together
```

Then, in another shell, run a print agent against your local server (useful
for testing without a shop PC):

```bash
cd apps/agent
npm install
AUTOPRINT_SERVER_URL=http://localhost:4000 \
AUTOPRINT_RUNTIME_KEY=<copy from Dashboard → Auto Print Agent> \
npm run dev
```

## End-to-end flow

1. **Shop owner** registers at `/register/shop`, logs into `/dashboard`,
   activates the ₹499/mo Auto Print add-on, and configures rates, payment
   mode and print rules under Settings.
2. **Shop QR**: Dashboard → Shop QR → download & print the QR code, stick it
   at the counter. It encodes `https://<your-domain>/print/<shopToken>`.
3. **Agent install**: Dashboard → Auto Print Agent shows the shop's unique
   runtime key + a downloadable Windows installer. Once running, the agent
   reports the PC's printers back to the dashboard.
4. **Customer**: scans the QR → uploads one or more files (photos and/or
   PDFs, reorderable, each image individually croppable) → they're merged
   server-side into a single print-ready PDF → sees total page count & price
   → pays via Razorpay (or the shop's configured cash/no-payment mode) → job
   appears in the shop dashboard queue and on the agent's poll, and prints
   automatically.
5. **Shop dashboard**: sees the live queue (Socket.io), can approve/reject
   jobs if "Approval Before Print" is enabled, and tracks wallet balance
   from online payments.

## Payments

Real payments go through [Razorpay](https://razorpay.com) (UPI/cards). Add
your test or live `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` to
`apps/server/.env` — get free test keys at
https://dashboard.razorpay.com/app/keys. Without keys configured, the app
automatically falls back to a manual "I've paid" confirm step so the whole
flow still works for demos/dev.

## Multi-file & multi-page uploads

A customer can select several photos and/or PDFs in one go (up to 20 files,
30MB each, 150MB combined). They're merged **server-side** — in upload order,
reorderable and individually croppable before submitting — into a single
print-ready PDF using `pdf-lib` (page copying/merging) and `jimp` (pure-JS
image decoding, no native build step). Multi-page PDFs contribute all of
their pages to the page count/price; each image contributes one page, scaled
to fit an A4 page. The merged PDF is what's actually queued and printed, so
the shop's printer only ever receives one combined file per job.

## Production hardening

- `helmet` (security headers), `compression`, request logging (`morgan`),
  and rate limiting (`express-rate-limit`) on all public/auth endpoints.
- Centralized error handling — routes never leak raw stack traces to
  clients; unhandled promise rejections/exceptions are logged, not fatal.
- Path-traversal guards on file references, upload size/type/count limits,
  and automatic cleanup of uploaded files + old finished job records via a
  daily cron job (`FILE_RETENTION_MS` / `JOB_RECORD_RETENTION_MS` in
  `.env`).
- Refuses to boot with `NODE_ENV=production` if `JWT_SECRET` is left at its
  insecure default.
- Single-process production deployment: `npm run build && npm start` serves
  the built web app and the API from one server (see `apps/server/src/index.js`
  static-serving block), with a PM2 `ecosystem.config.cjs` and a
  multi-stage `Dockerfile` provided for real deployments.

## Notes on parity with the reference product

This reproduces the core "Auto Print" functionality shown in the AK Print
Hub demo: QR-based customer upload, price-per-page by color/gray, online or
cash payment modes, approval-before-print, shop wallet, and a background
Windows agent for silent printing. It intentionally does **not** copy AK
Print Hub's other unrelated tools (ID card cropping, resume builder,
government-portal links, etc.) — this build is scoped to the Auto Print
feature the user asked to replicate. Ask if you'd like any of those
additional tools added on top.
