import { lazy, Suspense } from 'react'
import { createBrowserRouter, type RouteObject } from 'react-router'
import AppLayout from './layout/AppLayout'
import Explore from './routes/Explore'
import Guide from './routes/Guide'
import Home from './routes/Home'
import NotFound from './routes/NotFound'
import { MyProfile, PublicProfile } from './routes/Profile'
import ForgotPassword from './routes/auth/ForgotPassword'
import Login from './routes/auth/Login'
import Register from './routes/auth/Register'
import ResetPassword from './routes/auth/ResetPassword'

// Mirrors the current Jinja pages (api/app/routers/pages.py). Views that used
// to be #hash tabs on `/` are real history entries now, so Back works.
// Explore lives at /explore because /books is an API prefix.
// /mobile-scan/:token deliberately stays a standalone FastAPI page so phones
// don't download the whole app just to scan.
const pages: RouteObject[] = [
  { index: true, element: <Home /> },
  { path: 'explore', element: <Explore /> },
  { path: 'guide', element: <Guide /> },
  { path: 'profile', element: <MyProfile /> },
  { path: 'u/:handle', element: <PublicProfile /> },
  { path: '*', element: <NotFound /> },
]

if (import.meta.env.DEV) {
  const Kit = lazy(() => import('./routes/Kit'))
  pages.unshift({ path: 'dev/kit', element: <Suspense><Kit /></Suspense> })
}

export const router = createBrowserRouter([
  { path: '/', element: <AppLayout />, children: pages },
  // Full-screen, outside the shell: on phones the design's sign-in covers the tab bar.
  { path: '/login', element: <Login /> },
  { path: '/register', element: <Register /> },
  { path: '/forgot-password', element: <ForgotPassword /> },
  { path: '/reset-password', element: <ResetPassword /> },
])
