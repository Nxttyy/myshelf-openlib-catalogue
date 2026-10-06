import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// FastAPI on :8000 owns these paths. Proxying them keeps the browser on a
// single origin in dev, so the httponly `access_token` cookie just works
// (no CORS, no SameSite juggling) — the same shape as production, where
// FastAPI serves the built app.
// DORA_API overrides the backend address, e.g. to run a second copy on another port.
const API_TARGET = process.env.DORA_API ?? 'http://localhost:8000'

const API_PREFIXES = ['/books', '/auth', '/profiles', '/scan', '/dora', '/mobile-scan', '/static', '/health']

// `npm run dev:phone`: serve over HTTPS on the local network, because phone
// cameras only work on secure pages. The certificate is self-signed, so the
// phone shows a warning once; accept it to continue.
const PHONE = !!process.env.PHONE

export default defineConfig({
  plugins: [react(), ...(PHONE ? [basicSsl()] : [])],
  server: {
    port: 5173,
    host: PHONE ? true : undefined,
    proxy: Object.fromEntries(
      API_PREFIXES.map((p) => [p, {
        target: API_TARGET,
        changeOrigin: false,
        // X-Forwarded-Proto lets the API build https:// links (the phone
        // hand-off QR code) when the page itself was served over HTTPS.
        xfwd: true,
      }]),
    ),
  },
})
