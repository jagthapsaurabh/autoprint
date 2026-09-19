# Deploying AutoPrint for a client / net café

This covers taking AutoPrint from "runs on my laptop" to something you can
hand off to a client (a print shop chain, a net café owner, etc.) to run in
production.

## 1. Server (one machine, can be a small cloud VM or an on-site PC)

The server is the only piece that needs a public/reachable URL — it hosts
the customer upload page, the shop dashboard, and the API the print agents
talk to.

```bash
git clone <your-repo>
cd autoprint
npm install
cp apps/server/.env.example apps/server/.env
```

Edit `apps/server/.env`:

- `JWT_SECRET` — set a long random string (e.g. `openssl rand -hex 32`). The
  server **refuses to start in production** with the placeholder value, by design.
- `PUBLIC_BASE_URL` — the public URL customers will scan (used inside the
  generated QR codes), e.g. `https://print.yourdomain.com`.
- `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` — get live keys from
  https://dashboard.razorpay.com/app/keys once KYC is done. Leave blank to
  keep the built-in manual "confirm payment" demo mode.
- `NODE_ENV=production`

Build the web app and start everything as a single process:

```bash
npm run build      # builds apps/web/dist
npm start          # serves API + web app together on $PORT (default 4000)
```

Put this behind a reverse proxy (Nginx/Caddy) with HTTPS, or run directly if
your host already terminates TLS. For a persistent production process, use
PM2:

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup
```

### Docker option

```bash
docker build -f apps/server/Dockerfile -t autoprint-server .
docker run -d -p 4000:4000 --env-file apps/server/.env \
  -v autoprint-data:/data --name autoprint autoprint-server
```

The SQLite DB and uploaded files persist in the `autoprint-data` volume.

## 2. Shop PC print agent (one per shop / per printer)

Every shop that wants Auto Print installs the small background agent on the
Windows PC connected to their printer:

1. Shop owner logs into the dashboard → **Auto Print Agent** → copies their
   **runtime key**.
2. On the shop PC, package the agent into a Windows `.exe` (see
   `apps/agent/README.md` for the `pkg` + Inno Setup steps) — do this once,
   then distribute the resulting installer to every client shop.
3. Run the installer, paste the runtime key + your server's public URL when
   prompted (or edit `%USERPROFILE%\.autoprint\agent-config.json`).
4. The agent auto-detects installed printers and starts polling for jobs.
   Add it to Windows Startup so it survives reboots (see agent README).

## 3. Onboarding a new client / shop (day-to-day)

1. Shop owner registers at `/register/shop`, logs into `/dashboard`.
2. Activates the Auto Print add-on (wire this to a real subscription charge
   via `POST /api/shop/subscription/activate` — currently a manual toggle;
   see "Billing" below to make this a real recurring charge).
3. Configures rates, payment mode, and (optionally) approval-before-print
   under **Settings**.
4. Installs/starts the agent on their PC (**Auto Print Agent** page).
5. Downloads their QR from **Shop QR** and prints it for the counter.

## 4. Billing the ₹499/mo Auto Print subscription for real

Right now `POST /api/shop/subscription/activate` just flips a flag — good
enough for a pilot. For real recurring billing, wire it to Razorpay
Subscriptions (or any gateway) and have a webhook flip
`subscriptionActive`/`subscriptionUntil` on successful payment /
cancellation. Ask if you'd like this built out.

## 5. Operational notes

- **File & data retention**: uploaded/merged PDFs are deleted automatically
  once a job reaches a final state and its retention window passes
  (`FILE_RETENTION_MS`, default 24h); old finished job rows are purged after
  `JOB_RECORD_RETENTION_MS` (default 30 days). Tune both in `.env`.
- **Rate limiting**: public upload/payment endpoints are throttled
  (`express-rate-limit`) to reduce abuse from a single IP; auth endpoints are
  throttled harder against brute-forcing.
- **Backups**: back up the SQLite file (`apps/server/dev.db` by default, or
  your `DATABASE_URL` path) and the `UPLOAD_DIR` folder if you want to retain
  history beyond the retention window.
- **Multiple shops**: the same server supports unlimited shops — each has
  its own QR/token, runtime key, settings and wallet. No extra deployment
  needed per client, only a new agent install on their PC.
