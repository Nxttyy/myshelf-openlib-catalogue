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

## Scripts

- `npm run gen:api` regenerates `src/api/schema.d.ts` from the FastAPI app
  (no server needed). Run it after changing a response model.
- `npm run typecheck`, `npm run lint`, `npm run build`

## Layout

- `src/api/` fetch client, generated types, query hooks
- `src/routes/` one component per page
- `src/router.tsx` route table
