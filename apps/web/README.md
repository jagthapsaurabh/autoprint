# AutoPrint Web

React (Vite) frontend with two experiences:

- `/print/:shopToken` — customer-facing upload → preview/crop → pay → track page.
- `/dashboard` — shop owner dashboard (queue, settings, agent setup, wallet, QR).

See the repo root [README](../../README.md) for full setup instructions.

```bash
npm install
npm run dev      # http://localhost:5173, proxies /api to the server on :4000
npm run build    # production build to dist/
```
