# Dora web

React frontend for Dora. Replaces the Jinja templates in `app/templates` page by page.

## Dev

Run the API (`../api`) on :8000 as usual, then:

```sh
npm install
npm run dev        # http://localhost:5173
```

Vite proxies the API paths (`/books`, `/auth`, `/scan`, `/dora`, ...) to :8000, so
the browser sees a single origin and the `access_token` cookie works unchanged.

On a phone (camera scanning needs HTTPS): `npm run dev:phone`, then open the
`Network: https://…` address on the same Wi-Fi and accept the certificate once.

## Scripts

- `npm run gen:api` regenerates `src/api/schema.d.ts` from the FastAPI app
  (no server needed). Run it after changing a response model.
- `npm run typecheck`, `npm run lint`, `npm run build` (writes `dist/`, which FastAPI serves in production)

## Layout

- `src/styles/` the Folio design's CSS, copied verbatim (`tokens.css`, `styles.css`, `desktop.css`), plus `app.css`, the only place app-specific changes go
- `src/api/` fetch client, generated types, query hooks and mutations
- `src/routes/` one component per page (each its own chunk, except Home)
- `src/components/` covers, overlays, shelf views, photo notes, the add dialog (`add/`)
- `src/lib/` the scan queue, barcode scanner, overlay-in-the-URL helper
- `src/router.tsx` route table
