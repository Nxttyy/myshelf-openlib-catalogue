import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// FastAPI on :8000 owns these paths. Proxying them keeps the browser on a
// single origin in dev, so the httponly `access_token` cookie just works
// (no CORS, no SameSite juggling) — the same shape as production, where
// FastAPI serves the built app.
const API_PREFIXES = ['/books', '/auth', '/scan', '/dora', '/mobile-scan', '/static', '/health']

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      API_PREFIXES.map((p) => [p, { target: 'http://localhost:8000', changeOrigin: false }]),
    ),
  },
})
