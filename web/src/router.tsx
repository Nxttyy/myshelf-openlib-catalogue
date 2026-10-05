import { lazy, Suspense } from 'react'
import { createBrowserRouter, type RouteObject } from 'react-router'
import AppLayout from './layout/AppLayout'
import Placeholder from './routes/Placeholder'

// Mirrors the current Jinja pages (api/app/routers/pages.py). Views that used
// to be #hash tabs on `/` are real history entries now, so Back works.
// Explore lives at /explore because /books is an API prefix.
// /mobile-scan/:token deliberately stays a standalone FastAPI page so phones
// don't download the whole app just to scan.
const pages: RouteObject[] = [
  { index: true, element: <Placeholder name="home" /> },
  { path: 'explore', element: <Placeholder name="explore" /> },
  { path: 'guide', element: <Placeholder name="guide" /> },
  { path: 'profile', element: <Placeholder name="profile" /> },
  { path: 'u/:handle', element: <Placeholder name="public profile" /> },
  { path: 'login', element: <Placeholder name="login" /> },
  { path: 'register', element: <Placeholder name="register" /> },
  { path: 'forgot-password', element: <Placeholder name="forgot password" /> },
  { path: 'reset-password', element: <Placeholder name="reset password" /> },
  { path: '*', element: <Placeholder name="not found" /> },
]

if (import.meta.env.DEV) {
  const Kit = lazy(() => import('./routes/Kit'))
  pages.unshift({ path: 'dev/kit', element: <Suspense><Kit /></Suspense> })
}

export const router = createBrowserRouter([{ path: '/', element: <AppLayout />, children: pages }])
