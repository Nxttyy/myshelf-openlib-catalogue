import { createBrowserRouter } from 'react-router'
import Placeholder from './routes/Placeholder'

// Mirrors the current Jinja pages (app/routers/pages.py) plus the views that
// used to be #hash tabs on `/`, now real history entries so Back works.
// /mobile-scan/:token deliberately stays a standalone FastAPI page so phones
// don't download the whole app just to scan.
export const router = createBrowserRouter([
  { path: '/', element: <Placeholder name="home" /> },
  { path: '/books', element: <Placeholder name="explore" /> },
  { path: '/shelf', element: <Placeholder name="shelf" /> },
  { path: '/scan', element: <Placeholder name="scan" /> },
  { path: '/u/:handle', element: <Placeholder name="public profile" /> },
  { path: '/guide', element: <Placeholder name="guide" /> },
  { path: '/login', element: <Placeholder name="login" /> },
  { path: '/register', element: <Placeholder name="register" /> },
  { path: '/forgot-password', element: <Placeholder name="forgot password" /> },
  { path: '/reset-password', element: <Placeholder name="reset password" /> },
  { path: '*', element: <Placeholder name="not found" /> },
])
