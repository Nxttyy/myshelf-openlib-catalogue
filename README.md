# Dora

A record of the books you own. Monorepo:

- `api/` FastAPI backend: JSON API, Alembic migrations, MCP endpoint, and in production it also serves the built web app.
- `web/` React frontend (Vite + TypeScript). See `web/README.md`.
- `launch-film/` launch video source.

## Develop

Run the API (from `api/`), then the web app (from `web/`):

```sh
cd api
python -m venv venv && venv/bin/pip install -r requirements.txt
venv/bin/alembic upgrade head
venv/bin/uvicorn app.main:app --reload          # :8000, API only in dev

cd ../web
npm install
npm run dev                                     # http://localhost:5173
```

Open the app at :5173. Vite forwards API calls to :8000, so there's one origin and the login cookie works as-is.

To land back on the dev app after Google sign-in, set `FRONTEND_URL=http://localhost:5173` in `api/.env`.

### On your phone (camera scanning)

Phone cameras only work on HTTPS pages, so:

```sh
cd web && npm run dev:phone
```

Open the `Network: https://…:5173` address it prints on a phone on the same Wi-Fi, and accept the certificate warning once (it's self-signed).

## Production

```sh
cd web && npm ci && npm run build               # writes web/dist
cd ../api && venv/bin/alembic upgrade head
venv/bin/uvicorn app.main:app --proxy-headers --forwarded-allow-ips='*'
```

FastAPI serves `web/dist` itself: hashed files under `/assets` are cached forever, every page path gets `index.html`. Rebuild and restart to deploy a new version. `--proxy-headers` matters behind an HTTPS reverse proxy: it's how the phone scan QR code gets an `https://` link.

Settings in `api/.env` that matter in production:

- `PUBLIC_URL`, the site's address (e.g. `https://dora.you.et`), used in password-reset emails and link previews.
- `GOOGLE_REDIRECT_URI`, the production callback (`https://…/auth/google/callback`).
- `WEB_DIST`, only if the built app lives somewhere other than `web/dist`.
